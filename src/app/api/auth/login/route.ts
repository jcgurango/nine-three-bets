import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/auth";

export async function GET(req: Request) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return new Response("Discord login is not configured (DISCORD_CLIENT_ID is missing).", {
      status: 500,
    });
  }
  const state = randomBytes(16).toString("hex");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("redirect_uri", `${appUrl(req)}/api/auth/callback`);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
