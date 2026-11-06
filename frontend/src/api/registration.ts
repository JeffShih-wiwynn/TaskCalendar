import { requestJson } from "./base";
import { getAuthHeaders } from "./auth";

export type RegistrationStatus = {
    setup_required: boolean;
    registration_open: boolean;
    open_until: string | null;
};

export function getRegistrationStatus(): Promise<RegistrationStatus> {
    return requestJson("/auth/registration-status", { cache: "no-store" });
}

export function setRegistrationWindow(duration_minutes: 0 | 5): Promise<RegistrationStatus> {
    return requestJson("/admin/registration", {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ duration_minutes }),
    });
}
