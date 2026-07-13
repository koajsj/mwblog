export const FIXED_ACCOUNTS = {
  kikou: {
    id: "00000000-0000-4000-8000-000000000001",
    account: "kikou",
    authorKey: "white",
    displayName: "kikou",
  },
  scoinmic: {
    id: "00000000-0000-4000-8000-000000000002",
    account: "scoinmic",
    authorKey: "brown",
    displayName: "scoinmic",
  },
} as const;

export type FixedAccountName = keyof typeof FIXED_ACCOUNTS;

function normalizeAccount(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function resolveFixedAccount(value: string) {
  const account = value.trim().toLowerCase();
  if (account === "kikou" || account === "scoinmic") return FIXED_ACCOUNTS[account];
  return null;
}

export function resolveFixedAccountByName(value: string | null | undefined) {
  const name = normalizeAccount(value);
  return Object.values(FIXED_ACCOUNTS).find((account) => normalizeAccount(account.account) === name) || null;
}

export function isAllowedPrivateProfile(profile: { account?: string | null; author_key?: string | null } | null | undefined, account?: string | null) {
  if (!profile) return false;

  const allowed = resolveFixedAccountByName(account || profile.account);
  if (!allowed) return false;

  return normalizeAccount(profile.account) === normalizeAccount(allowed.account) && profile.author_key === allowed.authorKey;
}
