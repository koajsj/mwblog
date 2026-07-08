import { defineMiddleware } from "astro:middleware";
import { clearSessionCookies, getAccessToken, readSession } from "./lib/auth";
import { createUserClient } from "./lib/supabase";
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
];
const privatePagePrefixes = ["/blog", "/records", "/photos", "/places", "/activity", "/todo"];
const authPages = ["/auth/login"];

function isPrivatePagePath(pathname: string) {
  return pathname === "/" || privatePagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function withSecurityHeaders(response: Response) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return response;
}

function isMutatingMethod(method: string) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function isSameOriginRequest(request: Request, url: URL) {
  const origin = request.headers.get("origin");
  if (origin) return origin === url.origin;

  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    return new URL(referer).origin === url.origin;
  } catch {
    return false;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, request, url } = context;
  const hasSessionCookie = Boolean(cookies.get("cb-access-token") || cookies.get("cb-refresh-token"));
  const sessionState = await readSession(cookies);
  const accessToken = sessionState.accessToken || getAccessToken(cookies);

  context.locals.user = sessionState.user;
  context.locals.session = sessionState.session;
  context.locals.profile = null;

  if (sessionState.user) {
    const userClient = createUserClient(accessToken);
    const { data } = await userClient
      .from("profiles")
      .select("id,email,author_key,display_name,created_at")
      .eq("id", sessionState.user.id)
      .maybeSingle();

    context.locals.profile = (data || null) as Profile | null;
  }

  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const needsAuth =
    isPrivatePagePath(pathname) || protectedApiPrefixes.some((prefix) => pathname.startsWith(prefix));

  if (needsAuth && !sessionState.user) {
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(new Response(JSON.stringify({ error: "Please log in first." }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      }));
    }
    return withSecurityHeaders(context.redirect(`/auth/login?redirect=${encodeURIComponent(pathname)}`));
  }

  if (needsAuth && sessionState.user && !context.locals.profile) {
    clearSessionCookies(cookies);
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(new Response(JSON.stringify({ error: "This account is not allowed." }), {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      }));
    }
    return withSecurityHeaders(context.redirect("/auth/login?error=This%20account%20is%20not%20allowed."));
  }

  if (
    sessionState.user &&
    pathname.startsWith("/api/") &&
    isMutatingMethod(request.method) &&
    !isSameOriginRequest(request, url)
  ) {
    return withSecurityHeaders(new Response(JSON.stringify({ error: "Invalid request origin." }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    }));
  }

  if (sessionState.user && authPages.includes(pathname)) {
    return withSecurityHeaders(context.redirect("/?skipCover=1#home"));
  }

  const response = await next();
  withSecurityHeaders(response);

  if (hasSessionCookie || isPrivatePagePath(pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }
  if (url.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return response;
});
