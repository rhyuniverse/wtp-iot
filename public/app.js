let currentView = "overview";
let latestStore = { RO: null, PSG: null };
let filterKeywords = { RO: "", PSG: "" };
let currentUser = null;
let recordPage = 0;
let toastTimer;

function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById("current-clock");
    const hmiClockEl = document.getElementById("hmi-clock");
    if (clockEl) clockEl.textContent = now.toLocaleTimeString("en-GB");
    if (hmiClockEl) {
        const d = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
        const t = now.toLocaleTimeString("en-GB").slice(0, 7) + "..";
        hmiClockEl.textContent = `${d} ${t}`;
    }
}
setInterval(updateClock, 1000);
updateClock();

function toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("open");
}

function toggleNavGroup(machine) {
    const submenu = document.getElementById(`nav-${machine}-submenu`);
    const opening = submenu.hidden;
    ["ro", "psg"].forEach(name => {
        const child = document.getElementById(`nav-${name}-submenu`);
        const toggle = document.querySelector(`[aria-controls="nav-${name}-submenu"]`);
        child.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
    });
    if (opening) {
        submenu.hidden = false;
        document.querySelector(`[aria-controls="nav-${machine}-submenu"]`).setAttribute("aria-expanded", "true");
    }
}

function featureForView(view) {
    return view.replace(/^(?:ro|psg)-/, "");
}

function machineForView(view) {
    if (view.startsWith("ro-")) return "RO";
    if (view.startsWith("psg-")) return "PSG";
    return null;
}

function permissionForView(view) {
    const feature = featureForView(view);
    if (["RO", "PSG", "overview"].includes(feature)) return "pid.view";
    return { pid: "pid.view", tags: "pid.view", analysis: "history.view", records: "history.view", alarms: "alarm.view", rbac: "rbac.manage", activity: "activity.view" }[feature];
}

function switchView(view, btn) {
    const previousMachine = machineForView(currentView);
    currentView = view;
    const machine = machineForView(view);
    if (machine) {
        ["ro", "psg"].forEach(name => {
            const open = name === machine.toLowerCase();
            document.getElementById(`nav-${name}-submenu`).hidden = !open;
            document.querySelector(`[aria-controls="nav-${name}-submenu"]`).setAttribute("aria-expanded", String(open));
        });
    }
    document.querySelectorAll(".nav-menu .nav-link").forEach(link => link.classList.toggle("active", link.dataset.view === view));
    const activeLink = btn || document.querySelector(`[data-view="${view}"]`);
    if (activeLink) activeLink.classList.add("active");

    const analysisMachine = document.getElementById("analysis-machine");
    const recordMachine = document.getElementById("record-machine");
    const alarmMachine = document.getElementById("alarm-machine");
    [analysisMachine, recordMachine, alarmMachine].forEach(select => {
        select.disabled = Boolean(machine);
        if (machine) select.value = machine;
    });
    if (machine && machine !== previousMachine) recordPage = 0;

    const featurePanels = ["analysis", "alarms", "records", "rbac", "activity"];
    const feature = featureForView(view);
    const pageTitle = document.getElementById("page-title");
    const statsSec = document.getElementById("stats-section");
    const container = document.getElementById("panel-container");
    const panelRO = document.getElementById("panel-ro");
    const panelPSG = document.getElementById("panel-psg");
    const panelHMI = document.getElementById("panel-hmi");
    const panelROPid = document.getElementById("panel-ro-pid");
    featurePanels.forEach(name => { document.getElementById(`panel-${name}`).hidden = true; });
    panelROPid.hidden = true;

    if (view === "overview") {
        pageTitle.textContent = "Overview";
        statsSec.style.display = "grid";
        container.style.display = "grid";
        container.className = "panel-container grid-view";
        panelRO.style.display = "flex";
        panelPSG.style.display = "flex";
        panelHMI.style.display = "none";
    } else if (view === "RO") {
        pageTitle.textContent = "RO Machine Monitoring";
        statsSec.style.display = "grid";
        container.style.display = "grid";
        container.className = "panel-container single-view";
        panelRO.style.display = "flex";
        panelPSG.style.display = "none";
        panelHMI.style.display = "none";
    } else if (view === "psg-tags") {
        pageTitle.textContent = "PSG Machine Monitoring";
        statsSec.style.display = "grid";
        container.style.display = "grid";
        container.className = "panel-container single-view";
        panelRO.style.display = "none";
        panelPSG.style.display = "flex";
        panelHMI.style.display = "none";
    } else if (view === "PSG") {
        pageTitle.textContent = "Pure Steam Generator (PSG) Machine P&ID";
        statsSec.style.display = "none";
        container.style.display = "none";
        panelRO.style.display = "none";
        panelPSG.style.display = "none";
        panelHMI.style.display = "flex";
    } else if (view === "ro-pid") {
        pageTitle.textContent = "Reverse Osmosis (RO) Machine P&ID";
        statsSec.style.display = "none";
        container.style.display = "none";
        panelRO.style.display = "none";
        panelPSG.style.display = "none";
        panelHMI.style.display = "none";
        panelROPid.hidden = false;
    } else {
        statsSec.style.display = "none";
        container.style.display = "none";
        panelRO.style.display = "none";
        panelPSG.style.display = "none";
        panelHMI.style.display = "none";
        const panel = featurePanels.includes(feature) ? document.getElementById(`panel-${feature}`) : null;
        if (panel) panel.hidden = false;
        const labels = { analysis: "Trend analysis", alarms: "Log alarm", records: "Data record", rbac: "Access settings", activity: "Activity log" };
        pageTitle.textContent = `${labels[feature] || "Dashboard"}${machine ? ` (${machine})` : ""}`;
    }

    if (window.innerWidth <= 900) {
        document.getElementById("sidebar").classList.remove("open");
    }
    loadFeature(view);
}

const urlParams = new URLSearchParams(window.location.search);
const initView = urlParams.get("view") || "overview";

function handleSearch(machine, val) {
    filterKeywords[machine] = val.trim().toLowerCase();
    renderMachineTable(machine);
}

