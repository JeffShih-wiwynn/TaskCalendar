const rawBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const API_BASE_URL =
    typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";

export const API_ROUTES = {
    admin: {
        users: "/admin/users",
        user: (userId: string) => `/admin/users/${userId}`,
    },
    auth: {
        login: "/auth/login",
        register: "/auth/register",
        me: "/auth/me",
        password: "/auth/password",
    },
    backup: {
        export: "/backup/export",
        import: "/backup/import",
    },
    health: "/health",
    settings: {
        root: "/api/settings",
        testDiscord: "/api/settings/test-discord",
    },
    taskLists: {
        root: "/api/task-lists",
        item: (taskListId: string) => `/api/task-lists/${taskListId}`,
    },
    tasks: {
        root: "/api/tasks",
        item: (taskId: string) => `/api/tasks/${taskId}`,
        complete: (taskId: string) => `/api/tasks/${taskId}/complete`,
        uncomplete: (taskId: string) => `/api/tasks/${taskId}/uncomplete`,
    },
} as const;

export function resolveApiUrl(path: string): string {
    if (!API_BASE_URL) {
        return path;
    }

    return `${API_BASE_URL}${path}`;
}

type RequestJsonOptions = {
    readErrorMessage?: (response: Response) => Promise<string>;
    createUnauthorizedError?: (message: string) => Error;
    includeContentType?: boolean;
};

export async function requestJson<T>(
    path: string,
    init: RequestInit = {},
    options: RequestJsonOptions = {},
): Promise<T> {
    const {
        readErrorMessage = readDefaultErrorMessage,
        createUnauthorizedError,
        includeContentType = true,
    } = options;
    const response = await fetch(resolveApiUrl(path), {
        ...init,
        headers: {
            ...(includeContentType ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
        },
    });

    if (response.status === 401 && createUnauthorizedError) {
        throw createUnauthorizedError(await readErrorMessage(response));
    }

    if (!response.ok) {
        throw new Error(await readErrorMessage(response));
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return parseJsonResponse<T>(response);
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error(
            `Expected JSON response from backend, received ${contentType || "unknown content type"}`,
        );
    }

    return response.json() as Promise<T>;
}

export async function readDefaultErrorMessage(
    response: Response,
): Promise<string> {
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
