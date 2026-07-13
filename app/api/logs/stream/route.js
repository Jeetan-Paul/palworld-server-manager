const logger = require("@/lib/logger");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-sent events for the application log: replay the recent backlog, then
// stream new entries live. Same shape as the per-world log stream.
export async function GET() {
  const encoder = new TextEncoder();
  let unsub = null;
  const stream = new ReadableStream({
    start(controller) {
      // backlog first
      for (const entry of logger.getRecent(300)) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`));
      }
      unsub = logger.subscribe((entry) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`)); } catch {}
      });
    },
    cancel() { if (unsub) unsub(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
