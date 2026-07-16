import { defineMiddleware } from "astro:middleware";
import { isAllowedPrivateProfile, resolveFixedAccountByName } from "./lib/accounts";
import { clearSessionCookies, getAccessToken, readSession } from "./lib/auth";
import { profileById } from "./lib/local-store";
import { trustedAppOrigin, withScriptNonce, withSecurityHeaders } from "./lib/security";
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
  "/api/private-drafts",
  "/api/export",
];
const privatePagePrefixes = ["/blog", "/records", "/photos", "/places", "/activity", "/todo", "/export"];
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
  const hasSessionCookie = Boolean(cookies.get("cb-session"));
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

  const allowedAccount = resolveFixedAccountByName(sessionState.user?.account);
  const shouldValidatePrivateContext = needsAuth || authPages.includes(pathname);
  if (sessionState.user && allowedAccount && shouldValidatePrivateContext) {
    try {
      context.locals.profile = profileById(sessionState.user.id) as Profile | null;
    } catch {
      context.locals.profile = null;
    }
  }

  const hasAuthorizedSession = !sessionState.user
    || !shouldValidatePrivateContext
    || isAllowedPrivateProfile(context.locals.profile, sessionState.user.account);

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

  const scriptNonce = crypto.randomUUID().replace(/-/g, "");
  let response = await next();
  response = await withScriptNonce(response, scriptNonce);
  withSecurityHeaders(response, url, scriptNonce);

  if (hasSessionCookie || isPrivatePagePath(pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
});
