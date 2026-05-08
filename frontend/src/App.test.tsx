import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EventInput } from '@fullcalendar/core';
import { forwardRef, useEffect, useImperativeHandle, useState, type ForwardedRef } from 'react';

import { App } from './App';

const mocks = vi.hoisted(() => ({
  fullCalendarProps: { events: [] as EventInput[] },
  taskLists: [{ id: 'list-1', user_id: 'user-1', name: 'Work', color: '#2f80ed', created_at: '', updated_at: '' }],
  tasks: [] as Array<Record<string, unknown>>,
  createTask: vi.fn(async () => ({ id: 'task-new' })),
  deleteTask: vi.fn(async () => undefined),
  updateTask: vi.fn(async () => ({})),
  updateTaskList: vi.fn(async (_taskListId: string, input: { name?: string; color?: string }) => ({
    id: 'list-1',
    user_id: 'user-1',
    name: input.name ?? 'Work',
    color: input.color ?? '#2f80ed',
    created_at: '',
    updated_at: '',
  })),
}));

vi.mock('@fullcalendar/react', () => ({
  default: forwardRef(function MockFullCalendar(
    {
      dateClick,
      datesSet,
      eventDrop,
      events,
      initialView,
    }: {
      dateClick?: (arg: { date: Date; allDay: boolean }) => void;
      datesSet?: (arg: { view: { type: string; title: string }; start: Date }) => void;
      eventDrop?: (arg: {
        event: { id: string; start: Date; end: Date | null; allDay: boolean };
        revert: () => void;
      }) => void;
      events?: EventInput[];
      initialView?: string;
    },
    ref: ForwardedRef<{ getApi: () => {
      prev: () => void;
      next: () => void;
      today: () => void;
      changeView: (view: string) => void;
      gotoDate: (date: Date) => void;
      getDate: () => Date;
    } }>,
  ) {
    const [view, setView] = useState(initialView ?? 'timeGridWeek');
    const [currentDate, setCurrentDate] = useState(new Date('2026-05-08T00:00:00Z'));

    useImperativeHandle(ref, () => ({
      getApi: () => ({
        prev: () => setCurrentDate((current) => new Date(current.getTime() - 24 * 60 * 60 * 1000)),
        next: () => setCurrentDate((current) => new Date(current.getTime() + 24 * 60 * 60 * 1000)),
        today: () => setCurrentDate(new Date('2026-05-08T00:00:00Z')),
        changeView: (nextView: string) => setView(nextView),
        gotoDate: (date: Date) => setCurrentDate(new Date(date)),
        getDate: () => currentDate,
      }),
    }), [currentDate]);

    useEffect(() => {
      const title = view === 'dayGridMonth'
        ? 'May 2026'
        : view === 'timeGridDay'
          ? 'May 8, 2026'
          : 'May 4 – 10, 2026';
      datesSet?.({
        view: { type: view, title },
        start: currentDate,
      });
    }, [currentDate, datesSet, view]);

    mocks.fullCalendarProps.events = events ?? [];
    return (
      <>
        <button
          type="button"
          onClick={() => dateClick?.({ date: new Date('2026-05-08T09:00:00Z'), allDay: false })}
        >
          Open create task
        </button>
        <button
          type="button"
          onClick={() => dateClick?.({ date: new Date('2026-05-07T16:00:00Z'), allDay: true })}
        >
          Open all-day create task
        </button>
        <button
          type="button"
          onClick={() =>
            eventDrop?.({
              event: {
                id: 'task-1',
                start: new Date('2026-05-07T16:00:00Z'),
                end: null,
                allDay: true,
              },
              revert: vi.fn(),
            })
          }
        >
          Drop all-day task
        </button>
      </>
    );
  }),
}));

vi.mock('./api/tasks', () => ({
  listTasks: () => Promise.resolve(mocks.tasks),
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
  completeTask: vi.fn(),
  uncompleteTask: vi.fn(),
  mapTaskToEvent: vi.fn(),
  deleteTask: mocks.deleteTask,
}));

vi.mock('./api/taskLists', () => ({
  listTaskLists: () => Promise.resolve(mocks.taskLists),
  createTaskList: vi.fn(),
  updateTaskList: mocks.updateTaskList,
  deleteTaskList: vi.fn(),
}));

