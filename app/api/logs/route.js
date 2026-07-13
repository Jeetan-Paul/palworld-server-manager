import { NextResponse } from "next/server";
const logger = require("@/lib/logger");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Recent application-log backlog plus where the files live (so the viewer's
// "Open logs folder" button can hand the path to Electron's openPath).
export async function GET(req) {
  const n = parseInt(new URL(req.url).searchParams.get("limit") || "500", 10);
  return NextResponse.json({
    ok: true,
    entries: logger.getRecent(Number.isFinite(n) ? n : 500),
    dir: logger.dir(),
    file: logger.file(),
  });
}
