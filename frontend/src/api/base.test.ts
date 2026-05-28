import { describe, expect, it, vi } from "vitest";

import { API_ROUTES, parseJsonResponse, requestJson } from "./base";

describe("API_ROUTES", () => {
    it("keeps top-level route families explicit", () => {
        expect(API_ROUTES.auth.login).toBe("/auth/login");
        expect(API_ROUTES.admin.users).toBe("/admin/users");
        expect(API_ROUTES.backup.export).toBe("/backup/export");
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

        await expect(parseJsonResponse<{ ok: boolean }>(response)).resolves.toEqual({
            ok: true,
        });
    });

    it("throws a clear error for non-JSON responses", async () => {
        const response = new Response("<!doctype html><div>App shell</div>", {
            headers: {
                "Content-Type": "text/html",
            },
        });

        await expect(parseJsonResponse(response)).rejects.toThrow(
            "Expected JSON response from backend, received text/html",
        );
    });
});

describe("requestJson", () => {
    it("adds JSON content type by default and parses JSON responses", async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ ok: true }), {
                headers: {
                    "Content-Type": "application/json",
                },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(requestJson<{ ok: boolean }>("/api/test")).resolves.toEqual({
            ok: true,
        });
        expect(fetchMock).toHaveBeenCalledWith(
            `${import.meta.env.VITE_API_BASE_URL}/api/test`,
            expect.objectContaining({
                headers: expect.objectContaining({
                    "Content-Type": "application/json",
                }),
            }),
        );
    });

    it("returns undefined for empty 204 responses", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

        await expect(requestJson<void>("/api/test")).resolves.toBeUndefined();
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
            requestJson("/api/test", {}, {
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

        await requestJson("/health", {}, { includeContentType: false });

        expect(fetchMock).toHaveBeenCalledWith(
            `${import.meta.env.VITE_API_BASE_URL}/health`,
            expect.objectContaining({
                headers: {},
            }),
        );
    });
});
