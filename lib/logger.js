// lib/logger.js
// Application-level logger for the manager itself — NOT per-world game output
// (that lives in lib/supervisor.js) and NOT per-world events (lib/db.js). It
// records what the manager does: provisioning, backups, the scheduler, server
// process lifecycle, and errors that would otherwise vanish into empty catch {}.
//
// Zero dependencies. Writes human-readable lines to a rotating logs/app.log under
// the data dir, keeps a small in-memory ring for the UI, and fans out to SSE
// listeners. Mirrors the supervisor's globalThis singleton so every Next route
// handler / hot reload shares one instance.
const fs = require("fs");
const { P } = require("./paths");

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const RING = 1000;                    // entries kept in memory for the viewer
const MAX_BYTES = 5 * 1024 * 1024;    // rotate app.log at ~5 MB
const KEEP = 5;                       // app.log.1 .. app.log.5

const g = globalThis;
if (!g.__PAL_LOG) {
  const envLevel = LEVELS[String(process.env.PSM_LOG_LEVEL || "").toLowerCase()];
  g.__PAL_LOG = {
    ring: [],                 // { ts, level, scope, msg, seq }
    listeners: new Set(),     // fn(entry) for live streaming (SSE)
    threshold: envLevel || LEVELS.info,
    seq: 0,                   // monotonic id per entry — lets the viewer dedup backlog replays
  };
}
const L = g.__PAL_LOG;

// Render one entry as a file/console line: [ISO] LEVEL scope: message
function fmtLine(e) {
  return `[${e.ts}] ${e.level.toUpperCase().padEnd(5)} ${e.scope}: ${e.msg}`;
}

// Coerce whatever a caller passes into a single log string. Errors keep their
// stack; plain objects are JSON; everything else is String()'d.
function stringify(msg) {
  if (msg instanceof Error) return msg.stack || msg.message;
  if (typeof msg === "string") return msg;
  try { return JSON.stringify(msg); } catch { return String(msg); }
}

// Size-based rotation: when app.log crosses MAX_BYTES, shift app.log(.N) up by
// one and drop the oldest. Best-effort — any failure just means we keep writing
// to the current file. Never throws.
function rotateIfNeeded(file) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return; } // no file yet
  if (size < MAX_BYTES) return;
  try {
    for (let i = KEEP; i >= 1; i--) {
      const src = i === 1 ? file : `${file}.${i - 1}`;
      const dst = `${file}.${i}`;
      if (!fs.existsSync(src)) continue;
      if (i === KEEP) { try { fs.unlinkSync(dst); } catch {} }
      try { fs.renameSync(src, dst); } catch {}
    }
  } catch {}
}

function write(level, scope, msg) {
  const lvl = LEVELS[level] || LEVELS.info;
  if (lvl < L.threshold) return null;

  const entry = {
    seq: ++L.seq,
    ts: new Date().toISOString(),
    level,
    scope: String(scope || "app"),
    msg: stringify(msg),
  };

  // in-memory ring for the viewer's backlog
  L.ring.push(entry);
  if (L.ring.length > RING) L.ring.shift();

  // rotating file sink — best-effort, must never throw into the caller
  try {
    const file = P.appLog();
    rotateIfNeeded(file);
    fs.appendFileSync(file, fmtLine(entry) + "\n");
  } catch {}

  // live listeners (SSE)
  for (const fn of L.listeners) { try { fn(entry); } catch {} }

  return entry;
}

const logger = {
  debug: (scope, msg) => write("debug", scope, msg),
  info: (scope, msg) => write("info", scope, msg),
  warn: (scope, msg) => write("warn", scope, msg),
  error: (scope, msg) => write("error", scope, msg),

  // Most-recent-last slice of the ring, for the viewer's initial backlog.
  // n <= 0 returns nothing (guards against slice(-0) === slice(0) returning all).
  getRecent: (n = 500) => {
    const k = Math.max(0, Math.floor(Number(n) || 0));
    return k === 0 ? [] : L.ring.slice(-k);
  },
  // Subscribe to live entries; returns an unsubscribe fn.
  subscribe: (fn) => { L.listeners.add(fn); return () => L.listeners.delete(fn); },
  // Raise/lower the threshold at runtime (e.g. from settings). No-op if unknown.
  setLevel: (name) => { const v = LEVELS[String(name).toLowerCase()]; if (v) L.threshold = v; },

  dir: () => P.logs(),
  file: () => P.appLog(),
  LEVELS,
};

module.exports = logger;
