const rawBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const API_BASE_URL =
    typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";

export function resolveApiUrl(path: string): string {
    if (!API_BASE_URL) {
        return path;
    }

    return `${API_BASE_URL}${path}`;
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
