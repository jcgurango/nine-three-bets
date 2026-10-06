import { NextResponse } from "next/server";
import { SESSION_COOKIE, appUrl } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.redirect(`${appUrl(req)}/`, 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
