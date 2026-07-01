import { AuthError, getAuthHeaders } from "./auth";
import { API_ROUTES, requestJson } from "./base";

export type GoogleCalendarStatus = {
    connected: boolean;
    status: "connected" | "needs_reauth" | "disabled" | "error";
    mirror_calendar_summary: string | null;
    last_successful_sync_at: string | null;
    last_error_when_safe_to_show: string | null;
    pending_sync_items: number;
};

export type GoogleCalendarConnectResponse = {
    authorization_url: string;
};

export type GoogleCalendarDisconnectResponse = {
    message: string;
};

export type GoogleCalendarSyncNowResponse = {
    started: boolean;
    pending_sync_items: number;
    message: string;
};

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
    return request<GoogleCalendarStatus>(API_ROUTES.googleCalendar.status);
}

export async function connectGoogleCalendar(): Promise<GoogleCalendarConnectResponse> {
    return request<GoogleCalendarConnectResponse>(API_ROUTES.googleCalendar.connect, {
        method: "POST",
    });
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarDisconnectResponse> {
    return request<GoogleCalendarDisconnectResponse>(
        API_ROUTES.googleCalendar.disconnect,
        {
            method: "POST",
        },
    );
}

export async function syncGoogleCalendarNow(): Promise<GoogleCalendarSyncNowResponse> {
    return request<GoogleCalendarSyncNowResponse>(API_ROUTES.googleCalendar.syncNow, {
        method: "POST",
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
