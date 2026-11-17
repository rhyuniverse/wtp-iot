const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { pool, config: dbConfig, initSchema } = require("./db");
const { hashPassword, verifyPassword, parseBody, normalizePayload, mergeMachineData, machineName, sampleTime, jsonValue, sessionToken, clampLimit, defaultRange } = require("./util");

const app = express();
const sessions = new Map();
const loginFailures = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const RETENTION_DAYS = Math.min(Math.max(Number(process.env.HISTORY_RETENTION_DAYS) || 90, 1), 3650);
const builtInRoles = {
    admin: ["*"],
    operator: ["pid.view", "alarm.view", "alarm.acknowledge", "history.view", "history.export"],
    viewer: ["pid.view", "alarm.view", "history.view"]
};

const all = async (sql, params = []) => (await pool.query(sql, params))[0];
const one = async (sql, params = []) => (await all(sql, params))[0];
const run = async (sql, params = []) => (await pool.query(sql, params))[0];

async function bootstrap() {
    await initSchema();
    for (const [name, permissions] of Object.entries(builtInRoles)) {
        await run("INSERT IGNORE INTO roles(name, permissions) VALUES (?, ?)", [name, JSON.stringify(permissions)]);
    }
    const configuredAdmin = String(process.env.ADMIN_USERNAME || "admin").trim();
    const bootstrapUser = /^[A-Za-z0-9._-]{3,48}$/.test(configuredAdmin) ? configuredAdmin : "admin";
    const bootstrapPassword = process.env.ADMIN_PASSWORD || "";
    if ((await one("SELECT count(*) AS count FROM users")).count === 0 && bootstrapPassword.length >= 12 && bootstrapPassword.length <= 128) {
        await run("INSERT INTO users(username, password_hash, role) VALUES (?, ?, 'admin')", [bootstrapUser, hashPassword(bootstrapPassword)]);
    }
}

app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: "*/*", limit: "1mb" }));
app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/data" || req.path.startsWith("/data/")) res.setHeader("Cache-Control", "no-store");
    next();
});

async function addActivity(actor, action, target, details = {}) {
    await run("INSERT INTO activity(actor, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)",
        [actor, action, target, JSON.stringify(details), new Date().toISOString()]);
}

async function userFromRequest(req) {
    const token = sessionToken(req);
    if (!token) return null;
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) {
        sessions.delete(token);
        return null;
    }
    const user = await one("SELECT username, role FROM users WHERE username = ?", [session.username]);
    if (!user) return null;
    const role = await one("SELECT permissions FROM roles WHERE name = ?", [user.role]);
    return { ...user, permissions: role ? JSON.parse(role.permissions) : [] };
}

async function requireAuth(req, res, next) {
    const user = await userFromRequest(req);
    if (!user) return res.status(401).json({ error: "Login required" });
    req.user = user;
    next();
}

function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.user.permissions.includes("*") && !req.user.permissions.includes(permission)) {
            return res.status(403).json({ error: "Insufficient permissions" });
        }
        next();
    };
}

async function writeMachine(machine, incoming) {
    const previousRow = await one("SELECT payload FROM snapshots WHERE machine = ?", [machine]);
    const previous = previousRow ? JSON.parse(previousRow.payload) : null;
    const normalizedIncoming = normalizePayload(incoming);
    const next = mergeMachineData(previous, normalizedIncoming);
    if (!next || typeof next !== "object") return previous;
    next.timestamp = normalizedIncoming?.timestamp || normalizedIncoming?.time || new Date().toISOString();
    const updatedAt = sampleTime(next.timestamp);
    const values = (Array.isArray(normalizedIncoming?.values) ? normalizedIncoming.values : []).filter(item => item && item.id);
    const rules = new Map((await all("SELECT tag, low, high, severity FROM alarm_rules WHERE machine = ?", [machine])).map(r => [r.tag, r]));
    const active = new Set((await all("SELECT tag FROM alarms WHERE machine = ? AND status = 'active'", [machine])).map(r => r.tag));

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query("INSERT INTO snapshots(machine, payload, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=VALUES(updated_at)",
            [machine, JSON.stringify(next), updatedAt]);
        const samples = [];
        for (const item of values) {
            const tag = String(item.id).slice(0, 160);
            const sampledAt = sampleTime(item.t || next.timestamp || next.time);
            samples.push([machine, tag, jsonValue(item.v), jsonValue(item.q), sampledAt]);
            const rule = rules.get(tag);
            if (!rule || !Number.isFinite(Number(item.v))) continue;
            const number = Number(item.v);
            const out = (rule.low !== null && number < rule.low) || (rule.high !== null && number > rule.high);
            if (out && !active.has(tag)) {
                const side = rule.low !== null && number < rule.low ? `below ${rule.low}` : `above ${rule.high}`;
                await conn.query("INSERT INTO alarms(machine, tag, severity, status, message, value, opened_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
                    [machine, tag, rule.severity, `Value ${number} ${side}`, jsonValue(item.v), sampledAt]);
            } else if (!out && active.has(tag)) {
                await conn.query("UPDATE alarms SET status='cleared', cleared_at=? WHERE machine=? AND tag=? AND status='active'", [sampledAt, machine, tag]);
            }
        }
        if (samples.length) await conn.query("INSERT INTO samples(machine, tag, value, quality, sampled_at) VALUES ?", [samples]);
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
    return next;
}

