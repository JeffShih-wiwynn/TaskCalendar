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
    Draggable,
    type DropArg,
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
    type CSSProperties,
    type FormEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";

import {
    getSettings,
    testSettings,
    updateSettings,
    type AppSettings,
} from "./api/settings";
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

type TaskView =
    | "today"
    | "upcoming"
    | "overdue"
    | "completed"
    | "unscheduled"
    | "all";
type ThemeMode = "light" | "dark";
type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
const unclassifiedCategoryFilter = "__unclassified__";
const defaultSidebarWidth = 300;
const minSidebarWidth = 240;
const minCalendarWidth = 320;

type TaskFormState = {
    title: string;
    list_id: string;
    scheduled_start: string;
    scheduled_end: string;
    notes: string;
    recurrence_frequency: RecurrenceFrequency;
    recurrence_interval: string;
    recurrence_until: string;
    notification_unit: NotificationUnit;
    notification_offset_value: string;
    notification_channel: NotificationChannel;
};

type EditFormState = TaskFormState & {
    completed: boolean;
};

type WebhookSettingsFormState = {
    discord_webhook_url: string;
    discord_message_template: string;
};

type RecurrenceFrequency = "" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
type NotificationUnit = "" | "MINUTES" | "HOURS" | "DAYS";
type NotificationChannel = "" | "DISCORD";

type ContextMenuState = {
    kind: "task" | "category";
    id: string;
    x: number;
    y: number;
};

type PendingTaskDeleteState = {
    taskId: string;
    source: "detail" | "menu";
};

type PendingTaskEditState = {
    taskId: string;
    updates: Parameters<typeof updateTask>[1];
    source: "form" | "calendar";
    revert?: () => void;
};

type DetailPanelMode = "create" | "edit" | null;
type TaskRowDragEvent =
    | ReactMouseEvent<HTMLElement>
    | ReactPointerEvent<HTMLElement>;

const initialFormState: TaskFormState = {
    title: "",
    list_id: "",
    scheduled_start: "",
    scheduled_end: "",
    notes: "",
    recurrence_frequency: "",
    recurrence_interval: "1",
    recurrence_until: "",
    notification_unit: "",
    notification_offset_value: "0",
    notification_channel: "",
};

const notificationUnits: Array<{ id: NotificationUnit; label: string }> = [
    { id: "", label: "None" },
    { id: "MINUTES", label: "Minutes" },
    { id: "HOURS", label: "Hours" },
    { id: "DAYS", label: "Days" },
];

const defaultCategoryColor = "#176b58";

const taskViews: Array<{ id: TaskView; label: string }> = [
    { id: "today", label: "Today" },
    { id: "upcoming", label: "Upcoming" },
    { id: "overdue", label: "Overdue" },
    { id: "completed", label: "Completed" },
    { id: "unscheduled", label: "No time tasks" },
    { id: "all", label: "All tasks" },
];

const calendarViews: Array<{ id: CalendarView; label: string }> = [
    { id: "dayGridMonth", label: "Month" },
    { id: "timeGridWeek", label: "Week" },
    { id: "timeGridDay", label: "Day" },
];