describe('App', () => {
  beforeEach(() => {
    mocks.tasks = [];
    mocks.createTask.mockClear();
    mocks.deleteTask.mockClear();
    mocks.fullCalendarProps.events = [];
    mocks.updateTask.mockClear();
  });

  it('renders task views and keeps the floating panel hidden by default', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Task view' })).toHaveTextContent('Today');
    expect(screen.getByRole('button', { name: 'Task category' })).toHaveTextContent(
      'All categories',
    );
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.queryByText('Create task')).not.toBeInTheDocument();
  });

  it('replaces filters with the task form while creating and restores them on close', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Task view' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'today tasks' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open create task' }));

    expect(screen.getByRole('heading', { name: 'Create task' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Task view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Task category' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'today tasks' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('button', { name: 'Task view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task category' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'today tasks' })).toBeInTheDocument();
  });

  it('lets existing categories open an edit form with color and name', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Task category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Work' }));

    expect(screen.getByLabelText('Edit category name')).toHaveValue('Work');
    expect(screen.getByLabelText('Edit category color')).toHaveValue('#2f80ed');
  });

  it('closes the create panel after saving a task', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open create task' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Create task' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Task view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task category' })).toBeInTheDocument();
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New task' }),
    );
  });

  it('closes the edit panel after saving a task', async () => {
    mocks.tasks = [
      {
        id: 'task-edit',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'Edit me',
        notes: null,
        completed: false,
        scheduled_start: '2026-05-08T10:00:00Z',
        scheduled_end: '2026-05-08T11:00:00Z',
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: '2026-05-07T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z',
        completed_at: null,
      },
    ];

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Edit me/i }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Edit task' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Task view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task category' })).toBeInTheDocument();
    expect(mocks.updateTask).toHaveBeenCalledWith(
      'task-edit',
      expect.objectContaining({ title: 'Edited task' }),
    );
  });

  it('closes the edit panel after deleting a task', async () => {
    const now = new Date();
    const todayAtTen = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      10,
      0,
      0,
      0,
    );

    mocks.tasks = [
      {
        id: 'task-delete',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'Delete me',
        notes: null,
        completed: false,
        scheduled_start: todayAtTen.toISOString(),
        scheduled_end: new Date(todayAtTen.getTime() + 60 * 60 * 1000).toISOString(),
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        completed_at: null,
      },
    ];

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Delete me/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Edit task' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Task view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task category' })).toBeInTheDocument();
    expect(mocks.deleteTask).toHaveBeenCalledWith('task-delete');
  });

  it('filters tasks without a category from the category dropdown', async () => {
    mocks.tasks = [
      {
        id: 'task-unclassified',
        user_id: 'user-1',
        list_id: null,
        title: 'Unclassified task',
        notes: null,
        completed: false,
        scheduled_start: null,
        scheduled_end: null,
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: '2026-05-07T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z',
        completed_at: null,
      },
      {
        id: 'task-classified',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'Classified task',
        notes: null,
        completed: false,
        scheduled_start: null,
        scheduled_end: null,
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: '2026-05-07T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z',
        completed_at: null,
      },
    ];

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Task view' }));
    fireEvent.click(screen.getByRole('button', { name: 'All tasks' }));

    fireEvent.click(screen.getByRole('button', { name: 'Task category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unclassified' }));

    expect(screen.getByRole('button', { name: 'Task category' })).toHaveTextContent(
      'Unclassified',
    );
    expect(screen.getByText('Unclassified task')).toBeInTheDocument();
    expect(screen.queryByText('Classified task')).not.toBeInTheDocument();
  });

  it('marks midnight day-span tasks as all-day calendar events', async () => {
    mocks.tasks = [
      {
        id: 'task-1',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'All day task',
        notes: null,
        completed: false,
        scheduled_start: '2026-05-07T16:00:00Z',
        scheduled_end: '2026-05-08T16:00:00Z',
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: '2026-05-07T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z',
        completed_at: null,
      },
    ];

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Task view' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.fullCalendarProps.events).toHaveLength(1));
    expect(mocks.fullCalendarProps.events[0]).toMatchObject({
      title: 'All day task',
      allDay: true,
      start: '2026-05-08',
      end: '2026-05-09',
    });
  });

  it('saves an all-day drop with a one-day end when FullCalendar omits the end', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Task view' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Drop all-day task' }));

    await waitFor(() =>
      expect(mocks.updateTask).toHaveBeenCalledWith('task-1', {
        scheduled_start: '2026-05-07T16:00:00.000Z',
        scheduled_end: '2026-05-08T16:00:00.000Z',
      }),
    );
  });

  it('opens the create form with a full-day range when clicking the all-day lane', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Task view' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open all-day create task' }));

    expect(screen.getByRole('heading', { name: 'Create task' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-05-08T00:00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-05-09T00:00')).toBeInTheDocument();
  });

  it('filters upcoming tasks by a custom day window including today', async () => {
    const now = new Date();
    const todayAtTen = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      10,
      0,
      0,
      0,
    );
    const sevenDaysOutAtTen = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 6,
      10,
      0,
      0,
      0,
    );
    const eightDaysOutAtTen = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 7,
      10,
      0,
      0,
      0,
    );
    mocks.tasks = [
      {
        id: 'task-today',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'Today task',
        notes: null,
        completed: false,
        scheduled_start: todayAtTen.toISOString(),
        scheduled_end: new Date(todayAtTen.getTime() + 60 * 60 * 1000).toISOString(),
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        completed_at: null,
      },
      {
        id: 'task-later',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'Later task',
        notes: null,
        completed: false,
        scheduled_start: sevenDaysOutAtTen.toISOString(),
        scheduled_end: new Date(sevenDaysOutAtTen.getTime() + 60 * 60 * 1000).toISOString(),
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        completed_at: null,
      },
      {
        id: 'task-outside',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'Outside task',
        notes: null,
        completed: false,
        scheduled_start: eightDaysOutAtTen.toISOString(),
        scheduled_end: new Date(eightDaysOutAtTen.getTime() + 60 * 60 * 1000).toISOString(),
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        completed_at: null,
      },
    ];

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Task view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));

    expect(screen.getByDisplayValue(7)).toBeInTheDocument();
    expect(screen.getByText('Today task')).toBeInTheDocument();
    expect(screen.getByText('Later task')).toBeInTheDocument();
    expect(screen.queryByText('Outside task')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } });

    expect(screen.getByText('Today task')).toBeInTheDocument();
    expect(screen.queryByText('Later task')).not.toBeInTheDocument();
  });

  it('toggles completed tasks on the calendar from the completed view', async () => {
    mocks.tasks = [
      {
        id: 'task-completed',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'Completed calendar task',
        notes: null,
        completed: true,
        scheduled_start: '2026-05-08T10:00:00Z',
        scheduled_end: '2026-05-08T11:00:00Z',
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: '2026-05-07T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z',
        completed_at: '2026-05-08T11:00:00Z',
      },
    ];

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Task view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));

    expect(screen.getByText('Show on calendar')).toBeInTheDocument();
    await waitFor(() => expect(mocks.fullCalendarProps.events).toHaveLength(1));

    fireEvent.click(screen.getByLabelText('Show on calendar'));

    await waitFor(() => expect(mocks.fullCalendarProps.events).toHaveLength(0));

    fireEvent.click(screen.getByLabelText('Show on calendar'));

    await waitFor(() => expect(mocks.fullCalendarProps.events).toHaveLength(1));
  });

  it('deletes a task from the task list context menu on right click', async () => {
    mocks.tasks = [
      {
        id: 'task-delete',
        user_id: 'user-1',
        list_id: 'list-1',
        title: 'Delete me',
        notes: null,
        completed: false,
        scheduled_start: '2026-05-08T10:00:00Z',
        scheduled_end: '2026-05-08T11:00:00Z',
        due_at: null,
        timezone: 'Asia/Taipei',
        priority: null,
        created_at: '2026-05-07T00:00:00Z',
        updated_at: '2026-05-07T00:00:00Z',
        completed_at: null,
      },
    ];

    render(<App />);

    const taskRow = await screen.findByRole('button', { name: /Delete me/i });
    fireEvent.contextMenu(taskRow, { clientX: 120, clientY: 180 });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mocks.deleteTask).toHaveBeenCalledWith('task-delete'));
  });

  it('opens a year input from the month view title', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Month' }));
    fireEvent.click(screen.getByRole('button', { name: '2026' }));

    expect(screen.getByLabelText('Calendar year')).toHaveValue(2026);
  });
});
