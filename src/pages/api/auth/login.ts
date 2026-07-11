import type { APIRoute } from "astro";
import { isAllowedPrivateProfile, resolveFixedAccount, resolveFixedAccountByEmail } from "../../../lib/accounts";
import { setSessionCookies } from "../../../lib/auth";
import { safeLocalRedirect } from "../../../lib/redirect";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "../../../lib/security";
import { createAnonClient, createUserClient } from "../../../lib/supabase";

function backToLogin(message: string, redirectTo = "/?skipCover=1#home") {
  const params = new URLSearchParams({ error: message, redirect: redirectTo });
  return `/auth/login?${params.toString()}`;
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const accountName = String(form.get("account") || form.get("email") || "").trim().toLowerCase();
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

  const supabase = createAnonClient();
  let authResult;
  try {
    authResult = await supabase.auth.signInWithPassword({ email: account.email, password });
  } catch {
    return redirect(backToLogin("Login service is temporarily unavailable. Please try again shortly.", redirectTo), 303);
  }
  const { data, error } = authResult;

  if (error || !data.session) {
    recordLoginFailure(request, accountName);
    return redirect(backToLogin("Login failed. Please check your account and password.", redirectTo), 303);
  }

  const user = data.user;
  const allowedAccount = resolveFixedAccountByEmail(user?.email);
  if (!user || !allowedAccount) {
    recordLoginFailure(request, accountName);
    return redirect(backToLogin("This account is not allowed.", redirectTo), 303);
  }

  const userClient = createUserClient(data.session.access_token);
  let profile = null;
  try {
    const result = await userClient
      .from("profiles")
      .select("email,author_key")
      .eq("id", user.id)
      .maybeSingle();
    if (result.error) {
      return redirect(backToLogin("Login service is temporarily unavailable. Please try again shortly.", redirectTo), 303);
    }
    profile = result.data;
  } catch {
    return redirect(backToLogin("Login service is temporarily unavailable. Please try again shortly.", redirectTo), 303);
  }

  if (!isAllowedPrivateProfile(profile, user.email)) {
    recordLoginFailure(request, accountName);
    return redirect(backToLogin("This account is not allowed.", redirectTo), 303);
  }

  clearLoginFailures(request, accountName);
  setSessionCookies(cookies, data.session);
  return redirect(redirectTo, 303);
};
