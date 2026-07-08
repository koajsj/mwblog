export function getSupabaseEnv() {
  const url = import.meta.env.SUPABASE_URL;
  const anonKey = import.meta.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

  return { url, anonKey, serviceRoleKey };
}
