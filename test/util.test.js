const test = require("node:test");
const assert = require("node:assert/strict");
const u = require("../src/util");

test("password hash verifies and rejects wrong input", () => {
    const hash = u.hashPassword("correct horse battery");
    assert.ok(u.verifyPassword("correct horse battery", hash));
    assert.ok(!u.verifyPassword("wrong", hash));
    assert.ok(!u.verifyPassword(123, hash));
    assert.ok(!u.verifyPassword("x", "garbage"));
    assert.ok(!u.verifyPassword("x", null));
});

test("machineName maps PSG and RO, else null", () => {
    assert.equal(u.machineName("psg"), "PSG");
    assert.equal(u.machineName("ro"), "RO");
    assert.equal(u.machineName("PSG-RO"), "PSG");
    assert.equal(u.machineName("pump"), null);
    assert.equal(u.machineName(undefined), null);
});

test("sampleTime handles seconds, milliseconds, ISO and bad input", () => {
    assert.equal(u.sampleTime(1700000000), "2023-11-14T22:13:20.000Z");
    assert.equal(u.sampleTime(1700000000000), "2023-11-14T22:13:20.000Z");
    assert.equal(u.sampleTime("2024-01-02T03:04:05Z"), "2024-01-02T03:04:05.000Z");
    const fallback = new Date("2020-01-01T00:00:00Z");
    assert.equal(u.sampleTime("nope", fallback), "2020-01-01T00:00:00.000Z");
    assert.equal(u.sampleTime("", fallback), "2020-01-01T00:00:00.000Z");
});

test("normalizePayload keeps the newest value per tag", () => {
    const out = u.normalizePayload(JSON.stringify({ values: [
        { id: "a", v: 1, t: 1 }, { id: "a", v: 2, t: 2 }, { id: "b", v: 3 }, { v: 9 }
    ] }));
    assert.deepEqual(out.values.map(x => [x.id, x.v]), [["a", 2], ["b", 3]]);
});

test("mergeMachineData merges tags and takes the new timestamp", () => {
    const merged = u.mergeMachineData(
        { timestamp: "t0", values: [{ id: "a", v: 1 }, { id: "b", v: 2 }] },
        { timestamp: "t1", values: [{ id: "b", v: 20 }, { id: "c", v: 3 }] });
    assert.equal(merged.timestamp, "t1");
    assert.deepEqual(merged.values.map(x => [x.id, x.v]), [["a", 1], ["b", 20], ["c", 3]]);
    assert.deepEqual(u.mergeMachineData({ values: [] }, null), { values: [] });
});

test("clampLimit stays within 1..2000 and defaults to 500", () => {
    assert.equal(u.clampLimit(undefined), 500);
    assert.equal(u.clampLimit("50"), 50);
    assert.equal(u.clampLimit(99999), 2000);
    assert.equal(u.clampLimit(-5), 1);
});

test("sessionToken reads the plc_session cookie", () => {
    assert.equal(u.sessionToken({ headers: { cookie: "a=1; plc_session=abc123; b=2" } }), "abc123");
    assert.equal(u.sessionToken({ headers: {} }), undefined);
});

test("jsonValue serializes, undefined becomes null", () => {
    assert.equal(u.jsonValue(undefined), null);
    assert.equal(u.jsonValue({ x: 1 }), '{"x":1}');
});
