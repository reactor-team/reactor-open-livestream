import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const ADMIN_COOKIE = "reactor_tv_admin";
const SESSION_MESSAGE = "reactor-tv-admin-session-v1";

function adminPassword(): string {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) throw new Error("ADMIN_PASSWORD is not configured");
  return value;
}

function sessionToken(password = adminPassword()): string {
  return createHmac("sha256", password).update(SESSION_MESSAGE).digest("base64url");
}

function equal(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminPassword(value: string): boolean {
  return equal(value, adminPassword());
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  return Boolean(value && equal(value, sessionToken()));
}

export async function setAdminSession(): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, sessionToken(), {
    httpOnly: true,
    maxAge: 60 * 60 * 12,
    path: "/admin",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}
