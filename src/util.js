const crypto = require("crypto");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
    if (!stored || typeof password !== "string") return false;
    const [salt, expected] = String(stored).split(":");
    if (!salt || !expected) return false;
    const actual = Buffer.from(hashPassword(password, salt).split(":")[1], "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function parseBody(body) {
    if (typeof body === "string") {
        try { return JSON.parse(body); } catch { return body; }
    }
    return body;
}

function normalizePayload(payload) {
    const parsed = parseBody(payload);
    if (!parsed || typeof parsed !== "object") return parsed;
    if (!Array.isArray(parsed.values)) return parsed;
    const map = new Map();
    for (const item of parsed.values) {
        if (!item || !item.id) continue;
        const prev = map.get(String(item.id));
        if (!prev || (item.t && (!prev.t || item.t >= prev.t))) map.set(String(item.id), item);
    }
    return { ...parsed, values: Array.from(map.values()) };
}

function mergeMachineData(existing, incoming) {
    if (!incoming) return existing;
    const parsed = normalizePayload(incoming);
    if (!parsed || typeof parsed !== "object") return parsed;
    if (!existing || typeof existing !== "object") return parsed;
    const tagMap = new Map((existing.values || []).filter(item => item && item.id).map(item => [String(item.id), item]));
    (parsed.values || []).filter(item => item && item.id).forEach(item => tagMap.set(String(item.id), item));
    return {
        ...existing,
        ...parsed,
        timestamp: parsed.timestamp || parsed.time || existing.timestamp || existing.time,
        values: Array.from(tagMap.values())
    };
}

function machineName(value) {
    const raw = String(value || "").toUpperCase();
    if (raw.includes("PSG")) return "PSG";
    if (raw.includes("RO")) return "RO";
    return null;
}

function sampleTime(value, fallback = new Date()) {
    if (value === undefined || value === null || value === "") return fallback.toISOString();
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && numeric > 1000000000
        ? new Date(numeric > 1e11 ? numeric : numeric * 1000)
        : new Date(value);
    return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

const sessionToken = req => req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("plc_session="))?.slice("plc_session=".length);
const clampLimit = value => Math.min(Math.max(Number(value) || 500, 1), 2000);
const defaultRange = query => [sampleTime(query.from, new Date(Date.now() - 24 * 60 * 60 * 1000)), sampleTime(query.to, new Date())];

function jsonValue(value) {
    return value === undefined ? null : JSON.stringify(value);
}

module.exports = { hashPassword, verifyPassword, parseBody, normalizePayload, mergeMachineData, machineName, sampleTime, jsonValue, sessionToken, clampLimit, defaultRange };
