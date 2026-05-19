/// <reference lib="webworker" />

import { precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("fetch", () => {
    // Intentionally empty: Chromium installability checks look for a fetch handler,
    // while Workbox handles precached asset routing and navigation fallback.
});

