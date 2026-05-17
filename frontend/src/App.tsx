import type {
    DatesSetArg,
    DayCellContentArg,
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
    AnimatePresence,
    motion,
    useAnimationControls,
    useReducedMotion,
} from "framer-motion";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type CSSProperties,
    type FormEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";

import {
    clearStoredAuthToken,
    getCurrentUser,
    getStoredAuthToken,
    isAuthError,
    login,
    register,
    type AuthUser,
} from "./api/auth";
import {
    downloadBackupPayload,
    fetchBackupExport,
    importBackup,
    type BackupExportPayload,
} from "./api/backup";
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
    type CreateScheduledTaskInput,
    type ScheduledTask,
} from "./api/tasks";

type TaskState =
    | { status: "loading"; tasks: ScheduledTask[] }
    | { status: "refreshing"; tasks: ScheduledTask[] }
    | { status: "ready"; tasks: ScheduledTask[] }
    | { status: "error"; message: string; tasks: ScheduledTask[] };

type TaskView =
    | "today"
    | "upcoming"
    | "unscheduled"
    | "overdue"
    | "completed"
    | "all";
type ThemeMode = "light" | "dark";
type CalendarView = "dayGridMonth" | "timeGridWeek" | "timeGridDay";
type MobileScreen = "today" | "upcoming" | "unscheduled" | "calendar" | "settings";
type CalendarTransitionKind = "neutral" | "view" | "prev" | "next" | "today";
type DragTargetMode = "reorder" | "schedule" | null;
type AuthMode = "login" | "register";
type WorkingHoursSettings = {
    start: string;
    end: string;
};
const defaultSidebarWidth = 300;
const minSidebarWidth = 240;
const minCalendarWidth = 320;
const mobileLayoutQuery = "(max-width: 860px)";
const defaultWorkingHours: WorkingHoursSettings = {
    start: "08:00",
    end: "22:00",
};
const workingHourOptions = Array.from({ length: 24 }, (_, index) =>
    `${String(index).padStart(2, "0")}:00`,
);

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

type CategoryVisibilityState = {
    none: boolean;
    lists: Record<string, boolean>;
};

type AuthFormState = {
    username: string;
    password: string;
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

type TaskUndoState = {
    message: string;
    task?: ScheduledTask;
    kind: "update" | "delete" | "unavailable";
    restoreFields?: Array<keyof Parameters<typeof updateTask>[1]>;
    updateScope?: "single" | "series";
};

type DetailPanelMode = "create" | "edit" | null;
type TaskRowDragEvent =
    | ReactMouseEvent<HTMLElement>
    | ReactPointerEvent<HTMLElement>;
type TaskRowPointerState = {
    taskId: string;
    startX: number;
    startY: number;
    dragging: boolean;
    orderAtStart: string[];
};

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

const defaultCategoryVisibility: CategoryVisibilityState = {
    none: true,
    lists: {},
};

const taskViews: Array<{ id: TaskView; label: string }> = [
    { id: "today", label: "Today" },
    { id: "upcoming", label: "Upcoming" },
    { id: "unscheduled", label: "Inbox" },
];

const calendarViewCycle: Record<CalendarView, CalendarView> = {
    timeGridWeek: "timeGridDay",
    timeGridDay: "dayGridMonth",
    dayGridMonth: "timeGridWeek",
};

const calendarTransitionEase = [0.22, 1, 0.36, 1] as const;
const motionTimings = {
    completion: { duration: 0.24, ease: "easeOut" as const },
    panel: { duration: 0.26, ease: "easeOut" as const },
    dropdown: { duration: 0.22, ease: "easeInOut" as const },
    calendarView: { duration: 0.24, ease: calendarTransitionEase },
    calendarDate: { duration: 0.2, ease: calendarTransitionEase },
    calendarEventEnterMs: 190,
    calendarEventAnimationHoldMs: 300,
} as const;

function isNarrowScreen(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia(mobileLayoutQuery).matches
    );
}

