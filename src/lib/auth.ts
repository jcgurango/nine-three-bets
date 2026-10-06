import { createHmac, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { getUserById } from "./store";
import type { User } from "./types";

export const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set");
  return "dev-only-session-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + SESSION_MAX_AGE}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return userId;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

/** The logged-in user, or null. Deduped per request. */
export const getUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  return userId ? getUserById(userId) : null;
});

export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  return (process.env.ADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(user.id);
}

/** Public origin of the site, used to build the Discord redirect URI. */
export function appUrl(req: Request): string {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "");
}