function formatDisplayTime(val) {
    if (!val || val === "-") return "-";
    const num = Number(val);
    if (!isNaN(num) && num > 1000000000) {
        const date = new Date(num > 1e11 ? num : num * 1000);
        if (!isNaN(date.getTime())) return date.toLocaleTimeString("en-GB");
    }
    if (/^\d{4}-\d\d-\d\dT/.test(String(val))) {
        const date = new Date(val);
        if (!isNaN(date.getTime())) return date.toLocaleTimeString("en-GB");
    }
    return String(val);
}

function parseMachineData(raw) {
    if (!raw) return null;
    let data = raw;
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!data) return null;

    let timestamp = formatDisplayTime(data.timestamp || data.time || "-");
    let list = [];

    const sourceList = Array.isArray(data.values) ? data.values : (Array.isArray(data) ? data : null);

    if (sourceList) {
        list = sourceList.filter(item => item && item.id);
    } else if (typeof data === "object") {
        const keys = Object.keys(data).filter(k => k !== "timestamp" && k !== "time" && k !== "machine");
        list = keys.map(k => ({
            id: k,
            v: typeof data[k] === "object" && data[k] !== null ? data[k].v : data[k],
            q: typeof data[k] === "object" && data[k] !== null ? data[k].q : "Good",
            t: typeof data[k] === "object" && data[k] !== null ? data[k].t : timestamp
        }));
    }
    return { timestamp, items: list };
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// "WTP.PureSteamGenerator.generator_status" -> name "generator status", path "WTP.PureSteamGenerator".
function tagParts(id) {
    const s = String(id ?? "-");
    const i = s.lastIndexOf(".");
    const name = i > 0 ? s.slice(i + 1) : s;
    return { name: name.replace(/_/g, " "), path: i > 0 ? s.slice(0, i) : "" };
}

function formatValue(v) {
    if (v === undefined || v === null || v === "") return "—";
    if (typeof v === "number" && !Number.isInteger(v)) return String(+v.toPrecision(6));
    return String(v);
}

function qualityBadge(q) {
    if (q === undefined || q === null) return "—";
    const good = isGoodQuality(q);
    return `<span class="badge ${good ? "badge-good" : "badge-warn"}">${good ? "Good" : "Bad"}</span>`;
}

function isGoodQuality(q) {
    if (q === undefined || q === null) return false;
    if (q === true || q === "true" || q === 192 || q === "192") return true;
    if (q === false || q === "false") return false;
    return String(q).toLowerCase().includes("good");
}

function timestampMillis(value) {
    if (value === undefined || value === null || value === "") return NaN;
    const number = Number(value);
    const date = Number.isFinite(number) && number > 1000000000
        ? new Date(number > 1e11 ? number : number * 1000)
        : new Date(value);
    return Number.isNaN(date.getTime()) ? NaN : date.getTime();
}

function machineLastMillis(raw) {
    const parsed = parseMachineData(raw);
    const data = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
    const times = [data?.timestamp, data?.time, ...(parsed?.items || []).map(item => item.t)]
        .map(timestampMillis).filter(Number.isFinite);
    return times.length ? Math.max(...times) : NaN;
}

function machineStatus(raw) {
    if (!raw) return "Offline";
    const last = machineLastMillis(raw);
    return Number.isFinite(last) && Date.now() - last > 30000 ? "Stale" : "Online";
}

function ageText(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 1) return "less than a minute ago";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function renderMachineTable(machineKey) {
    const raw = latestStore[machineKey];
    const parsed = parseMachineData(raw);
    const tbody = document.getElementById(machineKey === "RO" ? "table-body-ro" : "table-body-psg");
    const timeEl = document.getElementById(machineKey === "RO" ? "timestamp-ro" : "timestamp-psg");
    const countEl = document.getElementById(machineKey === "RO" ? "count-ro" : "count-psg");

    if (!parsed || !parsed.items || parsed.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">Waiting for data from machine ${machineKey}</td></tr>`;
        timeEl.textContent = "Time: -";
        countEl.textContent = "0 items";
        return;
    }

    timeEl.textContent = "Time: " + parsed.timestamp;
    const keyword = filterKeywords[machineKey];
    const filtered = keyword
        ? parsed.items.filter(item => String(item.id || "").toLowerCase().includes(keyword))
        : parsed.items;

    countEl.textContent = `${filtered.length} / ${parsed.items.length} items`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No tags match your search</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    filtered.forEach(item => {
        const tr = document.createElement("tr");
        const alias = getTagAlias(item.id);
        const aliasBadge = alias ? `<span class="tag-alias">${escapeHtml(alias)}</span>` : "";
        const parts = tagParts(item.id);

        tr.innerHTML = `
            <td><span class="tag-id" title="${escapeHtml(item.id ?? "-")}">${escapeHtml(parts.name)}</span>${aliasBadge}<span class="tag-path">${escapeHtml(parts.path)}</span></td>
            <td><span class="tag-val">${escapeHtml(formatValue(item.v))}</span></td>
            <td>${qualityBadge(item.q)}</td>
            <td>${escapeHtml(formatDisplayTime(item.t ?? parsed.timestamp ?? "-"))}</td>
        `;
        tbody.appendChild(tr);
    });
}

function updateSummaryKPIs() {
    const roParsed = parseMachineData(latestStore.RO);
    const psgParsed = parseMachineData(latestStore.PSG);

    const roCount = roParsed ? roParsed.items.length : 0;
    const psgCount = psgParsed ? psgParsed.items.length : 0;
    const totalTags = roCount + psgCount;

    let goodCount = 0;
    let warnCount = 0;
    const notices = [];

    [["RO", roParsed, roCount], ["PSG", psgParsed, psgCount]].forEach(([machine, parsed, count]) => {
        const status = parsed ? machineStatus(latestStore[machine]) : "Offline";
        const key = machine.toLowerCase();
        const valueEl = document.getElementById(`kpi-${key}-count`);
        valueEl.textContent = status;
        valueEl.className = `stat-value ${status === "Online" ? "is-online" : status === "Offline" ? "is-offline" : "is-stale"}`;
        document.getElementById(`kpi-${key}-time`).textContent = parsed ? `${count} tags, last ${parsed.timestamp || "-"}` : "No data received yet";
        if (parsed) parsed.items.forEach(i => isGoodQuality(i.q) ? goodCount++ : warnCount++);
        if (status === "Stale") {
            const last = machineLastMillis(latestStore[machine]);
            notices.push(`<span><strong>${machine} data stopped</strong>: last received ${escapeHtml(new Date(last).toLocaleTimeString("en-GB"))} (${ageText(Date.now() - last)}). Check the IoT Gateway in KEPServerEX.</span>`);
        }
    });

    const banner = document.getElementById("data-banner");
    const html = notices.join("<br>");
    if (banner.dataset.html !== html) { banner.dataset.html = html; banner.innerHTML = html; }
    banner.hidden = !notices.length;

    const live = document.getElementById("analysis-live");
    const liveMachine = document.getElementById("analysis-machine").value;
    const arriving = latestStore[liveMachine] && machineStatus(latestStore[liveMachine]) === "Online";
    live.classList.toggle("is-idle", !arriving);
    live.textContent = arriving ? "Live, every 5 s" : "Waiting for new data";

    document.getElementById("kpi-total-tags").textContent = totalTags;
    document.getElementById("kpi-quality-ratio").textContent = `${goodCount} good`;
    document.getElementById("kpi-warn-count").textContent = `${warnCount} warning or bad`;
}

