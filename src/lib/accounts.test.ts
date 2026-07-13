import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedPrivateProfile, resolveFixedAccount, resolveFixedAccountByName } from "./accounts.ts";

test("only the two fixed account names resolve", () => {
  assert.equal(resolveFixedAccount("kikou")?.authorKey, "white");
  assert.equal(resolveFixedAccount("SCOINMIC")?.authorKey, "brown");
  assert.equal(resolveFixedAccount("mm"), null);
  assert.equal(resolveFixedAccount("someone"), null);
});

test("fixed account and profile identities must match", () => {
  assert.equal(resolveFixedAccountByName("KIKOU")?.displayName, "kikou");
  assert.equal(isAllowedPrivateProfile({ account: "kikou", author_key: "white" }), true);
  assert.equal(isAllowedPrivateProfile({ account: "kikou", author_key: "brown" }), false);
  assert.equal(isAllowedPrivateProfile({ account: "someone", author_key: "white" }), false);
});
