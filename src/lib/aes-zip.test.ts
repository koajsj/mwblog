import assert from "node:assert/strict";
import test from "node:test";
import { encryptAes256Block, expandAes256Key } from "../../public/scripts/aes-zip.js";

function hex(value: string) {
  return new Uint8Array(Buffer.from(value, "hex"));
}

test("AES-256 block encryption matches the NIST test vector", () => {
  const key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  const plain = hex("00112233445566778899aabbccddeeff");
  const encrypted = encryptAes256Block(plain, expandAes256Key(key));
  assert.equal(Buffer.from(encrypted).toString("hex"), "8ea2b7ca516745bfeafc49904b496089");
});