const DEVICE_MAP = {
    vt01: {
        name: "VT01",
        label: "VT01 Pure Steam",
        keys: ["pure_steam_valve", "vt01", "vt1"],
        pipes: ["pipe-vt01-loop"]
    },
    vt02: {
        name: "VT02",
        label: "VT02 Feed Water",
        keys: ["feed_water_valve", "vt02", "vt2"],
        pipes: ["pipe-pump-to-prefilter"]
    },
    vt03: {
        name: "VT03",
        label: "VT03 Sep Drain",
        keys: ["separator_drain_valve", "vt03", "vt3"],
        pipes: ["pipe-sep-drain"]
    },
    vt04: {
        name: "VT04",
        label: "VT04 Evap Drain",
        keys: ["evaporator_drain_valve", "vt04", "vt4"],
        pipes: ["pipe-vessel-drain", "pipe-cond-drain-to-vt04"]
    },
    vt05: {
        name: "VT05",
        label: "VT05 Feed Steam",
        keys: ["feed_steam_proportional_valve", "feed_steam", "vt05", "vt5"],
        pipes: ["pipe-sep-top-vt05"]
    },
    vt06: {
        name: "VT06",
        label: "VT06 Breather",
        keys: ["breather_valve", "vt06", "vt6"],
        pipes: ["pipe-prefilter-top-to-vt06"]
    }
};

const PUMP_KEYS = ["raw_water_pump", "feed_water_pump", "pump"];

function getTagAlias(id) {
    if (!id) return "";
    const s = String(id).toLowerCase();
    if (s.includes("pure_steam_valve") || s === "vt01") return "VT01";
    if (s.includes("feed_water_valve") || s === "vt02") return "VT02";
    if (s.includes("separator_drain_valve") || s === "vt03") return "VT03";
    if (s.includes("evaporator_drain_valve") || s === "vt04") return "VT04";
    if (s.includes("feed_steam_proportional_valve") || s.includes("feed_steam") || s === "vt05") return "VT05";
    if (s.includes("breather_valve") || s === "vt06") return "VT06";
    if (s.includes("raw_water_pump") || s === "pump") return "Pump";
    return "";
}

function findDeviceTag(items, keys) {
    if (!items || !items.length) return null;
    return items.find(i => {
        const id = String(i.id || "").toLowerCase();
        return keys.some(k => id === k || id.endsWith("." + k) || id.includes(k));
    });
}

function isDeviceActive(item) {
    if (!item) return false;
    const v = item.v;
    if (v === true || v === 1 || v === "1") return true;
    if (typeof v === "string") {
        const s = v.toLowerCase().trim();
        return s === "true" || s === "open" || s === "on" || s === "run" || s === "running";
    }
    return false;
}

function findTagValue(items, keys, fallback) {
    if (!items || items.length === 0) return fallback;
    for (const key of keys) {
        const item = items.find(i => String(i.id).toLowerCase().includes(key.toLowerCase()));
        if (item && item.v !== undefined && item.v !== null && item.v !== "") {
            const num = Number(item.v);
            if (!isNaN(num)) return num.toFixed(2);
            return String(item.v);
        }
    }
    return fallback;
}

// generator_status = MB620 (Byte): 1 = Manual, 2 = Automatic; generator_countdown = MD624 (S7 Time, Int32 ms) shown as HH:MM:SS.
function generatorState(items) {
    const statusItem = findDeviceTag(items, ["generator_status"]);
    const countdownItem = findDeviceTag(items, ["generator_countdown"]);
    const ms = Number(countdownItem?.v);
    const abs = Math.abs(ms);
    const countdown = countdownItem && countdownItem.v !== "" && Number.isFinite(ms)
        ? [Math.floor(abs / 3600000), Math.floor(abs / 60000) % 60, Math.floor(abs / 1000) % 60]
            .map(n => String(n).padStart(2, "0")).join(":")
        : "—";
    const mode = { 1: "Manual", 2: "Automatic" }[Number(statusItem?.v)];
    return { status: mode ?? statusItem?.v ?? "—", countdown };
}

function renderHMIValues(items) {
    const grid = document.getElementById("hmi-values-grid");
    if (!grid) return;

    const pumpItem = findDeviceTag(items, PUMP_KEYS);
    const pumpOn = isDeviceActive(pumpItem);
    const valveState = keys => {
        const item = findDeviceTag(items, keys);
        const open = isDeviceActive(item);
        return { value: !item ? "NO DATA" : (open ? "OPEN" : "CLOSE"), status: !item ? "unknown" : (open ? "on" : "off") };
    };

    const { status: statusText, countdown } = generatorState(items);

    const values = [
        { label: "Status Generator", value: statusText },
        { label: "Countdown", value: countdown },
        { label: "Temperature", value: findTagValue(items, ["temperature", "temp", "ti01", "ti_01", "suhu"], "—"), unit: "°C" },
        { label: "Pressure", value: findTagValue(items, ["generator pure steam pressure", "pure_steam_press", "press", "pi01"], "—"), unit: "mpa" },
        { label: "Conductivity", value: findTagValue(items, ["generator pure steam conductivity", "pure_steam_cond", "cond", "qi01"], "—"), unit: "us/cm" },
        { label: "Industrial Pure", value: findTagValue(items, ["steam pressure value", "industrial", "ind_press", "pi02"], "—"), unit: "mpa" },
        { label: "Level", value: findTagValue(items, ["level", "lt01", "ratio", "level_ratio"], "—"), unit: "%" },
        { label: "Raw Water Pump", value: pumpItem ? (pumpOn ? "RUN" : "STOP") : "NO DATA", status: pumpItem ? (pumpOn ? "on" : "off") : "unknown" },
        { label: "VT01 Pure Steam", ...valveState(DEVICE_MAP.vt01.keys) },
        { label: "VT02 Feed Water", ...valveState(DEVICE_MAP.vt02.keys) },
        { label: "VT03 Sep Drain", ...valveState(DEVICE_MAP.vt03.keys) },
        { label: "VT04 Evap Drain", ...valveState(DEVICE_MAP.vt04.keys) },
        { label: "VT05 Feed Steam", ...valveState(DEVICE_MAP.vt05.keys) },
        { label: "VT06 Breather", ...valveState(DEVICE_MAP.vt06.keys) }
    ];

    grid.innerHTML = values.map(v =>
        `<div class="hmi-val-card ${v.status ? 'status-' + v.status : ''}">
            <span class="hmi-val-label">${escapeHtml(v.label)}</span>
            <span class="hmi-val-number">${escapeHtml(v.value)}${v.unit ? ' ' + escapeHtml(v.unit) : ''}</span>
        </div>`
    ).join("");
}

