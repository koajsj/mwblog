import type { APIRoute } from "astro";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { resolveFixedAccount } from "../../../lib/accounts";
import { startSession } from "../../../lib/auth";
import { safeLocalRedirect } from "../../../lib/redirect";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "../../../lib/security";

function passwordMatches(input: string) {
  const encoded = String(process.env.LOGIN_PASSWORD_HASH || import.meta.env.LOGIN_PASSWORD_HASH || "");
  const [algorithm, saltText, expectedText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !expectedText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(expectedText, "base64url");
    const actual = scryptSync(input, salt, expected.length, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return expected.length === 32 && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function backToLogin(message: string, redirectTo = "/?skipCover=1#home") {
  const params = new URLSearchParams({ error: message, redirect: redirectTo });
  return `/auth/login?${params.toString()}`;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const accountName = String(form.get("account") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const redirectTo = safeLocalRedirect(String(form.get("redirect") || ""), "/?skipCover=1#home");
  const account = resolveFixedAccount(accountName);

  if (!account || !password) {
    return redirect(backToLogin("Please enter account kikou or scoinmic and your password.", redirectTo), 303);
  }

  const rateLimit = checkLoginRateLimit(request, accountName);
  if (!rateLimit.allowed) {
    const retryMinutes = Math.max(1, Math.ceil(rateLimit.retryAfterSeconds / 60));
    return redirect(backToLogin(`Too many login attempts. Try again in ${retryMinutes} minute${retryMinutes > 1 ? "s" : ""}.`, redirectTo), 303);
  }

  if (!passwordMatches(password)) {
    recordLoginFailure(request, accountName);
    return redirect(backToLogin("Login failed. Please check your account and password.", redirectTo), 303);
  }

  clearLoginFailures(request, accountName);
  startSession(cookies, account.id);
  return redirect(redirectTo, 303);
};