export function App() {
    const prefersReducedMotion = useReducedMotion();
    const calendarTransitionControls = useAnimationControls();
    const [authToken, setAuthToken] = useState<string | null>(
        getStoredAuthToken,
    );
    const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
    const [authMode, setAuthMode] = useState<AuthMode>("login");
    const [authFormState, setAuthFormState] = useState<AuthFormState>({
        username: "",
        password: "",
    });
    const [authError, setAuthError] = useState<string | null>(null);
    const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
    const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
    const [isSidebarOpen, setIsSidebarOpen] = useState(getInitialSidebarOpen);
    const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
    const [workingHours, setWorkingHours] = useState(getInitialWorkingHours);
    const [isFullDayTimelineVisible, setIsFullDayTimelineVisible] =
        useState(false);
    const [taskState, setTaskState] = useState<TaskState>({
        status: "loading",
        tasks: [],
    });
    const [activeView, setActiveView] = useState<TaskView>("today");
    const [mobileScreen, setMobileScreen] = useState<MobileScreen>("today");
    const [upcomingDays, setUpcomingDays] = useState(7);
    const [showCompletedTasks, setShowCompletedTasks] = useState(true);
    const [activeListId, setActiveListId] = useState<string | null>(null);
    const [areAllCategoriesVisible, setAreAllCategoriesVisible] =
        useState(true);
    const [categoryVisibility, setCategoryVisibility] =
        useState<CategoryVisibilityState>(defaultCategoryVisibility);
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
    const [isWorkingHoursSettingsOpen, setIsWorkingHoursSettingsOpen] =
        useState(false);
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
    const [isDuplicating, setIsDuplicating] = useState(false);
    const [dragTargetMode, setDragTargetMode] = useState<DragTargetMode>(null);
    const [pendingTaskDelete, setPendingTaskDelete] =
        useState<PendingTaskDeleteState | null>(null);
    const [pendingTaskEdit, setPendingTaskEdit] =
        useState<PendingTaskEditState | null>(null);
    const [taskUndo, setTaskUndo] = useState<TaskUndoState | null>(null);
    const [isUndoingTask, setIsUndoingTask] = useState(false);
    const [detailPanelMode, setDetailPanelMode] =
        useState<DetailPanelMode>(null);
    const [isDetailPanelClosing, setIsDetailPanelClosing] = useState(false);
    const [isWebhookSettingsOpen, setIsWebhookSettingsOpen] = useState(false);
    const [isBackupSettingsOpen, setIsBackupSettingsOpen] = useState(false);
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
    const [backupSummary, setBackupSummary] = useState<BackupExportPayload | null>(
        null,
    );
    const [isBackupLoading, setIsBackupLoading] = useState(false);
    const [backupImportFile, setBackupImportFile] = useState<File | null>(null);
    const [isBackupImporting, setIsBackupImporting] = useState(false);
    const [backupImportMessage, setBackupImportMessage] = useState<string | null>(
        null,
    );
    const [backupImportError, setBackupImportError] = useState<string | null>(
        null,
    );
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
        null,
    );
    const [calendarView, setCalendarView] =
        useState<CalendarView>("timeGridWeek");
    const [calendarTitle, setCalendarTitle] = useState("");
    const [calendarDate, setCalendarDate] = useState(new Date());
    const [mobileMonthPreviewDate, setMobileMonthPreviewDate] =
        useState<Date | null>(null);
    const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
    const [yearDraft, setYearDraft] = useState(
        String(new Date().getFullYear()),
    );
    const calendarRef = useRef<FullCalendar | null>(null);
    const calendarTransitionTimeoutRef = useRef<number | null>(null);
    const calendarEventAnimationKindRef =
        useRef<CalendarTransitionKind>("neutral");
    const calendarEventAnimationTimeoutRef = useRef<number | null>(null);
    const appShellRef = useRef<HTMLElement | null>(null);
    const backupFileInputRef = useRef<HTMLInputElement | null>(null);
    const taskListRef = useRef<HTMLElement | null>(null);
    const tasksRef = useRef<ScheduledTask[]>([]);
    const visibleTasksRef = useRef<ScheduledTask[]>([]);
    const taskRowPointerStateRef = useRef<TaskRowPointerState | null>(null);
    const taskRowWindowDragCleanupRef = useRef<(() => void) | null>(null);
    const previousCategoryVisibilityRef =
        useRef<CategoryVisibilityState | null>(null);
    const draggedUnscheduledTaskIdRef = useRef<string | null>(null);
    const suppressTaskRowClickRef = useRef<string | null>(null);
    const scheduleDragCleanupRef = useRef<(() => void) | null>(null);
    const unscheduledOrderRef = useRef<string[]>(unscheduledOrder);
    const unscheduledOrderSaveStateRef = useRef<{
        saving: boolean;
        queued: string[] | null;
    }>({
        saving: false,
        queued: null,
    });
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const createFormRef = useRef<HTMLFormElement | null>(null);
    const categoryNameInputRef = useRef<HTMLInputElement | null>(null);
    const yearInputRef = useRef<HTMLInputElement | null>(null);
    const timeGridScrollTopRef = useRef<number | null>(null);
    const locallyUpdatedTasksRef = useRef<Map<string, ScheduledTask>>(new Map());
    const calendarResizeRafRef = useRef<number | null>(null);
    const calendarResizeRaf2Ref = useRef<number | null>(null);

    const tasks = taskState.tasks;
    const isInitialTaskLoad =
        taskState.status === "loading" && tasks.length === 0;
    const isTaskRefreshing = taskState.status === "refreshing";
    const taskLoadBannerMessage = isTaskRefreshing
        ? "Refreshing tasks..."
        : isInitialTaskLoad
          ? "Loading tasks..."
          : null;
    const selectedTask = selectedTaskId
        ? tasks.find((task) => task.id === selectedTaskId)
        : undefined;
    const pendingDeleteTask = pendingTaskDelete
        ? tasks.find((task) => task.id === pendingTaskDelete.taskId)
        : undefined;

    const visibleTasks = useMemo(
        () =>
            filterTasksForView(
                tasks,
                activeView,
                areAllCategoriesVisible,
                categoryVisibility,
                upcomingDays,
                showCompletedTasks,
            ),
        [
            activeView,
            areAllCategoriesVisible,
            categoryVisibility,
            showCompletedTasks,
            tasks,
            upcomingDays,
        ],
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

    const activeCategoryLabel = areAllCategoriesVisible ? "All" : "Filtered";
    const selectedListIdForForms = activeListId ?? "";
    const categoryFilterKey = areAllCategoriesVisible
        ? "all"
        : `custom-${categoryVisibility.none ? "none-on" : "none-off"}-${taskLists
              .map(
                  (taskList) =>
                      `${taskList.id}:${(categoryVisibility.lists[taskList.id] ?? true) ? "on" : "off"}`,
              )
              .join("|")}`;

    const calendarTasks = useMemo(() => {
        return tasks.filter(
            (task) =>
                isTaskVisibleForCategory(
                    task,
                    areAllCategoriesVisible,
                    categoryVisibility,
                ) &&
                (showCompletedTasks || !task.completed),
        );
    }, [areAllCategoriesVisible, categoryVisibility, showCompletedTasks, tasks]);
    const isTimeGridView =
        calendarView === "timeGridWeek" || calendarView === "timeGridDay";

    const events = useMemo<EventInput[]>(() => {
        return mapTasksToCalendarEvents(calendarTasks, categoryColorById);
    }, [calendarTasks, categoryColorById]);
    const mobileMonthPreviewTasks = useMemo(() => {
        if (!mobileMonthPreviewDate) {
            return [];
        }

        return calendarTasks
            .filter((task) => {
                if (!task.scheduled_start) {
                    return false;
                }

                return isSameLocalDay(
                    parseTaskDate(task.scheduled_start),
                    mobileMonthPreviewDate,
                );
            })
            .sort(compareTasksByScheduledStart);
    }, [calendarTasks, mobileMonthPreviewDate]);
    const calendarSlotMinTime = isFullDayTimelineVisible
        ? "00:00:00"
        : `${workingHours.start}:00`;
    const calendarSlotMaxTime = isFullDayTimelineVisible
        ? "24:00:00"
        : `${workingHours.end}:00`;
    const isWorkingTimeGridView = isTimeGridView && !isFullDayTimelineVisible;
    const calendarViewToggleLabel =
        calendarView === "timeGridWeek"
            ? "Week"
            : calendarView === "timeGridDay"
              ? "Day"
              : "Month";
    const updateWorkingHours = useCallback(
        (updates: Partial<WorkingHoursSettings>) => {
            setWorkingHours((current) => ({
                ...current,
                ...updates,
            }));
        },
        [],
    );

    const resetAppData = useCallback(() => {
        locallyUpdatedTasksRef.current.clear();
        setTaskState({ status: "loading", tasks: [] });
        setTaskLists([]);
        setSelectedTaskId(null);
        setDetailPanelMode(null);
        setFormError(null);
        setTaskUndo(null);
        setWebhookSettings(null);
        setWebhookSettingsDraft({
            discord_webhook_url: "",
            discord_message_template: "",
        });
    }, []);

    const handleAuthExpired = useCallback(() => {
        clearStoredAuthToken();
        setAuthToken(null);
        setCurrentUser(null);
        setAuthError("Session expired. Please log in again.");
        resetAppData();
    }, [resetAppData]);

    const handleLogout = useCallback(() => {
        clearStoredAuthToken();
        setAuthToken(null);
        setCurrentUser(null);
        setAuthError(null);
        resetAppData();
    }, [resetAppData]);

    const handleOpenBackupSummary = useCallback(async () => {
        setIsBackupLoading(true);
        try {
            const payload = await fetchBackupExport();
            setBackupSummary(payload);
            downloadBackupPayload(payload);
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to load backup summary",
            );
        } finally {
            setIsBackupLoading(false);
        }
    }, []);

    const handleAuthSubmit = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            setAuthError(null);
            setIsAuthSubmitting(true);

            try {
                const credentials = {
                    username: authFormState.username.trim(),
                    password: authFormState.password,
                };

                if (authMode === "register") {
                    await register(credentials);
                }

                const token = await login(credentials);
                setAuthToken(token);
                setAuthFormState({ username: "", password: "" });
                setCurrentUser(await getCurrentUser());
            } catch (error) {
                setAuthError(
                    error instanceof Error
                        ? error.message
                        : "Unable to authenticate",
                );
            } finally {
                setIsAuthSubmitting(false);
            }
        },
        [authFormState.password, authFormState.username, authMode],
    );

    useEffect(() => {
        if (!authToken) {
            return;
        }

        void (async () => {
            try {
                setCurrentUser(await getCurrentUser());
            } catch (error) {
                if (isAuthError(error)) {
                    handleAuthExpired();
                    return;
                }
                setAuthError(
                    error instanceof Error
                        ? error.message
                        : "Unable to load current user",
                );
            }
        })();
    }, [authToken, handleAuthExpired]);

    useEffect(() => {
        if (calendarTransitionTimeoutRef.current !== null) {
            window.clearTimeout(calendarTransitionTimeoutRef.current);
            calendarTransitionTimeoutRef.current = null;
        }

        calendarTransitionTimeoutRef.current = window.setTimeout(() => {
            calendarTransitionTimeoutRef.current = null;
            calendarRef.current?.getApi().updateSize();
        }, prefersReducedMotion ? 0 : 220);

        return () => {
            if (calendarTransitionTimeoutRef.current !== null) {
                window.clearTimeout(calendarTransitionTimeoutRef.current);
                calendarTransitionTimeoutRef.current = null;
            }
        };
    }, [isSidebarOpen, prefersReducedMotion]);

    const scheduleCalendarResize = useCallback(() => {
        if (calendarResizeRafRef.current !== null) {
            window.cancelAnimationFrame(calendarResizeRafRef.current);
            calendarResizeRafRef.current = null;
        }
        if (calendarResizeRaf2Ref.current !== null) {
            window.cancelAnimationFrame(calendarResizeRaf2Ref.current);
            calendarResizeRaf2Ref.current = null;
        }

        if (calendarView === "dayGridMonth") {
            calendarResizeRafRef.current = window.requestAnimationFrame(() => {
                calendarResizeRafRef.current = null;
                calendarResizeRaf2Ref.current = window.requestAnimationFrame(
                    () => {
                        calendarResizeRaf2Ref.current = null;
                        calendarRef.current?.getApi().updateSize();
                    },
                );
            });
            return;
        }

        calendarResizeRafRef.current = window.requestAnimationFrame(() => {
            calendarResizeRafRef.current = null;
            calendarRef.current?.getApi().updateSize();
        });
    }, [calendarView]);

    useEffect(() => {
        scheduleCalendarResize();

        return () => {
            if (calendarResizeRafRef.current !== null) {
                window.cancelAnimationFrame(calendarResizeRafRef.current);
                calendarResizeRafRef.current = null;
            }
            if (calendarResizeRaf2Ref.current !== null) {
                window.cancelAnimationFrame(calendarResizeRaf2Ref.current);
                calendarResizeRaf2Ref.current = null;
            }
        };
    }, [
        detailPanelMode,
        isDetailPanelClosing,
        isFullDayTimelineVisible,
        isSidebarOpen,
        scheduleCalendarResize,
    ]);

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
        setTaskState((current) => ({
            status: current.tasks.length > 0 ? "refreshing" : "loading",
            tasks: current.tasks,
        }));

        try {
            const loadedTasks = await listTasks();
            setTaskState({
                status: "ready",
                tasks: mergeLocallyUpdatedTasks(
                    loadedTasks,
                    locallyUpdatedTasksRef.current,
                ),
            });
        } catch (error) {
            if (isAuthError(error)) {
                handleAuthExpired();
                return;
            }
            setTaskState((current) => ({
                status: "error",
                message:
                    error instanceof Error
                        ? error.message
                        : "Unable to load tasks",
                tasks: current.tasks,
            }));
        }
    }, [handleAuthExpired]);

    const replaceTaskInState = useCallback((updatedTask: ScheduledTask) => {
        locallyUpdatedTasksRef.current.set(updatedTask.id, updatedTask);
        setTaskState((current) => {
            const hasTask = current.tasks.some(
                (task) => task.id === updatedTask.id,
            );
            const nextTasks = hasTask
                ? current.tasks.map((task) =>
                      task.id === updatedTask.id ? updatedTask : task,
                  )
                : [...current.tasks, updatedTask];

            return current.status === "error"
                ? {
                      status: "error",
                      message: current.message,
                      tasks: nextTasks,
                  }
                : {
                      status: current.status,
                      tasks: nextTasks,
                  };
        });
    }, []);

    const replaceTasksInState = useCallback((updatedTasks: ScheduledTask[]) => {
        if (updatedTasks.length === 0) {
            return;
        }

        updatedTasks.forEach((updatedTask) => {
            locallyUpdatedTasksRef.current.set(updatedTask.id, updatedTask);
        });
        const updatedTaskById = new Map(
            updatedTasks.map((updatedTask) => [updatedTask.id, updatedTask]),
        );
        setTaskState((current) => {
            const nextTasks = current.tasks.map(
                (task) => updatedTaskById.get(task.id) ?? task,
            );

            return current.status === "error"
                ? {
                      status: "error",
                      message: current.message,
                      tasks: nextTasks,
                  }
                : {
                      status: current.status,
                      tasks: nextTasks,
                  };
        });
    }, []);

    const refreshTaskLists = useCallback(async () => {
        try {
            const loadedTaskLists = await listTaskLists();
            setTaskLists(loadedTaskLists);
        } catch (error) {
            if (isAuthError(error)) {
                handleAuthExpired();
                return;
            }
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to load categories",
            );
        }
    }, [handleAuthExpired]);

    const handleConfirmBackupImport = useCallback(async (file: File | null) => {
        if (!file) {
            setBackupImportError("Choose a JSON backup file first.");
            return;
        }

        setIsBackupImporting(true);
        setBackupImportMessage(null);
        setBackupImportError(null);
        try {
            const text = await readBackupFileText(file);
            const payload = JSON.parse(text) as BackupExportPayload;
            const result = await importBackup(payload);
            setBackupImportMessage(
                `Imported ${result.imported_tasks} tasks and ${result.imported_task_lists} categories.`,
            );
            setBackupImportFile(null);
            locallyUpdatedTasksRef.current.clear();
            await Promise.all([refreshTasks(), refreshTaskLists()]);
        } catch (error) {
            setBackupImportError(
                error instanceof SyntaxError
                    ? "Backup file must be valid JSON."
                    : error instanceof Error
                      ? error.message
                      : "Unable to import backup",
            );
        } finally {
            setIsBackupImporting(false);
        }
    }, [refreshTaskLists, refreshTasks]);

    const handleBackupImportFileChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            setBackupImportFile(file);
            setBackupImportMessage(null);
            setBackupImportError(null);

            if (!file) {
                return;
            }
        },
        [],
    );

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
            if (isAuthError(error)) {
                handleAuthExpired();
                return;
            }
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to load webhook settings",
            );
        }
    }, [handleAuthExpired]);

    useEffect(() => {
        if (!authToken) {
            return;
        }
        void refreshTaskLists();
    }, [authToken, refreshTaskLists]);

    useEffect(() => {
        if (!authToken) {
            return;
        }
        void refreshWebhookSettings();
    }, [authToken, refreshWebhookSettings]);

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
        saveWorkingHours(workingHours);
    }, [workingHours]);

    useEffect(() => {
        setCategoryVisibility((current) =>
            reconcileCategoryVisibility(current, taskLists),
        );
        previousCategoryVisibilityRef.current =
            previousCategoryVisibilityRef.current
                ? reconcileCategoryVisibility(
                      previousCategoryVisibilityRef.current,
                      taskLists,
                  )
                : null;
    }, [taskLists]);

    useEffect(() => {
        const unscheduledTaskIds = tasks
            .filter((task) => !task.scheduled_start && !task.scheduled_end)
            .map((task) => task.id);
        setUnscheduledOrder((current) => {
            const next = reconcileTaskOrder(current, unscheduledTaskIds);
            unscheduledOrderRef.current = next;
            return areStringArraysEqual(current, next) ? current : next;
        });
    }, [tasks]);

    useEffect(() => {
        unscheduledOrderRef.current = unscheduledOrder;
        saveUnscheduledOrder(unscheduledOrder);
    }, [unscheduledOrder]);

    useLayoutEffect(() => {
        const api = calendarRef.current?.getApi();
        if (!api) {
            return;
        }

        api.scrollToTime(
            isFullDayTimelineVisible ? "00:00:00" : `${workingHours.start}:00`,
        );
        api.updateSize();
    }, [
        calendarView,
        isFullDayTimelineVisible,
        workingHours.end,
        workingHours.start,
    ]);

    useEffect(() => {
        const taskListElement = taskListRef.current;
        if (!taskListElement || detailPanelMode) {
            return;
        }

        const draggable = new Draggable(taskListElement, {
            itemSelector: ".task-drag-handle[data-task-id]",
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
    }, [activeView, detailPanelMode, isDetailPanelClosing]);

    useEffect(() => {
        if (!isTimeGridView) {
            return;
        }

        const scroller = appShellRef.current?.querySelector<HTMLElement>(
            ".calendar-panel .fc-timegrid-body .fc-scroller",
        );
        if (!scroller) {
            return;
        }

        const handleScroll = () => {
            timeGridScrollTopRef.current = scroller.scrollTop;
        };

        timeGridScrollTopRef.current = scroller.scrollTop;
        scroller.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            scroller.removeEventListener("scroll", handleScroll);
        };
    }, [isTimeGridView]);

    useLayoutEffect(() => {
        if (!isTimeGridView || timeGridScrollTopRef.current == null) {
            return;
        }

        const scroller = appShellRef.current?.querySelector<HTMLElement>(
            ".calendar-panel .fc-timegrid-body .fc-scroller",
        );
        if (!scroller) {
            return;
        }

        scroller.scrollTop = timeGridScrollTopRef.current;
    }, [calendarDate, calendarView, isTimeGridView]);

    useEffect(() => {
        if (isYearPickerOpen) {
            window.setTimeout(() => yearInputRef.current?.focus(), 0);
        }
    }, [isYearPickerOpen]);

    useEffect(() => {
        return () => {
            if (calendarTransitionTimeoutRef.current !== null) {
                window.clearTimeout(calendarTransitionTimeoutRef.current);
                calendarTransitionTimeoutRef.current = null;
            }
            if (calendarEventAnimationTimeoutRef.current !== null) {
                window.clearTimeout(calendarEventAnimationTimeoutRef.current);
                calendarEventAnimationTimeoutRef.current = null;
            }
            calendarEventAnimationKindRef.current = "neutral";
            calendarTransitionControls.stop();
        };
    }, [calendarTransitionControls]);

    const startCalendarTransition = useCallback(
        (kind: "view" | "prev" | "next" | "today") => {
            if (prefersReducedMotion) {
                calendarEventAnimationKindRef.current = "neutral";
                return;
            }

            if (calendarTransitionTimeoutRef.current !== null) {
                window.clearTimeout(calendarTransitionTimeoutRef.current);
                calendarTransitionTimeoutRef.current = null;
            }
            if (calendarEventAnimationTimeoutRef.current !== null) {
                window.clearTimeout(calendarEventAnimationTimeoutRef.current);
                calendarEventAnimationTimeoutRef.current = null;
            }

            calendarEventAnimationKindRef.current = kind;
            const startState =
                kind === "view"
                    ? {
                          opacity: 0.94,
                          x: 0,
                          y: 4,
                          scale: 0.994,
                      }
                    : kind === "prev"
                      ? {
                            opacity: 0.95,
                            x: 8,
                            y: 0,
                            scale: 1,
                        }
                      : kind === "next"
                        ? {
                              opacity: 0.95,
                              x: -8,
                              y: 0,
                              scale: 1,
                          }
                        : {
                              opacity: 0.96,
                              x: 0,
                              y: 0,
                              scale: 0.996,
                          };

            const settleTransition =
                kind === "view"
                    ? motionTimings.calendarView
                    : motionTimings.calendarDate;

            calendarTransitionControls.stop();
            calendarTransitionControls.set(startState);

            calendarTransitionTimeoutRef.current = window.setTimeout(() => {
                void calendarTransitionControls.start({
                    opacity: 1,
                    x: 0,
                    y: 0,
                    scale: 1,
                    transition: settleTransition,
                });
                calendarTransitionTimeoutRef.current = null;
            }, kind === "view" ? 120 : 90);

            calendarEventAnimationTimeoutRef.current = window.setTimeout(() => {
                calendarEventAnimationKindRef.current = "neutral";
                calendarEventAnimationTimeoutRef.current = null;
            }, motionTimings.calendarEventAnimationHoldMs);
        },
        [calendarTransitionControls, prefersReducedMotion],
    );

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
        setIsDetailPanelClosing(true);
        setDetailPanelMode(null);
        setSelectedTaskId(null);
        if (pendingTaskEdit?.source === "calendar") {
            pendingTaskEdit.revert?.();
        }
        setPendingTaskEdit(null);
        setFormError(null);
    }, [pendingTaskEdit]);

    const clearUndoState = useCallback(() => {
        setTaskUndo(null);
    }, []);

    const showTaskUndo = useCallback((undo: TaskUndoState) => {
        setTaskUndo(undo);
    }, []);

    const handleUndoTaskChange = useCallback(async () => {
        if (!taskUndo) {
            return;
        }

        setFormError(null);
        setIsUndoingTask(true);

        try {
            if (taskUndo.kind === "unavailable" || !taskUndo.task) {
                setTaskUndo(null);
            } else if (taskUndo.kind === "delete") {
                const restoredTask = await createTask(
                    buildTaskCreateInputFromSnapshot(taskUndo.task),
                );
                replaceTaskInState(restoredTask);
            } else if (taskUndo.updateScope === "series") {
                await updateTask(
                    taskUndo.task.id,
                    buildTaskUpdateInputFromSnapshot(
                        taskUndo.task,
                        taskUndo.restoreFields,
                    ),
                    { updateScope: "series" },
                );
                reloadTasks();
            } else {
                const restoredTask = await updateTask(
                    taskUndo.task.id,
                    buildTaskUpdateInputFromSnapshot(
                        taskUndo.task,
                        taskUndo.restoreFields,
                    ),
                );
                replaceTaskInState(restoredTask);
                void refreshTasks();
            }

            setTaskUndo(null);
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to undo task change",
            );
        } finally {
            setIsUndoingTask(false);
        }
    }, [refreshTasks, reloadTasks, replaceTaskInState, taskUndo]);

    const runTaskDelete = useCallback(
        async (
            taskId: string,
            source: "detail" | "menu",
            deleteScope: "single" | "following" = "single",
        ) => {
            setFormError(null);
            clearUndoState();
            setIsDeleting(true);
            const previousTask = tasksRef.current.find(
                (task) => task.id === taskId,
            );

            try {
                await deleteTask(taskId, { deleteScope });
                locallyUpdatedTasksRef.current.delete(taskId);
                setPendingTaskDelete(null);
                if (previousTask) {
                    showTaskUndo(buildDeleteTaskUndo(previousTask, deleteScope));
                }

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
        [clearUndoState, closeDetailPanel, reloadTasks, selectedTaskId, showTaskUndo],
    );

    const runTaskUpdate = useCallback(
        async (
            taskId: string,
            updates: Parameters<typeof updateTask>[1],
            updateScope: "single" | "series" = "single",
            source: "form" | "calendar" = "form",
        ) => {
            setFormError(null);
            clearUndoState();
            setIsEditSaving(true);
            const previousTask = tasksRef.current.find(
                (task) => task.id === taskId,
            );

            try {
                if (updateScope === "series") {
                    await updateTask(taskId, updates, { updateScope });
                } else {
                    await updateTask(taskId, updates);
                }
                if (previousTask) {
                    showTaskUndo(
                        buildUpdateTaskUndo(previousTask, updates, updateScope),
                    );
                }
                setPendingTaskEdit(null);
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
        [clearUndoState, closeDetailPanel, pendingTaskEdit, reloadTasks, showTaskUndo],
    );

    const navigateCalendar = useCallback((direction: "prev" | "next") => {
        const api = calendarRef.current?.getApi();
        if (!api) {
            return;
        }

        if (direction === "prev") {
            startCalendarTransition("prev");
            api.prev();
        } else {
            startCalendarTransition("next");
            api.next();
        }
    }, [startCalendarTransition]);

    const goToToday = useCallback(() => {
        startCalendarTransition("today");
        calendarRef.current?.getApi().today();
    }, [startCalendarTransition]);

    const changeCalendarView = useCallback((nextView: CalendarView) => {
        startCalendarTransition("view");
        calendarRef.current?.getApi().changeView(nextView);
        setIsYearPickerOpen(false);
    }, [startCalendarTransition]);

    const cycleCalendarView = useCallback(() => {
        changeCalendarView(calendarViewCycle[calendarView]);
    }, [calendarView, changeCalendarView]);

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
            startCalendarTransition("today");
            calendarRef.current?.getApi().gotoDate(nextDate);
            setIsYearPickerOpen(false);
        },
        [calendarDate, calendarView, startCalendarTransition, yearDraft],
    );

    const handleEventDrop = useCallback(
        async (dropInfo: EventDropArg) => {
            const task = tasks.find((item) => item.id === dropInfo.event.id);
            const updates = getCalendarEventScheduleUpdate(dropInfo.event);
            clearUndoState();

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
                if (task) {
                    showTaskUndo(
                        buildUpdateTaskUndo(task, updates, "single", "Task moved."),
                    );
                }
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
        [clearUndoState, reloadTasks, showTaskUndo, tasks],
    );

    const handleEventResize = useCallback(
        async (resizeInfo: EventResizeDoneArg) => {
            const task = tasks.find((item) => item.id === resizeInfo.event.id);
            const updates = getCalendarEventScheduleUpdate(resizeInfo.event);
            clearUndoState();

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
                if (task) {
                    showTaskUndo(
                        buildUpdateTaskUndo(
                            task,
                            updates,
                            "single",
                            "Task resized.",
                        ),
                    );
                }
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
        [clearUndoState, reloadTasks, showTaskUndo, tasks],
    );

    const openCreatePanel = useCallback(
        (start: Date, end: Date) => {
            setFormError(null);
            setIsViewMenuOpen(false);
            setIsCategoryMenuOpen(false);
            setIsAddingCategory(false);
            setContextMenu(null);
            if (isNarrowScreen()) {
                setIsSidebarOpen(true);
                setMobileScreen("calendar");
            }
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

    const openTaskDetailPanel = useCallback((taskId: string) => {
        setFormError(null);
        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setIsAddingCategory(false);
        setContextMenu(null);
        setIsDetailPanelClosing(false);
        if (isNarrowScreen()) {
            setIsSidebarOpen(true);
        }
        setDetailPanelMode("edit");
        setSelectedTaskId(taskId);
    }, []);

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
            if (calendarView === "dayGridMonth" && isNarrowScreen()) {
                setMobileMonthPreviewDate(clickInfo.date);
                return;
            }

            const start = clickInfo.date;
            const end = clickInfo.allDay
                ? addLocalDays(start, 1)
                : new Date(start.getTime() + 60 * 60 * 1000);
            openCreatePanel(start, end);
        },
        [calendarView, openCreatePanel],
    );

    const handleCheckboxChange = useCallback(
        async (task: ScheduledTask) => {
            clearUndoState();
            try {
                if (task.completed) {
                    await uncompleteTask(task.id);
                } else {
                    await completeTask(task.id);
                }
                showTaskUndo({
                    kind: "update",
                    task,
                    restoreFields: ["completed"],
                    message: task.completed
                        ? "Task marked incomplete."
                        : "Task completed.",
                });
                reloadTasks();
            } catch (error) {
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to update task",
                );
            }
        },
        [clearUndoState, reloadTasks, showTaskUndo],
    );

    const completionTransition = useMemo(
        () =>
            prefersReducedMotion
                ? { duration: 0 }
                : motionTimings.completion,
        [prefersReducedMotion],
    );
    const panelTransition = useMemo(
        () =>
            prefersReducedMotion
                ? { duration: 0 }
                : motionTimings.panel,
        [prefersReducedMotion],
    );
    const panelVariants = useMemo(
        () => ({
            hidden: { opacity: 0, x: 12 },
            visible: { opacity: 1, x: 0 },
            exit: { opacity: 0, x: 12 },
        }),
        [],
    );
    useEffect(() => {
        if (!isDetailPanelClosing) {
            return;
        }

        const fallbackDelay = prefersReducedMotion
            ? 0
            : motionTimings.panel.duration * 1000 + 100;
        const fallbackTimer = window.setTimeout(() => {
            setIsDetailPanelClosing(false);
        }, fallbackDelay);

        return () => {
            window.clearTimeout(fallbackTimer);
        };
    }, [isDetailPanelClosing, prefersReducedMotion]);
    useEffect(() => {
        if (
            detailPanelMode !== "edit" ||
            isDetailPanelClosing ||
            taskState.status === "loading" ||
            taskState.status === "refreshing" ||
            !selectedTaskId ||
            selectedTask
        ) {
            return;
        }

        closeDetailPanel();
    }, [
        closeDetailPanel,
        detailPanelMode,
        isDetailPanelClosing,
        selectedTask,
        selectedTaskId,
        taskState.status,
    ]);
    const dropdownTransition = useMemo(
        () =>
            prefersReducedMotion
                ? { duration: 0 }
                : motionTimings.dropdown,
        [prefersReducedMotion],
    );
    const dropdownVariants = useMemo(
        () => ({
            hidden: { opacity: 0, y: -4, scale: 0.98 },
            visible: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: -4, scale: 0.98 },
        }),
        [],
    );
    const calendarDropTargetLabelTransition = useMemo(
        () =>
            prefersReducedMotion
                ? { duration: 0 }
                : { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const },
        [prefersReducedMotion],
    );
    const calendarDropTargetLabelVariants = useMemo(
        () => ({
            hidden: { opacity: 0, y: -10, scale: 0.985 },
            visible: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: -10, scale: 0.985 },
        }),
        [],
    );
    const taskContentVariants = useMemo(
        () => ({
            hidden: { opacity: 0, y: 8 },
            visible: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -8 },
        }),
        [],
    );
    const taskContentKey = `${activeView}-${categoryFilterKey}-${upcomingDays}`;

    const renderDayCellContent = useCallback((dayCellInfo: DayCellContentArg) => {
        return (
            <div className="calendar-month-day-cell-content">
                <span className="calendar-month-day-number">
                    {dayCellInfo.dayNumberText}
                </span>
            </div>
        );
    }, []);

    const renderEventContent = useCallback(
        (eventInfo: EventContentArg) => {
            const task =
                (eventInfo.event.extendedProps.task as ScheduledTask | undefined) ??
                tasksRef.current.find((item) => item.id === eventInfo.event.id);
            const isMobileMonthEvent =
                eventInfo.view.type === "dayGridMonth" && isNarrowScreen();

            if (!task) {
                return (
                    <div
                        className={
                            isMobileMonthEvent
                                ? "calendar-task calendar-task-month-summary"
                                : "calendar-task"
                        }
                    >
                        <span className="calendar-task-title task-title">
                            {eventInfo.event.title}
                        </span>
                    </div>
                );
            }

            if (isMobileMonthEvent) {
                return (
                    <div className="calendar-task calendar-task-month-summary">
                        <span
                            className={
                                task.completed
                                    ? "calendar-task-title task-title completed"
                                    : "calendar-task-title task-title"
                            }
                        >
                            {task.title}
                        </span>
                    </div>
                );
            }

            return (
                <div className="calendar-task">
                    <motion.input
                        type="checkbox"
                        className="task-checkbox"
                        checked={task.completed}
                        animate={{
                            scale: task.completed ? [1, 1.08, 1] : 1,
                        }}
                        transition={completionTransition}
                        onChange={() => void handleCheckboxChange(task)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Toggle ${task.title}`}
                    />
                    <motion.span
                        className={
                            task.completed
                                ? "calendar-task-title task-title completed"
                                : "calendar-task-title task-title"
                        }
                        animate={{ opacity: task.completed ? 0.72 : 1 }}
                        transition={completionTransition}
                    >
                        {task.title}
                    </motion.span>
                </div>
            );
        },
        [completionTransition, handleCheckboxChange],
    );

    const handleEventClick = useCallback((clickInfo: EventClickArg) => {
        if (
            clickInfo.view.type === "dayGridMonth" &&
            isNarrowScreen() &&
            clickInfo.event.start
        ) {
            setMobileMonthPreviewDate(clickInfo.event.start);
            return;
        }

        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setIsAddingCategory(false);
        if (isNarrowScreen()) {
            setIsSidebarOpen(true);
            setMobileScreen("calendar");
        }
        setDetailPanelMode("edit");
        setSelectedTaskId(clickInfo.event.id);
        setContextMenu(null);
    }, []);

    const applyLocalUnscheduledOrder = useCallback((nextOrder: string[]) => {
        unscheduledOrderRef.current = nextOrder;
        setUnscheduledOrder(nextOrder);
    }, []);

    const persistUnscheduledOrder = useCallback(
        (nextOrder: string[]) => {
            const saveState = unscheduledOrderSaveStateRef.current;
            saveState.queued = nextOrder;
            if (saveState.saving) {
                return;
            }

            saveState.saving = true;
            void (async () => {
                while (saveState.queued) {
                    const orderToSave = saveState.queued;
                    saveState.queued = null;

                    try {
                        clearUndoState();
                        const updates = buildUnscheduledOrderUpdates(
                            orderToSave,
                            tasksRef.current,
                        );
                        if (updates.length === 0) {
                            continue;
                        }

                        const updatedTasks = await Promise.all(
                            updates.map(({ taskId, unscheduled_order }) =>
                                updateTask(taskId, { unscheduled_order }),
                            ),
                        );
                        replaceTasksInState(updatedTasks);
                    } catch (error) {
                        setFormError(
                            error instanceof Error
                                ? error.message
                                : "Unable to save no time task order",
                        );
                        applyLocalUnscheduledOrder([]);
                        void refreshTasks();
                    }
                }

                saveState.saving = false;
            })();
        },
        [applyLocalUnscheduledOrder, clearUndoState, refreshTasks, replaceTasksInState],
    );

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
            if (dragTargetMode === "schedule") {
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

            setDragTargetMode("reorder");
            preventDefault();
            draggedUnscheduledTaskIdRef.current = taskId;
            suppressTaskRowClickRef.current = taskId;

            const dropTarget = getTaskReorderTarget(taskId, clientY);
            if (!dropTarget) {
                return;
            }

            const nextOrder = moveTaskIdRelative(
                unscheduledOrderRef.current,
                taskId,
                dropTarget.targetTaskId,
                dropTarget.position,
            );
            if (areStringArraysEqual(unscheduledOrderRef.current, nextOrder)) {
                return;
            }

            applyLocalUnscheduledOrder(nextOrder);
            pointerState.startX = clientX;
            pointerState.startY = clientY;
        },
        [activeView, applyLocalUnscheduledOrder, dragTargetMode],
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
            if (pointerState.dragging) {
                setDragTargetMode(null);
            }
            if (
                pointerState.dragging &&
                !areStringArraysEqual(
                    pointerState.orderAtStart,
                    unscheduledOrderRef.current,
                )
            ) {
                persistUnscheduledOrder(unscheduledOrderRef.current);
            }
            taskRowPointerStateRef.current = null;
        },
        [persistUnscheduledOrder],
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
            if (isInteractiveTaskRowTarget(event.target)) {
                return;
            }

            taskRowPointerStateRef.current = {
                taskId,
                startX: event.clientX,
                startY: event.clientY,
                dragging: false,
                orderAtStart: unscheduledOrderRef.current,
            };
            setDragTargetMode(null);
            suppressTaskRowClickRef.current = null;
            if (activeView === "unscheduled") {
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

    const moveUnscheduledTaskToTop = useCallback(
        (taskId: string) => {
            if (activeView !== "unscheduled") {
                return;
            }

            const nextOrder = moveTaskIdToTop(unscheduledOrderRef.current, taskId);
            if (
                areStringArraysEqual(unscheduledOrderRef.current, nextOrder)
            ) {
                return;
            }

            applyLocalUnscheduledOrder(nextOrder);
            persistUnscheduledOrder(nextOrder);
        },
        [activeView, applyLocalUnscheduledOrder, persistUnscheduledOrder],
    );

    const moveUnscheduledTaskByOffset = useCallback(
        (taskId: string, offset: number) => {
            if (activeView !== "unscheduled" || offset === 0) {
                return;
            }

            const currentOrder = unscheduledOrderRef.current;
            const currentIndex = currentOrder.indexOf(taskId);
            if (currentIndex < 0) {
                return;
            }

            const nextIndex = currentIndex + offset;
            if (nextIndex < 0 || nextIndex >= currentOrder.length) {
                return;
            }

            const nextOrder = [...currentOrder];
            [nextOrder[currentIndex], nextOrder[nextIndex]] = [
                nextOrder[nextIndex],
                nextOrder[currentIndex],
            ];

            if (areStringArraysEqual(currentOrder, nextOrder)) {
                return;
            }

            applyLocalUnscheduledOrder(nextOrder);
            persistUnscheduledOrder(nextOrder);
        },
        [activeView, applyLocalUnscheduledOrder, persistUnscheduledOrder],
    );

    const endScheduleDragHighlight = useCallback(() => {
        scheduleDragCleanupRef.current?.();
        scheduleDragCleanupRef.current = null;
        setDragTargetMode((current) => (current === "schedule" ? null : current));
    }, []);

    const startScheduleDragHighlight = useCallback(() => {
        endScheduleDragHighlight();
        setDragTargetMode("schedule");

        const clear = () => {
            scheduleDragCleanupRef.current = null;
            setDragTargetMode((current) =>
                current === "schedule" ? null : current,
            );
        };

        const handlePointerUp = () => clear();
        const handlePointerCancel = () => clear();

        window.addEventListener("pointerup", handlePointerUp, { once: true });
        window.addEventListener("mouseup", handlePointerUp, { once: true });
        window.addEventListener("pointercancel", handlePointerCancel, {
            once: true,
        });

        scheduleDragCleanupRef.current = () => {
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("mouseup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerCancel);
            clear();
        };
    }, [endScheduleDragHighlight]);

    useEffect(() => {
        return () => {
            endScheduleDragHighlight();
        };
    }, [endScheduleDragHighlight]);

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
                showTaskUndo(
                    buildUpdateTaskUndo(task, updates, "single", "Task moved."),
                );
                replaceTaskInState(updatedTask);
                void refreshTasks();
            } catch (error) {
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to schedule task",
                );
            } finally {
                endScheduleDragHighlight();
            }
        },
        [
            endScheduleDragHighlight,
            refreshTasks,
            replaceTaskInState,
            showTaskUndo,
        ],
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
        if (!mountInfo.isMirror) {
            const animationKind = calendarEventAnimationKindRef.current;
            mountInfo.el.style.setProperty(
                "--calendar-task-event-enter-duration",
                `${motionTimings.calendarEventEnterMs}ms`,
            );
            mountInfo.el.classList.add("calendar-task-event");
            mountInfo.el.classList.add("calendar-task-event--enter");
            mountInfo.el.classList.add(
                `calendar-task-event--enter-${animationKind}`,
            );
        }

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

        const recurrenceUntilError = validateRecurrenceUntil(
            formState.recurrence_frequency,
            formState.recurrence_until,
            formState.scheduled_start,
        );
        if (recurrenceUntilError) {
            setFormError(recurrenceUntilError);
            return;
        }

        clearUndoState();
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

    const handleMoveToNoTime = useCallback(() => {
        if (detailPanelMode === "create") {
            setFormState((current) => ({
                ...current,
                scheduled_start: "",
                scheduled_end: "",
            }));
            return;
        }

        if (detailPanelMode === "edit") {
            setEditState((current) =>
                current
                    ? {
                          ...current,
                          scheduled_start: "",
                          scheduled_end: "",
                      }
                    : current,
            );
        }
    }, [detailPanelMode]);

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

        const recurrenceUntilError = validateRecurrenceUntil(
            editState.recurrence_frequency,
            editState.recurrence_until,
            editState.scheduled_start,
        );
        if (recurrenceUntilError) {
            setFormError(recurrenceUntilError);
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

    const handleDuplicateFromMenu = async () => {
        if (!contextMenu || contextMenu.kind !== "task") {
            return;
        }

        const sourceTask = tasks.find((item) => item.id === contextMenu.id);
        if (!sourceTask) {
            setContextMenu(null);
            return;
        }

        setFormError(null);
        clearUndoState();
        setIsDuplicating(true);

        try {
            const duplicatedTask = await createTask(
                buildDuplicateTaskInput(sourceTask),
            );

            replaceTaskInState(duplicatedTask);
            setContextMenu(null);

            if (!duplicatedTask.scheduled_start && !duplicatedTask.scheduled_end) {
                const nextOrder = moveTaskIdRelative(
                    unscheduledOrderRef.current,
                    duplicatedTask.id,
                    sourceTask.id,
                    "after",
                );
                applyLocalUnscheduledOrder(nextOrder);
            }

            reloadTasks();
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to duplicate task",
            );
        } finally {
            setIsDuplicating(false);
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
        setIsWorkingHoursSettingsOpen(false);
        setIsWebhookSettingsOpen(true);
        setIsBackupSettingsOpen(false);
        setWebhookTestMessage(null);
        setWebhookSettingsDraft({
            discord_webhook_url: webhookSettings?.discord_webhook_url ?? "",
            discord_message_template:
                webhookSettings?.discord_message_template ?? "",
        });
        setIsSettingsMenuOpen(false);
    };

    const handleToggleAllCategories = (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (areAllCategoriesVisible) {
            setAreAllCategoriesVisible(false);
            setCategoryVisibility(
                previousCategoryVisibilityRef.current ??
                    createDefaultCategoryVisibility(taskLists),
            );
            return;
        }

        previousCategoryVisibilityRef.current = categoryVisibility;
        setCategoryVisibility(createDefaultCategoryVisibility(taskLists));
        setAreAllCategoriesVisible(true);
    };

    const handleToggleUncategorized = (
        event: ReactMouseEvent<HTMLButtonElement>,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        if (areAllCategoriesVisible) {
            return;
        }

        setCategoryVisibility((current) => ({
            ...current,
            none: !current.none,
        }));
    };

    const handleToggleTaskListVisibility = (
        taskListId: string,
        event: ReactMouseEvent<HTMLButtonElement>,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        if (areAllCategoriesVisible) {
            return;
        }

        setCategoryVisibility((current) => ({
            ...current,
            lists: {
                ...current.lists,
                [taskListId]: !(current.lists[taskListId] ?? true),
            },
        }));
    };

    const toggleSidebar = () => {
        setIsSettingsMenuOpen(false);
        setIsBackupSettingsOpen(false);
        setIsWebhookSettingsOpen(false);
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

    const appShellStyle: CSSProperties = {
        "--sidebar-width": `${isSidebarOpen ? Math.max(240, sidebarWidth) : 0}px`,
        "--sidebar-resizer-width": `${isSidebarOpen ? 12 : 0}px`,
    } as CSSProperties;
    const isSettingsSubviewOpen =
        isSettingsMenuOpen ||
        isWorkingHoursSettingsOpen ||
        isWebhookSettingsOpen ||
        isBackupSettingsOpen;
    const openMobileTaskScreen = useCallback(
        (screen: Extract<MobileScreen, "today" | "upcoming" | "unscheduled">) => {
            setMobileScreen(screen);
            setActiveView(screen);
            setIsSidebarOpen(true);
            setIsSettingsMenuOpen(false);
            setIsWorkingHoursSettingsOpen(false);
            setIsWebhookSettingsOpen(false);
            setIsBackupSettingsOpen(false);
            closeDetailPanel();
        },
        [closeDetailPanel],
    );
    const openMobileCalendarScreen = useCallback(() => {
        setMobileScreen("calendar");
        setIsSidebarOpen(false);
        setIsSettingsMenuOpen(false);
        setIsWorkingHoursSettingsOpen(false);
        setIsWebhookSettingsOpen(false);
        setIsBackupSettingsOpen(false);
        closeDetailPanel();
        window.setTimeout(() => {
            calendarRef.current?.getApi().updateSize();
        }, 0);
    }, [closeDetailPanel]);
    const openMobileSettingsScreen = useCallback(() => {
        setMobileScreen("settings");
        closeDetailPanel();
        setIsSidebarOpen(true);
        setIsWorkingHoursSettingsOpen(false);
        setIsWebhookSettingsOpen(false);
        setIsBackupSettingsOpen(false);
        setIsSettingsMenuOpen(true);
    }, [closeDetailPanel]);

    if (!authToken) {
        return (
            <AuthScreen
                authMode={authMode}
                formState={authFormState}
                error={authError}
                isSubmitting={isAuthSubmitting}
                onSubmit={handleAuthSubmit}
                onChange={setAuthFormState}
                onModeChange={(mode) => {
                    setAuthMode(mode);
                    setAuthFormState({ username: "", password: "" });
                    setAuthError(null);
                }}
            />
        );
    }

    return (
        <main
            ref={appShellRef}
            className={`app-shell ${themeMode} ${isSidebarOpen ? "sidebar-open" : "sidebar-collapsed"} mobile-screen-${mobileScreen} ${detailPanelMode ? "detail-panel-open" : ""}`}
            style={appShellStyle}
            onTransitionEnd={(event) => {
                if (
                    event.target === event.currentTarget &&
                    event.propertyName === "grid-template-columns"
                ) {
                    scheduleCalendarResize();
                }
            }}
            onClick={() => {
                setIsSettingsMenuOpen(false);
                setIsWorkingHoursSettingsOpen(false);
                setIsWebhookSettingsOpen(false);
                setIsBackupSettingsOpen(false);
                setContextMenu(null);
                setIsViewMenuOpen(false);
                setIsCategoryMenuOpen(false);
            }}
        >
            <nav className="mobile-app-nav" aria-label="Mobile app navigation">
                <button
                    type="button"
                    aria-label="Mobile Today"
                    className={`mobile-app-nav-button ${mobileScreen === "today" ? "active" : ""}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        openMobileTaskScreen("today");
                    }}
                >
                    Today
                </button>
                <button
                    type="button"
                    aria-label="Mobile Upcoming"
                    className={`mobile-app-nav-button ${mobileScreen === "upcoming" ? "active" : ""}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        openMobileTaskScreen("upcoming");
                    }}
                >
                    Upcoming
                </button>
                <button
                    type="button"
                    aria-label="Mobile Inbox"
                    className={`mobile-app-nav-button ${mobileScreen === "unscheduled" ? "active" : ""}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        openMobileTaskScreen("unscheduled");
                    }}
                >
                    Inbox
                </button>
                <button
                    type="button"
                    aria-label="Mobile Calendar"
                    className={`mobile-app-nav-button ${mobileScreen === "calendar" ? "active" : ""}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        openMobileCalendarScreen();
                    }}
                >
                    Calendar
                </button>
                <button
                    type="button"
                    aria-label="Mobile Settings"
                    className={`mobile-app-nav-button ${mobileScreen === "settings" ? "active" : ""}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        openMobileSettingsScreen();
                    }}
                >
                    Settings
                </button>
            </nav>
            <aside
                className={`task-sidebar ${isSidebarOpen ? "task-sidebar-open" : "task-sidebar-collapsed"}`}
                aria-hidden={!isSidebarOpen}
                inert={!isSidebarOpen}
                onTransitionEnd={(event) => {
                    if (
                        event.target === event.currentTarget &&
                        (event.propertyName === "opacity" ||
                            event.propertyName === "transform" ||
                            event.propertyName === "padding-right")
                    ) {
                        scheduleCalendarResize();
                    }
                }}
            >
                <div className="sidebar-header">
                    {currentUser && (
                        <p className="sidebar-greeting">
                            Hello, {currentUser.username}
                        </p>
                    )}
                    <div className="sidebar-header-actions">
                        <div
                            className="settings-menu"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <button
                                type="button"
                                className="theme-toggle settings-toggle"
                                aria-label={
                                    isSettingsSubviewOpen
                                        ? "Return to sidebar"
                                        : "Settings"
                                }
                                aria-expanded={isSettingsSubviewOpen}
                                onClick={() => {
                                    closeDetailPanel();
                                    setIsWorkingHoursSettingsOpen(false);
                                    setIsWebhookSettingsOpen(false);
                                    setIsBackupSettingsOpen(false);
                                    setIsSettingsMenuOpen((current) =>
                                        isSettingsSubviewOpen ? false : !current,
                                    );
                                }}
                            >
                                <span aria-hidden="true">
                                    {isSettingsSubviewOpen ? "☰" : "⚙"}
                                </span>
                            </button>
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

                    <AnimatePresence initial={false} mode="wait">
                        {!detailPanelMode && isSettingsMenuOpen && (
                            <motion.section
                                key="settings-menu"
                                className="filter-section settings-menu-panel"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
                                <div className="sidebar-settings-list">
                                    <div className="sidebar-settings-row">
                                        <span>Dark mode</span>
                                        <button
                                            type="button"
                                            className={`sidebar-switch ${themeMode === "dark" ? "sidebar-switch-on" : ""}`}
                                            role="switch"
                                            aria-label="Dark mode"
                                            aria-checked={themeMode === "dark"}
                                            onClick={() =>
                                                setThemeMode(
                                                    themeMode === "dark"
                                                        ? "light"
                                                        : "dark",
                                                )
                                            }
                                        >
                                            <span className="sidebar-switch-knob" />
                                        </button>
                                    </div>
                                    <div className="sidebar-settings-row">
                                        <span>Show completed tasks</span>
                                        <button
                                            type="button"
                                            className={`sidebar-switch ${showCompletedTasks ? "sidebar-switch-on" : ""}`}
                                            role="switch"
                                            aria-label="Show completed tasks"
                                            aria-checked={showCompletedTasks}
                                            onClick={() =>
                                                setShowCompletedTasks(
                                                    (current) => !current,
                                                )
                                            }
                                        >
                                            <span className="sidebar-switch-knob" />
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        className="filter-option"
                                        onClick={() => {
                                            setIsSettingsMenuOpen(false);
                                            setIsWorkingHoursSettingsOpen(true);
                                        }}
                                    >
                                        Working hours
                                    </button>
                                    <button
                                        type="button"
                                        className="filter-option"
                                        onClick={openWebhookSettings}
                                    >
                                        Webhook
                                    </button>
                                    <button
                                        type="button"
                                        className="filter-option"
                                        onClick={() => {
                                            setBackupImportMessage(null);
                                            setBackupImportError(null);
                                            setIsWorkingHoursSettingsOpen(false);
                                            setIsSettingsMenuOpen(false);
                                            setIsBackupSettingsOpen(true);
                                        }}
                                    >
                                        Backup &amp; Restore
                                    </button>
                                    <button
                                        type="button"
                                        className="filter-option"
                                        onClick={handleLogout}
                                    >
                                        Logout
                                    </button>
                                </div>
                            </motion.section>
                        )}
                        {!detailPanelMode && isWorkingHoursSettingsOpen && (
                            <motion.section
                                key="working-hours-settings"
                                className="filter-section"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
                                <form
                                    className="task-form working-hours-form"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <h3 className="working-hours-title">
                                        Working hours
                                    </h3>
                                    <label>
                                        <span>Start time</span>
                                        <input
                                            type="time"
                                            lang="en-GB"
                                            min="00:00"
                                            max="23:00"
                                            step="3600"
                                            value={workingHours.start}
                                            onChange={(event) =>
                                                updateWorkingHours({
                                                    start: event.target.value,
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        <span>End time</span>
                                        <input
                                            type="time"
                                            lang="en-GB"
                                            min="00:00"
                                            max="23:00"
                                            step="3600"
                                            value={workingHours.end}
                                            onChange={(event) =>
                                                updateWorkingHours({
                                                    end: event.target.value,
                                                })
                                            }
                                        />
                                    </label>
                                    <div className="task-form-actions">
                                        <button
                                            type="button"
                                            className="ghost-button"
                                            onClick={() => {
                                                setIsWorkingHoursSettingsOpen(false);
                                                setIsSettingsMenuOpen(true);
                                            }}
                                        >
                                            Back
                                        </button>
                                    </div>
                                </form>
                            </motion.section>
                        )}
                        {!detailPanelMode && isBackupSettingsOpen && (
                            <motion.section
                                key="backup-settings"
                                className="filter-section backup-settings-panel"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
                                <div className="task-form backup-settings-form">
                                    <input
                                        ref={backupFileInputRef}
                                        className="visually-hidden"
                                        type="file"
                                        aria-label="Import backup (.json)"
                                        accept="application/json,.json"
                                        onChange={handleBackupImportFileChange}
                                        disabled={isBackupImporting}
                                    />
                                    {backupSummary && (
                                        <div className="backup-summary">
                                            <div>
                                                <span>Tasks:</span>{" "}
                                                {backupSummary.tasks.length}
                                            </div>
                                            <div>
                                                <span>Categories:</span>{" "}
                                                {backupSummary.task_lists.length}
                                            </div>
                                            <div>
                                                <span>Schema version:</span>{" "}
                                                {backupSummary.schema_version}
                                            </div>
                                            <div>
                                                <span>Exported:</span>{" "}
                                                {formatBackupDate(
                                                    backupSummary.exported_at,
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {backupImportFile ? (
                                        <p className="form-error">
                                            Importing this backup will
                                            replace existing calendar and
                                            account data for this account.
                                            Confirm once to continue.
                                        </p>
                                    ) : (
                                        <p className="muted">
                                            Restore will replace existing
                                            calendar and account data for this
                                            account.
                                        </p>
                                    )}
                                    <button
                                        type="button"
                                        className="backup-action-button backup-action-button-primary"
                                        disabled={isBackupLoading}
                                        onClick={() =>
                                            void handleOpenBackupSummary()
                                        }
                                    >
                                        {isBackupLoading
                                            ? "Backing up..."
                                            : "Backup"}
                                    </button>
                                    <button
                                        type="button"
                                        className="backup-action-button backup-action-button-danger"
                                        disabled={isBackupImporting}
                                        onClick={() => {
                                            if (backupImportFile) {
                                                void handleConfirmBackupImport(
                                                    backupImportFile,
                                                );
                                                return;
                                            }
                                            backupFileInputRef.current?.click();
                                        }}
                                    >
                                        {isBackupImporting
                                            ? "Restoring..."
                                            : backupImportFile
                                              ? "Confirm restore"
                                              : "Restore"}
                                    </button>
                                    <button
                                        type="button"
                                        className="ghost-button"
                                        disabled={
                                            isBackupLoading || isBackupImporting
                                        }
                                        onClick={() => {
                                            setIsWorkingHoursSettingsOpen(false);
                                            setIsBackupSettingsOpen(false);
                                            setIsSettingsMenuOpen(true);
                                        }}
                                    >
                                        Back
                                    </button>
                                    {backupImportFile && (
                                        <p className="muted">
                                            Selected: {backupImportFile.name}
                                        </p>
                                    )}
                                    {backupImportMessage && (
                                        <p className="webhook-test-success">
                                            {backupImportMessage}
                                        </p>
                                    )}
                                    {backupImportError && (
                                        <p className="form-error">
                                            {backupImportError}
                                        </p>
                                    )}
                                </div>
                            </motion.section>
                        )}
                        {!detailPanelMode && isWebhookSettingsOpen && (
                            <motion.section
                                key="webhook-settings"
                                className="filter-section"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
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
                                                setIsWorkingHoursSettingsOpen(false);
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
                                                setIsSettingsMenuOpen(true);
                                            }}
                                        >
                                            Back
                                        </button>
                                    </div>
                                </form>
                            </motion.section>
                        )}
                    </AnimatePresence>

                    {!detailPanelMode &&
                        !isDetailPanelClosing &&
                        !isSettingsMenuOpen &&
                        !isWorkingHoursSettingsOpen &&
                        !isBackupSettingsOpen &&
                        !isWebhookSettingsOpen && (
                        <section
                            className="filter-section"
                            aria-label="Task filters"
                        >
                            <div className="filter-field task-view-filter-field">
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
                                    <AnimatePresence initial={false}>
                                        {isViewMenuOpen && (
                                            <motion.div
                                                key="view-menu"
                                                className="filter-menu"
                                                role="listbox"
                                                aria-label="Task view options"
                                                variants={dropdownVariants}
                                                initial="hidden"
                                                animate="visible"
                                                exit="exit"
                                                transition={
                                                    dropdownTransition
                                                }
                                            >
                                                {taskViews.map((view) => (
                                                    <button
                                                        key={view.id}
                                                        type="button"
                                                        className={`filter-option ${activeView === view.id ? "active" : ""}`}
                                                        onClick={() => {
                                                            setActiveView(
                                                                view.id,
                                                            );
                                                            setIsViewMenuOpen(
                                                                false,
                                                            );
                                                        }}
                                                    >
                                                        {view.label}
                                                    </button>
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
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
                                    <AnimatePresence initial={false}>
                                        {isCategoryMenuOpen && (
                                            <motion.div
                                                key="category-menu"
                                                className="filter-menu"
                                                role="listbox"
                                                aria-label="Task category options"
                                                variants={dropdownVariants}
                                                initial="hidden"
                                                animate="visible"
                                                exit="exit"
                                                transition={
                                                    dropdownTransition
                                                }
                                            >
                                                <div className="category-filter-row">
                                                    <span className="category-filter-label">
                                                        <span
                                                            className="category-swatch category-swatch-empty"
                                                            aria-hidden="true"
                                                        />
                                                        <span>All</span>
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className={`sidebar-switch ${areAllCategoriesVisible ? "sidebar-switch-on" : ""}`}
                                                        role="switch"
                                                        aria-label="All"
                                                        aria-checked={
                                                            areAllCategoriesVisible
                                                        }
                                                        onClick={
                                                            handleToggleAllCategories
                                                        }
                                                    >
                                                        <span className="sidebar-switch-knob" />
                                                    </button>
                                                </div>
                                                <div
                                                    className={`category-filter-row ${areAllCategoriesVisible ? "category-filter-row-disabled" : ""}`}
                                                >
                                                    <span className="category-filter-label">
                                                        <span
                                                            className="category-swatch category-swatch-empty"
                                                            aria-hidden="true"
                                                        />
                                                        <span>None</span>
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className={`sidebar-switch ${categoryVisibility.none ? "sidebar-switch-on" : ""}`}
                                                        role="switch"
                                                        aria-label="None"
                                                        aria-checked={
                                                            categoryVisibility.none
                                                        }
                                                        disabled={
                                                            areAllCategoriesVisible
                                                        }
                                                        onClick={
                                                            handleToggleUncategorized
                                                        }
                                                    >
                                                        <span className="sidebar-switch-knob" />
                                                    </button>
                                                </div>
                                                {taskLists.map((taskList) => (
                                                    <div
                                                        key={taskList.id}
                                                        className={`filter-option-row ${areAllCategoriesVisible ? "category-filter-row-disabled" : ""} category-filter-option-row`}
                                                    >
                                                        <div
                                                            className="category-filter-row category-filter-row-custom"
                                                            onContextMenu={
                                                                isNarrowScreen()
                                                                    ? undefined
                                                                    : (
                                                                          event,
                                                                      ) => {
                                                                          event.preventDefault();
                                                                          setContextMenu(
                                                                              {
                                                                                  kind: "category",
                                                                                  id: taskList.id,
                                                                                  x: event.clientX,
                                                                                  y: event.clientY,
                                                                              },
                                                                          );
                                                                      }
                                                            }
                                                        >
                                                            <span className="category-filter-label">
                                                                <span
                                                                    className="category-swatch"
                                                                    style={{
                                                                        backgroundColor:
                                                                            taskList.color,
                                                                    }}
                                                                    aria-hidden="true"
                                                                />
                                                                <span>
                                                                    {
                                                                        taskList.name
                                                                    }
                                                                </span>
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className="filter-option-action category-filter-action"
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
                                                            <button
                                                                type="button"
                                                                className={`sidebar-switch ${(categoryVisibility.lists[taskList.id] ?? true) ? "sidebar-switch-on" : ""}`}
                                                                role="switch"
                                                                aria-label={
                                                                    taskList.name
                                                                }
                                                                aria-checked={
                                                                    categoryVisibility
                                                                        .lists[
                                                                        taskList
                                                                            .id
                                                                    ] ?? true
                                                                }
                                                                disabled={
                                                                    areAllCategoriesVisible
                                                                }
                                                                onClick={(
                                                                    event,
                                                                ) =>
                                                                    handleToggleTaskListVisibility(
                                                                        taskList.id,
                                                                        event,
                                                                    )
                                                                }
                                                            >
                                                                <span className="sidebar-switch-knob" />
                                                            </button>
                                                        </div>
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
                                        </motion.div>
                                    )}
                                </AnimatePresence>
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

                    <AnimatePresence
                        initial={false}
                        mode="wait"
                        onExitComplete={() => setIsDetailPanelClosing(false)}
                    >
                        {detailPanelMode && (
                            <motion.section
                                key={detailPanelMode}
                                className="task-detail-panel mobile-task-sheet"
                                aria-label={
                                    detailPanelMode === "create"
                                        ? "Create task panel"
                                        : "Edit task panel"
                                }
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
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
                                        <button
                                            type="button"
                                            className="task-form-no-time-button"
                                            onClick={handleMoveToNoTime}
                                        >
                                            Clear time
                                        </button>
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
                                        <button
                                            type="button"
                                            className="task-form-no-time-button"
                                            onClick={handleMoveToNoTime}
                                        >
                                            Clear time
                                        </button>
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
                                                className="task-checkbox task-checkbox--compact"
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
                                </motion.section>
                        )}
                    </AnimatePresence>

                    {!detailPanelMode &&
                        !isDetailPanelClosing &&
                        !isSettingsMenuOpen &&
                        !isWorkingHoursSettingsOpen &&
                        !isBackupSettingsOpen &&
                        !isWebhookSettingsOpen && (
            <section
                ref={taskListRef}
                className={`task-list ${dragTargetMode === "reorder" ? "drag-target-list-active" : ""}`}
                aria-label={`${activeView} tasks`}
            >
                            <motion.div
                                key={taskContentKey}
                                className="task-list-content"
                                variants={taskContentVariants}
                                initial="hidden"
                                animate="visible"
                                transition={dropdownTransition}
                            >
                                {isInitialTaskLoad && (
                                    <motion.p
                                        className="muted"
                                        variants={dropdownVariants}
                                        initial="hidden"
                                        animate="visible"
                                        transition={dropdownTransition}
                                    >
                                        Loading tasks...
                                    </motion.p>
                                )}
                                {taskState.status === "error" && (
                                    <motion.p
                                        className="form-error"
                                        variants={dropdownVariants}
                                        initial="hidden"
                                        animate="visible"
                                        transition={dropdownTransition}
                                    >
                                        {taskState.message}
                                    </motion.p>
                                )}
                                {taskState.status === "ready" &&
                                    orderedVisibleTasks.length === 0 && (
                                        <motion.p
                                            className="muted"
                                            variants={dropdownVariants}
                                            initial="hidden"
                                            animate="visible"
                                            transition={dropdownTransition}
                                        >
                                            No tasks in this view.
                                        </motion.p>
                                    )}
                                {orderedVisibleTasks.map(
                                            (task, taskIndex) => (
                                                <motion.div
                                                    key={task.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    data-task-id={task.id}
                                                    layout={
                                                        activeView ===
                                                        "unscheduled"
                                                            ? "position"
                                                            : undefined
                                                    }
                                                    transition={
                                                        activeView ===
                                                        "unscheduled"
                                                            ? {
                                                                  type: "spring",
                                                                  stiffness: 420,
                                                                  damping: 34,
                                                                  mass: 0.7,
                                                              }
                                                            : undefined
                                                    }
                                                    className={`task-row ${activeView === "unscheduled" ? "task-row--reorderable" : ""} ${!task.completed && isOverdueTask(task, new Date()) ? "task-row--overdue" : ""} ${selectedTaskId === task.id ? "selected" : ""}`}
                                                    data-task-index={taskIndex}
                                                    style={{
                                                        borderLeftColor:
                                                            taskCategoryColor(
                                                                task,
                                                                categoryColorById,
                                                            ),
                                                        accentColor:
                                                            taskCategoryColor(
                                                                task,
                                                                categoryColorById,
                                                            ),
                                                    }}
                                                    onPointerDown={(event) =>
                                                        handleTaskRowPointerDown(
                                                            task.id,
                                                            event,
                                                        )
                                                    }
                                                    onMouseDown={(event) =>
                                                        handleTaskRowPointerDown(
                                                            task.id,
                                                            event,
                                                            true,
                                                        )
                                                    }
                                                    onPointerMove={(event) =>
                                                        handleTaskRowPointerMove(
                                                            task.id,
                                                            event,
                                                        )
                                                    }
                                                    onMouseMove={(event) =>
                                                        handleTaskRowPointerMove(
                                                            task.id,
                                                            event,
                                                        )
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
                                                    onPointerCancel={(
                                                        event,
                                                    ) => {
                                                        event.currentTarget.releasePointerCapture?.(
                                                            event.pointerId,
                                                        );
                                                        draggedUnscheduledTaskIdRef.current =
                                                            null;
                                                        taskRowPointerStateRef.current =
                                                            null;
                                                        suppressTaskRowClickRef.current =
                                                            null;
                                                        setDragTargetMode(null);
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
                                                        openTaskDetailPanel(
                                                            task.id,
                                                        );
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (
                                                            event.target !==
                                                                event.currentTarget ||
                                                            (event.key !==
                                                                "Enter" &&
                                                                event.key !==
                                                                    " ")
                                                        ) {
                                                            return;
                                                        }

                                                        event.preventDefault();
                                                        openTaskDetailPanel(
                                                            task.id,
                                                        );
                                                    }}
                                                    onContextMenu={
                                                        isNarrowScreen()
                                                            ? undefined
                                                            : (event) => {
                                                                  event.preventDefault();
                                                                  setSelectedTaskId(
                                                                      task.id,
                                                                  );
                                                                  setContextMenu(
                                                                      {
                                                                          kind: "task",
                                                                          id: task.id,
                                                                          x: event.clientX,
                                                                          y: event.clientY,
                                                                      },
                                                                  );
                                                              }
                                                    }
                                                >
                                                    <motion.input
                                                        type="checkbox"
                                                        className="task-checkbox"
                                                        checked={task.completed}
                                                        animate={{
                                                            scale: task.completed
                                                                ? [
                                                                      1,
                                                                      1.1,
                                                                      1,
                                                                  ]
                                                                : 1,
                                                        }}
                                                        transition={
                                                            completionTransition
                                                        }
                                                        onChange={() =>
                                                            void handleCheckboxChange(
                                                                task,
                                                            )
                                                        }
                                                        onClick={(event) =>
                                                            event.stopPropagation()
                                                        }
                                                        aria-label={`Toggle ${task.title}`}
                                                    />
                                                    <span className="task-row-main">
                                                        <motion.span
                                                            className={
                                                                task.completed
                                                                    ? "task-title completed"
                                                                    : "task-title"
                                                            }
                                                            animate={{
                                                                opacity:
                                                                    task.completed
                                                                        ? 0.72
                                                                        : 1,
                                                            }}
                                                            transition={
                                                                completionTransition
                                                            }
                                                        >
                                                            {task.title}
                                                        </motion.span>
                                                        <span className="task-meta">
                                                            {formatTaskMeta(
                                                                task,
                                                            )}
                                                        </span>
                                                    </span>
                                                    <span className="task-order-actions task-order-actions--aligned">
                                                        {activeView ===
                                                            "unscheduled" && (
                                                            <>
                                                                {mobileScreen ===
                                                                "unscheduled" ? (
                                                                    <>
                                                                        <button
                                                                            type="button"
                                                                            className="task-order-button task-order-button-up task-order-button-mobile-order"
                                                                            aria-label={`Move ${task.title} up`}
                                                                            disabled={
                                                                                taskIndex ===
                                                                                0
                                                                            }
                                                                            onPointerDown={(
                                                                                event,
                                                                            ) =>
                                                                                event.stopPropagation()
                                                                            }
                                                                            onClick={(
                                                                                event,
                                                                            ) => {
                                                                                event.stopPropagation();
                                                                                moveUnscheduledTaskByOffset(
                                                                                    task.id,
                                                                                    -1,
                                                                                );
                                                                            }}
                                                                        >
                                                                            ⇡
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="task-order-button task-order-button-down task-order-button-mobile-order"
                                                                            aria-label={`Move ${task.title} down`}
                                                                            disabled={
                                                                                taskIndex ===
                                                                                orderedVisibleTasks.length -
                                                                                    1
                                                                            }
                                                                            onPointerDown={(
                                                                                event,
                                                                            ) =>
                                                                                event.stopPropagation()
                                                                            }
                                                                            onClick={(
                                                                                event,
                                                                            ) => {
                                                                                event.stopPropagation();
                                                                                moveUnscheduledTaskByOffset(
                                                                                    task.id,
                                                                                    1,
                                                                                );
                                                                            }}
                                                                        >
                                                                            ⇣
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        className="task-order-button task-order-button-top task-order-button-desktop-top"
                                                                        aria-label={`Move ${task.title} to top`}
                                                                        disabled={
                                                                            taskIndex ===
                                                                            0
                                                                        }
                                                                        onPointerDown={(
                                                                            event,
                                                                        ) =>
                                                                            event.stopPropagation()
                                                                        }
                                                                        onClick={(
                                                                            event,
                                                                        ) => {
                                                                            event.stopPropagation();
                                                                            moveUnscheduledTaskToTop(
                                                                                task.id,
                                                                            );
                                                                        }}
                                                                    >
                                                                        ⇡
                                                                    </button>
                                                                )}
                                                            </>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className="task-drag-handle task-schedule-button"
                                                            data-task-id={
                                                                task.id
                                                            }
                                                            aria-label="Drag to calendar"
                                                            title="Drag to calendar"
                                                            onPointerDown={(
                                                                event,
                                                            ) => {
                                                                event.stopPropagation();
                                                                startScheduleDragHighlight();
                                                            }}
                                                            onMouseDown={(
                                                                event,
                                                            ) =>
                                                                event.stopPropagation()
                                                            }
                                                            onClick={(
                                                                event,
                                                            ) =>
                                                                event.stopPropagation()
                                                            }
                                                        >
                                                            <span
                                                                aria-hidden="true"
                                                                className="task-drag-handle-icon"
                                                            >
                                                                <svg
                                                                    viewBox="0 0 16 16"
                                                                    fill="none"
                                                                    aria-hidden="true"
                                                                >
                                                                    <rect
                                                                        x="2.5"
                                                                        y="3.5"
                                                                        width="11"
                                                                        height="10"
                                                                        rx="2"
                                                                        stroke="currentColor"
                                                                        strokeWidth="1.3"
                                                                    />
                                                                    <path
                                                                        d="M2.5 6h11"
                                                                        stroke="currentColor"
                                                                        strokeWidth="1.3"
                                                                        strokeLinecap="round"
                                                                    />
                                                                    <path
                                                                        d="M5 2.5v2M11 2.5v2"
                                                                        stroke="currentColor"
                                                                        strokeWidth="1.3"
                                                                        strokeLinecap="round"
                                                                    />
                                                                </svg>
                                                            </span>
                                                        </button>
                                                    </span>
                                                </motion.div>
                                            ),
                                        )}
                            </motion.div>
                        </section>
                    )}
            </aside>
            <div
                className={`sidebar-resizer ${isSidebarOpen ? "sidebar-resizer-open" : "sidebar-resizer-collapsed"}`}
                role="separator"
                aria-label="Resize sidebar"
                aria-orientation="vertical"
                onPointerDown={handleSidebarResizeStart}
            />

            <section
                className={`calendar-panel ${dragTargetMode === "schedule" ? "drag-target-calendar-active" : ""}`}
                aria-label="Scheduled tasks calendar"
                onTransitionEnd={(event) => {
                    if (
                        event.target === event.currentTarget &&
                        (event.propertyName === "box-shadow" ||
                            event.propertyName === "background-color" ||
                            event.propertyName === "transform")
                    ) {
                        scheduleCalendarResize();
                    }
                }}
            >
                <AnimatePresence initial={false}>
                    {dragTargetMode === "schedule" && (
                        <motion.div
                            key="calendar-drop-target-label"
                            className="calendar-drop-target-label"
                            aria-hidden="true"
                        >
                            <motion.div
                                className="calendar-drop-target-label-chip"
                                variants={calendarDropTargetLabelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={calendarDropTargetLabelTransition}
                            >
                                Drop on calendar to schedule
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
                <AnimatePresence initial={false}>
                    {taskLoadBannerMessage && (
                        <motion.div
                            key="task-refresh-banner"
                            className="status-banner"
                            variants={dropdownVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            transition={dropdownTransition}
                        >
                            {taskLoadBannerMessage}
                        </motion.div>
                    )}
                </AnimatePresence>
                {formError && (
                    <div className="status-banner error">{formError}</div>
                )}
                {taskUndo && (
                    <motion.div
                        key="task-undo"
                        className="undo-snackbar"
                        role="status"
                        aria-live="polite"
                        initial={{
                            opacity: 0,
                            y: 20,
                            x: 18,
                            scale: 0.92,
                        }}
                        animate={{
                            opacity: 1,
                            y: 0,
                            x: 0,
                            scale: 1,
                        }}
                        transition={{
                            duration: prefersReducedMotion ? 0 : 0.24,
                            ease: [0.22, 1, 0.36, 1],
                        }}
                    >
                        <button
                            type="button"
                            className="undo-snackbar-button"
                            aria-label={
                                taskUndo.kind === "unavailable"
                                    ? "Dismiss undo message"
                                    : "Undo task change"
                            }
                            disabled={
                                taskUndo.kind !== "unavailable" && isUndoingTask
                            }
                            onClick={() =>
                                taskUndo.kind === "unavailable"
                                    ? setTaskUndo(null)
                                    : void handleUndoTaskChange()
                            }
                        >
                            <span aria-hidden="true">↶</span>
                        </button>
                    </motion.div>
                )}

                <div className={`calendar-toolbar calendar-toolbar-${calendarView}`}>
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
                        <div className="mobile-calendar-period-control">
                            {isYearPickerOpen ? (
                                <form
                                    className="calendar-year-form"
                                    onSubmit={(event) =>
                                        void submitYearChange(event)
                                    }
                                >
                                    <input
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
                                    className="calendar-toolbar-button mobile-calendar-period-button"
                                    onClick={() => setIsYearPickerOpen(true)}
                                >
                                    {calendarDate.getFullYear()}{" "}
                                    {new Intl.DateTimeFormat(undefined, {
                                        month: "short",
                                    }).format(calendarDate)}
                                </button>
                            )}
                        </div>
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
                        {isTimeGridView && (
                            <button
                                type="button"
                                className="calendar-toolbar-button calendar-hours-toggle"
                                onClick={() =>
                                    setIsFullDayTimelineVisible((current) => !current)
                                }
                            >
                                {isFullDayTimelineVisible ? "Full" : "Work"}
                            </button>
                        )}
                        <button
                            type="button"
                            className="calendar-toolbar-button calendar-view-cycle-button"
                            onClick={cycleCalendarView}
                        >
                            {calendarViewToggleLabel}
                        </button>
                    </div>
                </div>

                <motion.div
                    className={`calendar-transition-shell calendar-view-${calendarView}${
                        isWorkingTimeGridView
                            ? " calendar-working-range"
                            : ""
                    }`}
                    animate={calendarTransitionControls}
                    initial={false}
                >
                    <FullCalendar
                        ref={calendarRef}
                        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                        initialView={calendarView}
                        initialDate={calendarDate}
                        fixedMirrorParent={document.body}
                        headerToolbar={false}
                        events={events}
                        eventTimeFormat={{
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                        }}
                        eventContent={renderEventContent}
                        dayCellContent={renderDayCellContent}
                        dayMaxEventRows={
                            calendarView === "dayGridMonth" &&
                            isNarrowScreen()
                                ? true
                                : false
                        }
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
                        scrollTimeReset={false}
                        eventResizableFromStart
                        nowIndicator
                        scrollTime={
                            isFullDayTimelineVisible
                                ? "00:00:00"
                                : `${workingHours.start}:00`
                        }
                        slotMinTime={calendarSlotMinTime}
                        slotMaxTime={calendarSlotMaxTime}
                        height={isWorkingTimeGridView ? "auto" : "100%"}
                        {...(isWorkingTimeGridView
                            ? {
                                  contentHeight: "auto" as const,
                                  expandRows: false as const,
                              }
                            : {})}
                    />
                </motion.div>
                {calendarView === "dayGridMonth" && (
                    <section
                        className={`mobile-month-task-preview${
                            mobileMonthPreviewDate
                                ? " mobile-month-task-preview-open"
                                : ""
                        }`}
                        aria-label="Selected day tasks"
                    >
                        <div className="mobile-month-task-preview-header">
                            <h2>
                                {mobileMonthPreviewDate
                                    ? formatDateFromDate(mobileMonthPreviewDate)
                                    : "Select a day"}
                            </h2>
                            {mobileMonthPreviewDate && (
                                <div className="mobile-month-task-preview-actions">
                                    <button
                                        type="button"
                                        className="sidebar-create-task-button mobile-month-task-preview-add"
                                        aria-label="Add task for selected day"
                                        onClick={() => {
                                            const selectedDate =
                                                mobileMonthPreviewDate;
                                            if (!selectedDate) {
                                                return;
                                            }

                                            setMobileMonthPreviewDate(null);
                                            openCreatePanel(
                                                selectedDate,
                                                addLocalDays(selectedDate, 1),
                                            );
                                        }}
                                    >
                                        Add
                                    </button>
                                    <button
                                        type="button"
                                        className="mobile-month-task-preview-close"
                                        aria-label="Close selected day tasks"
                                        onClick={() =>
                                            setMobileMonthPreviewDate(null)
                                        }
                                    >
                                        Close
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="mobile-month-task-list">
                            {mobileMonthPreviewDate &&
                            mobileMonthPreviewTasks.length === 0 ? (
                                <p className="muted">No tasks this day.</p>
                            ) : null}
                            {!mobileMonthPreviewDate ? (
                                <p className="muted">
                                    Tap a day to preview tasks.
                                </p>
                            ) : null}
                            {mobileMonthPreviewTasks.map((task) => (
                                <button
                                    key={task.id}
                                    type="button"
                                    className="mobile-month-task-row"
                                    style={{
                                        borderLeftColor: taskCategoryColor(
                                            task,
                                            categoryColorById,
                                        ),
                                    }}
                                    onClick={() => {
                                        setMobileMonthPreviewDate(null);
                                        openTaskDetailPanel(task.id);
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        className="task-checkbox"
                                        checked={task.completed}
                                        onChange={() =>
                                            void handleCheckboxChange(task)
                                        }
                                        onClick={(event) =>
                                            event.stopPropagation()
                                        }
                                        aria-label={`Toggle ${task.title}`}
                                    />
                                    <span className="mobile-month-task-main">
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
                                </button>
                            ))}
                        </div>
                    </section>
                )}
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
                    {contextMenu.kind === "task" && (
                        <button
                            type="button"
                            disabled={isDuplicating}
                            className="context-menu-item"
                            onClick={() => void handleDuplicateFromMenu()}
                        >
                            {isDuplicating ? "Duplicating..." : "Duplicate"}
                        </button>
                    )}
                    <button
                        type="button"
                        disabled={isDeleting}
                        className="context-menu-item context-menu-item-danger"
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

type AuthScreenProps = {
    authMode: AuthMode;
    formState: AuthFormState;
    error: string | null;
    isSubmitting: boolean;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    onChange: (state: AuthFormState) => void;
    onModeChange: (mode: AuthMode) => void;
};

function AuthScreen({
    authMode,
    formState,
    error,
    isSubmitting,
    onSubmit,
    onChange,
    onModeChange,
}: AuthScreenProps) {
    const isRegistering = authMode === "register";

    return (
        <main className="auth-shell">
            <section className="auth-panel" aria-labelledby="auth-title">
                <p className="eyebrow">SCHEDULED TASK CALENDAR</p>
                <h1 id="auth-title">
                    {isRegistering ? "Create account" : "Welcome back"}
                </h1>
                <p className="auth-subtitle">
                    {isRegistering ? "Create a new account" : "Sign in to continue"}
                </p>
                <div className="auth-mode-switch" role="tablist" aria-label="Authentication mode">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={!isRegistering}
                        className={`auth-mode-tab ${!isRegistering ? "auth-mode-tab-active" : ""}`}
                        onClick={() => {
                            onModeChange("login");
                        }}
                    >
                        Use an existing account
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={isRegistering}
                        className={`auth-mode-tab ${isRegistering ? "auth-mode-tab-active" : ""}`}
                        onClick={() => {
                            onModeChange("register");
                        }}
                    >
                        Create account
                    </button>
                </div>
                <form className="auth-form" onSubmit={onSubmit}>
                    <label>
                        <span>Username</span>
                        <input
                            type="text"
                            value={formState.username}
                            autoComplete="username"
                            required
                            onChange={(event) =>
                                onChange({
                                    ...formState,
                                    username: event.target.value,
                                })
                            }
                        />
                    </label>
                    <label>
                        <span>Password</span>
                        <input
                            type="password"
                            value={formState.password}
                            autoComplete={
                                isRegistering
                                    ? "new-password"
                                    : "current-password"
                            }
                            required
                            onChange={(event) =>
                                onChange({
                                    ...formState,
                                    password: event.target.value,
                                })
                            }
                        />
                    </label>
                    {error && <p className="form-error">{error}</p>}
                    <button type="submit" disabled={isSubmitting}>
                        {isSubmitting
                            ? isRegistering
                                ? "Creating..."
                                : "Signing in..."
                            : isRegistering
                              ? "Create account"
                              : "Sign in"}
                    </button>
                </form>
            </section>
        </main>
    );
}

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

function buildTaskUpdateInputFromSnapshot(
    task: ScheduledTask,
    restoreFields?: Array<keyof Parameters<typeof updateTask>[1]>,
): Parameters<typeof updateTask>[1] {
    const snapshot = {
        title: task.title,
        list_id: task.list_id,
        notes: task.notes,
        completed: task.completed,
        scheduled_start: task.scheduled_start,
        scheduled_end: task.scheduled_end,
        due_at: task.due_at,
        unscheduled_order: task.unscheduled_order,
        recurrence_rule: task.recurrence_rule,
        notification_enabled: task.notification_enabled,
        notification_offset_minutes: task.notification_offset_minutes,
        notification_channel: task.notification_channel,
    };

    if (!restoreFields) {
        return snapshot;
    }

    const update: Parameters<typeof updateTask>[1] = {};
    for (const field of restoreFields) {
        assignTaskUpdateField(update, snapshot, field);
    }

    return update;
}

function assignTaskUpdateField(
    update: Parameters<typeof updateTask>[1],
    snapshot: Parameters<typeof updateTask>[1],
    field: keyof Parameters<typeof updateTask>[1],
): void {
    switch (field) {
        case "title":
            update.title = snapshot.title;
            break;
        case "list_id":
            update.list_id = snapshot.list_id;
            break;
        case "notes":
            update.notes = snapshot.notes;
            break;
        case "completed":
            update.completed = snapshot.completed;
            break;
        case "scheduled_start":
            update.scheduled_start = snapshot.scheduled_start;
            break;
        case "scheduled_end":
            update.scheduled_end = snapshot.scheduled_end;
            break;
        case "due_at":
            update.due_at = snapshot.due_at;
            break;
        case "unscheduled_order":
            update.unscheduled_order = snapshot.unscheduled_order;
            break;
        case "recurrence_rule":
            update.recurrence_rule = snapshot.recurrence_rule;
            break;
        case "notification_enabled":
            update.notification_enabled = snapshot.notification_enabled;
            break;
        case "notification_offset_minutes":
            update.notification_offset_minutes =
                snapshot.notification_offset_minutes;
            break;
        case "notification_channel":
            update.notification_channel = snapshot.notification_channel;
            break;
    }
}

function buildUpdateTaskUndo(
    task: ScheduledTask,
    updates: Parameters<typeof updateTask>[1],
    updateScope: "single" | "series",
    message = "Task updated.",
): TaskUndoState {
    if (updateScope === "series") {
        return {
            kind: "unavailable",
            message: "Task updated. Undo is not available for recurring series edits.",
        };
    }

    if (updates.recurrence_rule !== undefined) {
        return {
            kind: "unavailable",
            message: "Task updated. Undo is not available for recurrence changes.",
        };
    }

    if (
        task.recurrence_series_id &&
        hasRecurringDetachUpdate(updates)
    ) {
        return {
            kind: "unavailable",
            message:
                "Task updated. Undo is not available after detaching a recurring occurrence.",
        };
    }

    return {
        kind: "update",
        task,
        restoreFields: Object.keys(updates) as Array<
            keyof Parameters<typeof updateTask>[1]
        >,
        message,
    };
}

function buildDeleteTaskUndo(
    task: ScheduledTask,
    deleteScope: "single" | "following",
): TaskUndoState {
    if (deleteScope !== "single") {
        return {
            kind: "unavailable",
            message: "Task deleted. Undo is not available for recurring series deletes.",
        };
    }

    if (task.recurrence_series_id || task.recurrence_rule) {
        return {
            kind: "unavailable",
            message:
                "Task deleted. Undo is not available for recurring occurrence deletes.",
        };
    }

    return {
        kind: "delete",
        task,
        message: "Task deleted.",
    };
}

function hasRecurringDetachUpdate(
    updates: Parameters<typeof updateTask>[1],
): boolean {
    return [
        "title",
        "list_id",
        "scheduled_start",
        "scheduled_end",
        "notification_enabled",
        "notification_offset_minutes",
        "notification_channel",
    ].some((field) => field in updates);
}

function buildTaskCreateInputFromSnapshot(
    task: ScheduledTask,
): CreateScheduledTaskInput {
    return {
        title: task.title,
        list_id: task.list_id,
        notes: task.notes,
        completed: task.completed,
        scheduled_start: task.scheduled_start,
        scheduled_end: task.scheduled_end,
        due_at: task.due_at,
        timezone: task.timezone,
        priority: task.priority,
        unscheduled_order: task.unscheduled_order,
        recurrence_rule: task.recurrence_rule,
        notification_enabled: task.notification_enabled,
        notification_offset_minutes: task.notification_offset_minutes,
        notification_channel: task.notification_channel,
    };
}

function buildDuplicateTaskInput(
    task: ScheduledTask,
): CreateScheduledTaskInput {
    return {
        title: task.title,
        list_id: task.list_id,
        notes: task.notes,
        completed: false,
        scheduled_start: task.scheduled_start,
        scheduled_end: task.scheduled_end,
        due_at: task.due_at,
        timezone: task.timezone,
        priority: task.priority,
        unscheduled_order:
            !task.scheduled_start && !task.scheduled_end
                ? task.unscheduled_order
                : null,
        notification_enabled: task.notification_enabled,
        notification_offset_minutes: task.notification_offset_minutes,
        notification_channel: task.notification_channel,
    };
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
        "notes",
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
    areAllCategoriesVisible: boolean,
    categoryVisibility: CategoryVisibilityState,
    upcomingDays: number,
    showCompletedTasks: boolean,
): ScheduledTask[] {
    const now = new Date();
    const filteredTasks = tasks.filter((task) => {
        if (
            !isTaskVisibleForCategory(
                task,
                areAllCategoriesVisible,
                categoryVisibility,
            )
        ) {
            return false;
        }

        if (activeView === "unscheduled") {
            return !task.completed && !task.scheduled_start && !task.scheduled_end;
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

        if (task.completed && !showCompletedTasks) {
            return false;
        }

        const taskDate = task.scheduled_start ?? task.due_at;

        if (activeView === "today") {
            return taskDate
                ? isSameLocalDay(parseTaskDate(taskDate), now) ||
                      isOverdueTask(task, now)
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

function createDefaultCategoryVisibility(
    taskLists: TaskList[],
): CategoryVisibilityState {
    return {
        none: true,
        lists: Object.fromEntries(taskLists.map((taskList) => [taskList.id, true])),
    };
}

function reconcileCategoryVisibility(
    visibility: CategoryVisibilityState,
    taskLists: TaskList[],
): CategoryVisibilityState {
    const validIds = new Set(taskLists.map((taskList) => taskList.id));
    const lists = Object.fromEntries(
        taskLists.map((taskList) => [
            taskList.id,
            visibility.lists[taskList.id] ?? true,
        ]),
    );

    if (
        Object.keys(visibility.lists).length === taskLists.length &&
        Object.keys(visibility.lists).every((id) => validIds.has(id)) &&
        taskLists.every((taskList) => visibility.lists[taskList.id] === lists[taskList.id])
    ) {
        return visibility;
    }

    return {
        none: visibility.none,
        lists,
    };
}

function isTaskVisibleForCategory(
    task: ScheduledTask,
    areAllCategoriesVisible: boolean,
    categoryVisibility: CategoryVisibilityState,
): boolean {
    if (areAllCategoriesVisible) {
        return true;
    }

    if (!task.list_id) {
        return categoryVisibility.none;
    }

    return categoryVisibility.lists[task.list_id] ?? true;
}

function mergeLocallyUpdatedTasks(
    loadedTasks: ScheduledTask[],
    locallyUpdatedTasks: Map<string, ScheduledTask>,
): ScheduledTask[] {
    if (locallyUpdatedTasks.size === 0) {
        return loadedTasks;
    }

    const mergedTasks = [...loadedTasks];

    for (const [taskId, localTask] of locallyUpdatedTasks) {
        const loadedTaskIndex = mergedTasks.findIndex(
            (task) => task.id === taskId,
        );

        if (loadedTaskIndex === -1) {
            mergedTasks.push(localTask);
            continue;
        }

        const loadedTask = mergedTasks[loadedTaskIndex];
        if (isTaskAtLeastAsFresh(loadedTask, localTask)) {
            locallyUpdatedTasks.delete(taskId);
            continue;
        }

        mergedTasks[loadedTaskIndex] = localTask;
    }

    return mergedTasks;
}

function isTaskAtLeastAsFresh(
    loadedTask: ScheduledTask,
    localTask: ScheduledTask,
): boolean {
    const loadedUpdatedAt = parseTaskDate(loadedTask.updated_at).getTime();
    const localUpdatedAt = parseTaskDate(localTask.updated_at).getTime();

    if (!Number.isFinite(loadedUpdatedAt)) {
        return false;
    }

    if (!Number.isFinite(localUpdatedAt)) {
        return true;
    }

    return loadedUpdatedAt >= localUpdatedAt;
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

function moveTaskIdToTop(currentOrder: string[], taskId: string): string[] {
    const currentIndex = currentOrder.indexOf(taskId);
    if (currentIndex <= 0) {
        return currentOrder;
    }

    const nextOrder = currentOrder.filter((currentTaskId) => currentTaskId !== taskId);
    nextOrder.unshift(taskId);
    return nextOrder;
}

function buildUnscheduledOrderUpdates(
    orderedTaskIds: string[],
    tasks: ScheduledTask[],
): Array<{ taskId: string; unscheduled_order: number }> {
    const unscheduledTasks = tasks.filter(
        (task) => !task.scheduled_start && !task.scheduled_end,
    );
    const taskById = new Map(unscheduledTasks.map((task) => [task.id, task]));
    const reconciledOrder = reconcileTaskOrder(
        orderedTaskIds,
        unscheduledTasks.map((task) => task.id),
    );

    return reconciledOrder
        .map((taskId, index) => {
            const task = taskById.get(taskId);
            if (!task || task.unscheduled_order === index) {
                return null;
            }

            return {
                taskId,
                unscheduled_order: index,
            };
        })
        .filter(
            (
                update,
            ): update is { taskId: string; unscheduled_order: number } =>
                update !== null,
        );
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

function validateRecurrenceUntil(
    recurrenceFrequency: RecurrenceFrequency,
    recurrenceUntil: string,
    scheduledStart: string,
): string | null {
    if (!recurrenceFrequency || !recurrenceUntil || !scheduledStart) {
        return null;
    }

    if (new Date(endOfLocalDateToIso(recurrenceUntil)) < new Date(scheduledStart)) {
        return "Repeat until must be on or after the start date";
    }

    return null;
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

function formatDateFromDate(value: Date): string {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(value);
}

function parseTaskDate(value: string): Date {
    return new Date(value);
}

function compareTasksByScheduledStart(
    left: ScheduledTask,
    right: ScheduledTask,
): number {
    const leftTime = left.scheduled_start
        ? parseTaskDate(left.scheduled_start).getTime()
        : 0;
    const rightTime = right.scheduled_start
        ? parseTaskDate(right.scheduled_start).getTime()
        : 0;

    return leftTime - rightTime || left.title.localeCompare(right.title);
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
    const classNames = task.completed
        ? ["task-event", "task-event--completed"]
        : ["task-event"];

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
        classNames,
        extendedProps: {
            task,
        },
    };
}

function mapTasksToCalendarEvents(
    tasks: ScheduledTask[],
    categoryColorById: Map<string, string>,
): EventInput[] {
    return tasks
        .filter((task) => task.scheduled_start)
        .map((task) => mapTaskToCalendarEvent(task, categoryColorById));
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

function getInitialWorkingHours(): WorkingHoursSettings {
    try {
        const stored = window.localStorage?.getItem("calendar-working-hours");
        if (!stored) {
            return defaultWorkingHours;
        }

        const parsed = JSON.parse(stored) as Partial<WorkingHoursSettings>;
        return {
            start: normalizeWorkingHour(parsed.start, defaultWorkingHours.start),
            end: normalizeWorkingHour(parsed.end, defaultWorkingHours.end),
        };
    } catch {
        return defaultWorkingHours;
    }
}

function saveWorkingHours(workingHours: WorkingHoursSettings): void {
    try {
        window.localStorage?.setItem(
            "calendar-working-hours",
            JSON.stringify(workingHours),
        );
    } catch {
        // Working hours persistence is optional.
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

function normalizeWorkingHour(value: string | undefined, fallback: string): string {
    return value && workingHourOptions.includes(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function readBackupFileText(file: File): Promise<string> {
    if (typeof file.text === "function") {
        return file.text();
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Unable to read backup file"));
        reader.readAsText(file);
    });
}

function formatBackupDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}
