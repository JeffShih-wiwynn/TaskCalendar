import { describe, expect, it } from "vitest";

import caddyfile from "../Caddyfile?raw";
import viteConfig from "../vite.config.ts?raw";

const routeFamilies = ["/api", "/auth", "/admin", "/backup", "/health"];

describe("backend route family configuration", () => {
    it("keeps Caddy proxy handles aligned with the PWA navigation denylist", () => {
        for (const routeFamily of routeFamilies) {
            const escapedRoute = routeFamily.replace("/", "\\/");
            const caddyPattern =
                routeFamily === "/health"
                    ? new RegExp(`handle\\s+${escapedRoute}\\s*\\{`)
                    : new RegExp(`handle\\s+${escapedRoute}/\\*\\s*\\{`);
            const pwaPattern =
                routeFamily === "/health"
                    ? String.raw`/^\/health$/`
                    : String.raw`/^\/${routeFamily.slice(1)}\//`;

            expect(caddyfile).toMatch(caddyPattern);
            expect(viteConfig).toContain(pwaPattern);
        }
    });
});