function renderHMI() {
    const psgParsed = parseMachineData(latestStore.PSG);
    const items = psgParsed ? psgParsed.items : [];

    const tempVal = findTagValue(items, ["temperature", "temp", "ti01", "ti_01", "suhu"], "—");
    const pressVal = findTagValue(items, ["generator pure steam pressure", "pure_steam_press", "press", "pi01"], "—");
    const condVal = findTagValue(items, ["generator pure steam conductivity", "pure_steam_cond", "cond", "qi01"], "—");
    const indPressVal = findTagValue(items, ["steam pressure value", "industrial", "ind_press", "pi02"], "—");
    const levelVal = findTagValue(items, ["level", "lt01", "ratio", "level_ratio"], "—");

    const badgeTemp = document.getElementById("badge-temp");
    if (badgeTemp) badgeTemp.textContent = `${tempVal}°C`;

    const badgePress = document.getElementById("badge-press");
    if (badgePress) badgePress.textContent = `${pressVal}mpa`;

    const badgeCond = document.getElementById("badge-cond");
    if (badgeCond) badgeCond.textContent = `${condVal}us/cm`;

    const badgeRightPress = document.getElementById("badge-right-press");
    if (badgeRightPress) badgeRightPress.textContent = `${indPressVal}mpa`;

    const badgeRightLevel = document.getElementById("badge-right-level");
    if (badgeRightLevel) badgeRightLevel.textContent = `${levelVal}%`;

    const gen = generatorState(items);
    const badgeStatus = document.getElementById("badge-status");
    if (badgeStatus) badgeStatus.textContent = gen.status;
    const badgeCountdown = document.getElementById("badge-countdown");
    if (badgeCountdown) badgeCountdown.textContent = gen.countdown;

    const pumpItem = findDeviceTag(items, PUMP_KEYS);
    const pumpOn = isDeviceActive(pumpItem);

    Object.entries(DEVICE_MAP).forEach(([valveKey, def]) => {
        const item = findDeviceTag(items, def.keys);
        const isOpen = isDeviceActive(item);
        const color = !item ? "#94a3b8" : (isOpen ? "#2c9a52" : "#c9362b");
        const stroke = !item ? "#475569" : (isOpen ? "#1c7436" : "#6e1812");
        const group = document.getElementById(`valve-${valveKey}-group`);
        if (group) {
            group.querySelectorAll("polygon").forEach(p => {
                p.setAttribute("fill", color);
                p.setAttribute("stroke", stroke);
            });
        }

        let pipeActive = isOpen;
        if (valveKey === "vt02" && pumpOn) pipeActive = true;
        def.pipes.forEach(pid => {
            const el = document.getElementById(pid);
            if (el) el.setAttribute("stroke", pipeActive ? "#3b82f6" : "#7d8a96");
        });
    });

    const pumpGroup = document.getElementById("pump-group");
    if (pumpGroup) {
        const pColor = !pumpItem ? "#94a3b8" : (pumpOn ? "#2c9a52" : "#c9362b");
        const pStroke = !pumpItem ? "#475569" : (pumpOn ? "#1c7436" : "#6e1812");
        const pDark = !pumpItem ? "#64748b" : (pumpOn ? "#14572a" : "#8c1d17");

        pumpGroup.querySelectorAll("ellipse, rect").forEach(el => {
            const fill = el.getAttribute("fill");
            if (fill === "#c9362b" || fill === "#2c9a52") {
                el.setAttribute("fill", pColor);
                el.setAttribute("stroke", pStroke);
            } else if (fill === "#8c1d17" || fill === "#14572a") {
                el.setAttribute("fill", pDark);
                el.setAttribute("stroke", pStroke);
            } else if (fill && fill.includes("motor-finned")) {
                el.setAttribute("fill", !pumpItem ? "#94a3b8" : (pumpOn ? "url(#motor-finned-on)" : "url(#motor-finned)"));
                el.setAttribute("stroke", pStroke);
            }
        });

        const pumpCap = pumpGroup.querySelector("path");
        if (pumpCap) {
            pumpCap.setAttribute("fill", !pumpItem ? "#94a3b8" : (pumpOn ? "#1c7436" : "#b3261e"));
            pumpCap.setAttribute("stroke", pStroke);
        }
    }

    renderHMIValues(items);
}

function mergeStore(prev, incoming) {
    if (!incoming) return prev;
    if (!prev) return incoming;

    const prevList = Array.isArray(prev.values) ? prev.values : [];
    const incomingList = Array.isArray(incoming.values) ? incoming.values : [];

    const map = new Map();
    for (const item of prevList) {
        if (item && item.id) map.set(item.id, item);
    }
    for (const item of incomingList) {
        if (item && item.id) map.set(item.id, item);
    }

    return {
        ...prev,
        ...incoming,
        timestamp: incoming.timestamp || incoming.time || prev.timestamp || prev.time,
        values: Array.from(map.values())
    };
}

