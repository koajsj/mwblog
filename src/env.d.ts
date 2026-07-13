/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly LOGIN_PASSWORD_HASH?: string;
  readonly ENABLE_IP_WEATHER?: string;
}

declare namespace App {
  interface Locals {
    user: import("./lib/auth").LocalUser | null;
    profile: import("./lib/types").Profile | null;
    session: import("./lib/auth").LocalSession | null;
    accessToken: string;
  }
}
