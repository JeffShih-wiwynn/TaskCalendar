import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportBackup } from "./backup";

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
});
