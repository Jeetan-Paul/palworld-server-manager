// lib/bootstrap.js
// Called by API routes to make sure background engines are running.
const dbm = require("./db");
const sup = require("./supervisor");
const logger = require("./logger");
const { ensureScheduler } = require("./scheduler");
const { ensureSampler } = require("./metrics");

const g = globalThis;

function boot() {
  if (g.__PAL_BOOTED) return;
  try {
    sup.ensureGuardian();
    ensureScheduler();
    ensureSampler();
    logger.info("bootstrap", "background engines started (guardian, scheduler, sampler)");
    // autostart worlds flagged for it
    for (const w of dbm.listWorlds()) {
      if (w.autostart) {
        logger.info("bootstrap", `autostart: starting world "${w.display_name}"`);
        sup.startWorld(w.world_id).catch((e) => logger.error("bootstrap", `autostart of "${w.display_name}" failed: ${e.message}`));
      } else if (w.status === "running") {
        // stale status from a previous run where the process is gone
        if (!sup.pidAlive(w.process_id)) dbm.updateWorld(w.world_id, { status: "stopped", process_id: null });
      }
    }
    // Only mark booted after we successfully read the registry. If the DB was
    // transiently locked, we leave __PAL_BOOTED unset so the next request retries.
    g.__PAL_BOOTED = true;
  } catch (e) {
    logger.error("bootstrap", `boot failed (will retry on next request): ${e && e.message ? e.message : e}`);
    // do NOT set __PAL_BOOTED — allow a later request to retry cleanly.
  }
}

module.exports = { boot };
