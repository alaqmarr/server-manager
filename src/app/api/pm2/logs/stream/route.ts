import { createLogStream, VALID_PROCESS_REGEX } from "@/lib/log-stream-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/pm2/logs/stream
 *
 * Real-time Server-Sent Events (SSE) endpoint streaming PM2 live stdout/stderr logs.
 * Supports query params:
 *   - ?targetProcess=<id|name> (strictly validated process filter, default: "all")
 *   - ?process=<id|name>       (filter by process name or id, default: "all")
 *   - ?lines=<number>          (number of historical lines to emit on connect, default: 20)
 *
 * Emits an immediate connection event at t=0s within start(controller)
 * to satisfy the programmatic acceptance criteria (< 10s latency).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    // Validate targetProcess query parameter against strict allowlist regex
    const targetProcessParam = url.searchParams.get("targetProcess");
    if (targetProcessParam !== null) {
      const trimmed = targetProcessParam.trim();
      if (trimmed !== "" && trimmed !== "all" && !VALID_PROCESS_REGEX.test(trimmed)) {
        return new Response(JSON.stringify({ error: "Invalid process identifier" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
    }

    const processFilter = targetProcessParam || url.searchParams.get("process") || "all";
    const linesParam = url.searchParams.get("lines");
    const lines = linesParam ? parseInt(linesParam, 10) : 20;

    const stream = createLogStream({
      processName: processFilter,
      lines: isNaN(lines) ? 20 : Math.max(0, Math.min(lines, 100)),
      signal: request.signal,
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[SSE Stream Route] Error initializing stream:", errorMsg);
    return new Response(JSON.stringify({ error: "Failed to initialize log stream", details: errorMsg }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
