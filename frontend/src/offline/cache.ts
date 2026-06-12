import type { AppSettings } from "../api/settings";
import type { TaskList } from "../api/taskLists";
import type { ScheduledTask } from "../api/tasks";

const databaseName = "calendar-offline-cache";
const databaseVersion = 1;
const taskCacheStoreName = "task_cache";
export const taskCacheSchemaVersion = 1;

export type TaskCacheData = {
    tasks: ScheduledTask[];
    taskLists: TaskList[];
    settings: AppSettings | null;
};

export type TaskCacheMetadata = {
    user_id: string;
    cached_at: string;
    schema_version: number;
};

export type TaskCacheRecord = TaskCacheData & {
    metadata: TaskCacheMetadata;
};

export async function saveTaskCache(
    userId: string,
    data: TaskCacheData,
    metadata: Partial<Omit<TaskCacheMetadata, "user_id">> = {},
): Promise<TaskCacheRecord> {
    const record: TaskCacheRecord = {
        ...data,
        metadata: {
            user_id: userId,
            cached_at: metadata.cached_at ?? new Date().toISOString(),
            schema_version: metadata.schema_version ?? taskCacheSchemaVersion,
        },
    };

    const database = await openOfflineCacheDatabase();
    await runStoreRequest(
        database
            .transaction(taskCacheStoreName, "readwrite")
            .objectStore(taskCacheStoreName)
            .put(record),
    );
    database.close();
    return record;
}

export async function loadTaskCache(
    userId: string,
): Promise<TaskCacheRecord | null> {
    const database = await openOfflineCacheDatabase();
    const record = await runStoreRequest<TaskCacheRecord | undefined>(
        database
            .transaction(taskCacheStoreName, "readonly")
            .objectStore(taskCacheStoreName)
            .get(userId),
    );
    database.close();

    if (!record || record.metadata.user_id !== userId) {
        return null;
    }

    return record;
}

export async function clearTaskCache(userId: string): Promise<void> {
    const database = await openOfflineCacheDatabase();
    await runStoreRequest(
        database
            .transaction(taskCacheStoreName, "readwrite")
            .objectStore(taskCacheStoreName)
            .delete(userId),
    );
    database.close();
}

function openOfflineCacheDatabase(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
        return Promise.reject(new Error("IndexedDB is unavailable"));
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(taskCacheStoreName)) {
                database.createObjectStore(taskCacheStoreName, {
                    keyPath: "metadata.user_id",
                });
            }
        };
        request.onerror = () =>
            reject(request.error ?? new Error("Unable to open offline cache"));
        request.onsuccess = () => resolve(request.result);
    });
}

function runStoreRequest<T = unknown>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onerror = () =>
            reject(request.error ?? new Error("Offline cache request failed"));
        request.onsuccess = () => resolve(request.result);
    });
}
