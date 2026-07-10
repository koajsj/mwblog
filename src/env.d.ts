/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    profile: import("./lib/types").Profile | null;
    session: import("@supabase/supabase-js").Session | null;
    accessToken: string;
  }
}
