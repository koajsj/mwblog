import type { APIRoute } from "astro";
import { clearSessionCookies, getAccessToken } from "../../../lib/auth";
import { createUserClient } from "../../../lib/supabase";

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = getAccessToken(cookies);
  if (token) {
    await createUserClient(token).auth.signOut().catch(() => undefined);
  }
  clearSessionCookies(cookies);
  return redirect("/", 303);
};