async function fetchData() {
    if (!currentUser) return;
    try {
        const res = await fetch("/data");
        if (!res.ok) return;
        const raw = await res.json();
        if (!raw) return;

        if (raw.RO !== undefined || raw.PSG !== undefined) {
            latestStore.RO = mergeStore(latestStore.RO, raw.RO);
            latestStore.PSG = mergeStore(latestStore.PSG, raw.PSG);
        } else if (raw.values) {
            latestStore.RO = mergeStore(latestStore.RO, raw);
        }

        renderMachineTable("RO");
        renderMachineTable("PSG");
        updateSummaryKPIs();
        renderHMI();
        refreshTagOptions("analysis-tag", "analysis-machine");
        refreshTagOptions("record-tag", "record-machine");
    } catch { showToast("Server connection lost"); }
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function hasPermission(permission) {
    return Boolean(currentUser && (currentUser.permissions.includes("*") || currentUser.permissions.includes(permission)));
}

function applyPermissions() {
    document.querySelectorAll("[data-permission]").forEach(element => {
        element.hidden = !hasPermission(element.dataset.permission);
    });
    document.getElementById("signed-in-user").textContent = currentUser.username === currentUser.role ? currentUser.username : `${currentUser.username} (${currentUser.role})`;
    document.getElementById("logout-button").hidden = false;
}

async function authenticate() {
    try {
        const status = await api("/api/auth/status");
        if (!status.user) {
            const overlay = document.getElementById("login-overlay");
            overlay.hidden = false;
            if (status.setupRequired) {
                document.getElementById("login-note").textContent = "Admin account not set up. Set ADMIN_PASSWORD (at least 12 characters) and restart the server.";
                document.querySelectorAll("#login-form input, #login-form button").forEach(el => { el.disabled = true; });
            }
            return;
        }
        currentUser = status.user;
        document.getElementById("login-overlay").hidden = true;
        applyPermissions();
        const requested = permissionForView(initView) && !hasPermission(permissionForView(initView)) ? "overview" : initView;
        switchView(requested);
        await fetchData();
        loadFeature(requested);
    } catch (error) { showToast(error.message); }
}

document.getElementById("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = document.getElementById("login-error");
    error.textContent = "";
    try {
        await api("/api/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
        await authenticate();
    } catch (e) { error.textContent = e.message; }
});

async function logout() {
    try { await api("/api/logout", { method: "POST" }); } catch { }
    currentUser = null;
    document.getElementById("signed-in-user").textContent = "";
    document.getElementById("logout-button").hidden = true;
    document.getElementById("login-overlay").hidden = false;
}

function refreshTagOptions(selectId, machineSelectId) {
    const select = document.getElementById(selectId);
    const machine = document.getElementById(machineSelectId)?.value || "RO";
    const parsed = parseMachineData(latestStore[machine]);
    const tags = parsed?.items.map(item => item.id).filter(Boolean) || [];
    // Rebuild only when the list changes, so an open dropdown is not reset every second.
    const signature = tags.join("\n");
    if (select.dataset.tags === signature && select.options.length === tags.length) return;
    select.dataset.tags = signature;
    const previous = select.value;
    select.innerHTML = tags.map(tag => `<option value="${escapeHtml(tag)}">${escapeHtml(tagParts(tag).name)}</option>`).join("");
    if (tags.includes(previous)) select.value = previous;
}

function dateInputValue(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function rangeParams(machine, tag, fromId, toId) {
    const params = new URLSearchParams({ machine, tag, limit: "2000" });
    const from = document.getElementById(fromId).value;
    const to = document.getElementById(toId).value;
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    return params;
}

function loadFeature(view) {
    if (!currentUser) return;
    const feature = featureForView(view);
    // "To" was fixed at page-load time, so samples that arrived later were filtered out.
    const toId = { records: "record-to", alarms: "alarm-to" }[feature];
    if (toId) document.getElementById(toId).value = dateInputValue(new Date());
    if (feature === "analysis") loadAnalysis();
    if (feature === "alarms") loadAlarms();
    if (feature === "records") loadRecords();
    if (feature === "rbac") loadRbac();
    if (feature === "activity") loadActivity();
}

function renderHistoryRows(rows, tbodyId, includeMachine = false) {
    const tbody = document.getElementById(tbodyId);
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="${includeMachine ? 5 : 3}" class="empty-cell">No data in this time range</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.slice().reverse().map(row => `<tr>
        <td>${escapeHtml(new Date(row.sampled_at).toLocaleString("en-GB"))}</td>
        ${includeMachine ? `<td>${escapeHtml(row.machine)}</td><td><span class="tag-id" title="${escapeHtml(row.tag)}">${escapeHtml(tagParts(row.tag).name)}</span></td>` : ""}
        <td><span class="tag-val">${escapeHtml(formatValue(row.value))}</span></td><td>${qualityBadge(row.quality)}</td>
    </tr>`).join("");
}

let trendState = null;
let trendHover = false;
let analysisRange = 60; // minutes ending now; null = manual From/To

function chartTime(ms, spanMs) {
    const d = new Date(ms);
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(spanMs <= 10 * 60000 ? { second: "2-digit" } : {}) });
    return spanMs > 24 * 3600000 ? `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })} ${time}` : time;
}

function setTrendStats(points, total) {
    const ys = points.map(p => p.y);
    const show = value => ys.length ? formatValue(value) : "—";
    document.getElementById("stat-last").textContent = show(ys[ys.length - 1]);
    document.getElementById("stat-min").textContent = show(Math.min(...ys));
    document.getElementById("stat-max").textContent = show(Math.max(...ys));
    document.getElementById("stat-avg").textContent = show(ys.reduce((a, b) => a + b, 0) / ys.length);
    document.getElementById("stat-count").textContent = total;
}

