import type { SlotLabelMountArg } from "@fullcalendar/core";

const labelCleanups = new WeakMap<HTMLElement, () => void>();

export function centerCalendarSlotLabel({ el }: Pick<SlotLabelMountArg, "el">): void {
    const row = el.closest("tr");
    if (!row) return;

    // A labeled hour includes the unlabeled half-hour rows below it.
    const rows = [row];
    let next = row.nextElementSibling;
    while (next && !next.querySelector(".fc-timegrid-slot-label-frame")) {
        rows.push(next as HTMLTableRowElement);
        next = next.nextElementSibling;
    }

    const updateOffset = () => {
        const cellBounds = el.getBoundingClientRect();
        const intervalBottom = rows[rows.length - 1].getBoundingClientRect().bottom;
        const offset = Math.max(0, (intervalBottom - cellBounds.bottom) / 2);
        el.style.setProperty("--calendar-slot-label-offset", `${offset}px`);
    };
    const observer = new ResizeObserver(updateOffset);
    rows.forEach((slotRow) => observer.observe(slotRow));
    const frame = requestAnimationFrame(updateOffset);
    labelCleanups.set(el, () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        el.style.removeProperty("--calendar-slot-label-offset");
    });
}

export function releaseCalendarSlotLabel({ el }: Pick<SlotLabelMountArg, "el">): void {
    labelCleanups.get(el)?.();
    labelCleanups.delete(el);
}
