import { beforeEach, describe, expect, it, vi } from "vitest";

let baseApi: typeof import("./base");

async function loadBaseApiWithUrl(baseUrl: string) {
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_API_BASE_URL", baseUrl);
    vi.resetModules();
    baseApi = await import("./base");
    return baseApi;
}

beforeEach(async () => {
    vi.restoreAllMocks();
    await loadBaseApiWithUrl("");
});

describe("API_ROUTES", () => {
    it("keeps top-level route families explicit", () => {
        const { API_ROUTES } = baseApi;

        expect(API_ROUTES.auth.login).toBe("/auth/login");
        expect(API_ROUTES.admin.users).toBe("/admin/users");
        expect(API_ROUTES.backup.export).toBe("/backup/export");
        expect(API_ROUTES.googleCalendar.status).toBe("/api/google-calendar/status");
        expect(API_ROUTES.googleCalendar.syncNow).toBe("/api/google-calendar/sync-now");
        expect(API_ROUTES.settings.root).toBe("/api/settings");
        expect(API_ROUTES.taskLists.root).toBe("/api/task-lists");
        expect(API_ROUTES.tasks.root).toBe("/api/tasks");
        expect(API_ROUTES.health).toBe("/health");
    });
});

describe("parseJsonResponse", () => {
    it("returns parsed JSON responses", async () => {
        const response = new Response(JSON.stringify({ ok: true }), {
            headers: {
                "Content-Type": "application/json",
            },
        });

        await expect(
            baseApi.parseJsonResponse<{ ok: boolean }>(response),
        ).resolves.toEqual({
            ok: true,
        });
    });

    it("throws a clear error for non-JSON responses", async () => {
        const response = new Response("<!doctype html><div>App shell</div>", {
            headers: {
                "Content-Type": "text/html",
            },
        });

        await expect(baseApi.parseJsonResponse(response)).rejects.toThrow(
            "Expected JSON response from backend, received text/html",
        );
    });
});

describe("requestJson", () => {
    it("notifies the app when an authenticated request returns 401", async () => {
        const events: CustomEvent[] = [];
        const handleEvent = (event: Event) => {
            events.push(event as CustomEvent);
        };
        window.addEventListener("calendar-auth-session-expired", handleEvent);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(JSON.stringify({ detail: "Expired" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                }),
            ),
        );

        await expect(
            baseApi.requestJson(
                "/api/tasks",
                {},
                {
                    createUnauthorizedError: (message) => new Error(message),
                    notifyUnauthorized: true,
                },
            ),
        ).rejects.toThrow("Expired");

        window.removeEventListener("calendar-auth-session-expired", handleEvent);
        expect(events).toHaveLength(1);
        expect(events[0].detail).toEqual({
            kind: "application",
            path: "/api/tasks",
        });
    });

    it("recognizes a Cloudflare Access login redirect", async () => {
        const events: CustomEvent[] = [];
        const handleEvent = (event: Event) => {
            events.push(event as CustomEvent);
        };
        window.addEventListener("calendar-auth-session-expired", handleEvent);
        const accessResponse = new Response("<html>login</html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
        });
        Object.defineProperties(accessResponse, {
            redirected: { value: true },
            url: {
                value: "https://team.cloudflareaccess.com/cdn-cgi/access/login",
            },
        });
        vi.stubGlobal("fetch", vi.fn(async () => accessResponse));

        await expect(
            baseApi.requestJson(
                "/api/tasks",
                {},
                { notifyUnauthorized: true },
            ),
        ).rejects.toThrow("Cloudflare Access session expired");

        window.removeEventListener("calendar-auth-session-expired", handleEvent);
        expect(events).toHaveLength(1);
        expect(events[0].detail).toEqual({
            kind: "cloudflare-access",
            path: "/api/tasks",
        });
    });

    it("adds JSON content type by default and parses JSON responses", async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ ok: true }), {
                headers: {
                    "Content-Type": "application/json",
                },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            baseApi.requestJson<{ ok: boolean }>("/api/test"),
        ).resolves.toEqual({
            ok: true,
        });
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/test",
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Content-Type": "application/json",
                }),
            }),
        );
    });

    it("returns undefined for empty 204 responses", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

        await expect(
            baseApi.requestJson<void>("/api/test"),
        ).resolves.toBeUndefined();
    });

    it("uses the provided unauthorized error factory", async () => {
        class TestAuthError extends Error {}
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(JSON.stringify({ detail: "Expired" }), {
                    status: 401,
                    headers: {
                        "Content-Type": "application/json",
                    },
                }),
            ),
        );

        await expect(
            baseApi.requestJson("/api/test", {}, {
                createUnauthorizedError: (message) =>
                    new TestAuthError(message),
            }),
        ).rejects.toThrow(TestAuthError);
    });

    it("can omit the request JSON content type", async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ ok: true }), {
                headers: {
                    "Content-Type": "application/json",
                },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await baseApi.requestJson("/health", {}, { includeContentType: false });

        expect(fetchMock).toHaveBeenCalledWith(
            "/health",
            expect.objectContaining({
                headers: {},
            }),
        );
    });

    it("prefixes requests when a base URL is configured", async () => {
        const { requestJson } = await loadBaseApiWithUrl(
            "https://calendar.example.com",
        );
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ ok: true }), {
                headers: {
                    "Content-Type": "application/json",
                },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await requestJson("/api/test");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://calendar.example.com/api/test",
            expect.any(Object),
        );
    });
});
