import { beforeEach, describe, expect, it, vi } from "vitest";

let authApi: typeof import("./auth");

describe("auth api", () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.stubEnv("VITE_API_BASE_URL", "");
        vi.resetModules();
        window.localStorage.clear();
        authApi = await import("./auth");
    });

    it("sends a password change request with the bearer token", async () => {
        window.localStorage.setItem("calendar-auth-token", "test-token");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(JSON.stringify({ message: "Password updated" }), {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                    },
                }),
            ) as typeof fetch,
        );

        await expect(
            authApi.changePassword({
                current_password: "old-pass",
                new_password: "new-pass",
                confirm_new_password: "new-pass",
            }),
        ).resolves.toEqual({ message: "Password updated" });

        expect(fetch).toHaveBeenCalledWith(
            "/auth/password",
            expect.objectContaining({
                method: "PATCH",
                headers: expect.objectContaining({
                    Authorization: "Bearer test-token",
                    "Content-Type": "application/json",
                }),
                body: JSON.stringify({
                    current_password: "old-pass",
                    new_password: "new-pass",
                    confirm_new_password: "new-pass",
                }),
            }),
        );
    });

    it("updates the current user's time zone with the bearer token", async () => {
        window.localStorage.setItem("calendar-auth-token", "test-token");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        id: "user-id",
                        username: "alice",
                        is_admin: false,
                        timezone: "Asia/Taipei",
                        created_at: "2026-01-01T00:00:00Z",
                        updated_at: "2026-01-01T00:00:00Z",
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    },
                ),
            ) as typeof fetch,
        );

        await expect(
            authApi.updateTimezone({ timezone: "Asia/Taipei" }),
        ).resolves.toMatchObject({ timezone: "Asia/Taipei" });

        expect(fetch).toHaveBeenCalledWith(
            "/auth/me/timezone",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({ timezone: "Asia/Taipei" }),
            }),
        );
    });

    it("sends an account deletion request with the bearer token", async () => {
        window.localStorage.setItem("calendar-auth-token", "test-token");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(JSON.stringify({ message: "Account deleted" }), {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                    },
                }),
            ) as typeof fetch,
        );

        await expect(authApi.deleteAccount({ confirmation: "DELETE" })).resolves.toEqual(
            {
                message: "Account deleted",
            },
        );

        expect(fetch).toHaveBeenCalledWith(
            "/auth/me",
            expect.objectContaining({
                method: "DELETE",
                headers: expect.objectContaining({
                    Authorization: "Bearer test-token",
                    "Content-Type": "application/json",
                }),
                body: JSON.stringify({ confirmation: "DELETE" }),
            }),
        );
    });

    it("stores a bearer token after login", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        access_token: "test-token",
                        token_type: "bearer",
                    }),
                    {
                        status: 200,
                        headers: {
                            "Content-Type": "application/json",
                        },
                    },
                ),
            ) as typeof fetch,
        );

        await expect(
            authApi.login({ username: "alice", password: "secret" }),
        ).resolves.toBe("test-token");
        expect(window.localStorage.getItem("calendar-auth-token")).toBe(
            "test-token",
        );
        expect(authApi.getAuthHeaders()).toEqual({
            Authorization: "Bearer test-token",
        });
        authApi.clearStoredAuthToken();
        expect(window.localStorage.getItem("calendar-auth-token")).toBeNull();
    });
});
