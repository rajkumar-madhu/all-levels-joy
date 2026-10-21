import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessage } from "./errors.ts";

test("reads DRF detail, field and nested errors", () => {
  assert.equal(errorMessage({ detail: "You cannot approve your own fix plan" }), "You cannot approve your own fix plan");
  assert.equal(errorMessage({ windowEnd: ["The fix window must end after it starts."] }), "The fix window must end after it starts.");
  assert.equal(errorMessage({ "findings.0": { severity: ['"urgent" is not a valid choice.'] } }), '"urgent" is not a valid choice.');
  assert.equal(errorMessage(null, "fallback"), "fallback");
});
