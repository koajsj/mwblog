import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const accounts = [
  { account: "kikou", email: "kikou@our-nest.local", legacyEmail: "mm@our-nest.local", password: "Qwer@1432", author_key: "white", display_name: "kikou" },
  { account: "scoinmic", email: "scoinmic@our-nest.local", legacyEmail: "ww@our-nest.local", password: "Qwer@1432", author_key: "brown", display_name: "scoinmic" },
];
const resetExistingPasswords = process.env.RESET_FIXED_USER_PASSWORDS === "1";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 100) return null;
  }
  return null;
}

loadDotEnv();

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

for (const account of accounts) {
  let user = await findUserByEmail(supabase, account.email);
  let migratedLegacyAccount = false;

  if (!user) {
    user = await findUserByEmail(supabase, account.legacyEmail);
    migratedLegacyAccount = Boolean(user);
  }

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: {
        account: account.account,
        author_key: account.author_key,
        display_name: account.display_name,
      },
    });
    if (error) throw error;
    user = data.user;
  } else {
    const updates = {
      ...(migratedLegacyAccount ? { email: account.email, email_confirm: true } : {}),
      user_metadata: {
        account: account.account,
        author_key: account.author_key,
        display_name: account.display_name,
      },
    };
    if (resetExistingPasswords || migratedLegacyAccount) updates.password = account.password;

    const { data, error } = await supabase.auth.admin.updateUserById(user.id, updates);
    if (error) throw error;
    user = data.user;
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: account.email,
      author_key: account.author_key,
      display_name: account.display_name,
    },
    { onConflict: "id" },
  );
  if (profileError) throw profileError;

  console.log(`Ready: ${account.account}${migratedLegacyAccount ? " (legacy account renamed)" : ""}`);
}

if (resetExistingPasswords) {
  console.warn("Existing fixed-account passwords were reset because RESET_FIXED_USER_PASSWORDS=1.");
}
