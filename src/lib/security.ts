type LoginBucket = {
  count: number;
  firstFailedAt: number;
  blockedUntil: number;
  lastSeenAt: number;
};

const loginAttempts = new Map<string, LoginBucket>();

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_BUCKET_TTL_MS = 24 * 60 * 60 * 1000;
const LOGIN_BUCKET_LIMIT = 5000;

function cleanupLoginBuckets(now: number) {
  loginAttempts.forEach((bucket, key) => {
    if (now - bucket.lastSeenAt > LOGIN_BUCKET_TTL_MS) {
      loginAttempts.delete(key);
    }
  });
}

export function clientIpFromRequest(request: Request) {
  // Nginx overwrites X-Real-IP with the socket peer. X-Forwarded-For can contain
  // caller-supplied entries, so it is only a fallback outside the VPS setup.
  const forwarded = request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const candidate = forwarded.split(",")[0]?.trim();
  return candidate || "unknown";
}

function loginBucketKey(request: Request, accountName: string) {
  return `${clientIpFromRequest(request)}:${accountName.trim().toLowerCase() || "unknown"}`;
}

export function checkLoginRateLimit(request: Request, accountName: string) {
  const now = Date.now();
  cleanupLoginBuckets(now);

  const bucket = loginAttempts.get(loginBucketKey(request, accountName));
  if (!bucket) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.lastSeenAt = now;
  if (bucket.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
    };
  }

  if (now - bucket.firstFailedAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(loginBucketKey(request, accountName));
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginFailure(request: Request, accountName: string) {
  const key = loginBucketKey(request, accountName);
  const now = Date.now();
  const current = loginAttempts.get(key);

  if (!current || now - current.firstFailedAt > LOGIN_WINDOW_MS) {
    if (!current && loginAttempts.size >= LOGIN_BUCKET_LIMIT) {
      let oldestKey = "";
      let oldestSeen = Number.POSITIVE_INFINITY;
      loginAttempts.forEach((bucket, bucketKey) => {
        if (bucket.lastSeenAt < oldestSeen) {
          oldestSeen = bucket.lastSeenAt;
          oldestKey = bucketKey;
        }
      });
      if (oldestKey) loginAttempts.delete(oldestKey);
    }
    loginAttempts.set(key, {
      count: 1,
      firstFailedAt: now,
      blockedUntil: 0,
      lastSeenAt: now,
    });
    return;
  }

  current.count += 1;
  current.lastSeenAt = now;
  if (current.count >= LOGIN_MAX_FAILURES) {
    current.blockedUntil = now + LOGIN_BLOCK_MS;
  }
  loginAttempts.set(key, current);
}

export function clearLoginFailures(request: Request, accountName: string) {
  loginAttempts.delete(loginBucketKey(request, accountName));
}

function cspConnectSrc() {
  const allow = new Set(["'self'"]);
  const rawUrl = process.env.SUPABASE_URL || import.meta.env.SUPABASE_URL;
  if (!rawUrl) return Array.from(allow).join(" ");

  try {
    const origin = new URL(rawUrl).origin;
    allow.add(origin);
  } catch {
    // Ignore malformed env values and keep the default policy.
  }

  return Array.from(allow).join(" ");
}

export function trustedAppOrigin(url: URL) {
  const configured = String(process.env.APP_ORIGIN || import.meta.env.APP_ORIGIN || "").trim();
  if (!configured) return url.origin;

  try {
    return new URL(configured).origin;
  } catch {
    return url.origin;
  }
}

export async function withScriptNonce(response: Response, nonce: string) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html") || !response.body) return response;

  const html = await response.text();
  const headers = new Headers(response.headers);
  const protectedHtml = html.replace(/<(script|style)(?=[\s>])(?![^>]*\bnonce=)/gi, `<$1 nonce="${nonce}"`);
  return new Response(protectedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withSecurityHeaders(response: Response, url: URL, scriptNonce = "") {
  response.headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `connect-src ${cspConnectSrc()}`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `style-src 'self' https://fonts.googleapis.com${scriptNonce ? ` 'nonce-${scriptNonce}'` : ""}`,
    `style-src-elem 'self' https://fonts.googleapis.com${scriptNonce ? ` 'nonce-${scriptNonce}'` : ""}`,
    "style-src-attr 'unsafe-inline'",
    `script-src 'self'${scriptNonce ? ` 'nonce-${scriptNonce}'` : ""}`,
    "media-src 'self' blob:",
  ].join("; "));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Origin-Agent-Cluster", "?1");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  if (new URL(trustedAppOrigin(url)).protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function serializeJsonForScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
