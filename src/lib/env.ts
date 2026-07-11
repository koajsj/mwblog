export function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL || import.meta.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

  return { url, anonKey, serviceRoleKey };
}
