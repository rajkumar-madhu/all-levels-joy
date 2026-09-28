import { describe, expect, test } from "bun:test";
import { inviteMemberSchema, updateMemberSchema, saveGroupSchema } from "../src/lib/admin-contract";
import { safeRedirect } from "../src/lib/itsm-shared";

const id = "10000000-0000-4000-8000-000000000001";

describe("administration input boundaries", () => {
  test("normalizes the invitation address without changing its mailbox", () => {
    expect(
      inviteMemberSchema.parse({ email: " Person@Example.com ", roles: ["requester"] }).email,
    ).toBe("person@example.com");
    expect(
      inviteMemberSchema.safeParse({ email: "not-an-email", roles: ["requester"] }).success,
    ).toBe(false);
  });
  test("rejects arbitrary, duplicated, and missing roles", () => {
    for (const roles of [[], ["superuser"], ["admin", "admin"]]) {
      expect(inviteMemberSchema.safeParse({ email: "member@example.com", roles }).success).toBe(
        false,
      );
    }
  });
  test("membership edits require an explicit prior version", () => {
    const input = { userId: id, roles: ["requester"], isActive: false };
    expect(updateMemberSchema.safeParse(input).success).toBe(false);
    expect(updateMemberSchema.safeParse({ ...input, expectedVersion: 1 }).success).toBe(true);
  });
  test("group creates and edits cannot disguise one another or duplicate members", () => {
    const input = {
      groupId: null,
      name: "Platform support",
      description: "",
      isActive: true,
      memberIds: [id],
      expectedVersion: null,
    };
    expect(saveGroupSchema.safeParse(input).success).toBe(true);
    expect(saveGroupSchema.safeParse({ ...input, groupId: id }).success).toBe(false);
    expect(saveGroupSchema.safeParse({ ...input, memberIds: [id, id] }).success).toBe(false);
  });
  test("sign-in preserves invitation links and rejects external or ambiguous destinations", () => {
    const destination = `/accept-invitation?invitation=${id}`;
    expect(safeRedirect(destination)).toBe(destination);
    for (const path of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "/\n/example.com",
      " /dashboard",
      "/auth\u0000",
    ]) {
      expect(safeRedirect(path)).toBe("/dashboard");
    }
  });
});