let ingestQueue = Promise.resolve();
function recordMachine(machine, incoming) {
    const result = ingestQueue.then(() => writeMachine(machine, incoming));
    ingestQueue = result.catch(() => { });
    return result;
}

function resolveMachine(req, body) {
    const parsed = parseBody(body);
    return machineName(req.params.machine || req.query.machine || req.get("x-machine") || parsed?.machine || parsed?.machineId || parsed?.machine_id || parsed?.device);
}

async function ingest(machine, payload) {
    if (machine && (machine === "RO" || machine === "PSG")) await recordMachine(machine, payload);
    else if (payload && typeof payload === "object" && (payload.RO || payload.PSG)) {
        if (payload.RO) await recordMachine("RO", payload.RO);
        if (payload.PSG) await recordMachine("PSG", payload.PSG);
    } else await recordMachine("RO", payload);
}

app.get("/api/auth/status", async (req, res) => {
    const user = await userFromRequest(req);
    const count = (await one("SELECT count(*) AS count FROM users")).count;
    res.json({ setupRequired: count === 0, user: user ? { username: user.username, role: user.role, permissions: user.permissions } : null });
});

app.post("/api/login", async (req, res) => {
    const username = String(req.body?.username || "").trim().slice(0, 48);
    const password = req.body?.password;
    const ip = req.ip || "unknown";
    const attempts = loginFailures.get(ip) || { count: 0, until: 0 };
    if (attempts.until > Date.now()) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    const user = await one("SELECT username, password_hash FROM users WHERE username = ?", [username]);
    if (typeof password !== "string" || password.length > 128 || !user || !verifyPassword(password, user.password_hash)) {
        attempts.count += 1;
        if (attempts.count >= 8) { attempts.count = 0; attempts.until = Date.now() + 15 * 60 * 1000; }
        loginFailures.set(ip, attempts);
        await addActivity(username || "anonymous", "login.failed", "session");
        return res.status(401).json({ error: "Invalid username or password" });
    }
    loginFailures.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { username: user.username, expires: Date.now() + SESSION_MS });
    res.setHeader("Set-Cookie", `plc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`);
    await addActivity(user.username, "login.success", "session");
    res.json({ ok: true });
});

