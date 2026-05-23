import { getAuthHeaders } from "./auth";
import { resolveApiUrl } from "./base";

export type AdminUser = {
    id: string;
    username: string;
    email?: string | null;
    is_admin: boolean;
    created_at: string;
    updated_at: string;
};

export type ActionResponse = {
    message: string;
};

export async function listAdminUsers(): Promise<AdminUser[]> {
    return request<AdminUser[]>("/admin/users", {
        headers: getAuthHeaders(),
    });
}

export async function deleteAdminUser(userId: string): Promise<ActionResponse> {
    return request<ActionResponse>(`/admin/users/${userId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
    });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(resolveApiUrl(path), {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...init?.headers,
        },
    });

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
