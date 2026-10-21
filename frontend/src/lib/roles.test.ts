import assert from "node:assert/strict";
import { test } from "node:test";
import { CHANGE_CREATE_ROLES, CHANGE_UPDATE_ROLES, REQUEST_UPDATE_ROLES, hasAnyRole } from "./roles.ts";

test("role gates match the API policy", () => {
  assert.equal(hasAnyRole(["requester"], CHANGE_CREATE_ROLES), false);
  assert.equal(hasAnyRole(["requester", "fulfiller"], CHANGE_CREATE_ROLES), true);
  assert.equal(hasAnyRole(["service_desk"], CHANGE_UPDATE_ROLES), false);
  assert.equal(hasAnyRole(["cab_member"], REQUEST_UPDATE_ROLES), false);
});
