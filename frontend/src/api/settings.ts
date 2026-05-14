import { AuthError, getAuthHeaders } from "./auth";

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type AppSettings = {
    id: number;
    discord_webhook_url: string | null;
    discord_message_template: string | null;
    created_at: string;
    updated_at: string;
};

export type UpdateAppSettingsInput = {
    discord_webhook_url?: string | null;
    discord_message_template?: string | null;
};

export type TestAppSettingsInput = {
    discord_webhook_url?: string | null;
    discord_message_template?: string | null;
};

export type TestAppSettingsResponse = {
    message: string;
};

export async function getSettings(): Promise<AppSettings> {
    return request<AppSettings>("/api/settings");
}

export async function updateSettings(
    input: UpdateAppSettingsInput,
): Promise<AppSettings> {
    return request<AppSettings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(input),
    });
}

export async function testSettings(
    input: TestAppSettingsInput,
): Promise<TestAppSettingsResponse> {
    return request<TestAppSettingsResponse>("/api/settings/test-discord", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
            ...init?.headers,
        },
    });

    if (response.status === 401) {
        throw new AuthError(await readErrorMessage(response));
    }

    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }

    return response.json() as Promise<T>;
}

async function readErrorMessage(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { detail?: unknown };
        if (typeof body.detail === "string") {
            return body.detail;
        }
    } catch {
        // Fall through to a generic HTTP message.
    }

    return `Request failed with ${response.status}`;
}
