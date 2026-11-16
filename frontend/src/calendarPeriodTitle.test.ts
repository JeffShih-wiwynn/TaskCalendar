import { describe, expect, it } from "vitest";
import { formatCalendarWeekTitle } from "./calendarPeriodTitle";

describe("calendar week title", () => {
    it.each([
        ["2026-11-30", "2026-12-07", "Nov – Dec 2026"],
        ["2026-12-28", "2027-01-04", "Dec 2026 – Jan 2027"],
        ["2026-11-09", "2026-11-16", "November 2026"],
        ["2026-11-24", "2026-12-01", "November 2026"],
        ["2026-12-25", "2027-01-01", "December 2026"],
    ])("formats %s to %s as %s", (start, end, expected) => {
        expect(formatCalendarWeekTitle(new Date(start), new Date(end), "en-US"))
            .toBe(expected);
    });
});
