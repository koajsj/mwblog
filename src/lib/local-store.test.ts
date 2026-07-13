import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

process.env.APP_DATA_DIR = join(tmpdir(), `mwblog-test-${randomUUID()}`);

const {
  createLocalsClient,
  createSession,
  deleteSession,
  profileByAccount,
  readSessionProfile,
} = await import("./local-store.ts");

const kikou = { id: "00000000-0000-4000-8000-000000000001", account: "kikou" };
const scoinmic = { id: "00000000-0000-4000-8000-000000000002", account: "scoinmic" };

test("local store initializes only the two fixed profiles", () => {
  assert.equal(profileByAccount(kikou.account)?.author_key, "white");
  assert.equal(profileByAccount(scoinmic.account)?.author_key, "brown");
  assert.equal(profileByAccount("third"), null);
});

test("one account cannot modify content owned by the other", async () => {
  const whiteStore = createLocalsClient({ user: kikou } as App.Locals);
  const brownStore = createLocalsClient({ user: scoinmic } as App.Locals);
  const created = await whiteStore.from("todos").insert({
    owner_id: kikou.id,
    title: "encrypted-title",
    due_on: null,
  }).select("id,title").single();
  assert.equal(created.error, null);

  const changed = await brownStore.from("todos")
    .update({ title: "changed-by-other-account" })
    .eq("id", created.data.id)
    .select("id,title")
    .maybeSingle();
  assert.equal(changed.error, null);
  assert.equal(changed.data, null);

  const current = await whiteStore.from("todos").select("title").eq("id", created.data.id).single();
  assert.equal(current.data.title, "encrypted-title");

  const activity = await whiteStore.from("activity_entries").insert({
    owner_id: kikou.id,
    activity_on: "2026-07-11",
    period: "morning",
    category: "test",
    minutes: 10,
    body: "encrypted-body",
  }).select("id").single();
  const foreignLink = await brownStore.from("todo_activity_entries").insert({
    todo_id: created.data.id,
    activity_entry_id: activity.data.id,
  });
  assert.match(foreignLink.error?.message || "", /another account/i);

  const ownLink = await whiteStore.from("todo_activity_entries").insert({
    todo_id: created.data.id,
    activity_entry_id: activity.data.id,
  });
  assert.equal(ownLink.error, null);
  const linked = await whiteStore.from("todo_activity_entries")
    .select("todo_id,activity_entries(start_time,end_time,minutes)")
    .eq("todo_id", created.data.id)
    .single();
  assert.equal(linked.error, null);
  assert.equal(linked.data.activity_entries.minutes, 10);
});

test("an update returns the changed row when a filtered field changes", async () => {
  const store = createLocalsClient({ user: kikou } as App.Locals);
  const { data: created, error: createError } = await store.from("todos").insert({
    owner_id: kikou.id,
    title: "encrypted-title",
    due_on: "2026-07-12",
  }).select("id,completed").single();
  assert.equal(createError, null);
  assert.equal(created.completed, false);

  const { data: changed, error } = await store.from("todos")
    .update({ completed: true })
    .eq("id", created.id)
    .eq("completed", false)
    .select("id,completed")
    .maybeSingle();

  assert.equal(error, null);
  assert.equal(changed.id, created.id);
  assert.equal(changed.completed, true);
});

test("server sessions can be created and revoked", () => {
  const token = randomBytes(32).toString("base64url");
  createSession(kikou.id, token, new Date(Date.now() + 60_000).toISOString());
  assert.equal(readSessionProfile(token)?.id, kikou.id);
  deleteSession(token);
  assert.equal(readSessionProfile(token), null);
});

test("private-space key bundle can be changed by either fixed account", async () => {
  const store = createLocalsClient({ user: kikou } as App.Locals);
  const row = {
    space_id: "private-couple-space",
    bundle: { version: 1, fingerprint: "0123456789abcdef" },
    created_by: kikou.id,
    updated_by: kikou.id,
    updated_at: new Date().toISOString(),
  };
  const first = await store.from("private_space_keys").insert(row).select("bundle").single();
  const second = await store.from("private_space_keys").insert(row).select("bundle").single();
  assert.equal(first.error, null);
  assert.equal(second.error?.code, "23505");

  const brownStore = createLocalsClient({ user: scoinmic } as App.Locals);
  const changed = await brownStore.from("private_space_keys").update({
    bundle: { version: 1, fingerprint: "fedcba9876543210" },
    updated_by: scoinmic.id,
  }).eq("space_id", row.space_id).select("bundle").single();
  assert.equal(changed.error, null);
  assert.equal(changed.data.bundle.fingerprint, "fedcba9876543210");

  const invalid = await brownStore.from("private_space_keys").update({
    bundle: row.bundle,
    updated_by: kikou.id,
  }).eq("space_id", row.space_id).select("bundle").single();
  assert.match(invalid.error?.message || "", /Invalid private-space key owner/);
});
