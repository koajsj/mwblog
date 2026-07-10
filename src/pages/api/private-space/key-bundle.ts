import type { APIRoute } from "astro";
import { PRIVATE_SPACE_ID } from "../../../lib/private-space";
import { createLocalsClient } from "../../../lib/supabase";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEnvelope(value: unknown) {
  if (!isObjectRecord(value)) return false;
  return ["salt", "iv", "data"].every((key) => typeof value[key] === "string" && String(value[key]).trim().length > 10);
}

function isBundle(value: unknown) {
  if (!isObjectRecord(value)) return false;
  const kdf = value.kdf;
  return value.version === 1
    && isObjectRecord(kdf)
    && kdf.name === "PBKDF2"
    && kdf.hash === "SHA-256"
    && Number.isInteger(kdf.iterations)
    && Number(kdf.iterations) >= 200000
    && isEnvelope(value.passphrase)
    && isEnvelope(value.recovery)
    && typeof value.fingerprint === "string"
    && String(value.fingerprint).trim().length >= 8;
}

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ error: "Please log in." }, 401);

  const supabase = createLocalsClient(locals);
  const { data, error } = await supabase
    .from("private_space_keys")
    .select("bundle")
    .eq("space_id", PRIVATE_SPACE_ID)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  return json({ bundle: data?.bundle || null });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  const payload = await request.json().catch(() => null);
  const bundle = payload?.bundle;
  if (!isBundle(bundle)) {
    return json({ error: "Invalid private-space key bundle." }, 400);
  }

  const supabase = createLocalsClient(locals);
  const row = {
    space_id: PRIVATE_SPACE_ID,
    bundle,
    created_by: user.id,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("private_space_keys")
    .upsert(row, { onConflict: "space_id" })
    .select("bundle")
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, bundle: data?.bundle || bundle });
};
