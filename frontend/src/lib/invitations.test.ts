import assert from "node:assert/strict";
import { test } from "node:test";
import { invitationIdFrom, invitationLink } from "./invitations.ts";

const id = "3F2B4C1E-0000-4000-8000-000000000001";

test("links keep the legacy ?invitation= shape", () => {
  assert.equal(invitationLink(id, "https://service.wecrew.in"), `https://service.wecrew.in/accept-invitation?invitation=${id}`);
});

test("reads legacy and token parameters, rejects anything that is not an id", () => {
  assert.equal(invitationIdFrom(new URLSearchParams(`invitation=${id}`)), id.toLowerCase());
  assert.equal(invitationIdFrom(new URLSearchParams(`token=${id}`)), id.toLowerCase());
  assert.equal(invitationIdFrom(new URLSearchParams("invitation=../admin")), null);
  assert.equal(invitationIdFrom(new URLSearchParams("")), null);
});
