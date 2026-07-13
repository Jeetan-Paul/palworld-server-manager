// lib/logger.test.js
// Unit tests for the application logger. Uses Node's built-in test runner
// (node:test) so it adds no dependencies — run with `npm test` or `node --test lib/`.
//
// The logger is a globalThis singleton, so the in-memory ring and seq counter are
// shared across tests; assertions use before/after deltas rather than absolute
// counts where that matters.
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Isolate all file output to a temp data dir before the logger loads.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "psm-logger-test-"));
process.env.PALWORLD_MANAGER_DATA_DIR = TMP;
process.env.PSM_LOG_LEVEL = "debug";

const logger = require("./logger");
const appLog = path.join(TMP, "logs", "app.log");
const readLog = () => { try { return fs.readFileSync(appLog, "utf8"); } catch { return ""; } };

test("logs an entry with seq/ts/level/scope/msg and writes the file line", () => {
  logger.info("test", "hello world");
  const e = logger.getRecent(1)[0];
  assert.equal(e.scope, "test");
  assert.equal(e.level, "info");
  assert.equal(e.msg, "hello world");
  assert.ok(typeof e.seq === "number" && e.ts);
  assert.match(readLog(), /\] INFO {2}test: hello world/);
});

test("seq is strictly monotonic", () => {
  const a = logger.info("test", "a").seq;
  const b = logger.info("test", "b").seq;
  assert.ok(b > a);
});

test("level threshold suppresses entries below it", () => {
  logger.setLevel("warn");
  const before = logger.getRecent(1e9).length;
  logger.debug("test", "dropped");
  logger.info("test", "dropped");
  logger.warn("test", "kept");
  const after = logger.getRecent(1e9);
  assert.equal(after.length, before + 1);
  assert.equal(after[after.length - 1].msg, "kept");
  logger.setLevel("debug");
});

test("getRecent(0) and negative return nothing (regression: slice(-0))", () => {
  logger.info("test", "seed");
  assert.deepEqual(logger.getRecent(0), []);
  assert.deepEqual(logger.getRecent(-5), []);
  assert.ok(logger.getRecent(1e9).length > 0);
});

test("getRecent(n) returns at most n, newest-last", () => {
  logger.info("test", "x1"); logger.info("test", "x2");
  const two = logger.getRecent(2);
  assert.equal(two.length, 2);
  assert.equal(two[1].msg, "x2");
});

test("stringify: Error keeps stack, object → JSON, circular does not throw", () => {
  logger.error("test", new Error("boom"));
  assert.match(logger.getRecent(1)[0].msg, /^Error: boom/);

  logger.info("test", { a: 1, b: "x" });
  assert.equal(logger.getRecent(1)[0].msg, '{"a":1,"b":"x"}');

  const circ = {}; circ.self = circ;
  assert.doesNotThrow(() => logger.info("test", circ));
});

test("subscribe delivers entries; unsubscribe stops them", () => {
  const seen = [];
  const off = logger.subscribe((e) => seen.push(e.msg));
  logger.info("test", "sub-a");
  off();
  logger.info("test", "sub-b");
  assert.ok(seen.includes("sub-a"));
  assert.ok(!seen.includes("sub-b"));
});

test("a throwing subscriber never reaches the caller or blocks others", () => {
  let otherRan = false;
  const off1 = logger.subscribe(() => { throw new Error("subscriber blew up"); });
  const off2 = logger.subscribe(() => { otherRan = true; });
  assert.doesNotThrow(() => logger.info("test", "multi"));
  assert.ok(otherRan);
  off1(); off2();
});

test("never throws into the caller when the file sink fails", () => {
  // Point at a data dir where 'logs' is a FILE, so the dir can't be created.
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), "psm-logger-bad-"));
  fs.writeFileSync(path.join(bad, "logs"), "not a dir");
  const saved = process.env.PALWORLD_MANAGER_DATA_DIR;
  process.env.PALWORLD_MANAGER_DATA_DIR = bad;
  let live = false;
  const off = logger.subscribe(() => { live = true; });
  assert.doesNotThrow(() => logger.error("test", "should not throw"));
  off();
  process.env.PALWORLD_MANAGER_DATA_DIR = saved;
  assert.ok(live, "live subscribers still fire even if the file write fails");
  assert.ok(logger.getRecent(1)[0].msg === "should not throw", "ring still captured it");
});

test("log injection: newlines in a message can't forge a second file line (CWE-117)", () => {
  const evil = 'World\n[2020-01-01T00:00:00.000Z] ERROR admin: FORGED';
  logger.info("api:worlds", `start "${evil}" failed`);
  // The just-written entry must occupy exactly one physical line in the file.
  const physical = readLog().replace(/\n$/, "").split("\n");
  const last = physical[physical.length - 1];
  assert.match(last, /INFO {2}api:worlds: start "World\\n\[2020/); // newline escaped to \n
  assert.ok(!/^\[[^\]]+\] ERROR admin: FORGED$/.test(last), "no standalone forged entry");
  // ...but the in-memory entry keeps the raw newline for rich display in the viewer.
  assert.ok(logger.getRecent(1)[0].msg.includes("\n"));
});

test("rotation: rolls at the size cap, keeps 5 archives, drops the oldest", () => {
  const SIX_MB = Buffer.alloc(6 * 1024 * 1024, "X");
  for (let gen = 1; gen <= 7; gen++) {
    fs.writeFileSync(appLog, `GEN${gen}\n`);
    fs.appendFileSync(appLog, SIX_MB);   // push current file over the 5 MB cap
    logger.info("rot", `trigger-${gen}`); // next write rotates then starts fresh
  }
  const gen = (f) => fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n")[0].trim() : null;
  assert.ok(fs.statSync(appLog).size < 1024, "current log is fresh after rotation");
  for (let i = 1; i <= 5; i++) assert.ok(fs.existsSync(`${appLog}.${i}`), `app.log.${i} kept`);
  assert.ok(!fs.existsSync(`${appLog}.6`), "6th archive dropped (retention = 5)");
  assert.equal(gen(`${appLog}.1`), "GEN7", "newest archive is .1");
  assert.equal(gen(`${appLog}.5`), "GEN3", "oldest kept archive is .5");
});
