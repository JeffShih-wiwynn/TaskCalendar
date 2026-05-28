import { getAuthHeaders } from "./auth";
import { API_ROUTES, requestJson } from "./base";

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
    return requestJson<AdminUser[]>(API_ROUTES.admin.users, {
        headers: getAuthHeaders(),
    });
}

export async function deleteAdminUser(userId: string): Promise<ActionResponse> {
    return requestJson<ActionResponse>(API_ROUTES.admin.user(userId), {
        method: "DELETE",
        headers: getAuthHeaders(),
    });
}
