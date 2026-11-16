import { describe, expect, it } from "vitest";

import { formatCalendarSlotTimes, getTimezoneCity } from "./calendarTimezones";

describe("calendar time zones", () => {
    it("formats the main and secondary time for Dutch standard time", () => {
        expect(
            formatCalendarSlotTimes(
                new Date("2026-01-15T08:00:00Z"),
                "Europe/Amsterdam",
                "Asia/Taipei",
            ),
        ).toEqual({ main: "08:00", secondary: "15:00" });
    });

    it("adjusts the secondary time for Dutch daylight-saving time", () => {
        expect(
            formatCalendarSlotTimes(
                new Date("2026-07-15T08:00:00Z"),
                "Europe/Amsterdam",
                "Asia/Taipei",
            ),
        ).toEqual({ main: "08:00", secondary: "14:00" });
    });

    it("omits the secondary time when the sub time zone is disabled", () => {
        expect(
            formatCalendarSlotTimes(
                new Date("2026-01-15T08:00:00Z"),
                "Asia/Taipei",
                null,
            ),
        ).toEqual({ main: "08:00", secondary: null });
    });

    it("uses a readable city name for time-zone headers", () => {
        expect(getTimezoneCity("America/New_York")).toBe("New York");
    });
});
