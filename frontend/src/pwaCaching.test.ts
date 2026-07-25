/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import caddyfile from "../Caddyfile?raw";
import serviceWorkerSource from "./sw.ts?raw";

describe("PWA cache update policy", () => {
    it("claims clients and cleans old precaches while preserving precaching", () => {
        expect(serviceWorkerSource).toContain("self.skipWaiting()");
        expect(serviceWorkerSource).toContain("clientsClaim()");
        expect(serviceWorkerSource).toContain("cleanupOutdatedCaches()");
        expect(serviceWorkerSource).toContain(
            "precacheAndRoute(self.__WB_MANIFEST)",
        );
    });

    it("keeps the Chromium installability fetch listener", () => {
        expect(serviceWorkerSource).toContain('self.addEventListener("fetch"');
    });
});

describe("Caddy frontend cache headers", () => {
    it("serves hashed assets with immutable long-lived caching", () => {
        expect(caddyfile).toContain("handle /assets/*");
        expect(caddyfile).toContain(
            'Cache-Control "public, max-age=31536000, immutable"',
        );
    });

    it("serves app shell and service worker files with no-cache", () => {
        for (const path of ["/sw.js", "/registerSW.js", "/manifest.webmanifest"]) {
            expect(caddyfile).toContain(`handle ${path}`);
        }
        expect(caddyfile).toContain('Cache-Control "no-cache"');
        expect(caddyfile).toContain("try_files {path} /index.html");
    });

    it("does not apply immutable caching to app shell files", () => {
        const immutablePolicy = 'Cache-Control "public, max-age=31536000, immutable"';

        for (const path of ["/sw.js", "/registerSW.js", "/manifest.webmanifest"]) {
            const handleStart = caddyfile.indexOf(`handle ${path}`);
            const nextHandle = caddyfile.indexOf("\n  handle ", handleStart + 1);
            const block = caddyfile.slice(
                handleStart,
                nextHandle === -1 ? undefined : nextHandle,
            );

            expect(block).not.toContain(immutablePolicy);
        }

        const fallbackStart = caddyfile.indexOf("\n  handle {\n");
        const fallbackBlock = caddyfile.slice(fallbackStart);

        expect(fallbackBlock).toContain('Cache-Control "no-cache"');
        expect(fallbackBlock).not.toContain(immutablePolicy);
    });
});
