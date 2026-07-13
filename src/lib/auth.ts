import type { AstroCookies } from "astro";
import { randomBytes } from "node:crypto";
import { createSession, deleteSession, readSessionProfile } from "./local-store";

const SESSION_COOKIE = "cb-session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

const cookieBase = {
  httpOnly: true,
  path: "/",
  sameSite: "strict" as const,
  secure: import.meta.env.PROD,
};

export interface LocalUser {
  id: string;
  account: string;
}

export interface LocalSession {
  token: string;
  expiresAt: string;
}

export function startSession(cookies: AstroCookies, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  createSession(userId, token, expiresAt);
  cookies.set(SESSION_COOKIE, token, {
    ...cookieBase,
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookies(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, cookieBase);
}

export function getAccessToken(cookies: AstroCookies) {
  return cookies.get(SESSION_COOKIE)?.value || "";
}

export async function readSession(cookies: AstroCookies) {
  const token = getAccessToken(cookies);
  if (!token) return { user: null, session: null, accessToken: "" };
  const profile = readSessionProfile(token);
  if (!profile) {
    clearSessionCookies(cookies);
    return { user: null, session: null, accessToken: "" };
  }
  return {
    user: { id: profile.id, account: profile.account } satisfies LocalUser,
    session: { token, expiresAt: "" } satisfies LocalSession,
    accessToken: token,
  };
}

export function endSession(cookies: AstroCookies) {
  const token = getAccessToken(cookies);
  if (token) deleteSession(token);
  clearSessionCookies(cookies);
}
