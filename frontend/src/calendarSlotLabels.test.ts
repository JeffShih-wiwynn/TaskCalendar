import { afterEach, describe, expect, it, vi } from "vitest";
import { centerCalendarSlotLabel, releaseCalendarSlotLabel } from "./calendarSlotLabels";

afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});

describe("calendar time label alignment", () => {
    it.each([24, 34])("centers across the whole hour with %ipx half-hour rows and updates on resize", (height) => {
        let resize = () => {};
        const disconnect = vi.fn();
        vi.stubGlobal("ResizeObserver", class {
            constructor(callback: () => void) { resize = callback; }
            observe() {}
            disconnect = disconnect;
        });
        vi.stubGlobal("requestAnimationFrame", () => 1);
        vi.stubGlobal("cancelAnimationFrame", vi.fn());
        const table = document.createElement("table");
        table.innerHTML = '<tbody><tr><td><div class="fc-timegrid-slot-label-frame"></div></td></tr><tr><td></td></tr><tr><td><div class="fc-timegrid-slot-label-frame"></div></td></tr></tbody>';
        document.body.append(table);
        const cell = table.rows[0].cells[0];
        cell.getBoundingClientRect = () => new DOMRect(0, 0, 64, height);
        let minorHeight = height;
        table.rows[1].getBoundingClientRect = () => new DOMRect(0, height, 64, minorHeight);
        const arg = { el: cell };
        centerCalendarSlotLabel(arg);
        resize();
        expect(cell.style.getPropertyValue("--calendar-slot-label-offset")).toBe(`${height / 2}px`);
        minorHeight = 40;
        resize();
        expect(cell.style.getPropertyValue("--calendar-slot-label-offset")).toBe("20px");
        releaseCalendarSlotLabel(arg);
        expect(disconnect).toHaveBeenCalledOnce();
        expect(cell.style.getPropertyValue("--calendar-slot-label-offset")).toBe("");
    });
});