// Returns the time window actually drawn, so the caller can say when it zoomed to the data.
function drawTrend(rows, domain = {}) {
    const svg = document.getElementById("trend-chart");
    const wrap = document.getElementById("trend-wrap");
    document.getElementById("trend-tooltip").hidden = true;
    const W = Math.max(wrap.clientWidth, 280), H = wrap.clientHeight || 340;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const points = rows.map(row => ({ x: new Date(row.sampled_at).getTime(), y: Number(row.value) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    setTrendStats(points, rows.length);
    trendState = { rows, domain, points: [] };
    if (points.length < 2) {
        svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="chart-empty">${rows.length ? "At least two numeric samples are needed to draw a trend" : "No data in this time range"}</text>`;
        return null;
    }
    const first = points[0].x, last = points[points.length - 1].x;
    let minX = domain.from, maxX = domain.to, fitted = false;
    if (!(Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX)) { minX = first; maxX = last; }
    else if (last - first < (maxX - minX) * 0.05) {
        // Data covers a sliver of the range: zoom to it instead of drawing one vertical stroke.
        const pad = Math.max((last - first) * 0.05, 1000);
        minX = first - pad; maxX = last + pad; fitted = true;
    }
    let minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const padY = (maxY - minY || Math.abs(maxY) || 1) * 0.08;
    minY -= padY; maxY += padY;
    const L = 58, R = W - 14, T = 12, B = H - 28;
    const sx = x => L + ((x - minX) / (maxX - minX)) * (R - L);
    const sy = y => B - ((y - minY) / (maxY - minY)) * (B - T);
    const yTicks = [0, 1, 2, 3, 4].map(i => minY + ((maxY - minY) * i) / 4);
    const xCount = W < 520 ? 3 : 5;
    const xTicks = Array.from({ length: xCount }, (_, i) => minX + ((maxX - minX) * i) / (xCount - 1));
    const visible = points.filter(p => p.x >= minX && p.x <= maxX);
    const line = visible.map(p => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
    const end = visible[visible.length - 1], start = visible[0];
    svg.innerHTML = `
        ${yTicks.map(v => `<line x1="${L}" y1="${sy(v)}" x2="${R}" y2="${sy(v)}" class="chart-grid"/><text x="${L - 8}" y="${sy(v) + 4}" text-anchor="end" class="chart-label">${escapeHtml(+v.toPrecision(4))}</text>`).join("")}
        <line x1="${L}" y1="${B}" x2="${R}" y2="${B}" class="chart-axis"/>
        ${xTicks.map((v, i) => `<text x="${sx(v)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === xCount - 1 ? "end" : "middle"}" class="chart-label">${escapeHtml(chartTime(v, maxX - minX))}</text>`).join("")}
        <polygon points="${sx(start.x).toFixed(1)},${B} ${line} ${sx(end.x).toFixed(1)},${B}" class="chart-area"/>
        <polyline points="${line}" class="chart-line"/>
        <circle cx="${sx(end.x)}" cy="${sy(end.y)}" r="3.5" class="chart-point"/>
        <line id="trend-cross" y1="${T}" y2="${B}" class="chart-cross" visibility="hidden"/>
        <circle id="trend-dot" r="4.5" class="chart-point" visibility="hidden"/>`;
    trendState = { rows, domain, points: visible, sx, sy, W };
    return { fitted, from: minX, to: maxX };
}

function trendPointer(event) {
    const svg = document.getElementById("trend-chart");
    const tooltip = document.getElementById("trend-tooltip");
    const cross = document.getElementById("trend-cross");
    const dot = document.getElementById("trend-dot");
    if (!trendState?.points.length || !cross) return;
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (trendState.W / rect.width);
    const point = trendState.points.reduce((best, p) => Math.abs(trendState.sx(p.x) - x) < Math.abs(trendState.sx(best.x) - x) ? p : best);
    const px = trendState.sx(point.x), py = trendState.sy(point.y);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
    tooltip.innerHTML = `<strong>${escapeHtml(formatValue(point.y))}</strong>${escapeHtml(new Date(point.x).toLocaleString("en-GB"))}`;
    tooltip.hidden = false;
    const scale = rect.width / trendState.W;
    const left = Math.min(Math.max(px * scale + 12, 0), rect.width - tooltip.offsetWidth - 4);
    tooltip.style.transform = `translate(${left}px, ${Math.max(py * scale - tooltip.offsetHeight - 10, 0)}px)`;
}

(() => {
    const svg = document.getElementById("trend-chart");
    svg.addEventListener("pointermove", event => { trendHover = true; trendPointer(event); });
    svg.addEventListener("pointerleave", () => {
        trendHover = false;
        document.getElementById("trend-tooltip").hidden = true;
        document.getElementById("trend-cross")?.setAttribute("visibility", "hidden");
        document.getElementById("trend-dot")?.setAttribute("visibility", "hidden");
    });
})();

function applyAnalysisRange() {
    if (!analysisRange) return;
    const now = new Date();
    document.getElementById("analysis-to").value = dateInputValue(now);
    document.getElementById("analysis-from").value = dateInputValue(new Date(now.getTime() - analysisRange * 60000));
}

function setAnalysisRange(minutes) {
    analysisRange = minutes;
    document.querySelectorAll(".range-chip").forEach(chip => chip.setAttribute("aria-pressed", String(Number(chip.dataset.range) === minutes)));
    document.getElementById("analysis-live").hidden = !minutes;
    applyAnalysisRange();
    loadAnalysis();
}

async function loadAnalysis() {
    if (!currentUser || featureForView(currentView) !== "analysis") return;
    const scopedMachine = machineForView(currentView);
    if (scopedMachine) document.getElementById("analysis-machine").value = scopedMachine;
    refreshTagOptions("analysis-tag", "analysis-machine");
    const machine = document.getElementById("analysis-machine").value;
    const tag = document.getElementById("analysis-tag").value;
    // A quick range ends at this exact moment; the datetime inputs only hold whole minutes.
    if (analysisRange && !["analysis-from", "analysis-to"].includes(document.activeElement?.id)) applyAnalysisRange();
    const to = analysisRange ? Date.now() : new Date(document.getElementById("analysis-to").value).getTime();
    const from = analysisRange ? to - analysisRange * 60000 : new Date(document.getElementById("analysis-from").value).getTime();
    try {
        const params = new URLSearchParams({ machine, tag, limit: "2000" });
        if (Number.isFinite(from)) params.set("from", new Date(from).toISOString());
        if (Number.isFinite(to)) params.set("to", new Date(to).toISOString());
        const rows = tag ? await api(`/api/history?${params}`) : [];
        const drawn = drawTrend(rows, { from, to });
        const zoom = drawn?.fitted ? `. Time axis zoomed to data (${chartTime(drawn.from, 0)} – ${chartTime(drawn.to, 0)})` : "";
        document.getElementById("analysis-summary").textContent = tag ? `${machine}: ${tagParts(tag).name}${zoom}` : "No tags available for this machine";
        renderHistoryRows(rows, "analysis-rows");
    } catch (error) { showToast(error.message); }
}

async function loadRecords() {
    if (!currentUser || featureForView(currentView) !== "records") return;
    const scopedMachine = machineForView(currentView);
    if (scopedMachine) document.getElementById("record-machine").value = scopedMachine;
    refreshTagOptions("record-tag", "record-machine");
    const machine = document.getElementById("record-machine").value;
    const tag = document.getElementById("record-tag").value;
    try {
        const params = rangeParams(machine, tag, "record-from", "record-to");
        params.set("limit", "100");
        params.set("offset", String(recordPage * 100));
        const rows = tag ? await api(`/api/history?${params}`) : [];
        document.getElementById("record-summary").textContent = `Page ${recordPage + 1}, ${machine} / ${tag || "no tag available"}`;
        renderHistoryRows(rows, "record-rows", true);
        document.getElementById("record-page-label").textContent = `Page ${recordPage + 1}`;
        document.getElementById("record-prev").disabled = recordPage === 0;
        document.getElementById("record-next").disabled = rows.length < 100;
    } catch (error) { showToast(error.message); }
}

function searchRecords() { recordPage = 0; loadRecords(); }
function changeRecordPage(delta) { recordPage = Math.max(0, recordPage + delta); loadRecords(); }

function exportRecords() {
    if (!hasPermission("history.export")) return showToast("Export permission not available");
    const machine = document.getElementById("record-machine").value;
    const tag = document.getElementById("record-tag").value;
    if (!tag) return showToast("Select a tag first");
    window.location.href = `/api/history/export?${rangeParams(machine, tag, "record-from", "record-to")}`;
}

async function loadAlarms() {
    if (!currentUser || featureForView(currentView) !== "alarms") return;
    const params = new URLSearchParams({ limit: "500" });
    const machine = machineForView(currentView) || document.getElementById("alarm-machine").value;
    if (machine) document.getElementById("alarm-machine").value = machine;
    const status = document.getElementById("alarm-status").value;
    const tag = document.getElementById("alarm-tag").value.trim();
    const from = document.getElementById("alarm-from").value;
    const to = document.getElementById("alarm-to").value;
    if (machine) params.set("machine", machine);
    if (status) params.set("status", status);
    if (tag) params.set("tag", tag);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    try {
        const rows = await api(`/api/alarms?${params}`);
        document.getElementById("alarm-rows").innerHTML = rows.length ? rows.map(row => `<tr>
            <td>${escapeHtml(new Date(row.opened_at).toLocaleString("en-GB"))}</td><td>${escapeHtml(row.machine)} / <span class="tag-id">${escapeHtml(row.tag)}</span></td>
            <td><span class="status-pill-inline ${row.severity === "critical" ? "critical" : ""}">${escapeHtml(row.severity)}</span></td><td>${escapeHtml(row.message)}: ${escapeHtml(row.value ?? "")}</td>
            <td>${row.status === "active" ? "Active" : `Cleared ${escapeHtml(new Date(row.cleared_at).toLocaleString("en-GB"))}`}${row.acknowledged_by ? `<br><small>Acknowledged by ${escapeHtml(row.acknowledged_by)}</small>` : ""}</td>
            <td>${row.status === "active" && !row.acknowledged_at && hasPermission("alarm.acknowledge") ? `<button class="secondary-button table-action" onclick="acknowledgeAlarm(${Number(row.id)})">Acknowledge</button>` : "—"}</td></tr>`).join("") : `<tr><td colspan="6" class="empty-cell">No alarms yet</td></tr>`;
    } catch (error) { showToast(error.message); }
}

async function acknowledgeAlarm(id) {
    try { await api(`/api/alarms/${id}/acknowledge`, { method: "POST", body: "{}" }); await loadAlarms(); showToast("Alarm acknowledged"); }
    catch (error) { showToast(error.message); }
}

const permissionList = ["pid.view", "alarm.view", "alarm.acknowledge", "history.view", "history.export", "activity.view", "rbac.manage"];
function renderPermissionOptions(selected = []) {
    document.getElementById("permission-options").innerHTML = permissionList.map(p => `<label><input type="checkbox" name="permissions" value="${p}" ${selected.includes(p) ? "checked" : ""}>${p}</label>`).join("");
}

async function loadRbac() {
    if (!currentUser || currentView !== "rbac") return;
    try {
        const [roles, users, rules] = await Promise.all([api("/api/roles"), api("/api/users"), api("/api/alarm-rules")]);
        const roleSelect = document.getElementById("user-role");
        roleSelect.innerHTML = roles.map(role => `<option value="${escapeHtml(role.name)}">${escapeHtml(role.name)}</option>`).join("");
        document.getElementById("user-rows").innerHTML = users.map(user => `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.role)}</td><td><select aria-label="Role ${escapeHtml(user.username)}" onchange="changeUserRole('${escapeHtml(user.username)}', this.value)">${roles.map(role => `<option value="${escapeHtml(role.name)}" ${role.name === user.role ? "selected" : ""}>${escapeHtml(role.name)}</option>`).join("")}</select></td></tr>`).join("");
        document.getElementById("role-rows").innerHTML = roles.map(role => `<tr><td>${escapeHtml(role.name)}</td><td>${role.permissions.map(escapeHtml).join(", ")}</td><td>${role.name === "admin" ? "—" : `<button class="secondary-button table-action" onclick="editRole('${escapeHtml(role.name)}', ${JSON.stringify(role.permissions).replace(/"/g, "&quot;")})">Edit</button> <button class="secondary-button table-action" onclick="deleteRole('${escapeHtml(role.name)}')">Delete</button>`}</td></tr>`).join("");
        document.getElementById("rule-rows").innerHTML = rules.map(rule => `<tr><td>${escapeHtml(rule.machine)} / ${escapeHtml(rule.tag)}</td><td>${escapeHtml(rule.low ?? "—")}</td><td>${escapeHtml(rule.high ?? "—")}</td><td>${escapeHtml(rule.severity)}</td><td><button class="secondary-button table-action" onclick="deleteRule('${escapeHtml(rule.machine)}',${escapeHtml(JSON.stringify(rule.tag))})">Delete</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty-cell">No alarm rules yet</td></tr>`;
        renderPermissionOptions();
    } catch (error) { showToast(error.message); }
}

function editRole(name, permissions) {
    const form = document.getElementById("role-form");
    form.elements.name.value = name;
    renderPermissionOptions(permissions);
}

async function changeUserRole(username, role) {
    try {
        await api(`/api/users/${encodeURIComponent(username)}`, { method: "PATCH", body: JSON.stringify({ role }) });
        if (username === currentUser.username) await authenticate();
        else await loadRbac();
        showToast("User role updated");
    }
    catch (error) { showToast(error.message); await loadRbac(); }
}

async function deleteRole(name) {
    if (!confirm(`Delete role ${name}?`)) return;
    try { await api(`/api/roles/${encodeURIComponent(name)}`, { method: "DELETE" }); await loadRbac(); }
    catch (error) { showToast(error.message); }
}

async function deleteRule(machine, tag) {
    try { await api(`/api/alarm-rules/${machine}/${encodeURIComponent(tag)}`, { method: "DELETE" }); await loadRbac(); showToast("Alarm rule deleted"); }
    catch (error) { showToast(error.message); }
}

document.getElementById("user-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
        await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
        event.currentTarget.reset(); await loadRbac(); showToast("User added");
    } catch (error) { showToast(error.message); }
});

