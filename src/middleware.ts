import { defineMiddleware } from "astro:middleware";
import { isAllowedPrivateProfile, resolveFixedAccountByEmail } from "./lib/accounts";
import { clearSessionCookies, getAccessToken, readSession } from "./lib/auth";
import { createUserClient } from "./lib/supabase";
import { trustedAppOrigin, withSecurityHeaders } from "./lib/security";
import type { Profile } from "./lib/types";

const protectedApiPrefixes = [
  "/api/blog",
  "/api/photos",
  "/api/records",
  "/api/activity",
  "/api/comments",
  "/api/places",
  "/api/status",
  "/api/todos",
  "/api/private-space",
];
const privatePagePrefixes = ["/blog", "/records", "/photos", "/places", "/activity", "/todo"];
const authPages = ["/auth/login"];

function isPrivatePagePath(pathname: string) {
  return pathname === "/" || privatePagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isMutatingMethod(method: string) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function isSameOriginRequest(request: Request, url: URL) {
  const expectedOrigin = trustedAppOrigin(url);
  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, request, url } = context;
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const needsAuth =
    isPrivatePagePath(pathname) || protectedApiPrefixes.some((prefix) => pathname.startsWith(prefix));
  const hasSessionCookie = Boolean(cookies.get("cb-access-token") || cookies.get("cb-refresh-token"));
  let sessionState;
  try {
    sessionState = await readSession(cookies);
  } catch {
    const response = pathname.startsWith("/api/")
      ? new Response(JSON.stringify({ error: "Authentication service is temporarily unavailable." }), {
          status: 503,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        })
      : new Response("Private space is temporarily unavailable. Please try again shortly.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
    return withSecurityHeaders(response, url);
  }
  const accessToken = sessionState.accessToken || getAccessToken(cookies);

  context.locals.user = sessionState.user;
  context.locals.session = sessionState.session;
  context.locals.profile = null;
  context.locals.accessToken = accessToken;

  const allowedAccount = resolveFixedAccountByEmail(sessionState.user?.email);
  let profileLoadFailed = false;

  if (sessionState.user && allowedAccount) {
    const userClient = createUserClient(accessToken);
    try {
      const { data, error } = await userClient
        .from("profiles")
        .select("id,email,author_key,display_name,created_at")
        .eq("id", sessionState.user.id)
        .maybeSingle();

      profileLoadFailed = Boolean(error);
      context.locals.profile = error ? null : (data || null) as Profile | null;
    } catch {
      profileLoadFailed = true;
    }
  }

  if (sessionState.user && allowedAccount && profileLoadFailed) {
    const response = pathname.startsWith("/api/")
      ? new Response(JSON.stringify({ error: "Private-space profile is temporarily unavailable." }), {
          status: 503,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        })
      : new Response("Private space is temporarily unavailable. Please try again shortly.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
    return withSecurityHeaders(response, url);
  }

  const hasAuthorizedSession = !sessionState.user || isAllowedPrivateProfile(context.locals.profile, sessionState.user.email);

  if (needsAuth && !sessionState.user) {
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(new Response(JSON.stringify({ error: "Please log in first." }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      }), url);
    }
    return withSecurityHeaders(context.redirect(`/auth/login?redirect=${encodeURIComponent(pathname)}`), url);
  }

  if (sessionState.user && !hasAuthorizedSession) {
    clearSessionCookies(cookies);
    context.locals.user = null;
    context.locals.session = null;
    context.locals.profile = null;
    context.locals.accessToken = "";

    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(new Response(JSON.stringify({ error: "This account is not allowed." }), {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      }), url);
    }

    if (needsAuth || authPages.includes(pathname)) {
      return withSecurityHeaders(context.redirect("/auth/login?error=This%20account%20is%20not%20allowed."), url);
    }
  }

  if (
    pathname.startsWith("/api/") &&
    isMutatingMethod(request.method) &&
    !isSameOriginRequest(request, url)
  ) {
    return withSecurityHeaders(new Response(JSON.stringify({ error: "Invalid request origin." }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    }), url);
  }

  if (context.locals.user && authPages.includes(pathname)) {
    return withSecurityHeaders(context.redirect("/?skipCover=1#home"), url);
  }

  const response = await next();
  withSecurityHeaders(response, url);

  if (hasSessionCookie || isPrivatePagePath(pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
});
