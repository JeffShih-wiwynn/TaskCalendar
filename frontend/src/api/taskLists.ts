const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
