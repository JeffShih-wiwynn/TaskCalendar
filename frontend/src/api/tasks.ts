import type { EventInput } from '@fullcalendar/core';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export type ScheduledTask = {
  id: string;
  user_id: string;
  list_id: string | null;
  title: string;
  notes: string | null;
  completed: boolean;
  scheduled_start: string | null;
  scheduled_end: string | null;
  due_at: string | null;
  timezone: string;
  priority: number | null;
  recurrence_rule: string | null;
  recurrence_series_id: string | null;
  notification_enabled: boolean;
  notification_offset_minutes: number;
  notification_channel: string | null;
  notification_sent_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type CreateScheduledTaskInput = {
  title: string;
  list_id?: string | null;
  notes?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  recurrence_rule?: string | null;
  notification_enabled?: boolean;
  notification_offset_minutes?: number;
  notification_channel?: string | null;
};

export type UpdateScheduledTaskInput = Partial<
  Pick<
    ScheduledTask,
    | 'title'
    | 'list_id'
    | 'notes'
    | 'scheduled_start'
    | 'scheduled_end'
    | 'due_at'
    | 'completed'
    | 'recurrence_rule'
    | 'notification_enabled'
    | 'notification_offset_minutes'
    | 'notification_channel'
  >
>;

export type ListTasksOptions = {
  rangeStart?: Date;
  rangeEnd?: Date;
  completed?: boolean;
  listId?: string;
  view?: 'overdue';
};

export async function listTasks(options: ListTasksOptions = {}): Promise<ScheduledTask[]> {
  const params = new URLSearchParams();

  if (options.rangeStart && options.rangeEnd) {
    params.set('from', options.rangeStart.toISOString());
    params.set('to', options.rangeEnd.toISOString());
  }

  if (options.completed !== undefined) {
    params.set('completed', String(options.completed));
  }

  if (options.listId) {
    params.set('list_id', options.listId);
  }

  if (options.view) {
    params.set('view', options.view);
  }

  const query = params.toString();
  const tasks = await request<ScheduledTask[]>(query ? `/api/tasks?${query}` : '/api/tasks');
  return tasks.map(normalizeTaskDates);
}

export async function createTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
  const task = await request<ScheduledTask>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return normalizeTaskDates(task);
}

export async function updateTask(
  taskId: string,
  input: UpdateScheduledTaskInput,
  options: { updateScope?: 'single' | 'series' } = {},
): Promise<ScheduledTask> {
  const params = new URLSearchParams();
  if (options.updateScope) {
    params.set('update_scope', options.updateScope);
  }

  const query = params.toString();
  const task = await request<ScheduledTask>(query ? `/api/tasks/${taskId}?${query}` : `/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return normalizeTaskDates(task);
}

export async function completeTask(taskId: string): Promise<ScheduledTask> {
  const task = await request<ScheduledTask>(`/api/tasks/${taskId}/complete`, { method: 'POST' });
  return normalizeTaskDates(task);
}

export async function uncompleteTask(taskId: string): Promise<ScheduledTask> {
  const task = await request<ScheduledTask>(`/api/tasks/${taskId}/uncomplete`, { method: 'POST' });
  return normalizeTaskDates(task);
}

export type DeleteTaskOptions = {
  deleteScope?: 'single' | 'following';
};

export async function deleteTask(
  taskId: string,
  options: DeleteTaskOptions = {},
): Promise<void> {
  const params = new URLSearchParams();
  if (options.deleteScope) {
    params.set('delete_scope', options.deleteScope);
  }

  const query = params.toString();
  await request<void>(query ? `/api/tasks/${taskId}?${query}` : `/api/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

export function mapTaskToEvent(task: ScheduledTask): EventInput {
  return {
    id: task.id,
    title: task.title,
    start: task.scheduled_start ?? undefined,
    end: task.scheduled_end ?? undefined,
    display: 'block',
    editable: true,
    classNames: task.completed ? ['task-event', 'task-event--completed'] : ['task-event'],
    extendedProps: {
      task,
    },
  };
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
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') {
      return body.detail;
    }
  } catch {
    // Fall through to a generic HTTP message.
  }

  return `Request failed with ${response.status}`;
}

function normalizeTaskDates(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    scheduled_start: normalizeApiDate(task.scheduled_start),
    scheduled_end: normalizeApiDate(task.scheduled_end),
    due_at: normalizeApiDate(task.due_at),
    created_at: normalizeApiDate(task.created_at) ?? task.created_at,
    updated_at: normalizeApiDate(task.updated_at) ?? task.updated_at,
    completed_at: normalizeApiDate(task.completed_at),
    notification_sent_at: normalizeApiDate(task.notification_sent_at),
  };
}

function normalizeApiDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  return `${value}Z`;
}
