export function getTimezoneCity(timezone: string): string {
    const timezoneParts = timezone.split("/");
    return (timezoneParts[timezoneParts.length - 1] ?? timezone).replace(
        /_/g,
        " ",
    );
}

export function formatCalendarSlotTimes(
    wallClockDate: Date,
    mainTimezone: string,
    secondaryTimezone: string | null,
): { main: string; secondary: string | null } {
    const instant = calendarWallClockToInstant(wallClockDate, mainTimezone);
    return {
        main: formatUtcWallClockTime(wallClockDate),
        secondary: secondaryTimezone
            ? formatTimeInTimezone(instant, secondaryTimezone)
            : null,
    };
}

function calendarWallClockToInstant(date: Date, timezone: string): Date {
    const wallClockMs = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
    );
    let utcMs = wallClockMs;
    for (let pass = 0; pass < 2; pass += 1) {
        utcMs = wallClockMs - getTimezoneOffsetMilliseconds(
            new Date(utcMs),
            timezone,
        );
    }
    return new Date(utcMs);
}

function getTimezoneOffsetMilliseconds(date: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)]),
    );
    return (
        Date.UTC(
            values.year,
            values.month - 1,
            values.day,
            values.hour,
            values.minute,
            values.second,
        ) - date.getTime()
    );
}

function formatUtcWallClockTime(date: Date): string {
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
        date.getUTCMinutes(),
    ).padStart(2, "0")}`;
}

function formatTimeInTimezone(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).format(date);
}
