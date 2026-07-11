import assert from "node:assert/strict";
import test from "node:test";
import { readEncryptedText } from "./private-payload.ts";

function encodedPayload(context: string) {
  const payload = {
    iv: Buffer.alloc(12, 1).toString("base64url"),
    data: Buffer.alloc(32, 2).toString("base64url"),
    context,
  };
  return `enc:wc2:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

test("accepts current ciphertext only for its declared context", () => {
  const value = encodedPayload("blog.title");
  assert.equal(readEncryptedText(value, { context: "blog.title" }), value);
  assert.throws(() => readEncryptedText(value, { context: "todo.title" }), /format is invalid/);
});

test("rejects previous ciphertext for new writes", () => {
  const payload = encodedPayload("blog.title").slice("enc:wc2:".length);
  assert.throws(
    () => readEncryptedText(`enc:wc1:${payload}`, { context: "blog.title" }),
    /current client-encryption format/,
  );
});