document.getElementById("role-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const permissions = Array.from(form.querySelectorAll("input[name=permissions]:checked")).map(input => input.value);
    try {
        await api("/api/roles", { method: "POST", body: JSON.stringify({ name: form.elements.name.value, permissions }) });
        form.reset(); renderPermissionOptions(); await authenticate(); showToast("Role saved");
    } catch (error) { showToast(error.message); }
});

document.getElementById("alarm-rule-form").addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await api("/api/alarm-rules", { method: "POST", body: JSON.stringify(values) }); event.currentTarget.reset(); await loadRbac(); showToast("Alarm rule saved"); }
    catch (error) { showToast(error.message); }
});

async function loadActivity() {
    if (!currentUser || currentView !== "activity") return;
    try {
        const params = new URLSearchParams({ limit: "500" });
        const actor = document.getElementById("activity-actor").value.trim();
        const action = document.getElementById("activity-action").value.trim();
        const from = document.getElementById("activity-from").value;
        const to = document.getElementById("activity-to").value;
        if (actor) params.set("actor", actor);
        if (action) params.set("action", action);
        if (from) params.set("from", new Date(from).toISOString());
        if (to) params.set("to", new Date(to).toISOString());
        const rows = await api(`/api/activity?${params}`);
        document.getElementById("activity-rows").innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(new Date(row.created_at).toLocaleString("en-GB"))}</td><td>${escapeHtml(row.actor)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.target)}</td><td>${escapeHtml(row.details || "—")}</td></tr>`).join("") : `<tr><td colspan="5" class="empty-cell">No activity yet</td></tr>`;
    } catch (error) { showToast(error.message); }
}

function bindPidInteractions() {
    document.querySelectorAll(".hmi-svg g[id$='-group']").forEach(group => {
        const device = group.id.replace("valve-", "").replace("-group", "");
        const definition = DEVICE_MAP[device];
        const keys = device === "pump" ? PUMP_KEYS : definition?.keys;
        if (!keys) return;
        group.setAttribute("tabindex", "0");
        group.setAttribute("role", "button");
        group.setAttribute("aria-label", `View ${definition?.label || "raw water pump"} details`);
        const show = () => {
            const items = parseMachineData(latestStore.PSG)?.items || [];
            const item = findDeviceTag(items, keys);
            const label = definition?.label || "Raw water pump";
            document.getElementById("pid-detail").textContent = item
                ? `${label}, Tag ${item.id}, Value ${item.v ?? "—"}, Quality ${item.q ?? "—"}, Time ${formatDisplayTime(item.t ?? "-")}`
                : `${label}, Tag not found in the received data`;
        };
        group.addEventListener("click", show);
        group.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); show(); } });
    });
    const sensors = {
        "badge-temp": ["temperature", "temp", "ti01", "ti_01", "suhu"],
        "badge-press": ["generator pure steam pressure", "pure_steam_press", "press", "pi01"],
        "badge-cond": ["generator pure steam conductivity", "pure_steam_cond", "cond", "qi01"],
        "badge-right-press": ["steam pressure value", "industrial", "ind_press", "pi02"],
        "badge-right-level": ["level", "lt01", "ratio", "level_ratio"],
        "badge-status": ["generator_status"],
        "badge-countdown": ["generator_countdown"]
    };
    Object.entries(sensors).forEach(([id, keys]) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.setAttribute("tabindex", "0");
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `View sensor ${id.replace("badge-", "")}`);
        const show = () => {
            const item = findDeviceTag(parseMachineData(latestStore.PSG)?.items || [], keys);
            document.getElementById("pid-detail").textContent = item
                ? `Sensor ${id.replace("badge-", "")}, Tag ${item.id}, Value ${item.v ?? "—"}, Quality ${item.q ?? "—"}, Time ${formatDisplayTime(item.t ?? "-")}`
                : `Sensor ${id.replace("badge-", "")}, Tag not found in the received data`;
        };
        element.addEventListener("click", show);
        element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); show(); } });
    });
}

const now = new Date();
document.getElementById("analysis-to").value = dateInputValue(now);
document.getElementById("analysis-from").value = dateInputValue(new Date(now.getTime() - 60 * 60 * 1000));
document.getElementById("record-to").value = dateInputValue(now);
document.getElementById("record-from").value = dateInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1000));
document.getElementById("alarm-to").value = dateInputValue(now);
document.getElementById("alarm-from").value = dateInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1000));
document.getElementById("activity-to").value = dateInputValue(now);
document.getElementById("activity-from").value = dateInputValue(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
bindPidInteractions();
renderPermissionOptions();
authenticate();
setInterval(fetchData, 1000);
setInterval(() => {
    if (featureForView(currentView) === "alarms") loadAlarms();
    // Live trend: skip while the user is reading a point or editing the filters.
    const editing = ["analysis-from", "analysis-to", "analysis-tag"].includes(document.activeElement?.id);
    if (featureForView(currentView) === "analysis" && analysisRange && !trendHover && !editing && !document.hidden) loadAnalysis();
}, 5000);
window.addEventListener("resize", () => { if (trendState && featureForView(currentView) === "analysis") drawTrend(trendState.rows, trendState.domain); });
