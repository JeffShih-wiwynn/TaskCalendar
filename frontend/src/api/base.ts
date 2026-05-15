const rawBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const API_BASE_URL =
    typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";

export function resolveApiUrl(path: string): string {
    if (!API_BASE_URL) {
        return path;
    }

    return `${API_BASE_URL}${path}`;
}
