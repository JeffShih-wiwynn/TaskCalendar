import { describe, expect, it } from "vitest";
import { taskColors } from "./taskColors";

function luminance(color: string): number {
    const channels = [1, 3, 5].map((offset) => {
        const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string): number {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("task colors", () => {
    for (const theme of ["light", "dark"] as const) {
        it(`keeps titles readable for saturated and extreme categories in ${theme} mode`, () => {
            for (const color of ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#ffffff", "#000000", "#176b58"]) {
                const palette = taskColors(color, theme);
                for (const surface of [palette.background, palette.listBackground, palette.hoverBackground]) {
                    expect(contrast(palette.text, surface)).toBeGreaterThanOrEqual(4.5);
                }
                expect(palette.background).not.toBe(color);
            }
        });

        it(`renders completed tasks neutrally without sacrificing readability in ${theme} mode`, () => {
            const completed = taskColors("#ff0000", theme, true);
            expect(completed).toEqual(taskColors("#0000ff", theme, true));
            expect(contrast(completed.text, completed.background)).toBeGreaterThanOrEqual(4.5);
        });
    }
});
