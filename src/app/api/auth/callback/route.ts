import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, appUrl, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { upsertUser } from "@/lib/store";

export async function GET(req: NextRequest) {
  const base = appUrl(req);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("oauth_state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    // Also covers the user pressing "Cancel" on Discord's consent screen.
    return NextResponse.redirect(`${base}/?login=failed`);
  }

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID ?? "",
      client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: `${base}/api/auth/callback`,
    }),
  });
  if (!tokenRes.ok) {
    console.error("Discord token exchange failed", tokenRes.status, await tokenRes.text());
    return NextResponse.redirect(`${base}/?login=failed`);
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) {
    console.error("Discord user fetch failed", meRes.status, await meRes.text());
    return NextResponse.redirect(`${base}/?login=failed`);
  }
  const me = (await meRes.json()) as {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
  };

  await upsertUser({
    id: me.id,
    username: me.username,
    displayName: me.global_name || me.username,
    avatarUrl: me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(me.id) >> BigInt(22)) % BigInt(6))}.png`,
  });

  const res = NextResponse.redirect(`${base}/`);
  res.cookies.set(SESSION_COOKIE, createSessionToken(me.id), sessionCookieOptions);
  res.cookies.delete("oauth_state");
  return res;
}
