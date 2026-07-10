import type { AstroCookies } from "astro";
import type { Session } from "@supabase/supabase-js";
import { createAnonClient } from "./supabase";

const ACCESS_COOKIE = "cb-access-token";
const REFRESH_COOKIE = "cb-refresh-token";

const cookieBase = {
  httpOnly: true,
  path: "/",
  sameSite: "strict" as const,
  secure: import.meta.env.PROD,
};

export function setSessionCookies(cookies: AstroCookies, session: Session) {
  cookies.set(ACCESS_COOKIE, session.access_token, {
    ...cookieBase,
    maxAge: session.expires_in || 3600,
  });
  cookies.set(REFRESH_COOKIE, session.refresh_token, {
    ...cookieBase,
    maxAge: 60 * 60 * 24 * 60,
  });
}

export function clearSessionCookies(cookies: AstroCookies) {
  cookies.delete(ACCESS_COOKIE, cookieBase);
  cookies.delete(REFRESH_COOKIE, cookieBase);
}

export function getAccessToken(cookies: AstroCookies) {
  return cookies.get(ACCESS_COOKIE)?.value || "";
}

export async function readSession(cookies: AstroCookies) {
  const accessToken = cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookies.get(REFRESH_COOKIE)?.value;
  const supabase = createAnonClient();

  if (accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (!error && data.user) {
      return {
        user: data.user,
        session: null,
        accessToken,
      };
    }
  }

  if (!refreshToken) {
    return { user: null, session: null, accessToken: "" };
  }

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session || !data.user) {
    clearSessionCookies(cookies);
    return { user: null, session: null, accessToken: "" };
  }

  setSessionCookies(cookies, data.session);
  return {
    user: data.user,
    session: data.session,
    accessToken: data.session.access_token,
  };
}
