import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

export function createAnonClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createServiceClient() {
  const { url, serviceRoleKey } = getSupabaseEnv();
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createUserClient(accessToken: string) {
  const { url, anonKey } = getSupabaseEnv();
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
