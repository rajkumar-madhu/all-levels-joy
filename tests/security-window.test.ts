import { describe, expect, test } from "bun:test";
import { securityWindowPayload, localWindowTimeToIso, windowTimeToLocalInput } from "../src/lib/security-window";
import { transitionSchema } from "../src/lib/security-workflow";

describe("security window timezone boundaries", () => {
  test("both local selections round trip without shifting", () => {
    const expected: Record<string, [string, string]> = {
      "America/New_York": ["2026-10-05T18:00:00.000Z", "2026-10-05T19:00:00.000Z"],
      "Asia/Kolkata": ["2026-10-05T08:30:00.000Z", "2026-10-05T09:30:00.000Z"],
      "UTC": ["2026-10-05T14:00:00.000Z", "2026-10-05T15:00:00.000Z"],
    };
    const zone = process.env.TZ ?? "UTC";
    const times = expected[zone];
    if (!times) throw new Error("Run timezone tests in UTC, America/New_York or Asia/Kolkata.");
    const result = securityWindowPayload("2026-10-05T14:00", "2026-10-05T15:00");
    expect(result.windowStart).toBe(times[0]);
    expect(result.windowEnd).toBe(times[1]);
    expect(windowTimeToLocalInput(result.windowStart)).toBe("2026-10-05T14:00");
    expect(windowTimeToLocalInput(result.windowEnd)).toBe("2026-10-05T15:00");
  });
  test("server rejects timezone-free start and end separately", () => {
    const valid = { action: "schedule", windowStart: "2026-10-05T18:00:00Z", windowEnd: "2026-10-05T19:00:00Z" };
    expect(transitionSchema.safeParse(valid).success).toBe(true);
    expect(transitionSchema.safeParse({ ...valid, windowStart: "2026-10-05T14:00" }).success).toBe(false);
    expect(transitionSchema.safeParse({ ...valid, windowEnd: "2026-10-05T15:00" }).success).toBe(false);
  });
  test("end must follow start on browser and server", () => {
    expect(() => securityWindowPayload("2026-10-05T15:00", "2026-10-05T14:00")).toThrow("end after");
    expect(transitionSchema.safeParse({ action: "schedule", windowStart: "2026-10-05T19:00:00Z", windowEnd: "2026-10-05T18:00:00Z" }).success).toBe(false);
  });
  test("invalid and missing local times are rejected", () => {
    expect(() => localWindowTimeToIso("")).toThrow();
    expect(() => localWindowTimeToIso("2026-02-30T14:00")).toThrow();
    expect(transitionSchema.safeParse({ action: "schedule", windowStart: "not-a-date", windowEnd: "2026-10-05T19:00:00Z" }).success).toBe(false);
  });
  test("New York spring gap is rejected and winter offset is respected", () => {
    if (process.env.TZ !== "America/New_York") return;
    expect(() => localWindowTimeToIso("2026-03-08T02:30")).toThrow("does not exist");
    expect(localWindowTimeToIso("2026-12-05T14:00")).toBe("2026-12-05T19:00:00.000Z");
  });
});