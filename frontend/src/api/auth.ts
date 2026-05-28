import { API_ROUTES, requestJson } from "./base";
const AUTH_TOKEN_STORAGE_KEY = "calendar-auth-token";

export type AuthCredentials = {
    username: string;
    password: string;
};

export type AuthUser = {
    id: string;
    username: string;
    is_admin: boolean;
    created_at: string;
    updated_at: string;
};

export type ChangePasswordInput = {
    current_password: string;
    new_password: string;
    confirm_new_password: string;
};

export type DeleteAccountInput = {
    confirmation: string;
};

export type ActionResponse = {
    message: string;
};

type TokenResponse = {
    access_token: string;
    token_type: string;
};

export class AuthError extends Error {
    constructor(message = "Authentication required") {
        super(message);
        this.name = "AuthError";
    }
}

export function getStoredAuthToken(): string | null {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function storeAuthToken(token: string): void {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearStoredAuthToken(): void {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

export function getAuthHeaders(): Record<string, string> {
    const token = getStoredAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isAuthError(error: unknown): boolean {
    return error instanceof AuthError;
}

export async function login(credentials: AuthCredentials): Promise<string> {
    const response = await requestAuth<TokenResponse>(
        API_ROUTES.auth.login,
        {
            method: "POST",
            body: JSON.stringify(credentials),
        },
    );
    storeAuthToken(response.access_token);
    return response.access_token;
}

export async function register(credentials: AuthCredentials): Promise<AuthUser> {
    return requestAuth<AuthUser>(API_ROUTES.auth.register, {
        method: "POST",
        body: JSON.stringify(credentials),
    });
}

export async function getCurrentUser(): Promise<AuthUser> {
    return requestAuth<AuthUser>(API_ROUTES.auth.me, {
        headers: getAuthHeaders(),
    });
}

export async function changePassword(
    input: ChangePasswordInput,
): Promise<ActionResponse> {
    return requestAuth<ActionResponse>(API_ROUTES.auth.password, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify(input),
    });
}

export async function deleteAccount(
    input: DeleteAccountInput,
): Promise<ActionResponse> {
    return requestAuth<ActionResponse>(API_ROUTES.auth.me, {
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify(input),
    });
}

async function requestAuth<T>(path: string, init?: RequestInit): Promise<T> {
    return requestJson<T>(path, init, {
        createUnauthorizedError: (message) => new AuthError(message),
        readErrorMessage,
    });
}

async function readErrorMessage(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { detail?: unknown };
        if (typeof body.detail === "string") {
            return body.detail;
        }
        if (Array.isArray(body.detail)) {
            const messages = body.detail
                .map((item) =>
                    typeof item === "object" && item !== null && "msg" in item
                        ? String((item as { msg?: unknown }).msg ?? "")
                        : "",
                )
                .filter(Boolean);
            if (messages.length > 0) {
                return messages.join(" ");
            }
        }
    } catch {
        // Fall through to a generic HTTP message.
    }

    return `Request failed with ${response.status}`;
}
