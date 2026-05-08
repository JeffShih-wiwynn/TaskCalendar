import type {
    DatesSetArg,
    EventApi,
    EventClickArg,
    EventContentArg,
    EventDropArg,
    EventInput,
    EventMountArg,
    DateSelectArg,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, {
    type DateClickArg,
    type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
} from "react";

import {
    createTaskList,
    deleteTaskList,
    listTaskLists,
    updateTaskList,
    type TaskList,
} from "./api/taskLists";
import {
    completeTask,
    createTask,
    deleteTask,
    listTasks,
    uncompleteTask,
    updateTask,
    type ScheduledTask,
} from "./api/tasks";

type TaskState =
    | { status: "loading" }
    | { status: "ready"; tasks: ScheduledTask[] }
    | { status: "error"; message: string };

type TaskView = "today" | "upcoming" | "completed" | "all";
type ThemeMode = "light" | "dark";
type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
const unclassifiedCategoryFilter = "__unclassified__";

type TaskFormState = {
    title: string;
    list_id: string;
    scheduled_start: string;
    scheduled_end: string;
    notes: string;
};

type EditFormState = TaskFormState & {
    completed: boolean;
};

type ContextMenuState = {
    kind: "task" | "category";
    id: string;
    x: number;
    y: number;
};

type DetailPanelMode = "create" | "edit" | null;

const initialFormState: TaskFormState = {
    title: "",
    list_id: "",
    scheduled_start: "",
    scheduled_end: "",
    notes: "",
};

const defaultCategoryColor = "#176b58";

const taskViews: Array<{ id: TaskView; label: string }> = [
    { id: "today", label: "Today" },
    { id: "upcoming", label: "Upcoming" },
    { id: "completed", label: "Completed" },
    { id: "all", label: "All tasks" },
];

const calendarViews: Array<{ id: CalendarView; label: string }> = [
    { id: "dayGridMonth", label: "Month" },
    { id: "timeGridWeek", label: "Week" },
    { id: "timeGridDay", label: "Day" },
];

export function App() {
    const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
    const [taskState, setTaskState] = useState<TaskState>({
        status: "loading",
    });
    const [activeView, setActiveView] = useState<TaskView>("today");
    const [upcomingDays, setUpcomingDays] = useState(7);
    const [showCompletedOnCalendar, setShowCompletedOnCalendar] =
        useState(true);
    const [activeListId, setActiveListId] = useState<string | null>(null);
    const [taskLists, setTaskLists] = useState<TaskList[]>([]);
    const [newListName, setNewListName] = useState("");
    const [newListColor, setNewListColor] = useState(defaultCategoryColor);
    const [editingTaskListId, setEditingTaskListId] = useState<string | null>(
        null,
    );
    const [editingListName, setEditingListName] = useState("");
    const [editingListColor, setEditingListColor] =
        useState(defaultCategoryColor);
    const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
    const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [formState, setFormState] = useState<TaskFormState>(initialFormState);
    const [editState, setEditState] = useState<EditFormState | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditSaving, setIsEditSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [detailPanelMode, setDetailPanelMode] =
        useState<DetailPanelMode>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
        null,
    );
    const [calendarView, setCalendarView] =
        useState<CalendarView>("timeGridWeek");
    const [calendarTitle, setCalendarTitle] = useState("");
    const [calendarDate, setCalendarDate] = useState(new Date());
    const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
    const [yearDraft, setYearDraft] = useState(
        String(new Date().getFullYear()),
    );
    const calendarRef = useRef<FullCalendar | null>(null);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const createFormRef = useRef<HTMLFormElement | null>(null);
    const categoryNameInputRef = useRef<HTMLInputElement | null>(null);
    const yearInputRef = useRef<HTMLInputElement | null>(null);

    const tasks = useMemo(
        () => (taskState.status === "ready" ? taskState.tasks : []),
        [taskState],
    );
    const selectedTask = selectedTaskId
        ? tasks.find((task) => task.id === selectedTaskId)
        : undefined;

    const visibleTasks = useMemo(
        () => filterTasksForView(tasks, activeView, activeListId, upcomingDays),
        [activeListId, activeView, tasks, upcomingDays],
    );

    const categoryColorById = useMemo(() => {
        return new Map(
            taskLists.map((taskList) => [taskList.id, taskList.color]),
        );
    }, [taskLists]);

    const activeViewLabel = useMemo(
        () =>
            taskViews.find((view) => view.id === activeView)?.label ?? "Today",
        [activeView],
    );

    const activeCategory = useMemo(
        () =>
            activeListId && activeListId !== unclassifiedCategoryFilter
                ? taskLists.find((taskList) => taskList.id === activeListId) ??
                  null
                : null,
        [activeListId, taskLists],
    );

    const activeCategoryLabel =
        activeListId === unclassifiedCategoryFilter
            ? "Unclassified"
            : activeCategory?.name ?? "All categories";

    const calendarTasks = useMemo(() => {
        const categoryFilteredTasks =
            activeListId === unclassifiedCategoryFilter
                ? tasks.filter((task) => task.list_id === null)
                : activeListId
                  ? tasks.filter((task) => task.list_id === activeListId)
                  : tasks;

        return categoryFilteredTasks.filter(
            (task) => showCompletedOnCalendar || !task.completed,
        );
    }, [activeListId, showCompletedOnCalendar, tasks]);

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
            notes: selectedTask.notes ?? "",
            scheduled_start: toDateTimeLocalValue(selectedTask.scheduled_start),
            scheduled_end: toDateTimeLocalValue(selectedTask.scheduled_end),
            completed: selectedTask.completed,
            list_id: selectedTask.list_id ?? "",
        });
    }, [selectedTask]);

    const refreshTasks = useCallback(async () => {
        setTaskState({ status: "loading" });

        try {
            const loadedTasks = await listTasks();
            setTaskState({ status: "ready", tasks: loadedTasks });
        } catch (error) {
            setTaskState({
                status: "error",
                message:
                    error instanceof Error
                        ? error.message
                        : "Unable to load tasks",
            });
        }
    }, []);

    const refreshTaskLists = useCallback(async () => {
        try {
            const loadedTaskLists = await listTaskLists();
            setTaskLists(loadedTaskLists);
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to load categories",
            );
        }
    }, []);

    useEffect(() => {
        void refreshTaskLists();
    }, [refreshTaskLists]);

    useEffect(() => {
        saveThemeMode(themeMode);
    }, [themeMode]);

    useEffect(() => {
        if (isYearPickerOpen) {
            window.setTimeout(() => yearInputRef.current?.focus(), 0);
        }
    }, [isYearPickerOpen]);

    const handleDatesSet = useCallback(
        (dateInfo: DatesSetArg) => {
            setCalendarView(dateInfo.view.type as CalendarView);
            setCalendarTitle(dateInfo.view.title);
            setCalendarDate(
                calendarRef.current?.getApi().getDate() ?? dateInfo.start,
            );
            setYearDraft(
                String(
                    (
                        calendarRef.current?.getApi().getDate() ??
                        dateInfo.start
                    ).getFullYear(),
                ),
            );
            void refreshTasks();
        },
        [refreshTasks],
    );

    const reloadTasks = useCallback(() => {
        void refreshTasks();
    }, [refreshTasks]);

    const navigateCalendar = useCallback((direction: "prev" | "next") => {
        const api = calendarRef.current?.getApi();
        if (!api) {
            return;
        }

        if (direction === "prev") {
            api.prev();
        } else {
            api.next();
        }
    }, []);

    const goToToday = useCallback(() => {
        calendarRef.current?.getApi().today();
    }, []);

    const changeCalendarView = useCallback((nextView: CalendarView) => {
        calendarRef.current?.getApi().changeView(nextView);
        setIsYearPickerOpen(false);
    }, []);

    const submitYearChange = useCallback(
        (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();

            const nextYear = Number.parseInt(yearDraft, 10);
            if (Number.isNaN(nextYear)) {
                return;
            }

            const nextDate = new Date(calendarDate);
            nextDate.setFullYear(nextYear);
            if (calendarView === "dayGridMonth") {
                nextDate.setDate(1);
            }
            calendarRef.current?.getApi().gotoDate(nextDate);
            setIsYearPickerOpen(false);
        },
        [calendarDate, calendarView, yearDraft],
    );

    const handleEventDrop = useCallback(
        async (dropInfo: EventDropArg) => {
            try {
                await updateTask(
                    dropInfo.event.id,
                    getCalendarEventScheduleUpdate(dropInfo.event),
                );
                reloadTasks();
            } catch (error) {
                dropInfo.revert();
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to move task",
                );
            }
        },
        [reloadTasks],
    );

    const handleEventResize = useCallback(
        async (resizeInfo: EventResizeDoneArg) => {
            try {
                await updateTask(
                    resizeInfo.event.id,
                    getCalendarEventScheduleUpdate(resizeInfo.event),
                );
                reloadTasks();
            } catch (error) {
                resizeInfo.revert();
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to resize task",
                );
            }
        },
        [reloadTasks],
    );

    const openCreatePanel = useCallback(
        (start: Date, end: Date) => {
            setFormError(null);
            setIsViewMenuOpen(false);
            setIsCategoryMenuOpen(false);
            setIsAddingCategory(false);
            setContextMenu(null);
            setDetailPanelMode("create");
            setSelectedTaskId(null);
            setFormState({
                ...initialFormState,
                list_id: activeListId ?? "",
                scheduled_start: dateToDateTimeLocalValue(start),
                scheduled_end: dateToDateTimeLocalValue(end),
            });
            window.setTimeout(() => {
                createFormRef.current?.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth",
                });
                titleInputRef.current?.focus();
            }, 0);
        },
        [activeListId],
    );

    const handleDateSelect = useCallback(
        (selectInfo: DateSelectArg) => {
            openCreatePanel(
                selectInfo.start,
                selectInfo.allDay
                    ? normalizeAllDayEnd(selectInfo.start, selectInfo.end)
                    : selectInfo.end,
            );
        },
        [openCreatePanel],
    );

    const handleDateClick = useCallback(
        (clickInfo: DateClickArg) => {
            const start = clickInfo.date;
            const end = clickInfo.allDay
                ? addLocalDays(start, 1)
                : new Date(start.getTime() + 60 * 60 * 1000);
            openCreatePanel(start, end);
        },
        [openCreatePanel],
    );

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
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to update task",
                );
            }
        },
        [reloadTasks],
    );

    const renderEventContent = useCallback(
        (eventInfo: EventContentArg) => {
            const task = eventInfo.event.extendedProps.task as ScheduledTask;

            return (
                <div className="calendar-task">
                    <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => void handleCheckboxChange(task)}
                        onClick={(event) => event.stopPropagation()}
                    />
                    <span>{task.title}</span>
                </div>
            );
        },
        [handleCheckboxChange],
    );

    const handleEventClick = useCallback((clickInfo: EventClickArg) => {
        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setIsAddingCategory(false);
        setDetailPanelMode("edit");
        setSelectedTaskId(clickInfo.event.id);
        setContextMenu(null);
    }, []);

    const closeDetailPanel = useCallback(() => {
        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setDetailPanelMode(null);
        setSelectedTaskId(null);
        setFormError(null);
    }, []);

    const handleEventDidMount = useCallback((mountInfo: EventMountArg) => {
        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();
            setSelectedTaskId(mountInfo.event.id);
            setContextMenu({
                kind: "task",
                id: mountInfo.event.id,
                x: event.clientX,
                y: event.clientY,
            });
        };

        mountInfo.el.addEventListener("contextmenu", handleContextMenu);
    }, []);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setFormError(null);

        if (!formState.title.trim()) {
            setFormError("Title is required");
            return;
        }

        if (
            !isValidTimeRange(
                formState.scheduled_start,
                formState.scheduled_end,
            )
        ) {
            setFormError("End time must be after start time");
            return;
        }

        setIsSaving(true);

        try {
            await createTask({
                title: formState.title.trim(),
                list_id: formState.list_id || null,
                notes: formState.notes.trim() || null,
                scheduled_start: toIsoOrNull(formState.scheduled_start),
                scheduled_end: toIsoOrNull(formState.scheduled_end),
            });
            setFormState(initialFormState);
            reloadTasks();
            closeDetailPanel();
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to create task",
            );
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
            setFormError("Title is required");
            return;
        }

        if (
            !isValidTimeRange(
                editState.scheduled_start,
                editState.scheduled_end,
            )
        ) {
            setFormError("End time must be after start time");
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
                completed: editState.completed,
            });
            reloadTasks();
            closeDetailPanel();
        } catch (error) {
            setFormError(
                error instanceof Error ? error.message : "Unable to save task",
            );
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
            setNewListName("");
            setNewListColor(defaultCategoryColor);
            setEditingTaskListId(null);
            setTaskLists((current) =>
                [...current, taskList].sort((a, b) =>
                    a.name.localeCompare(b.name),
                ),
            );
            setActiveListId(taskList.id);
            setIsAddingCategory(false);
            setIsCategoryMenuOpen(false);
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to create category",
            );
        }
    };

    const resetCategoryEditor = useCallback(() => {
        setIsAddingCategory(false);
        setEditingTaskListId(null);
        setNewListName("");
        setNewListColor(defaultCategoryColor);
        setEditingListName("");
        setEditingListColor(defaultCategoryColor);
    }, []);

    const startEditingTaskList = useCallback((taskList: TaskList) => {
        setIsAddingCategory(false);
        setEditingTaskListId(taskList.id);
        setEditingListName(taskList.name);
        setEditingListColor(taskList.color);
        window.setTimeout(() => categoryNameInputRef.current?.focus(), 0);
    }, []);

    const handleUpdateTaskList = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setFormError(null);

        if (!editingTaskListId) {
            return;
        }

        const name = editingListName.trim();
        if (!name) {
            return;
        }

        try {
            const updatedTaskList = await updateTaskList(editingTaskListId, {
                name,
                color: editingListColor,
            });
            setTaskLists((current) =>
                current
                    .map((taskList) =>
                        taskList.id === updatedTaskList.id
                            ? updatedTaskList
                            : taskList,
                    )
                    .sort((a, b) => a.name.localeCompare(b.name)),
            );
            resetCategoryEditor();
            setIsCategoryMenuOpen(false);
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to update category",
            );
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
            reloadTasks();
            closeDetailPanel();
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to delete task",
            );
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
            if (contextMenu.kind === "task") {
                await deleteTask(contextMenu.id);
                setSelectedTaskId((currentId) =>
                    currentId === contextMenu.id ? null : currentId,
                );
            } else {
                await deleteTaskList(contextMenu.id);
                setActiveListId((currentId) =>
                    currentId === contextMenu.id ? null : currentId,
                );
                setSelectedTaskId((currentId) => {
                    const selected = tasks.find(
                        (task) => task.id === currentId,
                    );
                    return selected?.list_id === contextMenu.id
                        ? null
                        : currentId;
                });
                void refreshTaskLists();
            }
            setContextMenu(null);
            reloadTasks();
        } catch (error) {
            setFormError(
                error instanceof Error ? error.message : "Unable to delete",
            );
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <main
            className={`app-shell ${themeMode}`}
            onClick={() => {
                setContextMenu(null);
                setIsViewMenuOpen(false);
                setIsCategoryMenuOpen(false);
            }}
        >
            <aside className="task-sidebar">
                <div className="sidebar-header">
                    <p className="eyebrow">Scheduled Task Calendar</p>
                    <button
                        type="button"
                        className="theme-toggle"
                        onClick={() =>
                            setThemeMode(
                                themeMode === "dark" ? "light" : "dark",
                            )
                        }
                    >
                        {themeMode === "dark" ? "Light" : "Dark"}
                    </button>
                </div>

                {!detailPanelMode && (
                    <section
                        className="filter-section"
                        aria-label="Task filters"
                    >
                        <div className="filter-field">
                            <span>View</span>
                            <div
                                className="filter-dropdown"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <button
                                    type="button"
                                    className="filter-trigger"
                                    aria-label="Task view"
                                    aria-expanded={isViewMenuOpen}
                                    onClick={() => {
                                        setIsViewMenuOpen(
                                            (current) => !current,
                                        );
                                        setIsCategoryMenuOpen(false);
                                    }}
                                >
                                    <span>{activeViewLabel}</span>
                                    <span
                                        className="filter-chevron"
                                        aria-hidden="true"
                                    >
                                        ▾
                                    </span>
                                </button>
                                {isViewMenuOpen && (
                                    <div
                                        className="filter-menu"
                                        role="listbox"
                                        aria-label="Task view options"
                                    >
                                        {taskViews.map((view) => (
                                            <button
                                                key={view.id}
                                                type="button"
                                                className={`filter-option ${activeView === view.id ? "active" : ""}`}
                                                onClick={() => {
                                                    setActiveView(view.id);
                                                    setIsViewMenuOpen(false);
                                                }}
                                            >
                                                {view.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {activeView === "upcoming" && (
                            <div className="filter-field">
                                <span>Days</span>
                                <input
                                    className="filter-number-input"
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={upcomingDays}
                                    onChange={(event) => {
                                        const nextValue = Number.parseInt(
                                            event.target.value,
                                            10,
                                        );
                                        setUpcomingDays(
                                            Number.isNaN(nextValue)
                                                ? 1
                                                : Math.max(1, nextValue),
                                        );
                                    }}
                                />
                            </div>
                        )}

                        {activeView === "completed" && (
                            <label className="filter-toggle-field">
                                <span>Show on calendar</span>
                                <input
                                    type="checkbox"
                                    checked={showCompletedOnCalendar}
                                    onChange={(event) =>
                                        setShowCompletedOnCalendar(
                                            event.target.checked,
                                        )
                                    }
                                />
                            </label>
                        )}

                        <div className="filter-field">
                            <span>Category</span>
                            <div
                                className="filter-dropdown"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <button
                                    type="button"
                                    className="filter-trigger"
                                    aria-label="Task category"
                                    aria-expanded={isCategoryMenuOpen}
                                    onClick={() => {
                                        setIsCategoryMenuOpen(
                                            (current) => !current,
                                        );
                                        setIsViewMenuOpen(false);
                                    }}
                                >
                                    <span className="filter-trigger-value">
                                        <span
                                            className="category-swatch"
                                            style={{
                                                backgroundColor:
                                                    activeCategory?.color ??
                                                    "transparent",
                                            }}
                                            aria-hidden="true"
                                        />
                                        <span>{activeCategoryLabel}</span>
                                    </span>
                                    <span
                                        className="filter-chevron"
                                        aria-hidden="true"
                                    >
                                        ▾
                                    </span>
                                </button>
                                {isCategoryMenuOpen && (
                                    <div
                                        className="filter-menu"
                                        role="listbox"
                                        aria-label="Task category options"
                                    >
                                        <button
                                            type="button"
                                            className={`filter-option ${activeListId === null ? "active" : ""}`}
                                            onClick={() => {
                                                setActiveListId(null);
                                                setIsCategoryMenuOpen(false);
                                            }}
                                        >
                                            <span
                                                className="category-swatch category-swatch-empty"
                                                aria-hidden="true"
                                            />
                                            <span>All categories</span>
                                        </button>
                                        <button
                                            type="button"
                                            className={`filter-option ${activeListId === unclassifiedCategoryFilter ? "active" : ""}`}
                                            onClick={() => {
                                                setActiveListId(
                                                    unclassifiedCategoryFilter,
                                                );
                                                setIsCategoryMenuOpen(false);
                                            }}
                                        >
                                            <span
                                                className="category-swatch category-swatch-empty"
                                                aria-hidden="true"
                                            />
                                            <span>Unclassified</span>
                                        </button>
                                        {taskLists.map((taskList) => (
                                            <div
                                                key={taskList.id}
                                                className="filter-option-row"
                                            >
                                                <button
                                                    type="button"
                                                    className={`filter-option ${activeListId === taskList.id ? "active" : ""}`}
                                                    onClick={() => {
                                                        setActiveListId(
                                                            taskList.id,
                                                        );
                                                        setIsCategoryMenuOpen(
                                                            false,
                                                        );
                                                    }}
                                                    onContextMenu={(event) => {
                                                        event.preventDefault();
                                                        setContextMenu({
                                                            kind: "category",
                                                            id: taskList.id,
                                                            x: event.clientX,
                                                            y: event.clientY,
                                                        });
                                                    }}
                                                >
                                                    <span
                                                        className="category-swatch"
                                                        style={{
                                                            backgroundColor:
                                                                taskList.color,
                                                        }}
                                                        aria-hidden="true"
                                                    />
                                                    <span>{taskList.name}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="filter-option-action"
                                                    aria-label={`Edit ${taskList.name}`}
                                                    onClick={() =>
                                                        startEditingTaskList(
                                                            taskList,
                                                        )
                                                    }
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        ))}
                                        <div className="filter-menu-footer">
                                            {editingTaskListId ? (
                                                <form
                                                    className="category-inline-form"
                                                    onSubmit={(event) =>
                                                        void handleUpdateTaskList(
                                                            event,
                                                        )
                                                    }
                                                >
                                                    <input
                                                        type="color"
                                                        value={editingListColor}
                                                        onChange={(event) =>
                                                            setEditingListColor(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                        aria-label="Edit category color"
                                                    />
                                                    <input
                                                        ref={
                                                            categoryNameInputRef
                                                        }
                                                        value={editingListName}
                                                        onChange={(event) =>
                                                            setEditingListName(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                        placeholder="Category name"
                                                        aria-label="Edit category name"
                                                    />
                                                    <div className="category-inline-actions">
                                                        <button type="submit">
                                                            Save
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="secondary-button"
                                                            onClick={() =>
                                                                resetCategoryEditor()
                                                            }
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </form>
                                            ) : isAddingCategory ? (
                                                <form
                                                    className="category-inline-form"
                                                    onSubmit={(event) =>
                                                        void handleCreateTaskList(
                                                            event,
                                                        )
                                                    }
                                                >
                                                    <input
                                                        type="color"
                                                        value={newListColor}
                                                        onChange={(event) =>
                                                            setNewListColor(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                        aria-label="New category color"
                                                    />
                                                    <input
                                                        ref={
                                                            categoryNameInputRef
                                                        }
                                                        value={newListName}
                                                        onChange={(event) =>
                                                            setNewListName(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                        placeholder="New category"
                                                        aria-label="New category"
                                                    />
                                                    <div className="category-inline-actions">
                                                        <button type="submit">
                                                            Add
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="secondary-button"
                                                            onClick={() => {
                                                                resetCategoryEditor();
                                                            }}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </form>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="filter-add-button"
                                                    onClick={() => {
                                                        setEditingTaskListId(
                                                            null,
                                                        );
                                                        setIsAddingCategory(
                                                            true,
                                                        );
                                                        window.setTimeout(
                                                            () =>
                                                                categoryNameInputRef.current?.focus(),
                                                            0,
                                                        );
                                                    }}
                                                >
                                                    Add category
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                {detailPanelMode && (
                    <section
                        className="task-detail-panel"
                        aria-label={
                            detailPanelMode === "create"
                                ? "Create task panel"
                                : "Edit task panel"
                        }
                    >
                        <div className="task-detail-header">
                            <h2>
                                {detailPanelMode === "create"
                                    ? "Create task"
                                    : "Edit task"}
                            </h2>
                            <button
                                type="button"
                                className="floating-panel-close"
                                onClick={closeDetailPanel}
                            >
                                Close
                            </button>
                        </div>

                        {detailPanelMode === "create" ? (
                            <form
                                ref={createFormRef}
                                className="task-form active-form"
                                onSubmit={(event) => void handleSubmit(event)}
                            >
                                <div className="task-form-row">
                                    <LabeledInput
                                        label="Title"
                                        value={formState.title}
                                        onChange={(value) =>
                                            setFormState({
                                                ...formState,
                                                title: value,
                                            })
                                        }
                                        inputRef={titleInputRef}
                                        required
                                    />
                                    <LabeledSelect
                                        label="Category"
                                        value={formState.list_id}
                                        onChange={(value) =>
                                            setFormState({
                                                ...formState,
                                                list_id: value,
                                            })
                                        }
                                        options={taskLists}
                                    />
                                </div>
                                <div className="task-form-row">
                                    <LabeledInput
                                        label="Start"
                                        type="datetime-local"
                                        value={formState.scheduled_start}
                                        onChange={(value) =>
                                            setFormState({
                                                ...formState,
                                                scheduled_start: value,
                                            })
                                        }
                                    />
                                    <LabeledInput
                                        label="End"
                                        type="datetime-local"
                                        value={formState.scheduled_end}
                                        onChange={(value) =>
                                            setFormState({
                                                ...formState,
                                                scheduled_end: value,
                                            })
                                        }
                                    />
                                </div>
                                <label>
                                    <span>Notes</span>
                                    <textarea
                                        value={formState.notes}
                                        onChange={(event) =>
                                            setFormState({
                                                ...formState,
                                                notes: event.target.value,
                                            })
                                        }
                                        rows={3}
                                    />
                                </label>
                                <button type="submit" disabled={isSaving}>
                                    {isSaving ? "Creating..." : "Create"}
                                </button>
                            </form>
                        ) : selectedTask && editState ? (
                            <form
                                className="task-form"
                                onSubmit={(event) =>
                                    void handleEditSubmit(event)
                                }
                            >
                                <div className="task-form-row">
                                    <LabeledInput
                                        label="Title"
                                        value={editState.title}
                                        onChange={(value) =>
                                            setEditState({
                                                ...editState,
                                                title: value,
                                            })
                                        }
                                        required
                                    />
                                    <LabeledSelect
                                        label="Category"
                                        value={editState.list_id}
                                        onChange={(value) =>
                                            setEditState({
                                                ...editState,
                                                list_id: value,
                                            })
                                        }
                                        options={taskLists}
                                    />
                                </div>
                                <div className="task-form-row">
                                    <LabeledInput
                                        label="Start"
                                        type="datetime-local"
                                        value={editState.scheduled_start}
                                        onChange={(value) =>
                                            setEditState({
                                                ...editState,
                                                scheduled_start: value,
                                            })
                                        }
                                    />
                                    <LabeledInput
                                        label="End"
                                        type="datetime-local"
                                        value={editState.scheduled_end}
                                        onChange={(value) =>
                                            setEditState({
                                                ...editState,
                                                scheduled_end: value,
                                            })
                                        }
                                    />
                                </div>
                                <div className="task-form-row task-form-row-center">
                                    <label className="task-form-inline-toggle">
                                        <span>Completed</span>
                                        <input
                                            type="checkbox"
                                            checked={editState.completed}
                                            onChange={(event) =>
                                                setEditState({
                                                    ...editState,
                                                    completed:
                                                        event.target.checked,
                                                })
                                            }
                                        />
                                    </label>
                                </div>
                                <label>
                                    <span>Notes</span>
                                    <textarea
                                        value={editState.notes}
                                        onChange={(event) =>
                                            setEditState({
                                                ...editState,
                                                notes: event.target.value,
                                            })
                                        }
                                        rows={5}
                                    />
                                </label>
                                <div className="task-form-actions">
                                    <button
                                        type="submit"
                                        disabled={isEditSaving}
                                    >
                                        {isEditSaving ? "Saving..." : "Save"}
                                    </button>
                                    <button
                                        className="danger-button"
                                        type="button"
                                        disabled={isDeleting}
                                        onClick={() =>
                                            void handleDeleteSelectedTask()
                                        }
                                    >
                                        {isDeleting ? "Deleting..." : "Delete"}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <p className="muted">Select a task to edit it.</p>
                        )}
                    </section>
                )}

                {!detailPanelMode && (
                    <section
                        className="task-list"
                        aria-label={`${activeView} tasks`}
                    >
                        {taskState.status === "loading" && (
                            <p className="muted">Loading tasks...</p>
                        )}
                        {taskState.status === "error" && (
                            <p className="form-error">{taskState.message}</p>
                        )}
                        {taskState.status === "ready" &&
                            visibleTasks.length === 0 && (
                                <p className="muted">No tasks in this view.</p>
                            )}
                        {visibleTasks.map((task) => (
                            <button
                                key={task.id}
                                type="button"
                                className={`task-row ${selectedTaskId === task.id ? "selected" : ""}`}
                                style={{
                                    borderLeftColor: taskCategoryColor(
                                        task,
                                        categoryColorById,
                                    ),
                                    accentColor: taskCategoryColor(
                                        task,
                                        categoryColorById,
                                    ),
                                }}
                                onClick={() => {
                                    setDetailPanelMode("edit");
                                    setSelectedTaskId(task.id);
                                }}
                                onContextMenu={(event) => {
                                    event.preventDefault();
                                    setSelectedTaskId(task.id);
                                    setContextMenu({
                                        kind: "task",
                                        id: task.id,
                                        x: event.clientX,
                                        y: event.clientY,
                                    });
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={task.completed}
                                    onChange={() =>
                                        void handleCheckboxChange(task)
                                    }
                                    onClick={(event) => event.stopPropagation()}
                                    aria-label={`Toggle ${task.title}`}
                                />
                                <span className="task-row-main">
                                    <span
                                        className={
                                            task.completed
                                                ? "task-title completed"
                                                : "task-title"
                                        }
                                    >
                                        {task.title}
                                    </span>
                                    <span className="task-meta">
                                        {formatScheduledRange(task)}
                                        {task.due_at &&
                                            `Due ${formatDateTime(task.due_at)}`}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </section>
                )}
            </aside>

            <section
                className="calendar-panel"
                aria-label="Scheduled tasks calendar"
            >
                {taskState.status === "loading" && (
                    <div className="status-banner">Loading tasks...</div>
                )}
                {formError && (
                    <div className="status-banner error">{formError}</div>
                )}

                <div className="calendar-toolbar">
                    <div className="calendar-toolbar-group">
                        <button
                            type="button"
                            className="calendar-nav-button"
                            aria-label="Previous period"
                            onClick={() => navigateCalendar("prev")}
                        >
                            ‹
                        </button>
                        <button
                            type="button"
                            className="calendar-nav-button"
                            aria-label="Next period"
                            onClick={() => navigateCalendar("next")}
                        >
                            ›
                        </button>
                        <button
                            type="button"
                            className="calendar-toolbar-button"
                            onClick={goToToday}
                        >
                            Today
                        </button>
                    </div>

                    <div className="calendar-toolbar-title">
                        {calendarView === "dayGridMonth" ? (
                            <div className="calendar-year-control">
                                <span className="calendar-title-month">
                                    {new Intl.DateTimeFormat(undefined, {
                                        month: "long",
                                    }).format(calendarDate)}
                                </span>
                                {isYearPickerOpen ? (
                                    <form
                                        className="calendar-year-form"
                                        onSubmit={(event) =>
                                            void submitYearChange(event)
                                        }
                                    >
                                        <input
                                            ref={yearInputRef}
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={yearDraft}
                                            onChange={(event) =>
                                                setYearDraft(event.target.value)
                                            }
                                            aria-label="Calendar year"
                                        />
                                    </form>
                                ) : (
                                    <button
                                        type="button"
                                        className="calendar-year-button"
                                        onClick={() =>
                                            setIsYearPickerOpen(true)
                                        }
                                    >
                                        {calendarDate.getFullYear()}
                                    </button>
                                )}
                            </div>
                        ) : (
                            <span>{calendarTitle}</span>
                        )}
                    </div>

                    <div
                        className="calendar-toolbar-group calendar-view-switcher"
                        role="tablist"
                        aria-label="Calendar view"
                    >
                        {calendarViews.map((view) => (
                            <button
                                key={view.id}
                                type="button"
                                className={`calendar-toolbar-button ${calendarView === view.id ? "active" : ""}`}
                                onClick={() => changeCalendarView(view.id)}
                            >
                                {view.label}
                            </button>
                        ))}
                    </div>
                </div>

                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                    initialView="timeGridWeek"
                    headerToolbar={false}
                    events={events}
                    eventContent={renderEventContent}
                    eventClick={handleEventClick}
                    eventDidMount={handleEventDidMount}
                    dateClick={handleDateClick}
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

            {contextMenu && (
                <div
                    className="context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => void handleDeleteFromMenu()}
                    >
                        {isDeleting
                            ? "Deleting..."
                            : contextMenu.kind === "category"
                              ? "Delete category"
                              : "Delete"}
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
    type = "text",
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

function LabeledSelect({
    label,
    value,
    onChange,
    options,
}: LabeledSelectProps) {
    return (
        <label>
            <span>{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
            >
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
    upcomingDays: number,
): ScheduledTask[] {
    const now = new Date();

    return tasks.filter((task) => {
        if (
            activeListId === unclassifiedCategoryFilter &&
            task.list_id !== null
        ) {
            return false;
        }

        if (
            activeListId &&
            activeListId !== unclassifiedCategoryFilter &&
            task.list_id !== activeListId
        ) {
            return false;
        }

        if (activeView === "all") {
            return true;
        }

        if (activeView === "completed") {
            return task.completed;
        }

        if (task.completed) {
            return false;
        }

        const taskDate = task.scheduled_start ?? task.due_at;

        if (activeView === "today") {
            return taskDate
                ? isSameLocalDay(parseTaskDate(taskDate), now)
                : false;
        }

        if (activeView === "upcoming") {
            return taskDate
                ? isWithinUpcomingDays(
                      parseTaskDate(taskDate),
                      now,
                      upcomingDays,
                  )
                : false;
        }

        return false;
    });
}

function toIsoOrNull(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
}

function toDateTimeLocalValue(value: string | null): string {
    if (!value) {
        return "";
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

function isWithinUpcomingDays(value: Date, now: Date, days: number): boolean {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = addLocalDays(start, Math.max(1, days));
    return value >= start && value < end;
}

function formatScheduledRange(task: ScheduledTask): string {
    if (!task.scheduled_start) {
        return "";
    }

    const start = formatDateTime(task.scheduled_start);
    const end = task.scheduled_end ? formatDateTime(task.scheduled_end) : "";
    return end ? `${start} - ${end}` : start;
}

function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(parseTaskDate(value));
}

function parseTaskDate(value: string): Date {
    return new Date(value);
}

function getCalendarEventScheduleUpdate(event: EventApi): {
    scheduled_start: string | null;
    scheduled_end: string | null;
} {
    if (!event.start) {
        return { scheduled_start: null, scheduled_end: null };
    }

    const end =
        event.end ?? (event.allDay ? addLocalDays(event.start, 1) : null);

    return {
        scheduled_start: event.start.toISOString(),
        scheduled_end: end?.toISOString() ?? null,
    };
}

function addLocalDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function normalizeAllDayEnd(start: Date, end: Date | null): Date {
    if (!end || end <= start) {
        return addLocalDays(start, 1);
    }

    return end;
}

function taskCategoryColor(
    task: ScheduledTask,
    categoryColorById: Map<string, string>,
): string {
    return task.list_id
        ? (categoryColorById.get(task.list_id) ?? defaultCategoryColor)
        : defaultCategoryColor;
}

function isAllDayScheduledTask(task: ScheduledTask): boolean {
    if (!task.scheduled_start || !task.scheduled_end) {
        return false;
    }

    const start = parseTaskDate(task.scheduled_start);
    const end = parseTaskDate(task.scheduled_end);
    const dayMs = 24 * 60 * 60 * 1000;
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: task.timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    });
    const startClock = formatter.formatToParts(start);
    const endClock = formatter.formatToParts(end);

    return (
        getPartValue(startClock, "hour") === "00" &&
        getPartValue(startClock, "minute") === "00" &&
        getPartValue(startClock, "second") === "00" &&
        getPartValue(endClock, "hour") === "00" &&
        getPartValue(endClock, "minute") === "00" &&
        getPartValue(endClock, "second") === "00" &&
        end.getTime() - start.getTime() >= dayMs
    );
}

function toCalendarDate(value: string, timeZone: string): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(parseTaskDate(value));
}

function getPartValue(
    parts: Intl.DateTimeFormatPart[],
    type: Intl.DateTimeFormatPartTypes,
): string {
    return parts.find((part) => part.type === type)?.value ?? "";
}

function mapTaskToCalendarEvent(
    task: ScheduledTask,
    categoryColorById: Map<string, string>,
): EventInput {
    const color = taskCategoryColor(task, categoryColorById);
    const allDay = isAllDayScheduledTask(task);

    return {
        id: task.id,
        title: task.title,
        start:
            allDay && task.scheduled_start
                ? toCalendarDate(task.scheduled_start, task.timezone)
                : (task.scheduled_start ?? undefined),
        end:
            allDay && task.scheduled_end
                ? toCalendarDate(task.scheduled_end, task.timezone)
                : (task.scheduled_end ?? undefined),
        allDay,
        display: "block",
        editable: true,
        backgroundColor: task.completed ? "#eef2ef" : color,
        borderColor: color,
        textColor: task.completed ? "#50615b" : readableTextColor(color),
        classNames: task.completed
            ? ["task-event", "task-event--completed"]
            : ["task-event"],
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
    return brightness > 145 ? "#182026" : "#ffffff";
}

function getInitialThemeMode(): ThemeMode {
    try {
        return window.localStorage?.getItem("calendar-theme") === "dark"
            ? "dark"
            : "light";
    } catch {
        return "light";
    }
}

function saveThemeMode(themeMode: ThemeMode): void {
    try {
        window.localStorage?.setItem("calendar-theme", themeMode);
    } catch {
        // Theme persistence is optional.
    }
}
