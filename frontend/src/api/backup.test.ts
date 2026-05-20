import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportBackup, fetchBackupExport, importBackup } from "./backup";

describe("exportBackup", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("downloads the exported backup as a dated json file", async () => {
        window.localStorage.setItem("calendar-auth-token", "test-token");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        schema_version: 1,
                        exported_at: "2026-05-14T00:00:00.000Z",
                        tasks: [],
                        task_lists: [],
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
        vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:backup");
        const revokeObjectURL = vi
            .spyOn(window.URL, "revokeObjectURL")
            .mockImplementation(() => undefined);
        const click = vi
            .spyOn(HTMLAnchorElement.prototype, "click")
            .mockImplementation(() => undefined);

        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

        await exportBackup();

        expect(fetch).toHaveBeenCalledWith(
            `${import.meta.env.VITE_API_BASE_URL}/backup/export`,
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer test-token",
                }),
            }),
        );
        expect(click).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
        revokeObjectURL.mockRestore();
        click.mockRestore();
    });

    it("fetches exported backup json with the auth header", async () => {
        window.localStorage.setItem("calendar-auth-token", "test-token");
        const payload = {
            schema_version: 1,
            exported_at: "2026-05-14T00:00:00.000Z",
            tasks: [],
            task_lists: [],
        };
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                    },
                }),
            ) as typeof fetch,
        );

        await expect(fetchBackupExport()).resolves.toEqual(payload);

        expect(fetch).toHaveBeenCalledWith(
            `${import.meta.env.VITE_API_BASE_URL}/backup/export`,
            expect.objectContaining({
                method: "GET",
                headers: expect.objectContaining({
                    Authorization: "Bearer test-token",
                }),
            }),
        );
    });

    it("posts imported backup json with the auth header", async () => {
        window.localStorage.setItem("calendar-auth-token", "test-token");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                new Response(
                    JSON.stringify({
                        imported_task_lists: 1,
                        imported_tasks: 2,
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
        const payload = {
            schema_version: 1,
            exported_at: "2026-05-14T00:00:00.000Z",
            tasks: [],
            task_lists: [],
        };

        await expect(importBackup(payload)).resolves.toEqual({
            imported_task_lists: 1,
            imported_tasks: 2,
        });

        expect(fetch).toHaveBeenCalledWith(
            `${import.meta.env.VITE_API_BASE_URL}/backup/import`,
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: "Bearer test-token",
                    "Content-Type": "application/json",
                }),
                body: JSON.stringify(payload),
            }),
        );
    });
});
