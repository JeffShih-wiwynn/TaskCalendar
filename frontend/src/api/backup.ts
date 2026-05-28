import { getAuthHeaders } from "./auth";
import { API_ROUTES, requestJson } from "./base";

export type BackupExportPayload = {
    schema_version: number;
    exported_at: string;
    tasks: Array<Record<string, unknown>>;
    task_lists: Array<Record<string, unknown>>;
};

export type BackupImportResult = {
    imported_task_lists: number;
    imported_tasks: number;
};

export async function exportBackup(): Promise<void> {
    const payload = await fetchBackupExport();
    downloadBackupPayload(payload);
}

export async function fetchBackupExport(): Promise<BackupExportPayload> {
    return requestJson<BackupExportPayload>(API_ROUTES.backup.export, {
        method: "GET",
        headers: {
            ...getAuthHeaders(),
        },
    }, {
        readErrorMessage: async (response) =>
            `Request failed with ${response.status}`,
    });
}

export async function importBackup(
    payload: BackupExportPayload,
): Promise<BackupImportResult> {
    return requestJson<BackupImportResult>(API_ROUTES.backup.import, {
        method: "POST",
        headers: {
            ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
    }, {
        readErrorMessage,
    });
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

async function readErrorMessage(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { detail?: unknown };
        if (typeof body.detail === "string") {
            return body.detail;
        }
        if (Array.isArray(body.detail)) {
            return "Backup file is not valid.";
        }
    } catch {
        // Fall through to a generic HTTP message.
    }

    return `Request failed with ${response.status}`;
}