app.post("/api/logout", requireAuth, async (req, res) => {
    sessions.delete(sessionToken(req));
    await addActivity(req.user.username, "logout", "session");
    res.setHeader("Set-Cookie", "plc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    res.json({ ok: true });
});

app.get("/data", requireAuth, requirePermission("pid.view"), async (req, res) => {
    const rows = await all("SELECT machine, payload FROM snapshots");
    const data = { RO: null, PSG: null };
    rows.forEach(row => { data[row.machine] = JSON.parse(row.payload); });
    res.json(data);
});

app.get("/data/:machine", requireAuth, requirePermission("pid.view"), async (req, res) => {
    const machine = machineName(req.params.machine);
    const row = machine && await one("SELECT payload FROM snapshots WHERE machine = ?", [machine]);
    res.json(row ? JSON.parse(row.payload) : { message: "No data received yet" });
});

app.get("/api/history", requireAuth, requirePermission("history.view"), async (req, res) => {
    const machine = machineName(req.query.machine);
    const tag = String(req.query.tag || "").slice(0, 160);
    const [from, to] = defaultRange(req.query);
    const limit = clampLimit(req.query.limit);
    const offset = Math.min(Math.max(Number(req.query.offset) || 0, 0), 100000);
    if (!machine || !tag) return res.status(400).json({ error: "Machine and tag are required" });
    const rows = (await all("SELECT machine, tag, value, quality, sampled_at FROM samples WHERE machine=? AND tag=? AND sampled_at BETWEEN ? AND ? ORDER BY sampled_at DESC LIMIT ? OFFSET ?",
        [machine, tag, from, to, limit, offset])).reverse();
    res.json(rows.map(row => ({ ...row, value: JSON.parse(row.value), quality: JSON.parse(row.quality) })));
});

app.get("/api/history/export", requireAuth, requirePermission("history.export"), async (req, res) => {
    const machine = machineName(req.query.machine);
    const tag = String(req.query.tag || "").slice(0, 160);
    const [from, to] = defaultRange(req.query);
    if (!machine || !tag) return res.status(400).send("Machine and tag are required");
    const rows = await all("SELECT machine, tag, value, quality, sampled_at FROM samples WHERE machine=? AND tag=? AND sampled_at BETWEEN ? AND ? ORDER BY sampled_at DESC LIMIT 10000",
        [machine, tag, from, to]);
    await addActivity(req.user.username, "history.export", `${machine}:${tag}`, { rows: rows.length, from, to });
    const escapeCsv = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [["sampled_at", "machine", "tag", "value", "quality"], ...rows.map(row => [row.sampled_at, row.machine, row.tag, JSON.parse(row.value), JSON.parse(row.quality)])]
        .map(row => row.map(escapeCsv).join(",")).join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="data-record-${machine.toLowerCase()}.csv"`);
    res.send(csv);
});

app.get("/api/alarms", requireAuth, requirePermission("alarm.view"), async (req, res) => {
    const machine = machineName(req.query.machine);
    const status = ["active", "cleared"].includes(req.query.status) ? req.query.status : null;
    const tag = String(req.query.tag || "").slice(0, 160);
    const from = req.query.from ? sampleTime(req.query.from) : null;
    const to = req.query.to ? sampleTime(req.query.to) : null;
    const limit = clampLimit(req.query.limit);
    res.json(await all(`SELECT * FROM alarms WHERE (? IS NULL OR machine=?) AND (? IS NULL OR status=?) AND (?='' OR tag LIKE ?) AND (? IS NULL OR opened_at>=?) AND (? IS NULL OR opened_at<=?) ORDER BY id DESC LIMIT ?`,
        [machine, machine, status, status, tag, `%${tag}%`, from, from, to, to, limit]));
});

app.post("/api/alarms/:id/acknowledge", requireAuth, requirePermission("alarm.acknowledge"), async (req, res) => {
    const result = await run("UPDATE alarms SET acknowledged_at=?, acknowledged_by=? WHERE id=? AND status='active' AND acknowledged_at IS NULL",
        [new Date().toISOString(), req.user.username, Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ error: "No active unacknowledged alarm found" });
    await addActivity(req.user.username, "alarm.acknowledge", `alarm:${req.params.id}`);
    res.json({ ok: true });
});

app.get("/api/alarm-rules", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    res.json(await all("SELECT machine, tag, low, high, severity FROM alarm_rules ORDER BY machine, tag"));
});

app.post("/api/alarm-rules", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    const machine = machineName(req.body?.machine);
    const tag = String(req.body?.tag || "").trim().slice(0, 160);
    const low = req.body?.low === "" || req.body?.low === null || req.body?.low === undefined ? null : Number(req.body.low);
    const high = req.body?.high === "" || req.body?.high === null || req.body?.high === undefined ? null : Number(req.body.high);
    const severity = ["warning", "critical"].includes(req.body?.severity) ? req.body.severity : "warning";
    if (!machine || !tag || (low === null && high === null) || (low !== null && !Number.isFinite(low)) || (high !== null && !Number.isFinite(high)) || (low !== null && high !== null && low >= high)) {
        return res.status(400).json({ error: "Provide a tag and at least one valid numeric limit; the lower limit must be below the upper limit" });
    }
    await run("INSERT INTO alarm_rules(machine, tag, low, high, severity) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE low=VALUES(low), high=VALUES(high), severity=VALUES(severity)",
        [machine, tag, low, high, severity]);
    await addActivity(req.user.username, "alarm.rule.save", `${machine}:${tag}`, { low, high, severity });
    res.json({ ok: true });
});

app.delete("/api/alarm-rules/:machine/:tag", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    const machine = machineName(req.params.machine);
    const tag = String(req.params.tag || "").slice(0, 160);
    await run("DELETE FROM alarm_rules WHERE machine=? AND tag=?", [machine, tag]);
    await run("UPDATE alarms SET status='cleared', cleared_at=? WHERE machine=? AND tag=? AND status='active'", [new Date().toISOString(), machine, tag]);
    await addActivity(req.user.username, "alarm.rule.delete", `${machine}:${tag}`);
    res.json({ ok: true });
});

app.get("/api/roles", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    res.json((await all("SELECT name, permissions FROM roles ORDER BY name")).map(row => ({ name: row.name, permissions: JSON.parse(row.permissions) })));
});

app.post("/api/roles", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    const name = String(req.body?.name || "").trim().toLowerCase();
    const permissions = Array.isArray(req.body?.permissions) && req.body.permissions.length <= 64 ? [...new Set(req.body.permissions.map(String).filter(p => /^[a-z]+\.[a-z]+$|^\*$/.test(p)))] : null;
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(name) || !permissions || (name === "admin" && !permissions.includes("*"))) return res.status(400).json({ error: "Invalid role name or permissions; the admin role must keep full permissions" });
    await run("INSERT INTO roles(name, permissions) VALUES (?, ?) ON DUPLICATE KEY UPDATE permissions=VALUES(permissions)", [name, JSON.stringify(permissions)]);
    await addActivity(req.user.username, "rbac.role.save", name, { permissions });
    res.json({ ok: true });
});

app.delete("/api/roles/:name", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    const name = String(req.params.name || "").toLowerCase();
    if (name === "admin" || await one("SELECT 1 FROM users WHERE role=? LIMIT 1", [name])) return res.status(409).json({ error: "The admin role and roles still in use cannot be deleted" });
    await run("DELETE FROM roles WHERE name=?", [name]);
    await addActivity(req.user.username, "rbac.role.delete", name);
    res.json({ ok: true });
});

app.get("/api/users", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    res.json(await all("SELECT username, role FROM users ORDER BY username"));
});

app.post("/api/users", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = req.body?.password;
    const role = String(req.body?.role || "");
    if (!/^[A-Za-z0-9._-]{3,48}$/.test(username) || typeof password !== "string" || password.length < 12 || password.length > 128 || !await one("SELECT 1 FROM roles WHERE name=?", [role])) {
        return res.status(400).json({ error: "Username must be 3-48 characters, password at least 12 characters, and the role must exist" });
    }
    try {
        await run("INSERT INTO users(username, password_hash, role) VALUES (?, ?, ?)", [username, hashPassword(password), role]);
    } catch {
        return res.status(409).json({ error: "Username already taken" });
    }
    await addActivity(req.user.username, "rbac.user.create", username, { role });
    res.json({ ok: true });
});

app.patch("/api/users/:username", requireAuth, requirePermission("rbac.manage"), async (req, res) => {
    const username = String(req.params.username || "");
    const role = String(req.body?.role || "");
    if (!await one("SELECT 1 FROM roles WHERE name=?", [role])) return res.status(400).json({ error: "Role does not exist" });
    const target = await one("SELECT role FROM users WHERE username=?", [username]);
    const adminCount = (await one("SELECT count(*) AS count FROM users WHERE role='admin'")).count;
    if (username === req.user.username && target?.role === "admin" && role !== "admin" && adminCount < 2) {
        return res.status(409).json({ error: "The last admin cannot demote themselves" });
    }
    if (!target) return res.status(404).json({ error: "User not found" });
    await run("UPDATE users SET role=? WHERE username=?", [role, username]);
    await addActivity(req.user.username, "rbac.user.role", username, { role });
    res.json({ ok: true });
});

app.get("/api/activity", requireAuth, requirePermission("activity.view"), async (req, res) => {
    const limit = clampLimit(req.query.limit);
    const actor = String(req.query.actor || "").slice(0, 80);
    const action = String(req.query.action || "").slice(0, 80);
    const from = req.query.from ? sampleTime(req.query.from) : null;
    const to = req.query.to ? sampleTime(req.query.to) : null;
    res.json(await all("SELECT actor, action, target, details, created_at FROM activity WHERE (?='' OR actor LIKE ?) AND (?='' OR action LIKE ?) AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?) ORDER BY id DESC LIMIT ?",
        [actor, `%${actor}%`, action, `%${action}%`, from, from, to, to, limit]));
});

function pruneMemory() {
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
    for (const [ip, attempts] of loginFailures) if (attempts.until < now) loginFailures.delete(ip);
}

async function pruneHistory() {
    pruneMemory();
    try {
        await run("DELETE FROM samples WHERE sampled_at < ?", [new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()]);
    } catch (error) { console.error("pruneHistory failed", error); }
}

app.post("/:machine", async (req, res, next) => {
    const machine = machineName(req.params.machine);
    if (!machine) return next();
    await ingest(machine, parseBody(req.body));
    res.status(200).send("OK");
});

app.post("/", async (req, res) => {
    const body = parseBody(req.body);
    await ingest(resolveMachine(req, body), body);
    res.status(200).send("OK");
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.get(/.*/, (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Endpoint not found" });
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});
app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: "Internal server error" });
});

bootstrap().then(async () => {
    await pruneHistory();
    setInterval(pruneHistory, 24 * 60 * 60 * 1000).unref();
    app.listen(Number(process.env.PORT) || 3005, "0.0.0.0", async () => {
        console.log(`Listening on http://127.0.0.1:${Number(process.env.PORT) || 3005} (MySQL ${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
        if ((await one("SELECT count(*) AS count FROM users")).count === 0) {
            console.warn("Set ADMIN_PASSWORD to a value of at least 12 characters to create the first admin account.");
        }
    });
}).catch(error => {
    console.error(`Failed to connect to MySQL (${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}): ${error.message}`);
    process.exit(1);
});
