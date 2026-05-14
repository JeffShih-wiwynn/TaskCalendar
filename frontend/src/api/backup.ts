import { getAuthHeaders } from "./auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type BackupExportPayload = {
    schema_version: number;
    exported_at: string;
    tasks: Array<Record<string, unknown>>;
    task_lists: Array<Record<string, unknown>>;
};

export async function exportBackup(): Promise<void> {
    const payload = await fetchBackupExport();
    downloadBackupPayload(payload);
}

export async function fetchBackupExport(): Promise<BackupExportPayload> {
    const response = await fetch(`${API_BASE_URL}/backup/export`, {
        headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
        },
    });

    if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
    }

    return response.json() as Promise<BackupExportPayload>;
}

export function downloadBackupPayload(payload: BackupExportPayload): void {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    anchor.href = url;
    anchor.download = `calendar-backup-${date}.json`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
}
