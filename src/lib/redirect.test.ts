import test from "node:test";
import assert from "node:assert/strict";
import { safeLocalRedirect } from "./redirect.ts";

test("safeLocalRedirect accepts normal same-site paths", () => {
  assert.equal(safeLocalRedirect("/records?created=record#top", "/"), "/records?created=record#top");
  assert.equal(safeLocalRedirect("  /blog/post-one  ", "/"), "/blog/post-one");
});

test("safeLocalRedirect rejects external and ambiguous redirects", () => {
  assert.equal(safeLocalRedirect("https://example.com", "/"), "/");
  assert.equal(safeLocalRedirect("//example.com/path", "/"), "/");
  assert.equal(safeLocalRedirect("/\\example.com", "/"), "/");
  assert.equal(safeLocalRedirect("/%5cexample.com", "/"), "/");
  assert.equal(safeLocalRedirect("/%2fexample.com", "/"), "/");
  assert.equal(safeLocalRedirect("/records\u0000", "/"), "/");
});
