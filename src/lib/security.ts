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

function cleanupLoginBuckets(now: number) {
  loginAttempts.forEach((bucket, key) => {
    if (now - bucket.lastSeenAt > LOGIN_BUCKET_TTL_MS) {
      loginAttempts.delete(key);
    }
  });
}

export function clientIpFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || "";
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
  const rawUrl = import.meta.env.SUPABASE_URL;
  if (!rawUrl) return Array.from(allow).join(" ");

  try {
    const origin = new URL(rawUrl).origin;
    allow.add(origin);
  } catch {
    // Ignore malformed env values and keep the default policy.
  }

  return Array.from(allow).join(" ");
}

export function withSecurityHeaders(response: Response, url: URL) {
  response.headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `connect-src ${cspConnectSrc()}`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline'",
    "media-src 'self' blob:",
  ].join("; "));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Origin-Agent-Cluster", "?1");
  if (url.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export function serializeJsonForScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
