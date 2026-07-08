export const FIXED_ACCOUNTS = {
  mm: { email: "mm@our-nest.local", authorKey: "white", displayName: "mm" },
  ww: { email: "ww@our-nest.local", authorKey: "brown", displayName: "ww" },
} as const;

export type FixedAccountName = keyof typeof FIXED_ACCOUNTS;

export function resolveFixedAccount(value: string) {
  const account = value.trim().toLowerCase();
  if (account === "mm" || account === "ww") return FIXED_ACCOUNTS[account];
  return null;
}
