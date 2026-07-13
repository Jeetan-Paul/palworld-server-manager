"use client";
// app/logs/page.jsx
// Application-log viewer. Streams the manager's own operations and errors
// (provisioning, backups, scheduler, server process lifecycle) live over SSE.
// Separate from a world's in-game console, which lives on the world page.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, toast } from "@/components/ui";

const LEVELS = ["all", "debug", "info", "warn", "error"];

// Level → CSS var color, for the level chip and message tint.
const LEVEL_COLOR = {
  debug: "var(--ink-muted)",
  info: "var(--green-bright)",
  warn: "var(--yellow)",
  error: "var(--red)",
};

// Local time, matching the app's compact console style.
function shortTime(iso) {
  try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}

export default function LogsPage() {
  const [entries, setEntries] = useState([]);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState("all");
  const [dir, setDir] = useState(null);
  const boxRef = useRef(null);
  const esRef = useRef(null);

  const isElectron = typeof window !== "undefined" && window.desktop?.isElectron;

  // one-shot: where the log files live (for "Open logs folder")
  useEffect(() => {
    fetch("/api/logs?limit=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setDir(d.dir); })
      .catch(() => {});
  }, []);

  // live SSE stream (backlog + new entries)
  useEffect(() => {
    if (!live) { esRef.current?.close(); return; }
    const es = new EventSource("/api/logs/stream");
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        setEntries((prev) => {
          const next = [...prev, entry];
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      } catch {}
    };
    es.onerror = () => { /* keep the panel; browser auto-reconnects */ };
    return () => es.close();
  }, [live]);

  // autoscroll to newest while streaming
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [entries]);

  const shown = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.level === filter)),
    [entries, filter]
  );

  const openFolder = () => {
    if (isElectron && dir) window.desktop.openPath(dir);
    else toast("Open the logs folder from the desktop app.", "info");
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 className="heading" style={{ fontSize: "1.4rem", margin: 0 }}>Application Logs</h1>
          <div className="subtle" style={{ fontSize: "0.82rem", marginTop: "0.25rem", maxWidth: 640 }}>
            What the manager itself is doing — provisioning, backups, the scheduler, server
            processes and errors. Written to <code>app.log</code> and separate from a world&apos;s in-game console.
          </div>
        </div>
        {isElectron && (
          <button className="btn btn-ghost" onClick={openFolder} title={dir || undefined}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", flexShrink: 0 }}>
            <Icon name="folder" size={16} /> Open logs folder
          </button>
        )}
      </div>

      <div className="panel" style={{ padding: "0.9rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.7rem", flexWrap: "wrap" }}>
          {/* level filter */}
          <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {LEVELS.map((lvl) => {
              const on = filter === lvl;
              return (
                <button key={lvl} onClick={() => setFilter(lvl)}
                  style={{
                    border: "none", borderRight: "1px solid var(--line)", background: on ? "var(--bg)" : "transparent",
                    color: on ? (LEVEL_COLOR[lvl] || "var(--ink)") : "var(--ink-muted)",
                    fontWeight: 700, fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.03em",
                    padding: "0.35rem 0.7rem", cursor: "pointer",
                  }}>
                  {lvl}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="subtle" style={{ fontSize: "0.72rem", fontWeight: 700 }}>{shown.length} shown</span>
            <button className="btn btn-ghost" style={{ padding: "0.3rem 0.7rem" }} onClick={() => setEntries([])}>Clear</button>
            <button className={`btn ${live ? "btn-primary" : "btn-ghost"}`} style={{ padding: "0.3rem 0.7rem" }} onClick={() => setLive((v) => !v)}>
              {live ? "Live" : "Paused"}
            </button>
          </div>
        </div>

        <div ref={boxRef} className="console" style={{ height: 520 }}>
          {shown.length === 0 ? (
            <div className="ln subtle">No log entries yet. Activity from the manager will appear here.</div>
          ) : (
            shown.map((e, i) => (
              <div key={i} className="ln" style={{ display: "flex", gap: "0.6rem", alignItems: "baseline" }}>
                <span style={{ color: "var(--ink-muted)", flexShrink: 0 }}>{shortTime(e.ts)}</span>
                <span style={{ color: LEVEL_COLOR[e.level] || "var(--ink)", fontWeight: 700, width: "3.2rem", flexShrink: 0 }}>
                  {String(e.level || "").toUpperCase()}
                </span>
                <span style={{ color: "var(--accent)", flexShrink: 0 }}>{e.scope}</span>
                <span style={{ color: e.level === "error" || e.level === "warn" ? LEVEL_COLOR[e.level] : undefined }}>{e.msg}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
