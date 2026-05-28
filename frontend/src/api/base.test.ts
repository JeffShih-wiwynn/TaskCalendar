import { describe, expect, it } from "vitest";

import { parseJsonResponse } from "./base";

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
