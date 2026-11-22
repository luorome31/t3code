import { describe, expect, it } from "vite-plus/test";

import { formatNextScheduledTaskRun } from "./scheduledTaskPresentation";

describe("formatNextScheduledTaskRun", () => {
  it("names the rounded unit for a run later today", () => {
    const now = new Date(2026, 10, 3, 10, 0, 0).getTime();
    const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
    expect(formatNextScheduledTaskRun(at(59), now)).toBe("Next run in 59 minutes");
    expect(formatNextScheduledTaskRun(at(59.5), now)).toBe("Next run in 1 hour");
    expect(formatNextScheduledTaskRun(at(150), now)).toBe("Next run in 3 hours");
  });

  it("picks tomorrow from the chosen zone's calendar, not the device's", () => {
    // 23:30 UTC on November 3 is already November 4 in Tokyo but still November 3 in New York.
    const now = Date.parse("2026-11-03T23:30:00.000Z");
    const next = "2026-11-04T20:00:00.000Z";
    const timeIn = (zone: string) =>
      new Date(next).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: zone });
    expect(formatNextScheduledTaskRun(next, now, undefined, "Asia/Tokyo")).toBe(
      `Next run tomorrow at ${timeIn("Asia/Tokyo")}`,
    );
    expect(formatNextScheduledTaskRun(next, now, undefined, "America/New_York")).toBe(
      `Next run tomorrow at ${timeIn("America/New_York")}`,
    );
  });

  it("names the weekday in the chosen zone across a DST change", () => {
    // America/New_York left DST on 2026-11-01: the run lands on Monday, November 2 at 1:30 AM EST.
    const now = Date.parse("2026-10-30T12:00:00.000Z");
    const next = "2026-11-02T06:30:00.000Z";
    const time = new Date(next).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
    expect(formatNextScheduledTaskRun(next, now, undefined, "America/New_York")).toBe(
      `Next run next Monday at ${time}`,
    );
  });

  it("keeps the device zone's calendar without an override", () => {
    const now = new Date(2026, 10, 3, 10, 0, 0).getTime();
    const next = new Date(2026, 10, 12, 9, 30);
    expect(formatNextScheduledTaskRun(next.toISOString(), now)).toBe(
      `Next run ${next.toLocaleDateString([], { month: "short", day: "numeric" })} at ${next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    );
  });
});
