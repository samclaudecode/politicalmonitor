import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "pm_admin";
export const ADMIN_SESSION_DAYS = 30;

/** When no ADMIN_PASSWORD is set, admin features stay open (dev-friendly). */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

/**
 * Session token: HMAC of a constant, keyed by the admin password. Changing
 * the password invalidates existing sessions; nothing secret is stored
 * server-side.
 */
export function adminToken(): string {
  return createHmac("sha256", process.env.ADMIN_PASSWORD as string)
    .update("politicalmonitor-admin-session-v1")
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function passwordMatches(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(password, expected);
}

export async function isAdmin(): Promise<boolean> {
  if (!isAuthConfigured()) return true;
  const store = await cookies();
  const value = store.get(ADMIN_COOKIE)?.value;
  if (!value) return false;
  try {
    return safeEqual(value, adminToken());
  } catch {
    return false;
  }
}
