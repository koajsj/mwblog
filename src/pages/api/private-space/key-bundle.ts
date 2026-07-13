import type { APIRoute } from "astro";
import { PRIVATE_SPACE_ID } from "../../../lib/private-space";
import { createLocalsClient } from "../../../lib/local-store";

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
  const salt = String(value.salt || "");
  const iv = String(value.iv || "");
  const data = String(value.data || "");
  const base64url = /^[A-Za-z0-9_-]+$/;
  return salt.length === 22
    && iv.length === 16
    && data.length >= 48
    && data.length <= 256
    && base64url.test(salt)
    && base64url.test(iv)
    && base64url.test(data);
}

function isBundle(value: unknown) {
  if (!isObjectRecord(value)) return false;
  const kdf = value.kdf;
  return value.version === 1
    && isObjectRecord(kdf)
    && kdf.name === "PBKDF2"
    && kdf.hash === "SHA-256"
    && Number.isInteger(kdf.iterations)
    && Number(kdf.iterations) >= 600000
    && Number(kdf.iterations) <= 1000000
    && isEnvelope(value.passphrase)
    && isEnvelope(value.recovery)
    && typeof value.fingerprint === "string"
    && /^[A-Za-z0-9_-]{16}$/.test(String(value.fingerprint));
}

function normalizeBundle(value: unknown) {
  if (!isBundle(value)) return null;
  const source = value as Record<string, any>;
  return {
    version: 1,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: Number(source.kdf.iterations),
    },
    passphrase: {
      salt: String(source.passphrase.salt),
      iv: String(source.passphrase.iv),
      data: String(source.passphrase.data),
    },
    recovery: {
      salt: String(source.recovery.salt),
      iv: String(source.recovery.iv),
      data: String(source.recovery.data),
    },
    fingerprint: String(source.fingerprint),
  };
}

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user) return json({ error: "Please log in." }, 401);

  const store = createLocalsClient(locals);
  const { data, error } = await store
    .from("private_space_keys")
    .select("bundle")
    .eq("space_id", PRIVATE_SPACE_ID)
    .maybeSingle();

  if (error) return json({ error: "Could not load the private-space key bundle." }, 500);
  return json({ bundle: data?.bundle || null });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  const payload = await request.json().catch(() => null);
  const rawBundle = payload?.bundle;
  if (!rawBundle || JSON.stringify(rawBundle).length > 4096) {
    return json({ error: "Invalid private-space key bundle." }, 400);
  }
  const bundle = normalizeBundle(rawBundle);
  if (!bundle) {
    return json({ error: "Invalid private-space key bundle." }, 400);
  }

  const store = createLocalsClient(locals);
  const { data: existing, error: existingError } = await store
    .from("private_space_keys")
    .select("space_id")
    .eq("space_id", PRIVATE_SPACE_ID)
    .maybeSingle();

  if (existingError) return json({ error: "Could not verify the private-space key bundle." }, 500);
  if (existing) return json({ error: "The private-space key has already been created." }, 409);

  const row = {
    space_id: PRIVATE_SPACE_ID,
    bundle,
    created_by: user.id,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await store
    .from("private_space_keys")
    .insert(row)
    .select("bundle")
    .single();

  if (error) {
    if (error.code === "23505") return json({ error: "The private-space key has already been created." }, 409);
    return json({ error: "Could not save the private-space key bundle." }, 500);
  }
  return json({ ok: true, bundle: data?.bundle || bundle });
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Please log in." }, 401);

  const payload = await request.json().catch(() => null);
  const rawBundle = payload?.bundle;
  const expectedFingerprint = String(payload?.expectedFingerprint || "");
  if (!rawBundle || JSON.stringify(rawBundle).length > 4096) {
    return json({ error: "Invalid private-space key bundle." }, 400);
  }
  const bundle = normalizeBundle(rawBundle);
  if (!bundle || !/^[A-Za-z0-9_-]{16}$/.test(expectedFingerprint) || bundle.fingerprint !== expectedFingerprint) {
    return json({ error: "Invalid private-space key bundle." }, 400);
  }

  const store = createLocalsClient(locals);
  const { data: existing, error: existingError } = await store
    .from("private_space_keys")
    .select("bundle")
    .eq("space_id", PRIVATE_SPACE_ID)
    .maybeSingle();
  if (existingError) return json({ error: "Could not verify the private-space key bundle." }, 500);
  if (!existing?.bundle || existing.bundle.fingerprint !== expectedFingerprint) {
    return json({ error: "The private-space key changed elsewhere. Reload and try again." }, 409);
  }

  const { data, error } = await store
    .from("private_space_keys")
    .update({
      bundle,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("space_id", PRIVATE_SPACE_ID)
    .eq("bundle", existing.bundle)
    .select("bundle")
    .maybeSingle();
  if (error) return json({ error: "Could not update the private-space passphrase." }, 500);
  if (!data) return json({ error: "The private-space key changed elsewhere. Reload and try again." }, 409);
  return json({ ok: true, bundle: data.bundle || bundle });
};
