import { describe, expect, it } from "vite-plus/test";

import {
  calendarDayIndex,
  formatChatTimestampTooltip,
  formatDayAwareTimestamp,
  formatDayHeader,
  formatFullTimestamp,
  formatShortTimestamp,
  formatUpcomingTimestamp,
} from "./timestampFormat";

// Node re-resolves the default zone when TZ is assigned, like a renderer after the OS zone changes.
function useTimeZone(timeZone: string): Disposable {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  return {
    [Symbol.dispose]: () => {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    },
  };
}

const dayHeaderOptionsIn: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

describe("timestamps in an explicit time zone", () => {
  // 23:00 UTC on July 1 is 7 PM on July 1 in New York, whatever the host zone.
  const now = Date.parse("2026-07-01T23:00:00.000Z");
  const zone = "America/New_York";

  it("picks relative days from the calendar in that zone", () => {
    expect(formatUpcomingTimestamp("2026-07-02T00:30:00.000Z", "12-hour", now, zone)).not.toMatch(
      /tomorrow/,
    );
    expect(formatUpcomingTimestamp("2026-07-02T05:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^tomorrow at /,
    );
    expect(formatDayAwareTimestamp("2026-07-01T03:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^yesterday at /,
    );
  });

  it("renders the tooltip date and time in that zone", () => {
    // 20:00 UTC on October 31 is still October 31 in New York but November 1 in Bangkok.
    const monthEnd = "2026-10-31T20:00:00.000Z";
    const timeInZone = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: zone,
    }).format(new Date(monthEnd));
    expect(formatChatTimestampTooltip(monthEnd, "12-hour", zone)).toBe(
      `${timeInZone}, 31st October 2026`,
    );
  });

  it("keeps short and full timestamps in that zone", () => {
    const instant = "2026-10-31T20:00:00.000Z";
    expect(formatShortTimestamp(instant, "24-hour", zone)).toBe("16:00");
    const full = formatFullTimestamp(instant, "24-hour", zone);
    expect(full).toContain("16:00");
    expect(full).not.toContain("20:00");
  });

  it("formats an hour the zone repeats when clocks go back", () => {
    // America/New_York left DST on 2026-11-01: 05:30 UTC is 1:30 AM EST after the fall-back.
    const fallBack = "2026-11-01T05:30:00.000Z";
    expect(formatShortTimestamp(fallBack, "24-hour", zone)).toBe("1:30");
    expect(formatChatTimestampTooltip(fallBack, "24-hour", zone)).toMatch(
      /^1:30, 1st November 2026$/,
    );
  });

  it("reuses formatters on the day-aware hot path once the zone's are warm", () => {
    // Old messages hit every zoned formatter the path reads: time, calendar day, numeric date.
    const old = "2026-06-20T12:00:00.000Z";
    expect(formatDayAwareTimestamp(old, "24-hour", now, zone)).not.toBe("");

    const realDateTimeFormat = Intl.DateTimeFormat;
    let constructions = 0;
    class CountingDateTimeFormat extends realDateTimeFormat {
      constructor(...args: ConstructorParameters<typeof realDateTimeFormat>) {
        super(...args);
        constructions += 1;
      }
    }
    // The counting subclass covers the `new` path the measured window exercises.
    Intl.DateTimeFormat = CountingDateTimeFormat as unknown as typeof Intl.DateTimeFormat;
    try {
      for (let call = 0; call < 100; call += 1) {
        expect(formatDayAwareTimestamp(old, "24-hour", now, zone)).not.toBe("");
      }
    } finally {
      Intl.DateTimeFormat = realDateTimeFormat;
    }
    expect(constructions).toBe(0);
  });
});

describe("day headers and grouping in an explicit time zone", () => {
  // 03:30 and 04:30 UTC on November 1 are 23:30 and 00:30 in New York, across its midnight.
  const beforeMidnight = "2026-11-01T03:30:00.000Z";
  const afterMidnight = "2026-11-01T04:30:00.000Z";
  const zone = "America/New_York";

  it("groups rows by the zone's calendar day", () => {
    expect(calendarDayIndex(beforeMidnight, zone)).not.toBe(calendarDayIndex(afterMidnight, zone));
    // 20:00 UTC on October 31 is 16:00 in New York, the same zone day as 23:30 there.
    expect(calendarDayIndex("2026-10-31T20:00:00.000Z", zone)).toBe(
      calendarDayIndex(beforeMidnight, zone),
    );
  });

  it("headers keep the locale's short month-day-year in the zone", () => {
    const headerIn = (iso: string) =>
      new Intl.DateTimeFormat(undefined, { ...dayHeaderOptionsIn, timeZone: zone }).format(
        new Date(iso),
      );
    expect(formatDayHeader(beforeMidnight, zone)).toBe(headerIn(beforeMidnight));
    expect(formatDayHeader(afterMidnight, zone)).toBe(headerIn(afterMidnight));
  });

  it("keeps the device zone's header and grouping without an override", () => {
    // 20:00 UTC on October 31 is already November 1 in Tokyo, whatever the host zone is.
    using _deviceZone = useTimeZone("Asia/Tokyo");
    const monthEnd = "2026-10-31T20:00:00.000Z";
    expect(formatDayHeader(monthEnd)).toBe(
      new Date(monthEnd).toLocaleDateString(undefined, dayHeaderOptionsIn),
    );
    expect(calendarDayIndex(monthEnd)).toBe(calendarDayIndex("2026-11-01T02:00:00.000Z"));
  });
});

describe("timestamps after the system time zone changes", () => {
  // Built fresh with an explicit zone, so expectations follow the host locale but not a stale zone.
  const timeIn = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(new Date(iso));
  const dayIn = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", timeZone }).format(
      new Date(iso),
    );

  it("renders the gutter label in the new zone", () => {
    const sameDay = "2026-11-07T04:45:43.877Z";
    const earlierInWeek = "2026-11-04T20:00:00.000Z";
    const now = Date.parse(sameDay);
    using _zone = useTimeZone("America/New_York");
    expect([
      formatDayAwareTimestamp(sameDay, "12-hour", now),
      formatDayAwareTimestamp(earlierInWeek, "12-hour", now),
    ]).toEqual([
      timeIn(sameDay, "America/New_York"),
      `${dayIn(earlierInWeek, "America/New_York")} ${timeIn(earlierInWeek, "America/New_York")}`,
    ]);

    process.env.TZ = "Asia/Bangkok";
    expect([
      formatDayAwareTimestamp(sameDay, "12-hour", now),
      formatDayAwareTimestamp(earlierInWeek, "12-hour", now),
    ]).toEqual([
      timeIn(sameDay, "Asia/Bangkok"),
      `${dayIn(earlierInWeek, "Asia/Bangkok")} ${timeIn(earlierInWeek, "Asia/Bangkok")}`,
    ]);
  });

  it("renders the tooltip in the new zone", () => {
    const monthEnd = "2026-10-31T20:00:00.000Z";
    using _zone = useTimeZone("America/New_York");
    expect(formatChatTimestampTooltip(monthEnd, "12-hour")).toBe(
      `${timeIn(monthEnd, "America/New_York")}, 31st October 2026`,
    );

    process.env.TZ = "Asia/Bangkok";
    expect(formatChatTimestampTooltip(monthEnd, "12-hour")).toBe(
      `${timeIn(monthEnd, "Asia/Bangkok")}, 1st November 2026`,
    );
  });
});
