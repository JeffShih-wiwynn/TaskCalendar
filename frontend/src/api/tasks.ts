import type { EventInput } from '@fullcalendar/core';

import { AuthError, getAuthHeaders } from './auth';
import { API_ROUTES, requestJson } from './base';

export type ScheduledTask = {
  id: string;
  user_id: string;
  list_id: string | null;
  title: string;
  notes: string | null;
  completed: boolean;
  scheduled_start: string | null;
  scheduled_end: string | null;
  all_day: boolean;
  due_at: string | null;
  timezone: string;
  priority: number | null;
  unscheduled_order: number | null;
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
  completed?: boolean;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  all_day?: boolean;
  due_at?: string | null;
  timezone?: string;
  priority?: number | null;
  unscheduled_order?: number | null;
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
    | 'all_day'
    | 'due_at'
    | 'completed'
    | 'unscheduled_order'
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
  const tasks = await request<ScheduledTask[]>(
    query ? `${API_ROUTES.tasks.root}?${query}` : API_ROUTES.tasks.root,
  );
  return tasks.map(normalizeTaskDates);
}

export async function createTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
  const task = await request<ScheduledTask>(API_ROUTES.tasks.root, {
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
  const task = await request<ScheduledTask>(query ? `${API_ROUTES.tasks.item(taskId)}?${query}` : API_ROUTES.tasks.item(taskId), {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return normalizeTaskDates(task);
}

export async function completeTask(taskId: string): Promise<ScheduledTask> {
  const task = await request<ScheduledTask>(API_ROUTES.tasks.complete(taskId), { method: 'POST' });
  return normalizeTaskDates(task);
}

export async function uncompleteTask(taskId: string): Promise<ScheduledTask> {
  const task = await request<ScheduledTask>(API_ROUTES.tasks.uncomplete(taskId), { method: 'POST' });
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
  await request<void>(query ? `${API_ROUTES.tasks.item(taskId)}?${query}` : API_ROUTES.tasks.item(taskId), {
    method: 'DELETE',
  });
}

export function mapTaskToEvent(task: ScheduledTask): EventInput {
  const allDayStart = task.all_day && task.scheduled_start ? task.scheduled_start.slice(0, 10) : undefined;
  return {
    id: task.id,
    title: task.title,
    start: allDayStart ?? task.scheduled_start ?? undefined,
    end: task.all_day ? undefined : (task.scheduled_end ?? undefined),
    allDay: task.all_day,
    display: 'block',
    editable: true,
    classNames: task.completed ? ['task-event', 'task-event--completed'] : ['task-event'],
    extendedProps: {
      task,
    },
  };
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
    readErrorMessage,
  });
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
