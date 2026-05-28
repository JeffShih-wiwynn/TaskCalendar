import { AuthError, getAuthHeaders } from './auth';
import { parseJsonResponse, resolveApiUrl } from './base';

export type TaskList = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

export async function listTaskLists(): Promise<TaskList[]> {
  return request<TaskList[]>('/api/task-lists');
}

export async function createTaskList(name: string, color: string): Promise<TaskList> {
  return request<TaskList>('/api/task-lists', {
    method: 'POST',
    body: JSON.stringify({ name, color }),
  });
}

export async function updateTaskList(
  taskListId: string,
  input: Partial<Pick<TaskList, 'name' | 'color'>>,
): Promise<TaskList> {
  return request<TaskList>(`/api/task-lists/${taskListId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteTaskList(taskListId: string): Promise<void> {
  await request<void>(`/api/task-lists/${taskListId}`, { method: 'DELETE' });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    throw new AuthError(`Request failed with ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return parseJsonResponse<T>(response);
}
