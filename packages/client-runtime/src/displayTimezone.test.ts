import { describe, expect, it } from "vite-plus/test";

import {
  displayTimeZoneOptions,
  resolveDisplayTimeZone,
  SYSTEM_DISPLAY_TIME_ZONE,
} from "./displayTimezone.ts";

describe("resolveDisplayTimeZone", () => {
  it("keeps the device zone while the toggle is off, even with a saved zone", () => {
    expect(resolveDisplayTimeZone(false, "Asia/Tokyo")).toBeUndefined();
    expect(resolveDisplayTimeZone(undefined, "Asia/Tokyo")).toBeUndefined();
  });

  it("keeps the device zone when unset or following the system", () => {
    expect(resolveDisplayTimeZone(true, undefined)).toBeUndefined();
    expect(resolveDisplayTimeZone(true, SYSTEM_DISPLAY_TIME_ZONE)).toBeUndefined();
  });

  it("returns the saved zone while the toggle is on", () => {
    expect(resolveDisplayTimeZone(true, "Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("keeps the device zone when the saved name is not a real IANA zone", () => {
    expect(resolveDisplayTimeZone(true, "Mars/Olympus_Mons")).toBeUndefined();
    expect(resolveDisplayTimeZone(true, "")).toBeUndefined();
    expect(resolveDisplayTimeZone(true, "   ")).toBeUndefined();
  });

  it("accepts zone names ICU knows beyond the common ones", () => {
    expect(resolveDisplayTimeZone(true, "Australia/Lord_Howe")).toBe("Australia/Lord_Howe");
  });
});

describe("displayTimeZoneOptions", () => {
  it("lists supported zones without duplicates, UTC included", () => {
    const zones = displayTimeZoneOptions();
    expect(zones.length).toBeGreaterThan(20);
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones).toContain("UTC");
  });
});
