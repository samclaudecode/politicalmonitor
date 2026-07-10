import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_DAYS,
  adminToken,
  isAuthConfigured,
  passwordMatches,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/sources", req.url), 303);
  }
  const form = await req.formData();
  const password = String(form.get("password") || "");

  if (!passwordMatches(password)) {
    return NextResponse.redirect(new URL("/admin/login?error=1", req.url), 303);
  }

  const res = NextResponse.redirect(new URL("/sources", req.url), 303);
  res.cookies.set(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_DAYS * 24 * 60 * 60,
  });
  return res;
}
