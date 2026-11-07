import { NextResponse } from "next/server";
import { getSession } from "@/lib/session/server";

/** GET /api/demo/context: the current session, or 401 when nobody is signed in on this host. */
export async function GET() {
  const session = await getSession();
  return session ? NextResponse.json({ session }) : NextResponse.json({ error: "Not signed in." }, { status: 401 });
}
