/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import {
    cleanupOutdatedCaches,
    createHandlerBoundToURL,
    precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const backendRouteDenylist = [
    /^\/api\//,
    /^\/auth\//,
    /^\/admin\//,
    /^\/backup\//,
    /^\/health$/,
];

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
    new NavigationRoute(createHandlerBoundToURL("/index.html"), {
        denylist: backendRouteDenylist,
    }),
);

self.addEventListener("fetch", () => {
    // Intentionally empty: Chromium installability checks look for a fetch handler,
    // while Workbox handles precached asset routing and navigation fallback.
});
