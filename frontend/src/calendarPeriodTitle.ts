// FullCalendar's named-zone dates carry calendar wall-clock fields in UTC.
export function formatCalendarWeekTitle(
    start: Date,
    exclusiveEnd: Date,
    locale?: string,
): string {
    const lastDay = new Date(exclusiveEnd.getTime() - 1);
    const format = (date: Date, options: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);

    if (start.getUTCFullYear() !== lastDay.getUTCFullYear()) {
        return `${format(start, { month: "short", year: "numeric" })} – ${format(lastDay, { month: "short", year: "numeric" })}`;
    }
    if (start.getUTCMonth() !== lastDay.getUTCMonth()) {
        return `${format(start, { month: "short" })} – ${format(lastDay, { month: "short", year: "numeric" })}`;
    }
    return format(start, { month: "long", year: "numeric" });
}
