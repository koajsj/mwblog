import type { APIRoute } from "astro";
import { readEncryptedText } from "../../lib/private-payload";
import { createLocalsClient } from "../../lib/local-store";

const MAX_FIELDS = 4;
const MAX_CIPHERTEXT_LENGTH = 12 * 1024;
const MAX_TOTAL_CIPHERTEXT_LENGTH = 32 * 1024;
const DRAFT_RETENTION_DAYS = 30;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

type DraftFieldContexts = Record<string, string>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function draftSpec(value: unknown): { key: string; fields: DraftFieldContexts } | null {
  const key = String(value || "").trim().toLowerCase();
  if (key === "record-create") return { key, fields: { body: "record.body", photo_event: "photo.title" } };
  if (key === "todo-create") return { key, fields: { title: "todo.title", due_on: "todo.due" } };
  if (new RegExp(`^(record|blog)-comment-${UUID}$`, "i").test(key)) {
    return { key, fields: { body: "comment.body" } };
  }
  if (new RegExp(`^todo-edit-${UUID}$`, "i").test(key)) return { key, fields: { title: "todo.title" } };
  return null;
}

function encryptedFields(value: unknown, allowedFields: DraftFieldContexts) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > MAX_FIELDS) return null;

  const fields: Record<string, string> = {};
  let total = 0;
  for (const [name, encrypted] of entries) {
    const context = allowedFields[name];
    if (!context || typeof encrypted !== "string") return null;
    if (!encrypted.startsWith("enc:wc2:") || encrypted.length > MAX_CIPHERTEXT_LENGTH) return null;
    try {
      fields[name] = readEncryptedText(encrypted, { maxLength: MAX_CIPHERTEXT_LENGTH, context });
    } catch {
      return null;
    }
    total += encrypted.length;
    if (total > MAX_TOTAL_CIPHERTEXT_LENGTH) return null;
  }
  return fields;
}

async function discardExpiredDrafts(store: ReturnType<typeof createLocalsClient>, ownerId: string) {
  const cutoff = new Date(Date.now() - DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await store.from("private_drafts").delete().eq("owner_id", ownerId).lt("updated_at", cutoff);
}

export const GET: APIRoute = async ({ url, locals }) => {
  const user = locals.user;
  const draft = draftSpec(url.searchParams.get("key"));
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  if (!draft) return json({ ok: false, error: "invalid_draft" }, 400);

  const store = createLocalsClient(locals);
  const { data, error } = await store
    .from("private_drafts")
    .select("payload,updated_at")
    .eq("owner_id", user.id)
    .eq("draft_key", draft.key)
    .maybeSingle();
  if (error) return json({ ok: false, error: "Could not read draft." }, 500);
  if (!data) return json({ ok: true, draft: null });
  return json({ ok: true, draft: { fields: data.payload, updated_at: data.updated_at } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await request.json().catch(() => null);
  const draft = draftSpec(body?.key);
  const fields = draft && encryptedFields(body?.fields, draft.fields);
  if (!draft || !fields) return json({ ok: false, error: "invalid_draft" }, 400);

  const store = createLocalsClient(locals);
  await discardExpiredDrafts(store, user.id);
  const { error } = await store.from("private_drafts").upsert({
    owner_id: user.id,
    draft_key: draft.key,
    payload: fields,
  }, { onConflict: "owner_id,draft_key" });
  if (error) return json({ ok: false, error: "Could not save draft." }, 500);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const draft = draftSpec(body?.key);
  if (!draft) return json({ ok: false, error: "invalid_draft" }, 400);

  const store = createLocalsClient(locals);
  const { error } = await store.from("private_drafts").delete().eq("owner_id", user.id).eq("draft_key", draft.key);
  if (error) return json({ ok: false, error: "Could not clear draft." }, 500);
  return json({ ok: true });
};
