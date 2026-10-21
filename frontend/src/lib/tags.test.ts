import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTags } from "./tags.ts";

test("tags are normalised like the API", () => {
  assert.deepEqual(parseTags("VPN, vpn , Remote Access!, ,"), ["vpn", "remote-access"]);
  assert.equal(parseTags(Array.from({ length: 20 }, (_, i) => `t${i}`).join(",")).length, 12);
});
