import { describe, expect, test } from "bun:test";
import { requireSecurityStaff } from "../src/lib/security-access";

describe("security board staff permission", () => {
  test("allows a server-verified staff member", async () => {
    await expect(requireSecurityStaff(async () => ({ data: true, error: null }))).resolves.toBeUndefined();
  });
  test("rejects a requester before record reads", async () => {
    let recordsRead = false;
    const read = async () => {
      await requireSecurityStaff(async () => ({ data: false, error: null }));
      recordsRead = true;
    };
    await expect(read()).rejects.toThrow("staff only");
    expect(recordsRead).toBe(false);
  });
  test("fails closed when permission verification fails", async () => {
    await expect(requireSecurityStaff(async () => ({ data: true, error: new Error("unavailable") }))).rejects.toThrow("staff only");
    await expect(requireSecurityStaff(async () => ({ data: null, error: null }))).rejects.toThrow("staff only");
  });
});