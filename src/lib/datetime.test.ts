import test from "node:test";
import assert from "node:assert/strict";
import { isDateKey, shanghaiDateKey } from "./datetime.ts";

test("shanghaiDateKey formats dates in Asia/Shanghai instead of UTC", () => {
  assert.equal(shanghaiDateKey(new Date("2026-01-01T15:30:00.000Z")), "2026-01-01");
  assert.equal(shanghaiDateKey(new Date("2026-01-01T16:30:00.000Z")), "2026-01-02");
});

test("isDateKey rejects impossible calendar dates", () => {
  assert.equal(isDateKey("2026-02-28"), true);
  assert.equal(isDateKey("2026-02-29"), false);
  assert.equal(isDateKey("2024-02-29"), true);
  assert.equal(isDateKey("2026-13-01"), false);
  assert.equal(isDateKey("2026-00-10"), false);
  assert.equal(isDateKey("2026-01-32"), false);
});
