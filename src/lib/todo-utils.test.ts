import test from "node:test";
import assert from "node:assert/strict";
import { durationMinutes, parseTimeRanges } from "./todo-utils.ts";

test("durationMinutes rejects identical start and end times", () => {
  assert.equal(durationMinutes("09:00", "09:00"), 0);
});

test("durationMinutes keeps normal and overnight ranges", () => {
  assert.equal(durationMinutes("09:00", "10:30"), 90);
  assert.equal(durationMinutes("23:30", "00:15"), 45);
});

test("parseTimeRanges drops zero-length ranges instead of treating them as a full day", () => {
  assert.deepEqual(parseTimeRanges('[{"start":"09:00","end":"09:00"}]'), []);
  assert.deepEqual(parseTimeRanges(null, { start: "09:00", end: "09:00" }), []);
});
