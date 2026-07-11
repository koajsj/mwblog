import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedPrivateProfile, resolveFixedAccount, resolveFixedAccountByEmail } from "./accounts.ts";

test("only the two fixed account names resolve", () => {
  assert.equal(resolveFixedAccount("kikou")?.authorKey, "white");
  assert.equal(resolveFixedAccount("SCOINMIC")?.authorKey, "brown");
  assert.equal(resolveFixedAccount("mm"), null);
  assert.equal(resolveFixedAccount("someone"), null);
});

test("fixed emails and profile identities must match", () => {
  assert.equal(resolveFixedAccountByEmail("KIKOU@our-nest.local")?.displayName, "kikou");
  assert.equal(isAllowedPrivateProfile({ email: "kikou@our-nest.local", author_key: "white" }), true);
  assert.equal(isAllowedPrivateProfile({ email: "kikou@our-nest.local", author_key: "brown" }), false);
  assert.equal(isAllowedPrivateProfile({ email: "mm@our-nest.local", author_key: "white" }), false);
});
