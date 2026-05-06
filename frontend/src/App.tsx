import type {
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
  EventMountArg,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  createTaskList,
  deleteTaskList,
  listTaskLists,
  updateTaskList,
  type TaskList,
} from './api/taskLists';
import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  uncompleteTask,
  updateTask,
  type ScheduledTask,
} from './api/tasks';

type TaskState =
  | { status: 'loading' }
  | { status: 'ready'; tasks: ScheduledTask[] }
  | { status: 'error'; message: string };

type TaskView = 'today' | 'upcoming' | 'completed' | 'all';
type ThemeMode = 'light' | 'dark';

type TaskFormState = {
  title: string;
  list_id: string;
  scheduled_start: string;
  scheduled_end: string;
  notes: string;
};

type EditFormState = TaskFormState & {
  due_at: string;
  completed: boolean;
};

type ContextMenuState = {
  kind: 'task' | 'category';
  id: string;
  x: number;
  y: number;
};

const initialFormState: TaskFormState = {
  title: '',
  list_id: '',
  scheduled_start: '',
  scheduled_end: '',
  notes: '',
};

const defaultCategoryColor = '#176b58';

const taskViews: Array<{ id: TaskView; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All tasks' },
];

export function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [taskState, setTaskState] = useState<TaskState>({ status: 'loading' });
  const [activeView, setActiveView] = useState<TaskView>('today');
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState(defaultCategoryColor);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [formState, setFormState] = useState<TaskFormState>(initialFormState);
  const [editState, setEditState] = useState<EditFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreateFormActive, setIsCreateFormActive] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const createFormRef = useRef<HTMLFormElement | null>(null);

  const tasks = useMemo(() => (taskState.status === 'ready' ? taskState.tasks : []), [taskState]);
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : undefined;

  const visibleTasks = useMemo(
    () => filterTasksForView(tasks, activeView, activeListId),
    [activeListId, activeView, tasks],
  );

  const categoryColorById = useMemo(() => {
    return new Map(taskLists.map((taskList) => [taskList.id, taskList.color]));
  }, [taskLists]);

  const calendarTasks = useMemo(() => {
    return activeListId ? tasks.filter((task) => task.list_id === activeListId) : tasks;
  }, [activeListId, tasks]);

  const events = useMemo<EventInput[]>(() => {
    return calendarTasks
      .filter((task) => task.scheduled_start)
      .map((task) => mapTaskToCalendarEvent(task, categoryColorById));
  }, [calendarTasks, categoryColorById]);

  useEffect(() => {
    if (!selectedTask) {
      setEditState(null);
      return;
    }

    setEditState({
      title: selectedTask.title,
      notes: selectedTask.notes ?? '',
      scheduled_start: toDateTimeLocalValue(selectedTask.scheduled_start),
      scheduled_end: toDateTimeLocalValue(selectedTask.scheduled_end),
      due_at: toDateTimeLocalValue(selectedTask.due_at),
      completed: selectedTask.completed,
      list_id: selectedTask.list_id ?? '',
    });
  }, [selectedTask]);

  const refreshTasks = useCallback(async () => {
    setTaskState({ status: 'loading' });

    try {
      const loadedTasks = await listTasks();
      setTaskState({ status: 'ready', tasks: loadedTasks });
    } catch (error) {
      setTaskState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to load tasks',
      });
    }
  }, []);

  const refreshTaskLists = useCallback(async () => {
    try {
      const loadedTaskLists = await listTaskLists();
      setTaskLists(loadedTaskLists);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to load categories');
    }
  }, []);

  useEffect(() => {
    void refreshTaskLists();
  }, [refreshTaskLists]);

  useEffect(() => {
    saveThemeMode(themeMode);
  }, [themeMode]);

  const handleDatesSet = useCallback(
    () => {
      void refreshTasks();
    },
    [refreshTasks],
  );

  const reloadTasks = useCallback(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const handleEventDrop = useCallback(
    async (dropInfo: EventDropArg) => {
      try {
        await updateTask(dropInfo.event.id, {
          scheduled_start: dropInfo.event.start?.toISOString() ?? null,
          scheduled_end: dropInfo.event.end?.toISOString() ?? null,
        });
        reloadTasks();
      } catch (error) {
        dropInfo.revert();
        setFormError(error instanceof Error ? error.message : 'Unable to move task');
      }
    },
    [reloadTasks],
  );

  const handleEventResize = useCallback(
    async (resizeInfo: EventResizeDoneArg) => {
      try {
        await updateTask(resizeInfo.event.id, {
          scheduled_start: resizeInfo.event.start?.toISOString() ?? null,
          scheduled_end: resizeInfo.event.end?.toISOString() ?? null,
        });
        reloadTasks();
      } catch (error) {
        resizeInfo.revert();
        setFormError(error instanceof Error ? error.message : 'Unable to resize task');
      }
    },
    [reloadTasks],
  );

  const handleDateSelect = useCallback((selectInfo: { start: Date; end: Date }) => {
    setFormError(null);
    setIsCreateFormActive(true);
    setSelectedTaskId(null);
    setFormState((current) => ({
      ...current,
      list_id: activeListId ?? '',
      scheduled_start: dateToDateTimeLocalValue(selectInfo.start),
      scheduled_end: dateToDateTimeLocalValue(selectInfo.end),
    }));
    window.setTimeout(() => {
      createFormRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      titleInputRef.current?.focus();
    }, 0);
  }, [activeListId]);

  const handleCheckboxChange = useCallback(
    async (task: ScheduledTask) => {
      try {
        if (task.completed) {
          await uncompleteTask(task.id);
        } else {
          await completeTask(task.id);
        }
        reloadTasks();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Unable to update task');
      }
    },
    [reloadTasks],
  );

  const renderEventContent = useCallback(
    (eventInfo: EventContentArg) => {
      const task = eventInfo.event.extendedProps.task as ScheduledTask;

      return (
        <label className="calendar-task">
          <input
            type="checkbox"
            checked={task.completed}
            onChange={() => void handleCheckboxChange(task)}
            onClick={(event) => event.stopPropagation()}
          />
          <span>{task.title}</span>
        </label>
      );
    },
    [handleCheckboxChange],
  );

  const handleEventClick = useCallback((clickInfo: EventClickArg) => {
    setIsCreateFormActive(false);
    setSelectedTaskId(clickInfo.event.id);
    setContextMenu(null);
  }, []);

  const handleEventDidMount = useCallback((mountInfo: EventMountArg) => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setSelectedTaskId(mountInfo.event.id);
      setContextMenu({
        kind: 'task',
        id: mountInfo.event.id,
        x: event.clientX,
        y: event.clientY,
      });
    };

    mountInfo.el.addEventListener('contextmenu', handleContextMenu);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!formState.title.trim()) {
      setFormError('Title is required');
      return;
    }

    if (!isValidTimeRange(formState.scheduled_start, formState.scheduled_end)) {
      setFormError('End time must be after start time');
      return;
    }

    setIsSaving(true);

    try {
      const task = await createTask({
        title: formState.title.trim(),
        list_id: formState.list_id || null,
        notes: formState.notes.trim() || null,
        scheduled_start: toIsoOrNull(formState.scheduled_start),
        scheduled_end: toIsoOrNull(formState.scheduled_end),
      });
      setFormState(initialFormState);
      setIsCreateFormActive(false);
      setSelectedTaskId(task.id);
      reloadTasks();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create task');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!selectedTask || !editState) {
      return;
    }

    if (!editState.title.trim()) {
      setFormError('Title is required');
      return;
    }

    if (!isValidTimeRange(editState.scheduled_start, editState.scheduled_end)) {
      setFormError('End time must be after start time');
      return;
    }

    setIsEditSaving(true);

    try {
      await updateTask(selectedTask.id, {
        title: editState.title.trim(),
        list_id: editState.list_id || null,
        notes: editState.notes.trim() || null,
        scheduled_start: toIsoOrNull(editState.scheduled_start),
        scheduled_end: toIsoOrNull(editState.scheduled_end),
        due_at: toIsoOrNull(editState.due_at),
        completed: editState.completed,
      });
      reloadTasks();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save task');
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleCreateTaskList = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const name = newListName.trim();
    if (!name) {
      return;
    }

    try {
      const taskList = await createTaskList(name, newListColor);
      setNewListName('');
      setNewListColor(defaultCategoryColor);
      setTaskLists((current) => [...current, taskList].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveListId(taskList.id);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create category');
    }
  };

  const handleCategoryColorChange = async (taskListId: string, color: string) => {
    setFormError(null);
    setTaskLists((current) =>
      current.map((taskList) => (taskList.id === taskListId ? { ...taskList, color } : taskList)),
    );

    try {
      const updated = await updateTaskList(taskListId, { color });
      setTaskLists((current) =>
        current.map((taskList) => (taskList.id === taskListId ? updated : taskList)),
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to update category color');
      void refreshTaskLists();
    }
  };

  const handleDeleteSelectedTask = async () => {
    if (!selectedTask) {
      return;
    }

    setFormError(null);
    setIsDeleting(true);

    try {
      await deleteTask(selectedTask.id);
      setSelectedTaskId(null);
      reloadTasks();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to delete task');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteFromMenu = async () => {
    if (!contextMenu) {
      return;
    }

    setFormError(null);
    setIsDeleting(true);

    try {
      if (contextMenu.kind === 'task') {
        await deleteTask(contextMenu.id);
        setSelectedTaskId((currentId) => (currentId === contextMenu.id ? null : currentId));
      } else {
        await deleteTaskList(contextMenu.id);
        setActiveListId((currentId) => (currentId === contextMenu.id ? null : currentId));
        setSelectedTaskId((currentId) => {
          const selected = tasks.find((task) => task.id === currentId);
          return selected?.list_id === contextMenu.id ? null : currentId;
        });
        void refreshTaskLists();
      }
      setContextMenu(null);
      reloadTasks();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to delete');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <main className={`app-shell ${themeMode}`} onClick={() => setContextMenu(null)}>
      <aside className="task-sidebar">
        <p className="eyebrow">Scheduled Task Calendar</p>
        <div className="sidebar-header">
          <h1>Calendar MVP</h1>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
          >
            {themeMode === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>

        <nav className="task-nav" aria-label="Task views">
          {taskViews.map((view) => (
            <button
              key={view.id}
              type="button"
              className={activeView === view.id ? 'active' : undefined}
              onClick={() => setActiveView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </nav>

        <section className="category-section" aria-label="Categories">
          <h2>Categories</h2>
          <button
            type="button"
            className={`category-button ${activeListId === null ? 'active' : ''}`}
            onClick={() => setActiveListId(null)}
          >
            All categories
          </button>
          {taskLists.map((taskList) => (
            <div key={taskList.id} className="category-row">
              <input
                type="color"
                value={taskList.color}
                aria-label={`${taskList.name} color`}
                onChange={(event) => void handleCategoryColorChange(taskList.id, event.target.value)}
              />
              <button
                type="button"
                className={`category-button ${activeListId === taskList.id ? 'active' : ''}`}
                onClick={() => setActiveListId(taskList.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({
                    kind: 'category',
                    id: taskList.id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                {taskList.name}
              </button>
            </div>
          ))}
          <form className="category-form" onSubmit={(event) => void handleCreateTaskList(event)}>
            <input
              type="color"
              value={newListColor}
              onChange={(event) => setNewListColor(event.target.value)}
              aria-label="New category color"
            />
            <input
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="New category"
              aria-label="New category"
            />
            <button type="submit">Add</button>
          </form>
        </section>

        <section className="task-list" aria-label={`${activeView} tasks`}>
          {taskState.status === 'loading' && <p className="muted">Loading tasks...</p>}
          {taskState.status === 'error' && <p className="form-error">{taskState.message}</p>}
          {taskState.status === 'ready' && visibleTasks.length === 0 && (
            <p className="muted">No tasks in this view.</p>
          )}
          {visibleTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`task-row ${selectedTaskId === task.id ? 'selected' : ''}`}
              style={{
                borderLeftColor: taskCategoryColor(task, categoryColorById),
                accentColor: taskCategoryColor(task, categoryColorById),
              }}
              onClick={() => {
                setIsCreateFormActive(false);
                setSelectedTaskId(task.id);
              }}
            >
              <input
                type="checkbox"
                checked={task.completed}
                onChange={() => void handleCheckboxChange(task)}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Toggle ${task.title}`}
              />
              <span className="task-row-main">
                <span className={task.completed ? 'task-title completed' : 'task-title'}>
                  {task.title}
                </span>
                <span className="task-meta">
                  {formatScheduledRange(task)}
                  {task.due_at && `Due ${formatDateTime(task.due_at)}`}
                </span>
              </span>
            </button>
          ))}
        </section>

      </aside>

      <section className="calendar-panel" aria-label="Scheduled tasks calendar">
        {taskState.status === 'loading' && <div className="status-banner">Loading tasks...</div>}
        {formError && <div className="status-banner error">{formError}</div>}

        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          events={events}
          eventContent={renderEventContent}
          eventClick={handleEventClick}
          eventDidMount={handleEventDidMount}
          datesSet={handleDatesSet}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          select={handleDateSelect}
          editable
          selectable
          eventResizableFromStart
          nowIndicator
          slotMinTime="05:00:00"
          slotMaxTime="23:00:00"
          height="100%"
        />
      </section>

      <aside className="edit-panel" aria-label="Task details">
        {isCreateFormActive ? (
          <form
            ref={createFormRef}
            className="task-form active-form"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <h2>Create task</h2>
            <LabeledInput
              label="Title"
              value={formState.title}
              onChange={(value) => setFormState({ ...formState, title: value })}
              inputRef={titleInputRef}
              required
            />
            <LabeledInput
              label="Start"
              type="datetime-local"
              value={formState.scheduled_start}
              onChange={(value) => setFormState({ ...formState, scheduled_start: value })}
            />
            <LabeledInput
              label="End"
              type="datetime-local"
              value={formState.scheduled_end}
              onChange={(value) => setFormState({ ...formState, scheduled_end: value })}
            />
            <LabeledSelect
              label="Category"
              value={formState.list_id}
              onChange={(value) => setFormState({ ...formState, list_id: value })}
              options={taskLists}
            />
            <label>
              <span>Notes</span>
              <textarea
                value={formState.notes}
                onChange={(event) => setFormState({ ...formState, notes: event.target.value })}
                rows={3}
              />
            </label>
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Creating...' : 'Create task'}
            </button>
          </form>
        ) : selectedTask && editState ? (
          <form className="task-form" onSubmit={(event) => void handleEditSubmit(event)}>
            <h2>Edit task</h2>
            <LabeledInput
              label="Title"
              value={editState.title}
              onChange={(value) => setEditState({ ...editState, title: value })}
              required
            />
            <label>
              <span>Completed</span>
              <input
                type="checkbox"
                checked={editState.completed}
                onChange={(event) =>
                  setEditState({ ...editState, completed: event.target.checked })
                }
              />
            </label>
            <LabeledInput
              label="Start"
              type="datetime-local"
              value={editState.scheduled_start}
              onChange={(value) => setEditState({ ...editState, scheduled_start: value })}
            />
            <LabeledInput
              label="End"
              type="datetime-local"
              value={editState.scheduled_end}
              onChange={(value) => setEditState({ ...editState, scheduled_end: value })}
            />
            <LabeledInput
              label="Due"
              type="datetime-local"
              value={editState.due_at}
              onChange={(value) => setEditState({ ...editState, due_at: value })}
            />
            <LabeledSelect
              label="Category"
              value={editState.list_id}
              onChange={(value) => setEditState({ ...editState, list_id: value })}
              options={taskLists}
            />
            <label>
              <span>Notes</span>
              <textarea
                value={editState.notes}
                onChange={(event) => setEditState({ ...editState, notes: event.target.value })}
                rows={5}
              />
            </label>
            <button type="submit" disabled={isEditSaving}>
              {isEditSaving ? 'Saving...' : 'Save changes'}
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={isDeleting}
              onClick={() => void handleDeleteSelectedTask()}
            >
              {isDeleting ? 'Deleting...' : 'Delete task'}
            </button>
          </form>
        ) : (
          <p className="muted">Select a task to edit it.</p>
        )}
      </aside>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" disabled={isDeleting} onClick={() => void handleDeleteFromMenu()}>
            {isDeleting ? 'Deleting...' : contextMenu.kind === 'category' ? 'Delete category' : 'Delete'}
          </button>
        </div>
      )}
    </main>
  );
}

type LabeledInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  type?: string;
  required?: boolean;
};

function LabeledInput({
  label,
  value,
  onChange,
  inputRef,
  type = 'text',
  required = false,
}: LabeledInputProps) {
  return (
    <label>
      <span>{label}</span>
      <input
        ref={inputRef}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}

type LabeledSelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: TaskList[];
};

function LabeledSelect({ label, value, onChange, options }: LabeledSelectProps) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">No category</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function filterTasksForView(
  tasks: ScheduledTask[],
  activeView: TaskView,
  activeListId: string | null,
): ScheduledTask[] {
  const now = new Date();

  return tasks.filter((task) => {
    if (activeListId && task.list_id !== activeListId) {
      return false;
    }

    if (activeView === 'all') {
      return true;
    }

    if (activeView === 'completed') {
      return task.completed;
    }

    if (task.completed) {
      return false;
    }

    const taskDate = task.scheduled_start ?? task.due_at;

    if (activeView === 'today') {
      return taskDate ? isSameLocalDay(parseTaskDate(taskDate), now) : false;
    }

    if (activeView === 'upcoming') {
      return taskDate ? isAfterToday(parseTaskDate(taskDate), now) : false;
    }

    return false;
  });
}

function toIsoOrNull(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function toDateTimeLocalValue(value: string | null): string {
  if (!value) {
    return '';
  }

  return dateToDateTimeLocalValue(parseTaskDate(value));
}

function dateToDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function isValidTimeRange(start: string, end: string): boolean {
  return !start || !end || new Date(end) > new Date(start);
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isAfterToday(value: Date, now: Date): boolean {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return value >= tomorrow;
}

function formatScheduledRange(task: ScheduledTask): string {
  if (!task.scheduled_start) {
    return '';
  }

  const start = formatDateTime(task.scheduled_start);
  const end = task.scheduled_end ? formatDateTime(task.scheduled_end) : '';
  return end ? `${start} - ${end}` : start;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parseTaskDate(value));
}

function parseTaskDate(value: string): Date {
  return new Date(value);
}

function taskCategoryColor(task: ScheduledTask, categoryColorById: Map<string, string>): string {
  return task.list_id
    ? (categoryColorById.get(task.list_id) ?? defaultCategoryColor)
    : defaultCategoryColor;
}

function mapTaskToCalendarEvent(
  task: ScheduledTask,
  categoryColorById: Map<string, string>,
): EventInput {
  const color = taskCategoryColor(task, categoryColorById);

  return {
    id: task.id,
    title: task.title,
    start: task.scheduled_start ?? undefined,
    end: task.scheduled_end ?? undefined,
    display: 'block',
    editable: true,
    backgroundColor: task.completed ? '#eef2ef' : color,
    borderColor: color,
    textColor: task.completed ? '#50615b' : readableTextColor(color),
    classNames: task.completed ? ['task-event', 'task-event--completed'] : ['task-event'],
    extendedProps: {
      task,
    },
  };
}

function readableTextColor(hexColor: string): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness > 145 ? '#182026' : '#ffffff';
}

function getInitialThemeMode(): ThemeMode {
  try {
    return window.localStorage?.getItem('calendar-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function saveThemeMode(themeMode: ThemeMode): void {
  try {
    window.localStorage?.setItem('calendar-theme', themeMode);
  } catch {
    // Theme persistence is optional.
  }
}
