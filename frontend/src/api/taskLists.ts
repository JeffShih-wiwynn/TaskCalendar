import { AuthError, getAuthHeaders } from './auth';
import { API_ROUTES, requestJson } from './base';

export type TaskList = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

export async function listTaskLists(): Promise<TaskList[]> {
  return request<TaskList[]>(API_ROUTES.taskLists.root);
}

export async function createTaskList(name: string, color: string): Promise<TaskList> {
  return request<TaskList>(API_ROUTES.taskLists.root, {
    method: 'POST',
    body: JSON.stringify({ name, color }),
  });
}

export async function updateTaskList(
  taskListId: string,
  input: Partial<Pick<TaskList, 'name' | 'color'>>,
): Promise<TaskList> {
  return request<TaskList>(API_ROUTES.taskLists.item(taskListId), {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteTaskList(taskListId: string): Promise<void> {
  await request<void>(API_ROUTES.taskLists.item(taskListId), { method: 'DELETE' });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...init?.headers,
    },
  }, {
    createUnauthorizedError: (message) => new AuthError(message),
    readErrorMessage: async (response) => `Request failed with ${response.status}`,
  });
}
