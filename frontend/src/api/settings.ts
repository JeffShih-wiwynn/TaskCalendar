import { AuthError, getAuthHeaders } from "./auth";
import { API_ROUTES, requestJson } from "./base";

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
    return request<AppSettings>(API_ROUTES.settings.root);
}

export async function updateSettings(
    input: UpdateAppSettingsInput,
): Promise<AppSettings> {
    return request<AppSettings>(API_ROUTES.settings.root, {
        method: "PATCH",
        body: JSON.stringify(input),
    });
}

export async function testSettings(
    input: TestAppSettingsInput,
): Promise<TestAppSettingsResponse> {
    return request<TestAppSettingsResponse>(API_ROUTES.settings.testDiscord, {
        method: "POST",
        body: JSON.stringify(input),
    });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    return requestJson<T>(
        path,
        {
            ...init,
            headers: {
                ...getAuthHeaders(),
                ...init?.headers,
            },
        },
        {
            createUnauthorizedError: (message) => new AuthError(message),
            readErrorMessage,
        },
    );
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
