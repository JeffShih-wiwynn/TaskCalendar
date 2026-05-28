import { describe, expect, it } from "vitest";

import { API_ROUTES, parseJsonResponse } from "./base";

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
