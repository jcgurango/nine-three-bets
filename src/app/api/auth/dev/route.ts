import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, appUrl, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { upsertUser } from "@/lib/store";

/**
 * Local-only login that skips Discord: /api/auth/dev?as=alice signs you in as
 * the user "dev-alice". Only works outside production with DEV_LOGIN=1.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_LOGIN !== "1") {
    return new Response("Not found", { status: 404 });
  }
  const name = (req.nextUrl.searchParams.get("as") ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!name) return new Response("Use ?as=<name>", { status: 400 });
  const id = `dev-${name}`;
  await upsertUser({ id, username: name, displayName: name, avatarUrl: null });
  const res = NextResponse.redirect(`${appUrl(req)}/`);
  res.cookies.set(SESSION_COOKIE, createSessionToken(id), sessionCookieOptions);
  return res;
}
