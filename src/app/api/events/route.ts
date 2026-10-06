import type { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { onWake } from "@/lib/live";
import { latestEventId, listEventsAfter } from "@/lib/store";

export const dynamic = "force-dynamic";

const POLL_MS = 5000;
const HEARTBEAT_MS = 20000;

/**
 * Server-sent events for the logged-in player's bet results. The client
 * resumes from the last event it saw (Last-Event-ID on reconnect, ?after= on
 * page load), so results that landed while they were away still arrive.
 */
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const userId = user.id;

  const resume = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("after");
  let cursor = resume && /^\d+$/.test(resume) ? Number(resume) : null;

  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let busy = false;
      let again = false;

      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };

      const pump = async () => {
        if (closed || cursor == null) return;
        if (busy) {
          again = true;
          return;
        }
        busy = true;
        try {
          do {
            again = false;
            for (const event of await listEventsAfter(userId, cursor)) {
              send(`id: ${event.id}\nevent: bet\ndata: ${JSON.stringify(event)}\n\n`);
              cursor = event.id;
            }
          } while (again && !closed);
        } catch (e) {
          console.error("event stream poll failed", e);
        } finally {
          busy = false;
        }
      };

      const unsubscribe = onWake(pump);
      const poll = setInterval(pump, POLL_MS);
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      stop = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", stop);

      send("retry: 3000\n\n");
      if (cursor == null) {
        // First visit on this device: start from now rather than replaying history.
        cursor = await latestEventId();
        send(`id: ${cursor}\nevent: hello\ndata: {}\n\n`);
      }
      await pump();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
