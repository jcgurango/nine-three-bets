import { getUser, isAdmin } from "@/lib/auth";
import { parseScrape } from "@/lib/scrape";
import { UserError, ingestScrape } from "@/lib/store";

/**
 * Receives odds scraped from an external bookmaker page and writes them as
 * the provided odds on the matching markets. Accepts one scraped match, or an
 * array of them. The caller must be logged in as an admin (session cookie).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ ok: false, error: "Log in first." }, { status: 401 });
  if (!isAdmin(user)) return Response.json({ ok: false, error: "Admins only." }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const ingest = async (payload: unknown) => {
    try {
      return { ok: true as const, ...(await ingestScrape(parseScrape(payload))) };
    } catch (e) {
      if (e instanceof UserError) return { ok: false as const, error: e.message };
      throw e;
    }
  };

  if (Array.isArray(body)) {
    const results = [];
    for (const payload of body.slice(0, 50)) results.push(await ingest(payload));
    return Response.json({ ok: results.every((r) => r.ok), results });
  }
  const result = await ingest(body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
