type ThemeMode = "light" | "dark";

function mix(color: string, base: string, amount: number): string {
    const channels = [1, 3, 5].map((offset) => {
        const foreground = Number.parseInt(color.slice(offset, offset + 2), 16);
        const background = Number.parseInt(base.slice(offset, offset + 2), 16);
        return Math.round(foreground * amount + background * (1 - amount))
            .toString(16).padStart(2, "0");
    });
    return `#${channels.join("")}`;
}

export function taskColors(color: string, theme: ThemeMode, completed = false) {
    const source = /^#[0-9a-f]{6}$/i.test(color) ? color : "#176b58";
    const dark = theme === "dark";
    const panel = dark ? "#18201d" : "#ffffff";
    const muted = mix(source, "#7f8b84", 0.65);
    const tint = completed ? "#7f8b84" : muted;
    return {
        background: mix(tint, panel, dark ? 0.24 : 0.14),
        listBackground: mix(tint, panel, dark ? 0.12 : 0.06),
        hoverBackground: mix(tint, panel, dark ? 0.34 : 0.22),
        accent: mix(tint, dark ? "#c3d3c9" : "#24382f", dark ? 0.65 : 0.75),
        text: dark ? "#eef4f1" : "#182026",
    };
}
