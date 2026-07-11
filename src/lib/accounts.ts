export const FIXED_ACCOUNTS = {
  kikou: { email: "kikou@our-nest.local", authorKey: "white", displayName: "kikou" },
  scoinmic: { email: "scoinmic@our-nest.local", authorKey: "brown", displayName: "scoinmic" },
} as const;

export type FixedAccountName = keyof typeof FIXED_ACCOUNTS;

function normalizeEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function resolveFixedAccount(value: string) {
  const account = value.trim().toLowerCase();
  if (account === "kikou" || account === "scoinmic") return FIXED_ACCOUNTS[account];
  return null;
}

export function resolveFixedAccountByEmail(value: string | null | undefined) {
  const email = normalizeEmail(value);
  return Object.values(FIXED_ACCOUNTS).find((account) => normalizeEmail(account.email) === email) || null;
}

export function isAllowedPrivateProfile(profile: { email?: string | null; author_key?: string | null } | null | undefined, email?: string | null) {
  if (!profile) return false;

  const allowed = resolveFixedAccountByEmail(email || profile.email);
  if (!allowed) return false;

  return normalizeEmail(profile.email) === normalizeEmail(allowed.email) && profile.author_key === allowed.authorKey;
}