export function App() {
    const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
    const [isSidebarOpen, setIsSidebarOpen] = useState(getInitialSidebarOpen);
    const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
    const [taskState, setTaskState] = useState<TaskState>({
        status: "loading",
    });
    const [activeView, setActiveView] = useState<TaskView>("today");
    const [upcomingDays, setUpcomingDays] = useState(7);
    const [showCompletedOnCalendar, setShowCompletedOnCalendar] =
        useState(true);
    const [activeListId, setActiveListId] = useState<string | null>(null);
    const [taskLists, setTaskLists] = useState<TaskList[]>([]);
    const [unscheduledOrder, setUnscheduledOrder] = useState<string[]>(
        getInitialUnscheduledOrder,
    );
    const [newListName, setNewListName] = useState("");
    const [newListColor, setNewListColor] = useState(defaultCategoryColor);
    const [editingTaskListId, setEditingTaskListId] = useState<string | null>(
        null,
    );
    const [editingListName, setEditingListName] = useState("");
    const [editingListColor, setEditingListColor] =
        useState(defaultCategoryColor);
    const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
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
    const [pendingTaskDelete, setPendingTaskDelete] =
        useState<PendingTaskDeleteState | null>(null);
    const [pendingTaskEdit, setPendingTaskEdit] =
        useState<PendingTaskEditState | null>(null);
    const [detailPanelMode, setDetailPanelMode] =
        useState<DetailPanelMode>(null);
    const [isWebhookSettingsOpen, setIsWebhookSettingsOpen] = useState(false);
    const [webhookSettings, setWebhookSettings] = useState<AppSettings | null>(
        null,
    );
    const [webhookSettingsDraft, setWebhookSettingsDraft] =
        useState<WebhookSettingsFormState>({
            discord_webhook_url: "",
            discord_message_template: "",
        });
    const [isWebhookSettingsSaving, setIsWebhookSettingsSaving] =
        useState(false);
    const [isWebhookSettingsTesting, setIsWebhookSettingsTesting] =
        useState(false);
    const [webhookTestMessage, setWebhookTestMessage] = useState<string | null>(
        null,
    );
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
        null,
    );
    const [calendarView, setCalendarView] =
        useState<CalendarView>("timeGridWeek");
    const [calendarTitle, setCalendarTitle] = useState("");
    const [calendarDate, setCalendarDate] = useState(new Date());
    const [calendarRefreshToken, setCalendarRefreshToken] = useState(0);
    const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
    const [yearDraft, setYearDraft] = useState(
        String(new Date().getFullYear()),
    );
    const calendarRef = useRef<FullCalendar | null>(null);
    const appShellRef = useRef<HTMLElement | null>(null);
    const taskListRef = useRef<HTMLElement | null>(null);
    const tasksRef = useRef<ScheduledTask[]>([]);
    const visibleTasksRef = useRef<ScheduledTask[]>([]);
    const taskRowPointerStateRef = useRef<{
        taskId: string;
        startX: number;
        startY: number;
        dragging: boolean;
    } | null>(null);
    const taskRowWindowDragCleanupRef = useRef<(() => void) | null>(null);
    const draggedUnscheduledTaskIdRef = useRef<string | null>(null);
    const suppressTaskRowClickRef = useRef<string | null>(null);
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
    const pendingDeleteTask = pendingTaskDelete
        ? tasks.find((task) => task.id === pendingTaskDelete.taskId)
        : undefined;

    const visibleTasks = useMemo(
        () => filterTasksForView(tasks, activeView, activeListId, upcomingDays),
        [activeListId, activeView, tasks, upcomingDays],
    );
    const orderedVisibleTasks = useMemo(
        () =>
            activeView === "unscheduled"
                ? orderTasksByIds(visibleTasks, unscheduledOrder)
                : visibleTasks,
        [activeView, unscheduledOrder, visibleTasks],
    );

    tasksRef.current = tasks;
    visibleTasksRef.current = orderedVisibleTasks;

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
                ? (taskLists.find((taskList) => taskList.id === activeListId) ??
                  null)
                : null,
        [activeListId, taskLists],
    );

    const activeCategoryLabel =
        activeListId === unclassifiedCategoryFilter
            ? "Unclassified"
            : (activeCategory?.name ?? "All");
    const selectedListIdForForms =
        activeListId && activeListId !== unclassifiedCategoryFilter
            ? activeListId
            : "";

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

        const recurrenceState = parseRecurrenceRule(
            selectedTask.recurrence_rule,
        );

        setEditState({
            title: selectedTask.title,
            notes: selectedTask.notes ?? "",
            scheduled_start: toDateTimeLocalValue(selectedTask.scheduled_start),
            scheduled_end: toDateTimeLocalValue(selectedTask.scheduled_end),
            completed: selectedTask.completed,
            list_id: selectedTask.list_id ?? "",
            recurrence_frequency: recurrenceState.frequency,
            recurrence_interval: recurrenceState.interval,
            recurrence_until: recurrenceState.until,
            ...notificationFormStateFromTask(selectedTask),
            notification_channel:
                Boolean(selectedTask.notification_enabled) &&
                selectedTask.notification_channel === "discord"
                    ? "DISCORD"
                    : "",
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

    const replaceTaskInState = useCallback((updatedTask: ScheduledTask) => {
        setTaskState((current) => {
            if (current.status !== "ready") {
                return current;
            }

            return {
                status: "ready",
                tasks: current.tasks.map((task) =>
                    task.id === updatedTask.id ? updatedTask : task,
                ),
            };
        });
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

    const refreshWebhookSettings = useCallback(async () => {
        try {
            const loadedSettings = await getSettings();
            setWebhookSettings(loadedSettings);
            setWebhookSettingsDraft({
                discord_webhook_url: loadedSettings.discord_webhook_url ?? "",
                discord_message_template:
                    loadedSettings.discord_message_template ?? "",
            });
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to load webhook settings",
            );
        }
    }, []);

    useEffect(() => {
        void refreshTaskLists();
    }, [refreshTaskLists]);

    useEffect(() => {
        void refreshWebhookSettings();
    }, [refreshWebhookSettings]);

    useEffect(() => {
        saveThemeMode(themeMode);
    }, [themeMode]);

    useEffect(() => {
        saveSidebarOpen(isSidebarOpen);
    }, [isSidebarOpen]);

    useEffect(() => {
        saveSidebarWidth(sidebarWidth);
    }, [sidebarWidth]);

    useEffect(() => {
        const unscheduledTaskIds = tasks
            .filter((task) => !task.scheduled_start && !task.scheduled_end)
            .map((task) => task.id);
        setUnscheduledOrder((current) => {
            const next = reconcileTaskOrder(current, unscheduledTaskIds);
            return areStringArraysEqual(current, next) ? current : next;
        });
    }, [tasks]);

    useEffect(() => {
        saveUnscheduledOrder(unscheduledOrder);
    }, [unscheduledOrder]);

    useEffect(() => {
        const taskListElement = taskListRef.current;
        if (!taskListElement || detailPanelMode || activeView === "unscheduled") {
            return;
        }

        const draggable = new Draggable(taskListElement, {
            itemSelector: ".task-row[data-task-id]",
            minDistance: 6,
            eventData(taskRowElement) {
                const taskId = taskRowElement.getAttribute("data-task-id");
                const task = visibleTasksRef.current.find(
                    (item) => item.id === taskId,
                );
                if (!task) {
                    return {};
                }

                return {
                    create: false,
                    duration: getTaskDragDuration(task),
                };
            },
        });

        return () => {
            draggable.destroy();
        };
    }, [activeView, detailPanelMode]);

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

    const closeDetailPanel = useCallback(() => {
        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setContextMenu(null);
        setDetailPanelMode(null);
        setSelectedTaskId(null);
        if (pendingTaskEdit?.source === "calendar") {
            pendingTaskEdit.revert?.();
        }
        setPendingTaskEdit(null);
        setFormError(null);
    }, [pendingTaskEdit]);

    const runTaskDelete = useCallback(
        async (
            taskId: string,
            source: "detail" | "menu",
            deleteScope: "single" | "following" = "single",
        ) => {
            setFormError(null);
            setIsDeleting(true);

            try {
                await deleteTask(taskId, { deleteScope });
                setPendingTaskDelete(null);

                if (source === "detail") {
                    closeDetailPanel();
                } else {
                    if (selectedTaskId === taskId) {
                        closeDetailPanel();
                    } else {
                        setSelectedTaskId((currentId) =>
                            currentId === taskId ? null : currentId,
                        );
                        setContextMenu(null);
                    }
                }

                reloadTasks();
            } catch (error) {
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to delete task",
                );
            } finally {
                setIsDeleting(false);
            }
        },
        [closeDetailPanel, reloadTasks, selectedTaskId],
    );

    const runTaskUpdate = useCallback(
        async (
            taskId: string,
            updates: Parameters<typeof updateTask>[1],
            updateScope: "single" | "series" = "single",
            source: "form" | "calendar" = "form",
        ) => {
            setFormError(null);
            setIsEditSaving(true);

            try {
                if (updateScope === "series") {
                    await updateTask(taskId, updates, { updateScope });
                } else {
                    await updateTask(taskId, updates);
                }
                setPendingTaskEdit(null);
                if (source === "calendar") {
                    setCalendarRefreshToken((current) => current + 1);
                }
                reloadTasks();
                if (source === "form") {
                    closeDetailPanel();
                }
            } catch (error) {
                if (source === "calendar") {
                    pendingTaskEdit?.revert?.();
                    setPendingTaskEdit(null);
                }
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to save task",
                );
            } finally {
                setIsEditSaving(false);
            }
        },
        [closeDetailPanel, pendingTaskEdit, reloadTasks],
    );

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
            const task = tasks.find((item) => item.id === dropInfo.event.id);
            const updates = getCalendarEventScheduleUpdate(dropInfo.event);

            if (task && shouldPromptRecurringTaskEdit(task, updates)) {
                setPendingTaskEdit({
                    taskId: task.id,
                    updates,
                    source: "calendar",
                    revert: dropInfo.revert,
                });
                return;
            }

            try {
                await updateTask(dropInfo.event.id, updates);
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
        [reloadTasks, tasks],
    );

    const handleEventResize = useCallback(
        async (resizeInfo: EventResizeDoneArg) => {
            const task = tasks.find((item) => item.id === resizeInfo.event.id);
            const updates = getCalendarEventScheduleUpdate(resizeInfo.event);

            if (task && shouldPromptRecurringTaskEdit(task, updates)) {
                setPendingTaskEdit({
                    taskId: task.id,
                    updates,
                    source: "calendar",
                    revert: resizeInfo.revert,
                });
                return;
            }

            try {
                await updateTask(resizeInfo.event.id, updates);
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
        [reloadTasks, tasks],
    );

    const handleExternalTaskDrop = useCallback(
        async (dropInfo: DropArg) => {
            const taskId = dropInfo.draggedEl.getAttribute("data-task-id");
            const task = tasksRef.current.find((item) => item.id === taskId);
            if (!task) {
                return;
            }

            const updates = getCalendarDropScheduleUpdate(task, dropInfo);

            if (shouldPromptRecurringTaskEdit(task, updates)) {
                setPendingTaskEdit({
                    taskId: task.id,
                    updates,
                    source: "calendar",
                });
                return;
            }

            try {
                const updatedTask = await updateTask(task.id, updates);
                replaceTaskInState(updatedTask);
                setCalendarRefreshToken((current) => current + 1);
            } catch (error) {
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to schedule task",
                );
            }
        },
        [replaceTaskInState],
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
                list_id: selectedListIdForForms,
                scheduled_start: dateToDateTimeLocalValue(start),
                scheduled_end: dateToDateTimeLocalValue(end),
            });
            window.setTimeout(() => {
                createFormRef.current?.scrollIntoView?.({
                    block: "nearest",
                    behavior: "smooth",
                });
                titleInputRef.current?.focus();
            }, 0);
        },
        [selectedListIdForForms],
    );

    const openUnscheduledCreatePanel = useCallback(() => {
        setFormError(null);
        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setIsAddingCategory(false);
        setContextMenu(null);
        setDetailPanelMode("create");
        setSelectedTaskId(null);
        setFormState({
            ...initialFormState,
            list_id: selectedListIdForForms,
        });
        window.setTimeout(() => {
            createFormRef.current?.scrollIntoView?.({
                block: "nearest",
                behavior: "smooth",
            });
            titleInputRef.current?.focus();
        }, 0);
    }, [selectedListIdForForms]);

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

    const moveTaskRowDuringDrag = useCallback(
        (
            taskId: string,
            clientX: number,
            clientY: number,
            buttons: number,
            preventDefault: () => void,
        ) => {
            const pointerState = taskRowPointerStateRef.current;
            if (!pointerState || pointerState.taskId !== taskId) {
                return;
            }

            const movedEnough =
                Math.abs(clientX - pointerState.startX) > 6 ||
                Math.abs(clientY - pointerState.startY) > 6;
            if (movedEnough || (activeView === "unscheduled" && buttons === 1)) {
                pointerState.dragging = true;
            }

            if (
                activeView !== "unscheduled" ||
                !pointerState.dragging
            ) {
                return;
            }

            preventDefault();
            draggedUnscheduledTaskIdRef.current = taskId;
            suppressTaskRowClickRef.current = taskId;

            const dropTarget = getTaskReorderTarget(taskId, clientY);
            if (!dropTarget) {
                return;
            }

            setUnscheduledOrder((current) =>
                moveTaskIdRelative(
                    current,
                    taskId,
                    dropTarget.targetTaskId,
                    dropTarget.position,
                ),
            );
            pointerState.startX = clientX;
            pointerState.startY = clientY;
        },
        [activeView],
    );

    const handleTaskRowPointerMove = useCallback(
        (taskId: string, event: TaskRowDragEvent) => {
            if (isInteractiveTaskRowTarget(event.target)) {
                return;
            }

            moveTaskRowDuringDrag(
                taskId,
                event.clientX,
                event.clientY,
                event.buttons,
                () => event.preventDefault(),
            );
        },
        [moveTaskRowDuringDrag],
    );

    const finishTaskRowPointerInteraction = useCallback(
        (taskId: string, event?: TaskRowDragEvent) => {
            const pointerState = taskRowPointerStateRef.current;
            if (!pointerState || pointerState.taskId !== taskId) {
                return;
            }

            taskRowWindowDragCleanupRef.current?.();
            if (event && "pointerId" in event) {
                event.currentTarget.releasePointerCapture?.(event.pointerId);
            }
            draggedUnscheduledTaskIdRef.current = null;
            suppressTaskRowClickRef.current = pointerState.dragging
                ? taskId
                : null;
            taskRowPointerStateRef.current = null;
        },
        [],
    );

    const handleTaskRowPointerDown = useCallback(
        (
            taskId: string,
            event: TaskRowDragEvent,
            trackWindowDrag = false,
        ) => {
            if (typeof event.button === "number" && event.button !== 0) {
                return;
            }

            taskRowPointerStateRef.current = {
                taskId,
                startX: event.clientX,
                startY: event.clientY,
                dragging: false,
            };
            suppressTaskRowClickRef.current = null;
            if (
                activeView === "unscheduled" &&
                !isInteractiveTaskRowTarget(event.target)
            ) {
                if ("pointerId" in event) {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                }

                if (trackWindowDrag) {
                    taskRowWindowDragCleanupRef.current?.();
                    const handleMouseMove = (moveEvent: MouseEvent) => {
                        moveTaskRowDuringDrag(
                            taskId,
                            moveEvent.clientX,
                            moveEvent.clientY,
                            moveEvent.buttons,
                            () => moveEvent.preventDefault(),
                        );
                    };
                    const handleMouseUp = () => {
                        finishTaskRowPointerInteraction(taskId);
                    };

                    window.addEventListener("mousemove", handleMouseMove);
                    window.addEventListener("mouseup", handleMouseUp, {
                        once: true,
                    });
                    taskRowWindowDragCleanupRef.current = () => {
                        window.removeEventListener("mousemove", handleMouseMove);
                        window.removeEventListener("mouseup", handleMouseUp);
                        taskRowWindowDragCleanupRef.current = null;
                    };
                }
            }
        },
        [
            activeView,
            finishTaskRowPointerInteraction,
            moveTaskRowDuringDrag,
        ],
    );

    const moveUnscheduledTask = useCallback(
        (taskId: string, offset: -1 | 1) => {
            if (activeView !== "unscheduled") {
                return;
            }

            setUnscheduledOrder((current) =>
                moveTaskIdByOffset(current, taskId, offset),
            );
        },
        [activeView],
    );

    const moveUnscheduledTaskToTop = useCallback(
        (taskId: string) => {
            if (activeView !== "unscheduled") {
                return;
            }

            setUnscheduledOrder((current) => moveTaskIdToTop(current, taskId));
        },
        [activeView],
    );

    const promptRecurringTaskDelete = useCallback(
        (task: ScheduledTask, source: PendingTaskDeleteState["source"]) => {
            if (!task.recurrence_series_id && !task.recurrence_rule) {
                return false;
            }

            setContextMenu(null);
            setPendingTaskDelete({
                taskId: task.id,
                source,
            });
            return true;
        },
        [],
    );

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
            hasIncompleteDateTimeValue(formState.scheduled_start) ||
            hasIncompleteDateTimeValue(formState.scheduled_end)
        ) {
            setFormError("Start and end must include both date and time");
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

        if (formState.recurrence_frequency && !formState.scheduled_start) {
            setFormError("Recurring tasks require a start time");
            return;
        }

        if (
            formState.recurrence_frequency &&
            parsePositiveIntegerOrZero(formState.recurrence_interval) < 1
        ) {
            setFormError("Recurrence interval must be at least 1");
            return;
        }

        setIsSaving(true);

        try {
            const notificationSettings =
                getNotificationSettings(formState);
            await createTask({
                title: formState.title.trim(),
                list_id: formState.list_id || null,
                notes: formState.notes.trim() || null,
                scheduled_start: toIsoOrNull(formState.scheduled_start),
                scheduled_end: toIsoOrNull(formState.scheduled_end),
                recurrence_rule: buildRecurrenceRule(formState),
                notification_enabled: notificationSettings.enabled,
                notification_offset_minutes:
                    notificationSettings.offsetMinutes,
                notification_channel: notificationSettings.channel,
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
            hasIncompleteDateTimeValue(editState.scheduled_start) ||
            hasIncompleteDateTimeValue(editState.scheduled_end)
        ) {
            setFormError("Start and end must include both date and time");
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

        if (editState.recurrence_frequency && !editState.scheduled_start) {
            setFormError("Recurring tasks require a start time");
            return;
        }

        if (
            editState.recurrence_frequency &&
            parsePositiveIntegerOrZero(editState.recurrence_interval) < 1
        ) {
            setFormError("Recurrence interval must be at least 1");
            return;
        }

        const updates = buildTaskUpdates(selectedTask, editState);
        if (Object.keys(updates).length === 0) {
            closeDetailPanel();
            return;
        }

        if (shouldPromptRecurringTaskEdit(selectedTask, updates)) {
            setPendingTaskEdit({
                taskId: selectedTask.id,
                updates,
                source: "form",
            });
            return;
        }

        await runTaskUpdate(selectedTask.id, updates, "single", "form");
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

    useEffect(() => {
        if (!isCategoryMenuOpen) {
            resetCategoryEditor();
        }
    }, [isCategoryMenuOpen, resetCategoryEditor]);

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

    const handleDeleteEditingTaskList = async () => {
        if (!editingTaskListId) {
            return;
        }

        setFormError(null);
        setIsDeleting(true);

        try {
            await deleteTaskList(editingTaskListId);
            setActiveListId((currentId) =>
                currentId === editingTaskListId ? null : currentId,
            );
            setSelectedTaskId((currentId) => {
                const selected = tasks.find((task) => task.id === currentId);
                return selected?.list_id === editingTaskListId
                    ? null
                    : currentId;
            });
            resetCategoryEditor();
            setIsCategoryMenuOpen(false);
            void refreshTaskLists();
            reloadTasks();
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to delete category",
            );
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDeleteSelectedTask = async () => {
        if (!selectedTask) {
            return;
        }

        if (promptRecurringTaskDelete(selectedTask, "detail")) {
            return;
        }

        await runTaskDelete(selectedTask.id, "detail");
    };

    const handleDeleteFromMenu = async () => {
        if (!contextMenu) {
            return;
        }

        try {
            if (contextMenu.kind === "task") {
                const task = tasks.find((item) => item.id === contextMenu.id);
                if (!task) {
                    throw new Error("Task not found");
                }

                if (promptRecurringTaskDelete(task, "menu")) {
                    return;
                }

                await runTaskDelete(contextMenu.id, "menu");
            } else {
                setFormError(null);
                setIsDeleting(true);
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
                setContextMenu(null);
                reloadTasks();
            }
        } catch (error) {
            setFormError(
                error instanceof Error ? error.message : "Unable to delete",
            );
        } finally {
            if (contextMenu.kind === "category") {
                setIsDeleting(false);
            }
        }
    };

    const handleSaveWebhookSettings = async (
        event: FormEvent<HTMLFormElement>,
    ) => {
        event.preventDefault();
        setFormError(null);
        setWebhookTestMessage(null);
        setIsWebhookSettingsSaving(true);

        try {
            const savedSettings = await updateSettings({
                discord_webhook_url:
                    webhookSettingsDraft.discord_webhook_url.trim() || null,
                discord_message_template:
                    webhookSettingsDraft.discord_message_template.trim() ||
                    null,
            });
            setWebhookSettings(savedSettings);
            setWebhookSettingsDraft({
                discord_webhook_url: savedSettings.discord_webhook_url ?? "",
                discord_message_template:
                    savedSettings.discord_message_template ?? "",
            });
            setIsWebhookSettingsOpen(false);
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to save webhook settings",
            );
        } finally {
            setIsWebhookSettingsSaving(false);
        }
    };

    const handleTestWebhookSettings = async () => {
        setFormError(null);
        setWebhookTestMessage(null);
        setIsWebhookSettingsTesting(true);

        try {
            const result = await testSettings({
                discord_webhook_url:
                    webhookSettingsDraft.discord_webhook_url.trim() || null,
                discord_message_template:
                    webhookSettingsDraft.discord_message_template.trim() ||
                    null,
            });
            setWebhookTestMessage(result.message);
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to test webhook settings",
            );
        } finally {
            setIsWebhookSettingsTesting(false);
        }
    };

    const openWebhookSettings = () => {
        closeDetailPanel();
        setIsWebhookSettingsOpen(true);
        setWebhookTestMessage(null);
        setWebhookSettingsDraft({
            discord_webhook_url: webhookSettings?.discord_webhook_url ?? "",
            discord_message_template:
                webhookSettings?.discord_message_template ?? "",
        });
        setIsSettingsMenuOpen(false);
    };

    const toggleSidebar = () => {
        setIsSettingsMenuOpen(false);
        setContextMenu(null);
        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setIsSidebarOpen((current) => !current);
    };

    const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
        const shellRect = appShellRef.current?.getBoundingClientRect();
        if (!shellRect) {
            return;
        }

        const startX = event.clientX;
        const startWidth = sidebarWidth;

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const currentShellWidth =
                appShellRef.current?.getBoundingClientRect().width ??
                shellRect.width;
            const maxSidebarWidth = Math.max(
                minSidebarWidth,
                currentShellWidth - minCalendarWidth - 12,
            );
            setSidebarWidth(
                clampNumber(
                    startWidth + (moveEvent.clientX - startX),
                    minSidebarWidth,
                    maxSidebarWidth,
                ),
            );
        };

        const handlePointerUp = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
    };

    const appShellStyle: CSSProperties | undefined = isSidebarOpen
        ? ({ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties)
        : undefined;

    return (
        <main
            ref={appShellRef}
            className={`app-shell ${themeMode} ${isSidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`}
            style={appShellStyle}
            onClick={() => {
                setIsSettingsMenuOpen(false);
                setContextMenu(null);
                setIsViewMenuOpen(false);
                setIsCategoryMenuOpen(false);
            }}
        >
            {isSidebarOpen && (
                <aside className="task-sidebar">
                    <div className="sidebar-header">
                    <p className="eyebrow">Scheduled Task Calendar</p>
                    <div className="sidebar-header-actions">
                        <div
                            className="settings-menu"
                            onClick={(event) => event.stopPropagation()}
                        >
                                <button
                                    type="button"
                                    className="theme-toggle settings-toggle"
                                    aria-label="Settings"
                                    aria-expanded={isSettingsMenuOpen}
                                    onClick={() =>
                                        setIsSettingsMenuOpen(
                                            (current) => !current,
                                        )
                                    }
                                >
                                    <span aria-hidden="true">☰</span>
                                </button>
                                {isSettingsMenuOpen && (
                                    <div className="settings-menu-panel">
                                        <button
                                            type="button"
                                            className="filter-option"
                                            onClick={() => {
                                                setThemeMode(
                                                    themeMode === "dark"
                                                        ? "light"
                                                        : "dark",
                                                );
                                                setIsSettingsMenuOpen(false);
                                            }}
                                        >
                                            Switch to{" "}
                                            {themeMode === "dark"
                                                ? "light"
                                                : "dark"}{" "}
                                            mode
                                        </button>
                                        <button
                                            type="button"
                                            className="filter-option"
                                            onClick={openWebhookSettings}
                                        >
                                            Webhook settings
                                        </button>
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            className="theme-toggle sidebar-toggle"
                            aria-label="Hide sidebar"
                            onClick={toggleSidebar}
                        >
                            <span aria-hidden="true">⇤</span>
                        </button>
                    </div>
                </div>

                    {!detailPanelMode && (
                        <section className="filter-section">
                            {isWebhookSettingsOpen && (
                                <form
                                    className="task-form webhook-settings-form"
                                    onSubmit={(event) =>
                                        void handleSaveWebhookSettings(event)
                                    }
                                >
                                    <label>
                                        <span>Webhook URL</span>
                                        <input
                                            type="text"
                                            value={
                                                webhookSettingsDraft.discord_webhook_url
                                            }
                                            onChange={(event) =>
                                                setWebhookSettingsDraft(
                                                    (current) => ({
                                                        ...current,
                                                        discord_webhook_url:
                                                            event.target.value,
                                                    }),
                                                )
                                            }
                                        />
                                    </label>
                                    <label>
                                        <span>Message format</span>
                                        <textarea
                                            value={
                                                webhookSettingsDraft.discord_message_template
                                            }
                                            onChange={(event) =>
                                                setWebhookSettingsDraft(
                                                    (current) => ({
                                                        ...current,
                                                        discord_message_template:
                                                            event.target.value,
                                                    }),
                                                )
                                            }
                                            rows={4}
                                        />
                                    </label>
                                    <p className="muted">
                                        Use placeholders like {`{title}`},{" "}
                                        {`{when}`}, {`{notes}`}, and{" "}
                                        {`{app_url}`}.
                                    </p>
                                    {webhookTestMessage && (
                                        <p className="webhook-test-success">
                                            {webhookTestMessage}
                                        </p>
                                    )}
                                    <div className="task-form-actions">
                                        <button
                                            type="submit"
                                            disabled={
                                                isWebhookSettingsSaving ||
                                                isWebhookSettingsTesting
                                            }
                                        >
                                            {isWebhookSettingsSaving
                                                ? "Saving..."
                                                : "Save"}
                                        </button>
                                        <button
                                            type="button"
                                            className="warning-button"
                                            disabled={
                                                isWebhookSettingsSaving ||
                                                isWebhookSettingsTesting
                                            }
                                            onClick={() =>
                                                void handleTestWebhookSettings()
                                            }
                                        >
                                            {isWebhookSettingsTesting
                                                ? "Testing..."
                                                : "Test"}
                                        </button>
                                        <button
                                            type="button"
                                            className="ghost-button"
                                            disabled={
                                                isWebhookSettingsSaving ||
                                                isWebhookSettingsTesting
                                            }
                                            onClick={() => {
                                                setWebhookSettingsDraft({
                                                    discord_webhook_url:
                                                        webhookSettings?.discord_webhook_url ??
                                                        "",
                                                    discord_message_template:
                                                        webhookSettings?.discord_message_template ??
                                                        "",
                                                });
                                                setWebhookTestMessage(null);
                                                setIsWebhookSettingsOpen(false);
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>
                            )}
                        </section>
                    )}

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
                                                        setIsViewMenuOpen(
                                                            false,
                                                        );
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
                                                    setIsCategoryMenuOpen(
                                                        false,
                                                    );
                                                }}
                                            >
                                                <span
                                                    className="category-swatch category-swatch-empty"
                                                    aria-hidden="true"
                                                />
                                                <span>All</span>
                                            </button>
                                            <button
                                                type="button"
                                                className={`filter-option ${activeListId === unclassifiedCategoryFilter ? "active" : ""}`}
                                                onClick={() => {
                                                    setActiveListId(
                                                        unclassifiedCategoryFilter,
                                                    );
                                                    setIsCategoryMenuOpen(
                                                        false,
                                                    );
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
                                                    className={`filter-option-row ${activeListId === taskList.id ? "active" : ""}`}
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
                                                        onContextMenu={(
                                                            event,
                                                        ) => {
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
                                                        <span>
                                                            {taskList.name}
                                                        </span>
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
                                                        <span
                                                            aria-hidden="true"
                                                            className="filter-option-action-icon"
                                                        >
                                                            ⚙
                                                        </span>
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
                                                        <div className="category-inline-fields">
                                                            <input
                                                                type="color"
                                                                value={
                                                                    editingListColor
                                                                }
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setEditingListColor(
                                                                        event
                                                                            .target
                                                                            .value,
                                                                    )
                                                                }
                                                                aria-label="Edit category color"
                                                            />
                                                            <input
                                                                ref={
                                                                    categoryNameInputRef
                                                                }
                                                                type="text"
                                                                value={
                                                                    editingListName
                                                                }
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setEditingListName(
                                                                        event
                                                                            .target
                                                                            .value,
                                                                    )
                                                                }
                                                                placeholder="Category name"
                                                                aria-label="Edit category name"
                                                            />
                                                        </div>
                                                        <div className="category-inline-actions">
                                                            <button type="submit">
                                                                Save
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="danger-button"
                                                                disabled={
                                                                    isDeleting
                                                                }
                                                                onClick={() =>
                                                                    void handleDeleteEditingTaskList()
                                                                }
                                                            >
                                                                {isDeleting
                                                                    ? "Deleting..."
                                                                    : "Delete"}
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
                                                        <div className="category-inline-fields">
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
                                                                type="text"
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
                                                        </div>
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
                                                        Add
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {activeView === "unscheduled" && (
                                <button
                                    type="button"
                                    className="sidebar-create-task-button"
                                    aria-label="Create task"
                                    onClick={openUnscheduledCreatePanel}
                                >
                                    Create
                                </button>
                            )}
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
                                <div className="task-detail-header-actions">
                                    {detailPanelMode === "create" ? (
                                        <button
                                            type="submit"
                                            form="task-create-form"
                                            className="floating-panel-action floating-panel-save"
                                            disabled={isSaving}
                                        >
                                            {isSaving ? "Saving..." : "Save"}
                                        </button>
                                    ) : selectedTask && editState ? (
                                        <>
                                            <button
                                                type="submit"
                                                form="task-edit-form"
                                                className="floating-panel-action floating-panel-save"
                                                disabled={isEditSaving}
                                            >
                                                {isEditSaving
                                                    ? "Saving..."
                                                    : "Save"}
                                            </button>
                                            <button
                                                type="button"
                                                className="floating-panel-action floating-panel-delete"
                                                disabled={isDeleting}
                                                onClick={() =>
                                                    void handleDeleteSelectedTask()
                                                }
                                            >
                                                {isDeleting
                                                    ? "Deleting..."
                                                    : "Delete"}
                                            </button>
                                        </>
                                    ) : null}
                                    <button
                                        type="button"
                                        className="floating-panel-action"
                                        onClick={closeDetailPanel}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>

                            {detailPanelMode === "create" ? (
                                <form
                                    id="task-create-form"
                                    ref={createFormRef}
                                    className="task-form active-form"
                                    onSubmit={(event) =>
                                        void handleSubmit(event)
                                    }
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
                                        <LabeledDateTimeInput
                                            label="Start"
                                            value={formState.scheduled_start}
                                            onChange={(value) =>
                                                setFormState({
                                                    ...formState,
                                                    scheduled_start: value,
                                                })
                                            }
                                        />
                                        <LabeledDateTimeInput
                                            label="End"
                                            value={formState.scheduled_end}
                                            onChange={(value) =>
                                                setFormState({
                                                    ...formState,
                                                    scheduled_end: value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="task-form-row">
                                        <div className="task-form-recurring-inline">
                                            <div className="task-form-recurring-top">
                                                <label>
                                                    <span>Repeat</span>
                                                    <select
                                                        value={
                                                            formState.recurrence_frequency
                                                        }
                                                        onChange={(event) =>
                                                            setFormState({
                                                                ...formState,
                                                                recurrence_frequency:
                                                                    event.target
                                                                        .value as RecurrenceFrequency,
                                                            })
                                                        }
                                                    >
                                                        <option value="">
                                                            None
                                                        </option>
                                                        <option value="DAILY">
                                                            Daily
                                                        </option>
                                                        <option value="WEEKLY">
                                                            Weekly
                                                        </option>
                                                        <option value="MONTHLY">
                                                            Monthly
                                                        </option>
                                                        <option value="YEARLY">
                                                            Yearly
                                                        </option>
                                                    </select>
                                                </label>
                                                {formState.recurrence_frequency && (
                                                    <LabeledInput
                                                        label="Every"
                                                        type="number"
                                                        min={1}
                                                        step={1}
                                                        value={
                                                            formState.recurrence_interval
                                                        }
                                                        onChange={(value) =>
                                                            setFormState({
                                                                ...formState,
                                                                recurrence_interval:
                                                                    value,
                                                            })
                                                        }
                                                    />
                                                )}
                                            </div>
                                            {formState.recurrence_frequency && (
                                                <div className="task-form-recurring-bottom">
                                                    <LabeledInput
                                                        label="Until"
                                                        type="date"
                                                        value={
                                                            formState.recurrence_until
                                                        }
                                                        onChange={(value) =>
                                                            setFormState({
                                                                ...formState,
                                                                recurrence_until:
                                                                    value,
                                                            })
                                                        }
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="task-form-row task-form-row-split">
                                        <label>
                                            <span>Notification</span>
                                            <select
                                                value={
                                                    formState.notification_unit
                                                }
                                                onChange={(event) =>
                                                    setFormState({
                                                        ...formState,
                                                        notification_unit:
                                                            event.target
                                                                .value as NotificationUnit,
                                                    })
                                                }
                                            >
                                                {notificationUnits.map(
                                                    (unit) => (
                                                        <option
                                                            key={unit.id}
                                                            value={unit.id}
                                                        >
                                                            {unit.label}
                                                        </option>
                                                    ),
                                                )}
                                            </select>
                                        </label>
                                        {formState.notification_unit ? (
                                            <LabeledInput
                                                label="Before"
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={
                                                    formState.notification_offset_value
                                                }
                                                onChange={(value) =>
                                                    setFormState({
                                                        ...formState,
                                                        notification_offset_value:
                                                            value,
                                                    })
                                                }
                                            />
                                        ) : (
                                            <div />
                                        )}
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
                                </form>
                            ) : selectedTask && editState ? (
                                <form
                                    id="task-edit-form"
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
                                        <LabeledDateTimeInput
                                            label="Start"
                                            value={editState.scheduled_start}
                                            onChange={(value) =>
                                                setEditState({
                                                    ...editState,
                                                    scheduled_start: value,
                                                })
                                            }
                                        />
                                        <LabeledDateTimeInput
                                            label="End"
                                            value={editState.scheduled_end}
                                            onChange={(value) =>
                                                setEditState({
                                                    ...editState,
                                                    scheduled_end: value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="task-form-row">
                                        <div className="task-form-recurring-inline">
                                            <div className="task-form-recurring-top">
                                                <label>
                                                    <span>Repeat</span>
                                                    <select
                                                        value={
                                                            editState.recurrence_frequency
                                                        }
                                                        onChange={(event) =>
                                                            setEditState({
                                                                ...editState,
                                                                recurrence_frequency:
                                                                    event.target
                                                                        .value as RecurrenceFrequency,
                                                            })
                                                        }
                                                    >
                                                        <option value="">
                                                            None
                                                        </option>
                                                        <option value="DAILY">
                                                            Daily
                                                        </option>
                                                        <option value="WEEKLY">
                                                            Weekly
                                                        </option>
                                                        <option value="MONTHLY">
                                                            Monthly
                                                        </option>
                                                        <option value="YEARLY">
                                                            Yearly
                                                        </option>
                                                    </select>
                                                </label>
                                                {editState.recurrence_frequency && (
                                                    <LabeledInput
                                                        label="Every"
                                                        type="number"
                                                        min={1}
                                                        step={1}
                                                        value={
                                                            editState.recurrence_interval
                                                        }
                                                        onChange={(value) =>
                                                            setEditState({
                                                                ...editState,
                                                                recurrence_interval:
                                                                    value,
                                                            })
                                                        }
                                                    />
                                                )}
                                            </div>
                                            {editState.recurrence_frequency && (
                                                <div className="task-form-recurring-bottom">
                                                    <LabeledInput
                                                        label="Until"
                                                        type="date"
                                                        value={
                                                            editState.recurrence_until
                                                        }
                                                        onChange={(value) =>
                                                            setEditState({
                                                                ...editState,
                                                                recurrence_until:
                                                                    value,
                                                            })
                                                        }
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="task-form-row task-form-row-split">
                                        <label>
                                            <span>Notification</span>
                                            <select
                                                value={
                                                    editState.notification_unit
                                                }
                                                onChange={(event) =>
                                                    setEditState({
                                                        ...editState,
                                                        notification_unit:
                                                            event.target
                                                                .value as NotificationUnit,
                                                    })
                                                }
                                            >
                                                {notificationUnits.map(
                                                    (unit) => (
                                                        <option
                                                            key={unit.id}
                                                            value={unit.id}
                                                        >
                                                            {unit.label}
                                                        </option>
                                                    ),
                                                )}
                                            </select>
                                        </label>
                                        {editState.notification_unit ? (
                                            <LabeledInput
                                                label="Before"
                                                type="number"
                                                min={0}
                                                step={1}
                                                value={
                                                    editState.notification_offset_value
                                                }
                                                onChange={(value) =>
                                                    setEditState({
                                                        ...editState,
                                                        notification_offset_value:
                                                            value,
                                                    })
                                                }
                                            />
                                        ) : (
                                            <div />
                                        )}
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
                                                            event.target
                                                                .checked,
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
                                </form>
                            ) : (
                                <p className="muted">
                                    Select a task to edit it.
                                </p>
                            )}
                        </section>
                    )}

                    {!detailPanelMode && (
                        <section
                            ref={taskListRef}
                            className="task-list"
                            aria-label={`${activeView} tasks`}
                        >
                            {taskState.status === "loading" && (
                                <p className="muted">Loading tasks...</p>
                            )}
                            {taskState.status === "error" && (
                                <p className="form-error">
                                    {taskState.message}
                                </p>
                            )}
                            {taskState.status === "ready" &&
                                orderedVisibleTasks.length === 0 && (
                                    <p className="muted">
                                        No tasks in this view.
                                    </p>
                                )}
                            {orderedVisibleTasks.map((task, taskIndex) => (
                                <div
                                    key={task.id}
                                    role="button"
                                    tabIndex={0}
                                    data-task-id={task.id}
                                    className={`task-row ${activeView === "unscheduled" ? "task-row--reorderable" : ""} ${selectedTaskId === task.id ? "selected" : ""}`}
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
                                    onPointerDown={(event) =>
                                        handleTaskRowPointerDown(task.id, event)
                                    }
                                    onMouseDown={(event) =>
                                        handleTaskRowPointerDown(
                                            task.id,
                                            event,
                                            true,
                                        )
                                    }
                                    onSelectStart={
                                        activeView === "unscheduled"
                                            ? (event) => event.preventDefault()
                                            : undefined
                                    }
                                    onPointerMove={(event) =>
                                        handleTaskRowPointerMove(task.id, event)
                                    }
                                    onMouseMove={(event) =>
                                        handleTaskRowPointerMove(task.id, event)
                                    }
                                    onPointerUp={(event) =>
                                        finishTaskRowPointerInteraction(
                                            task.id,
                                            event,
                                        )
                                    }
                                    onMouseUp={(event) =>
                                        finishTaskRowPointerInteraction(
                                            task.id,
                                            event,
                                        )
                                    }
                                    onPointerCancel={(event) => {
                                        event.currentTarget.releasePointerCapture?.(
                                            event.pointerId,
                                        );
                                        draggedUnscheduledTaskIdRef.current =
                                            null;
                                        taskRowPointerStateRef.current = null;
                                        suppressTaskRowClickRef.current = null;
                                    }}
                                    onClick={() => {
                                        if (
                                            suppressTaskRowClickRef.current ===
                                            task.id
                                        ) {
                                            suppressTaskRowClickRef.current =
                                                null;
                                            return;
                                        }
                                        setDetailPanelMode("edit");
                                        setSelectedTaskId(task.id);
                                    }}
                                    onKeyDown={(event) => {
                                        if (
                                            event.target !==
                                                event.currentTarget ||
                                            (event.key !== "Enter" &&
                                                event.key !== " ")
                                        ) {
                                            return;
                                        }

                                        event.preventDefault();
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
                                        onClick={(event) =>
                                            event.stopPropagation()
                                        }
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
                                            {formatTaskMeta(task)}
                                        </span>
                                    </span>
                                    {activeView === "unscheduled" && (
                                        <span className="task-order-actions task-order-actions--aligned">
                                            <button
                                                type="button"
                                                className="task-order-button task-order-button-top"
                                                aria-label={`Move ${task.title} to top`}
                                                disabled={taskIndex === 0}
                                                onPointerDown={(event) =>
                                                    event.stopPropagation()
                                                }
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    moveUnscheduledTaskToTop(
                                                        task.id,
                                                    );
                                                }}
                                            >
                                                ⇡
                                            </button>
                                            <button
                                                type="button"
                                                className="task-order-button"
                                                aria-label={`Move ${task.title} up`}
                                                disabled={taskIndex === 0}
                                                onPointerDown={(event) =>
                                                    event.stopPropagation()
                                                }
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    moveUnscheduledTask(
                                                        task.id,
                                                        -1,
                                                    );
                                                }}
                                            >
                                                ↑
                                            </button>
                                            <button
                                                type="button"
                                                className="task-order-button"
                                                aria-label={`Move ${task.title} down`}
                                                disabled={
                                                    taskIndex ===
                                                    orderedVisibleTasks.length -
                                                        1
                                                }
                                                onPointerDown={(event) =>
                                                    event.stopPropagation()
                                                }
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    moveUnscheduledTask(
                                                        task.id,
                                                        1,
                                                    );
                                                }}
                                            >
                                                ↓
                                            </button>
                                        </span>
                                    )}
                                </div>
                            ))}
                        </section>
                    )}
                </aside>
            )}
            {isSidebarOpen && (
                <div
                    className="sidebar-resizer"
                    role="separator"
                    aria-label="Resize sidebar"
                    aria-orientation="vertical"
                    onPointerDown={handleSidebarResizeStart}
                />
            )}

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
                        {!isSidebarOpen && (
                            <button
                                type="button"
                                className="calendar-toolbar-button sidebar-reopen-button"
                                aria-label="⇥"
                                onClick={toggleSidebar}
                            >
                                ⇥
                            </button>
                        )}
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
                    key={`${calendarView}-${calendarRefreshToken}`}
                    ref={calendarRef}
                    plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                    initialView={calendarView}
                    initialDate={calendarDate}
                    headerToolbar={false}
                    events={events}
                    eventTimeFormat={{
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                    }}
                    eventContent={renderEventContent}
                    eventClick={handleEventClick}
                    eventDidMount={handleEventDidMount}
                    dateClick={handleDateClick}
                    datesSet={handleDatesSet}
                    eventDrop={handleEventDrop}
                    eventResize={handleEventResize}
                    drop={handleExternalTaskDrop}
                    slotLabelFormat={{
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                    }}
                    select={handleDateSelect}
                    editable
                    droppable
                    selectable
                    stickyFooterScrollbar={false}
                    eventResizableFromStart
                    nowIndicator
                    slotMinTime="00:00:00"
                    slotMaxTime="24:00:00"
                    height="100%"
                />
            </section>

            {pendingDeleteTask && (
                <div
                    className="dialog-backdrop"
                    role="presentation"
                    onClick={() => !isDeleting && setPendingTaskDelete(null)}
                >
                    <div
                        className="choice-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-recurring-task-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h2 id="delete-recurring-task-title">
                            Delete recurring task
                        </h2>
                        <p className="muted">
                            Choose how to delete this recurring task.
                        </p>
                        <div className="choice-dialog-actions">
                            <button
                                type="button"
                                className="danger-button"
                                disabled={isDeleting}
                                onClick={() =>
                                    void runTaskDelete(
                                        pendingDeleteTask.id,
                                        pendingTaskDelete?.source ?? "detail",
                                        "single",
                                    )
                                }
                            >
                                {isDeleting
                                    ? "Deleting..."
                                    : "Delete only this"}
                            </button>
                            <button
                                type="button"
                                className="danger-button"
                                disabled={isDeleting}
                                onClick={() =>
                                    void runTaskDelete(
                                        pendingDeleteTask.id,
                                        pendingTaskDelete?.source ?? "detail",
                                        "following",
                                    )
                                }
                            >
                                {isDeleting
                                    ? "Deleting..."
                                    : "Delete the recurrsive"}
                            </button>
                            <button
                                type="button"
                                className="secondary-button"
                                disabled={isDeleting}
                                onClick={() => setPendingTaskDelete(null)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingTaskEdit && (
                <div
                    className="dialog-backdrop"
                    role="presentation"
                    onClick={() => {
                        if (isEditSaving) {
                            return;
                        }
                        if (pendingTaskEdit.source === "calendar") {
                            pendingTaskEdit.revert?.();
                        }
                        setPendingTaskEdit(null);
                    }}
                >
                    <div
                        className="choice-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="edit-recurring-task-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h2 id="edit-recurring-task-title">
                            Edit recurring task
                        </h2>
                        <p className="muted">
                            Choose whether to edit only this task or all
                            recurring tasks.
                        </p>
                        <div className="choice-dialog-actions">
                            <button
                                type="button"
                                disabled={isEditSaving}
                                onClick={() =>
                                    void runTaskUpdate(
                                        pendingTaskEdit.taskId,
                                        pendingTaskEdit.updates,
                                        "single",
                                        pendingTaskEdit.source,
                                    )
                                }
                            >
                                {isEditSaving ? "Saving..." : "Edit only this"}
                            </button>
                            <button
                                type="button"
                                disabled={isEditSaving}
                                onClick={() =>
                                    void runTaskUpdate(
                                        pendingTaskEdit.taskId,
                                        pendingTaskEdit.updates,
                                        "series",
                                        pendingTaskEdit.source,
                                    )
                                }
                            >
                                {isEditSaving
                                    ? "Saving..."
                                    : "Edit all recurring tasks"}
                            </button>
                            <button
                                type="button"
                                className="secondary-button"
                                disabled={isEditSaving}
                                onClick={() => {
                                    if (pendingTaskEdit.source === "calendar") {
                                        pendingTaskEdit.revert?.();
                                    }
                                    setPendingTaskEdit(null);
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
    min?: number;
    step?: number;
};

function LabeledInput({
    label,
    value,
    onChange,
    inputRef,
    type = "text",
    required = false,
    min,
    step,
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
                min={min}
                step={step}
            />
        </label>
    );
}

type LabeledDateTimeInputProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
};

function LabeledDateTimeInput({
    label,
    value,
    onChange,
}: LabeledDateTimeInputProps) {
    const { datePart, timePart } = splitDateTimeInputValue(value);

    return (
        <label className="task-form-datetime">
            <span>{label}</span>
            <div className="task-form-datetime-row">
                <input
                    type="date"
                    value={datePart}
                    onChange={(event) =>
                        onChange(
                            combineDateTimeInputValue(
                                event.target.value,
                                timePart,
                            ),
                        )
                    }
                    aria-label={`${label} date`}
                />
                <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-2][0-9]:[0-5][0-9]"
                    placeholder="HH:mm"
                    maxLength={5}
                    value={timePart}
                    onChange={(event) =>
                        onChange(
                            combineDateTimeInputValue(
                                datePart,
                                sanitizeTimeInputValue(event.target.value),
                            ),
                        )
                    }
                    aria-label={`${label} time`}
                />
            </div>
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
                <option value="">None</option>
                {options.map((option) => (
                    <option key={option.id} value={option.id}>
                        {option.name}
                    </option>
                ))}
            </select>
        </label>
    );
}

function buildTaskUpdates(
    selectedTask: ScheduledTask,
    editState: EditFormState,
): Parameters<typeof updateTask>[1] {
    const updates: Parameters<typeof updateTask>[1] = {};
    const title = editState.title.trim();
    const listId = editState.list_id || null;
    const notes = editState.notes.trim() || null;
    const scheduledStart = toIsoOrNull(editState.scheduled_start);
    const scheduledEnd = toIsoOrNull(editState.scheduled_end);
    const recurrenceRule = buildRecurrenceRule(editState);
    const notificationSettings = getNotificationSettings(editState);
    const notificationEnabled = notificationSettings.enabled;
    const notificationOffsetMinutes = notificationSettings.offsetMinutes;
    const notificationChannel = notificationSettings.channel;

    if (title !== selectedTask.title) {
        updates.title = title;
    }
    if (listId !== selectedTask.list_id) {
        updates.list_id = listId;
    }
    if (notes !== (selectedTask.notes ?? null)) {
        updates.notes = notes;
    }
    if (scheduledStart !== (selectedTask.scheduled_start ?? null)) {
        updates.scheduled_start = scheduledStart;
    }
    if (scheduledEnd !== (selectedTask.scheduled_end ?? null)) {
        updates.scheduled_end = scheduledEnd;
    }
    if (editState.completed !== selectedTask.completed) {
        updates.completed = editState.completed;
    }
    if (recurrenceRule !== (selectedTask.recurrence_rule ?? null)) {
        updates.recurrence_rule = recurrenceRule;
    }
    if (notificationEnabled !== Boolean(selectedTask.notification_enabled)) {
        updates.notification_enabled = notificationEnabled;
    }
    if (
        notificationOffsetMinutes !==
        (selectedTask.notification_offset_minutes ?? 0)
    ) {
        updates.notification_offset_minutes = notificationOffsetMinutes;
    }
    if (notificationChannel !== (selectedTask.notification_channel ?? null)) {
        updates.notification_channel = notificationChannel;
    }

    return updates;
}

function notificationFormStateFromTask(task: ScheduledTask): Pick<
    TaskFormState,
    "notification_unit" | "notification_offset_value"
> {
    if (!task.notification_enabled) {
        return {
            notification_unit: "",
            notification_offset_value: "0",
        };
    }

    const notificationOffsetMinutes = task.notification_offset_minutes ?? 0;
    if (notificationOffsetMinutes > 0 && notificationOffsetMinutes % 1_440 === 0) {
        return {
            notification_unit: "DAYS",
            notification_offset_value: String(
                notificationOffsetMinutes / 1_440,
            ),
        };
    }
    if (notificationOffsetMinutes > 0 && notificationOffsetMinutes % 60 === 0) {
        return {
            notification_unit: "HOURS",
            notification_offset_value: String(notificationOffsetMinutes / 60),
        };
    }

    return {
        notification_unit: "MINUTES",
        notification_offset_value: String(notificationOffsetMinutes),
    };
}

function getNotificationSettings(
    state: Pick<
        TaskFormState,
        "notification_unit" | "notification_offset_value"
    >,
): {
    enabled: boolean;
    offsetMinutes: number;
    channel: "discord" | null;
} {
    if (!state.notification_unit) {
        return {
            enabled: false,
            offsetMinutes: 0,
            channel: null,
        };
    }

    const notificationValue = parsePositiveIntegerOrZero(
        state.notification_offset_value,
    );
    const notificationOffsetMinutes =
        state.notification_unit === "DAYS"
            ? notificationValue * 1_440
            : state.notification_unit === "HOURS"
              ? notificationValue * 60
              : notificationValue;

    return {
        enabled: true,
        offsetMinutes: notificationOffsetMinutes,
        channel: "discord",
    };
}

function shouldPromptRecurringTaskEdit(
    selectedTask: ScheduledTask,
    updates: Parameters<typeof updateTask>[1],
): boolean {
    if (
        !selectedTask.recurrence_series_id ||
        Object.keys(updates).length === 0
    ) {
        return false;
    }

    const supportedSeriesKeys = new Set([
        "title",
        "list_id",
        "scheduled_start",
        "scheduled_end",
        "recurrence_rule",
        "notification_enabled",
        "notification_offset_minutes",
        "notification_channel",
    ]);

    return Object.keys(updates).every((key) => supportedSeriesKeys.has(key));
}

function filterTasksForView(
    tasks: ScheduledTask[],
    activeView: TaskView,
    activeListId: string | null,
    upcomingDays: number,
): ScheduledTask[] {
    const now = new Date();
    const filteredTasks = tasks.filter((task) => {
        if (activeView === "unscheduled") {
            return !task.completed && !task.scheduled_start && !task.scheduled_end;
        }

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

        if (activeView === "overdue") {
            return isOverdueTask(task, now);
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

    return collapseRecurringTasksForList(filteredTasks);
}

function collapseRecurringTasksForList(
    tasks: ScheduledTask[],
): ScheduledTask[] {
    const seenSeries = new Set<string>();

    return tasks.filter((task) => {
        if (!task.recurrence_series_id) {
            return true;
        }

        if (seenSeries.has(task.recurrence_series_id)) {
            return false;
        }

        seenSeries.add(task.recurrence_series_id);
        return true;
    });
}

function orderTasksByIds(
    tasks: ScheduledTask[],
    orderedTaskIds: string[],
): ScheduledTask[] {
    const orderIndex = new Map(
        orderedTaskIds.map((taskId, index) => [taskId, index]),
    );

    return [...tasks].sort((left, right) => {
        const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
    });
}

function reconcileTaskOrder(currentOrder: string[], taskIds: string[]): string[] {
    const validTaskIds = new Set(taskIds);
    const nextOrder = currentOrder.filter((taskId) => validTaskIds.has(taskId));

    for (const taskId of taskIds) {
        if (!nextOrder.includes(taskId)) {
            nextOrder.push(taskId);
        }
    }

    return nextOrder;
}

function moveTaskIdRelative(
    currentOrder: string[],
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after",
): string[] {
    if (draggedTaskId === targetTaskId) {
        return currentOrder;
    }

    const nextOrder = currentOrder.filter((taskId) => taskId !== draggedTaskId);
    const targetIndex = nextOrder.indexOf(targetTaskId);
    if (targetIndex === -1) {
        return [...nextOrder, draggedTaskId];
    }

    const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
    nextOrder.splice(insertIndex, 0, draggedTaskId);
    return nextOrder;
}

function moveTaskIdByOffset(
    currentOrder: string[],
    taskId: string,
    offset: -1 | 1,
): string[] {
    const currentIndex = currentOrder.indexOf(taskId);
    if (currentIndex === -1) {
        return currentOrder;
    }

    const targetIndex = currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) {
        return currentOrder;
    }

    const nextOrder = [...currentOrder];
    [nextOrder[currentIndex], nextOrder[targetIndex]] = [
        nextOrder[targetIndex],
        nextOrder[currentIndex],
    ];
    return nextOrder;
}

function moveTaskIdToTop(currentOrder: string[], taskId: string): string[] {
    const currentIndex = currentOrder.indexOf(taskId);
    if (currentIndex <= 0) {
        return currentOrder;
    }

    const nextOrder = currentOrder.filter((currentTaskId) => currentTaskId !== taskId);
    nextOrder.unshift(taskId);
    return nextOrder;
}

function getTaskReorderTarget(
    draggedTaskId: string,
    clientY: number,
): { targetTaskId: string; position: "before" | "after" } | null {
    const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".task-row[data-task-id]"),
    ).filter((row) => row.dataset.taskId !== draggedTaskId);

    if (rows.length === 0) {
        return null;
    }

    const firstRowAfterPointer = rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
    });

    if (firstRowAfterPointer?.dataset.taskId) {
        return {
            targetTaskId: firstRowAfterPointer.dataset.taskId,
            position: "before",
        };
    }

    const lastRow = rows[rows.length - 1];
    return lastRow?.dataset.taskId
        ? { targetTaskId: lastRow.dataset.taskId, position: "after" }
        : null;
}

function isInteractiveTaskRowTarget(target: EventTarget): boolean {
    return target instanceof Element
        ? Boolean(target.closest("button, input, textarea, select, a"))
        : false;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
    return (
        left.length === right.length &&
        left.every((value, index) => value === right[index])
    );
}

function toIsoOrNull(value: string): string | null {
    return isCompleteDateTimeValue(value)
        ? new Date(value).toISOString()
        : null;
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
    return (
        !isCompleteDateTimeValue(start) ||
        !isCompleteDateTimeValue(end) ||
        new Date(end) > new Date(start)
    );
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

function formatTaskMeta(task: ScheduledTask): string {
    const parts: string[] = [];
    const scheduledRange = formatScheduledRange(task);
    if (scheduledRange) {
        parts.push(scheduledRange);
    }
    if (task.due_at) {
        parts.push(`Due ${formatDateTime(task.due_at)}`);
    }

    const recurrenceLabel = formatRecurrenceRule(task.recurrence_rule);
    if (recurrenceLabel) {
        parts.push(recurrenceLabel);
    }

    return parts.join(" • ");
}

function formatRecurrenceRule(recurrenceRule: string | null): string {
    if (!recurrenceRule) {
        return "";
    }

    const parsed = parseRecurrenceRule(recurrenceRule);
    if (!parsed.frequency) {
        return "";
    }

    const frequencyLabel = parsed.frequency.toLowerCase();
    const interval = Number.parseInt(parsed.interval, 10);
    const intervalLabel =
        interval === 1 ? frequencyLabel : `${frequencyLabel}s`;
    const untilLabel = parsed.until ? ` until ${formatDate(parsed.until)}` : "";

    return `Repeats every ${interval} ${intervalLabel}${untilLabel}`;
}

function parseRecurrenceRule(recurrenceRule: string | null): {
    frequency: RecurrenceFrequency;
    interval: string;
    until: string;
} {
    if (!recurrenceRule) {
        return {
            frequency: "",
            interval: "1",
            until: "",
        };
    }

    const parts = Object.fromEntries(
        recurrenceRule
            .split(";")
            .filter((segment) => segment.includes("="))
            .map((segment) => {
                const [key, value] = segment.split("=", 2);
                return [key.trim().toUpperCase(), value.trim()];
            }),
    ) as Record<string, string>;

    return {
        frequency: (parts.FREQ as RecurrenceFrequency) ?? "",
        interval: parts.INTERVAL ?? "1",
        until: parts.UNTIL ? toDateInputValue(parts.UNTIL) : "",
    };
}

function buildRecurrenceRule(state: {
    recurrence_frequency: RecurrenceFrequency;
    recurrence_interval: string;
    recurrence_until: string;
}): string | null {
    if (!state.recurrence_frequency) {
        return null;
    }

    const interval = parsePositiveIntegerOrZero(state.recurrence_interval);
    if (interval < 1) {
        return null;
    }

    const segments = [
        `FREQ=${state.recurrence_frequency}`,
        `INTERVAL=${interval}`,
    ];

    if (state.recurrence_until) {
        segments.push(`UNTIL=${endOfLocalDateToIso(state.recurrence_until)}`);
    }

    return segments.join(";");
}

function parsePositiveIntegerOrZero(value: string): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function isOverdueTask(task: ScheduledTask, now: Date): boolean {
    if (task.completed) {
        return false;
    }

    if (task.scheduled_end) {
        return parseTaskDate(task.scheduled_end) < now;
    }

    return task.due_at ? parseTaskDate(task.due_at) < now : false;
}

function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(parseTaskDate(value));
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(parseTaskDate(value));
}

function parseTaskDate(value: string): Date {
    return new Date(value);
}

function splitDateTimeInputValue(value: string): {
    datePart: string;
    timePart: string;
} {
    if (!value) {
        return { datePart: "", timePart: "" };
    }

    const [datePart, rawTimePart = ""] = value.split("T", 2);
    return {
        datePart,
        timePart: rawTimePart.slice(0, 5),
    };
}

function combineDateTimeInputValue(datePart: string, timePart: string): string {
    if (!datePart && !timePart) {
        return "";
    }

    return `${datePart}T${timePart}`;
}

function sanitizeTimeInputValue(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 4);

    if (digits.length <= 2) {
        return digits;
    }

    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isCompleteDateTimeValue(value: string): boolean {
    const { datePart, timePart } = splitDateTimeInputValue(value);
    return Boolean(datePart) && /^([01]\d|2[0-3]):[0-5]\d$/.test(timePart);
}

function hasIncompleteDateTimeValue(value: string): boolean {
    if (!value) {
        return false;
    }

    return !isCompleteDateTimeValue(value);
}

function toDateInputValue(value: string): string {
    const date = parseTaskDate(value);
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function endOfLocalDateToIso(value: string): string {
    const date = new Date(`${value}T23:59:59.999`);
    return date.toISOString();
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

function getCalendarDropScheduleUpdate(
    task: ScheduledTask,
    dropInfo: DropArg,
): {
    scheduled_start: string;
    scheduled_end: string;
} {
    const start = dropInfo.date;
    const durationMinutes = getTaskDragDurationMinutes(task, dropInfo.allDay);
    const end = dropInfo.allDay
        ? addLocalDays(start, Math.max(1, Math.ceil(durationMinutes / 1440)))
        : new Date(start.getTime() + durationMinutes * 60_000);

    return {
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
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

function getTaskDragDuration(task: ScheduledTask): {
    days?: number;
    hours?: number;
    minutes?: number;
} {
    if (!task.scheduled_start || !task.scheduled_end) {
        return { hours: 1 };
    }

    const start = parseTaskDate(task.scheduled_start);
    const end = parseTaskDate(task.scheduled_end);
    const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);

    if (totalMinutes <= 0) {
        return { hours: 1 };
    }

    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    return {
        ...(days > 0 ? { days } : {}),
        ...(hours > 0 ? { hours } : {}),
        ...(minutes > 0 ? { minutes } : {}),
    };
}

function getTaskDragDurationMinutes(
    task: ScheduledTask,
    droppedAllDay: boolean,
): number {
    if (!task.scheduled_start || !task.scheduled_end) {
        return droppedAllDay ? 1440 : 60;
    }

    const start = parseTaskDate(task.scheduled_start);
    const end = parseTaskDate(task.scheduled_end);
    const totalMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);

    return totalMinutes > 0 ? totalMinutes : droppedAllDay ? 1440 : 60;
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
        backgroundColor: task.completed
            ? withAlpha(color, 0.32)
            : color,
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

function withAlpha(hexColor: string, alpha: number): string {
    const red = Number.parseInt(hexColor.slice(1, 3), 16);
    const green = Number.parseInt(hexColor.slice(3, 5), 16);
    const blue = Number.parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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

function getInitialSidebarOpen(): boolean {
    try {
        return window.localStorage?.getItem("calendar-sidebar") !== "collapsed";
    } catch {
        return true;
    }
}

function saveSidebarOpen(isSidebarOpen: boolean): void {
    try {
        window.localStorage?.setItem(
            "calendar-sidebar",
            isSidebarOpen ? "open" : "collapsed",
        );
    } catch {
        // Sidebar persistence is optional.
    }
}

function getInitialSidebarWidth(): number {
    try {
        const storedWidth = Number.parseInt(
            window.localStorage?.getItem("calendar-sidebar-width") ?? "",
            10,
        );
        return Number.isNaN(storedWidth)
            ? defaultSidebarWidth
            : Math.max(minSidebarWidth, storedWidth);
    } catch {
        return defaultSidebarWidth;
    }
}

function saveSidebarWidth(sidebarWidth: number): void {
    try {
        window.localStorage?.setItem(
            "calendar-sidebar-width",
            String(Math.round(sidebarWidth)),
        );
    } catch {
        // Sidebar persistence is optional.
    }
}

function getInitialUnscheduledOrder(): string[] {
    try {
        const storedOrder = window.localStorage?.getItem(
            "calendar-unscheduled-order",
        );
        if (!storedOrder) {
            return [];
        }

        const parsedOrder = JSON.parse(storedOrder);
        return Array.isArray(parsedOrder)
            ? parsedOrder.filter((value): value is string => typeof value === "string")
            : [];
    } catch {
        return [];
    }
}

function saveUnscheduledOrder(unscheduledOrder: string[]): void {
    try {
        window.localStorage?.setItem(
            "calendar-unscheduled-order",
            JSON.stringify(unscheduledOrder),
        );
    } catch {
        // Unscheduled task order persistence is optional.
    }
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
