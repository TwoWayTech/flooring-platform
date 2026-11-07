import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session/session";

/** POST /api/demo/logout: clears the demo session cookie. */
export function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
