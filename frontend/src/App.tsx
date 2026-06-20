import type {
    DatesSetArg,
    DayCellContentArg,
    DayHeaderContentArg,
    EventApi,
    EventClickArg,
    EventContentArg,
    EventDropArg,
    EventInput,
    EventMountArg,
    DateSelectArg,
    SlotLabelContentArg,
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
import { createPortal } from "react-dom";
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
    type ReactNode,
    type TouchEvent as ReactTouchEvent,
} from "react";

import {
    deleteAdminUser,
    listAdminUsers,
    type AdminUser,
} from "./api/admin";
import {
    clearStoredAuthToken,
    changePassword,
    deleteAccount,
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
import {
    IconArrowDown,
    IconArrowUp,
    IconCheck,
    IconChevronDown,
    IconClose,
    IconEdit,
    IconMinus,
    IconPlus,
    IconSave,
    IconTrash,
} from "./components/icons";
import { AdminSettingsPanel } from "./components/AdminSettingsPanel";
import {
    loadTaskCache,
    saveTaskCache,
    type TaskCacheData,
    type TaskCacheRecord,
} from "./offline/cache";

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
type WeekStart = "sunday" | "monday";
type MobileScreen = "today" | "upcoming" | "unscheduled" | "calendar" | "settings";
type CalendarTransitionKind = "neutral" | "view" | "prev" | "next" | "today";
type DragTargetMode = "reorder" | "schedule" | null;
type AuthMode = "login" | "register";
type OfflineDataSource = "server" | "cache" | "empty";
type WorkingHoursSettings = {
    start: string;
    end: string;
};
const defaultSidebarWidth = 300;

function getAdminUserDisplayName(user: AdminUser): string {
    return user.email?.trim() || user.username.trim() || user.id;
}
const minSidebarWidth = 240;
const minCalendarWidth = 320;
const mobileLayoutQuery = "(max-width: 860px)";
const mobileCalendarLongPressDelayMs = 550;
const mobileCalendarReadonlyLongPressDelayMs = 60 * 60 * 1000;
const defaultWorkingHours: WorkingHoursSettings = {
    start: "08:00",
    end: "22:00",
};
const workingHourOptions = Array.from({ length: 24 }, (_, index) =>
    `${String(index).padStart(2, "0")}:00`,
);
const taskFormDropdownThemeVariables = [
    "--panel-bg",
    "--text",
    "--muted",
    "--subtle",
    "--border",
    "--field-border",
    "--accent",
    "--accent-soft",
    "--selected-bg",
    "--shadow",
    "--danger",
    "--danger-soft",
];

type TaskFormState = {
    title: string;
    list_id: string;
    scheduled_start: string;
    scheduled_end: string;
    notes: string;
    recurrence_frequency: RecurrenceFrequency;
    recurrence_interval: string;
    recurrence_until: string;
    reminder_mode: ReminderMode;
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

const DEFAULT_WEBHOOK_MESSAGE_TEMPLATE =
    "Task due: {title}\nWhen: {when}\nNotes: {notes}\nOpen app: {app_url}";
const offlineReadOnlyMessage = "Offline: editing disabled";

const recurringTaskChoiceActionStyle: CSSProperties = {
    backgroundColor: "rgb(69 181 143 / 52%)",
    border: "1px solid rgb(69 181 143 / 38%)",
    color: "#ffffff",
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
type ReminderMode = "NONE" | "ON_TIME" | "BEFORE";
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

type MobileQuickAction = "earlier" | "later" | "shorten" | "extend";

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
type SettingsView =
    | "menu"
    | "calendar-display"
    | "account"
    | "change-password"
    | "delete-account"
    | "admin"
    | "webhook"
    | "backup";
type TaskFormAccordionSectionId = "schedule" | "organization" | "notes";
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
type CalendarSwipeState = {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    blocked: boolean;
    isHorizontalSwipe: boolean;
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
    reminder_mode: "NONE",
    notification_unit: "",
    notification_offset_value: "0",
    notification_channel: "",
};

function TaskFormAccordionSection({
    id,
    title,
    actions,
    isExpanded,
    onToggle,
    children,
}: {
    id: TaskFormAccordionSectionId;
    title: string;
    actions?: ReactNode;
    isExpanded: boolean;
    onToggle: (section: TaskFormAccordionSectionId) => void;
    children: ReactNode;
}) {
    const panelId = `task-form-accordion-panel-${id}`;
    const buttonId = `task-form-accordion-button-${id}`;

    return (
        <section
            className={`task-composer-section task-form-accordion-section${
                isExpanded ? " task-form-accordion-section-open" : ""
            }`}
        >
            <div className="task-composer-section-header task-form-accordion-header">
                <button
                    id={buttonId}
                    type="button"
                    className="task-form-accordion-trigger"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    onClick={() => onToggle(id)}
                >
                    <span className="task-form-accordion-chevron">
                        <IconChevronDown />
                    </span>
                    <span>{title}</span>
                </button>
                {actions}
            </div>
            {isExpanded && (
                <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className="task-form-accordion-panel"
                >
                    {children}
                </div>
            )}
        </section>
    );
}

const notificationUnits: Array<{ id: Exclude<NotificationUnit, "">; label: string }> = [
    { id: "MINUTES", label: "Minutes" },
    { id: "HOURS", label: "Hours" },
    { id: "DAYS", label: "Days" },
];

const recurrenceFrequencyOptions: TaskComposerDropdownOption[] = [
    { value: "", label: "Does not repeat" },
    { value: "DAILY", label: "day" },
    { value: "WEEKLY", label: "week" },
    { value: "MONTHLY", label: "month" },
    { value: "YEARLY", label: "year" },
];

const recurrenceEndsOptions: TaskComposerDropdownOption[] = [
    { value: "NEVER", label: "Forever" },
    { value: "ON_DATE", label: "Until" },
];

const reminderOptions: TaskComposerDropdownOption[] = [
    { value: "NONE", label: "Does not remind" },
    { value: "ON_TIME", label: "On time" },
    { value: "BEFORE", label: "Before" },
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

const calendarMonthOptions = Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    shortLabel: new Intl.DateTimeFormat(undefined, { month: "short" }).format(
        new Date(2026, monthIndex, 1),
    ),
    longLabel: new Intl.DateTimeFormat(undefined, { month: "long" }).format(
        new Date(2026, monthIndex, 1),
    ),
}));

const calendarTransitionEase = [0.22, 1, 0.36, 1] as const;
const mobileCalendarTapSuppressThresholdPx = 24;
const mobileCalendarSwipeThresholdPx = 60;
const mobileCalendarSwipeHorizontalRatio = 1.2;
const mobileCalendarTapSuppressResetMs = 180;
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

function shouldIgnoreCalendarSwipeTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return true;
    }

    return Boolean(
        target.closest(
            [
                "button",
                "input",
                "select",
                "textarea",
                "[contenteditable='true']",
                ".filter-dropdown",
                ".task-drag-handle",
                ".fc-event-resizer",
                ".fc-event-resizer-start",
                ".fc-event-resizer-end",
            ].join(","),
        ),
    );
}

function isHorizontalCalendarSwipeIntent(
    startX: number,
    startY: number,
    currentX: number,
    currentY: number,
    thresholdPx: number,
): boolean {
    const absDeltaX = Math.abs(currentX - startX);
    const absDeltaY = Math.abs(currentY - startY);

    return (
        absDeltaX >= thresholdPx &&
        absDeltaX > absDeltaY * mobileCalendarSwipeHorizontalRatio
    );
}

export function App() {
    const prefersReducedMotion = useReducedMotion();
    const calendarTransitionControls = useAnimationControls();
    const [authToken, setAuthToken] = useState<string | null>(
        getStoredAuthToken,
    );
    const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
    const [isBrowserOnline, setIsBrowserOnline] = useState(() =>
        typeof navigator === "undefined" ? true : navigator.onLine,
    );
    const [offlineDataSource, setOfflineDataSource] =
        useState<OfflineDataSource>("empty");
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
    const [weekStart, setWeekStart] = useState<WeekStart>("sunday");
    const [isFullDayTimelineVisible, setIsFullDayTimelineVisible] =
        useState(false);
    const [taskState, setTaskState] = useState<TaskState>({
        status: "loading",
        tasks: [],
    });
    const [activeView, setActiveView] = useState<TaskView>("today");
    const [mobileScreen, setMobileScreen] = useState<MobileScreen>("today");
    const [upcomingDays, setUpcomingDays] = useState(7);
    const [showCompletedTasks, setShowCompletedTasks] = useState(
        getInitialShowCompletedTasks,
    );
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
    const [settingsView, setSettingsView] = useState<SettingsView | null>(null);
    const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
    const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [isDeleteCategoryConfirming, setIsDeleteCategoryConfirming] =
        useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [formState, setFormState] = useState<TaskFormState>(initialFormState);
    const [editState, setEditState] = useState<EditFormState | null>(null);
    const [createAccordionSection, setCreateAccordionSection] =
        useState<TaskFormAccordionSectionId | null>("schedule");
    const [editAccordionSection, setEditAccordionSection] =
        useState<TaskFormAccordionSectionId | null>("schedule");
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
    const [taskSnackbarMessage, setTaskSnackbarMessage] = useState<
        string | null
    >(null);
    const [isUndoingTask, setIsUndoingTask] = useState(false);
    const [detailPanelMode, setDetailPanelMode] =
        useState<DetailPanelMode>(null);
    const [isDetailPanelClosing, setIsDetailPanelClosing] = useState(false);
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
    const [changePasswordCurrentPassword, setChangePasswordCurrentPassword] =
        useState("");
    const [changePasswordNewPassword, setChangePasswordNewPassword] =
        useState("");
    const [changePasswordConfirmNewPassword, setChangePasswordConfirmNewPassword] =
        useState("");
    const [isPasswordChanging, setIsPasswordChanging] = useState(false);
    const [changePasswordError, setChangePasswordError] = useState<
        string | null
    >(null);
    const [changePasswordSuccess, setChangePasswordSuccess] = useState<
        string | null
    >(null);
    const [deleteAccountConfirmation, setDeleteAccountConfirmation] =
        useState("");
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [deleteAccountError, setDeleteAccountError] = useState<string | null>(
        null,
    );
    const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
    const [isAdminUsersLoading, setIsAdminUsersLoading] = useState(false);
    const [adminUsersError, setAdminUsersError] = useState<string | null>(null);
    const [adminUserDeleteCandidate, setAdminUserDeleteCandidate] =
        useState<AdminUser | null>(null);
    const [deletingAdminUserId, setDeletingAdminUserId] = useState<string | null>(
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
    const [isMobileLayout, setIsMobileLayout] = useState(isNarrowScreen);
    const [mobileMonthPreviewDate, setMobileMonthPreviewDate] =
        useState<Date | null>(null);
    const [mobileQuickActionTaskId, setMobileQuickActionTaskId] =
        useState<string | null>(null);
    const [isMonthYearPickerOpen, setIsMonthYearPickerOpen] = useState(false);
    const [monthYearPickerYear, setMonthYearPickerYear] = useState(
        new Date().getFullYear(),
    );
    const [monthYearPickerStyle, setMonthYearPickerStyle] =
        useState<CSSProperties | null>(null);
    const editStateSyncTaskIdRef = useRef<string | null>(null);
    const calendarRef = useRef<FullCalendar | null>(null);
    const calendarTransitionTimeoutRef = useRef<number | null>(null);
    const calendarEventAnimationKindRef =
        useRef<CalendarTransitionKind>("neutral");
    const calendarEventAnimationTimeoutRef = useRef<number | null>(null);
    const taskSyncIntervalRef = useRef<number | null>(null);
    const taskSyncInFlightRef = useRef(false);
    const mobileEventCleanupRef = useRef<WeakMap<HTMLElement, () => void>>(
        new WeakMap(),
    );
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
    const monthYearPickerRef = useRef<HTMLDivElement | null>(null);
    const monthYearPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
    const timeGridScrollTopRef = useRef<number | null>(null);
    const calendarSwipeStateRef = useRef<CalendarSwipeState | null>(null);
    const suppressNextCalendarTapRef = useRef(false);
    const calendarTapSuppressTimerRef = useRef<number | null>(null);
    const locallyUpdatedTasksRef = useRef<Map<string, ScheduledTask>>(new Map());
    const calendarResizeRafRef = useRef<number | null>(null);
    const calendarResizeRaf2Ref = useRef<number | null>(null);
    const taskListsRef = useRef<TaskList[]>([]);
    const webhookSettingsRef = useRef<AppSettings | null>(null);
    const currentUserIdRef = useRef<string | null>(null);

    const tasks = taskState.tasks;
    const isUsingCachedData = offlineDataSource === "cache";
    const isOfflineReadOnly = !isBrowserOnline || isUsingCachedData;
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
    const mobileQuickActionTask = mobileQuickActionTaskId
        ? tasks.find((task) => task.id === mobileQuickActionTaskId)
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
    const calendarInteractionMode = isMobileLayout ? "mobile" : "desktop";

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
    const calendarViewToggleLabel =
        calendarView === "timeGridWeek"
            ? "Week"
            : calendarView === "timeGridDay"
              ? "Day"
              : "Month";
    const calendarFirstDay = weekStart === "monday" ? 1 : 0;
    const updateWorkingHours = useCallback(
        (updates: Partial<WorkingHoursSettings>) => {
            if (isOfflineReadOnly) {
                setTaskUndo(null);
                setTaskSnackbarMessage(offlineReadOnlyMessage);
                return;
            }
            setWorkingHours((current) => ({
                ...current,
                ...updates,
            }));
            if (authToken && updates.start) {
                void updateSettings({
                    working_hours_start: updates.start,
                }).catch(() => undefined);
            }
        },
        [authToken, isOfflineReadOnly],
    );
    const updateWeekStart = useCallback(
        (value: WeekStart) => {
            if (isOfflineReadOnly) {
                setTaskUndo(null);
                setTaskSnackbarMessage(offlineReadOnlyMessage);
                return;
            }
            setWeekStart(value);
            if (authToken) {
                void updateSettings({
                    week_start: value,
                }).catch(() => undefined);
            }
        },
        [authToken, isOfflineReadOnly],
    );
    const toggleCreateAccordionSection = useCallback(
        (section: TaskFormAccordionSectionId) => {
            setCreateAccordionSection((current) =>
                current === section ? null : section,
            );
        },
        [],
    );
    const toggleEditAccordionSection = useCallback(
        (section: TaskFormAccordionSectionId) => {
            setEditAccordionSection((current) =>
                current === section ? null : section,
            );
        },
        [],
    );

    const closeSettingsPanels = useCallback(() => {
        setSettingsView(null);
    }, []);

    const resetAccountForms = useCallback(() => {
        setChangePasswordCurrentPassword("");
        setChangePasswordNewPassword("");
        setChangePasswordConfirmNewPassword("");
        setIsPasswordChanging(false);
        setChangePasswordError(null);
        setChangePasswordSuccess(null);
        setDeleteAccountConfirmation("");
        setIsDeletingAccount(false);
        setDeleteAccountError(null);
        setAdminUsersError(null);
        setAdminUserDeleteCandidate(null);
        setDeletingAdminUserId(null);
    }, []);

    const resetAppData = useCallback(() => {
        locallyUpdatedTasksRef.current.clear();
        setTaskState({ status: "loading", tasks: [] });
        setOfflineDataSource("empty");
        setTaskLists([]);
        setSelectedTaskId(null);
        setDetailPanelMode(null);
        setFormError(null);
        setTaskUndo(null);
        setTaskSnackbarMessage(null);
        setWebhookSettings(null);
        setWebhookSettingsDraft({
            discord_webhook_url: "",
            discord_message_template: "",
        });
        setWebhookTestMessage(null);
        setAdminUsers([]);
        setAdminUsersError(null);
        setIsAdminUsersLoading(false);
        setDeletingAdminUserId(null);
        setBackupSummary(null);
        setBackupImportFile(null);
        setBackupImportMessage(null);
        setBackupImportError(null);
        setIsBackupLoading(false);
        setIsBackupImporting(false);
        closeSettingsPanels();
        resetAccountForms();
    }, [closeSettingsPanels, resetAccountForms]);

    const handleAuthExpired = useCallback(() => {
        clearStoredAuthToken();
        setAuthToken(null);
        setCurrentUser(null);
        currentUserIdRef.current = null;
        setAuthError("Session expired. Please log in again.");
        resetAppData();
    }, [resetAppData]);

    const handleLogout = useCallback(() => {
        clearStoredAuthToken();
        setAuthToken(null);
        setCurrentUser(null);
        currentUserIdRef.current = null;
        setAuthError(null);
        resetAppData();
        resetAccountForms();
    }, [resetAppData, resetAccountForms]);

    const handleOpenBackupSummary = useCallback(async () => {
        if (isOfflineReadOnly) {
            setTaskUndo(null);
            setTaskSnackbarMessage(offlineReadOnlyMessage);
            return;
        }
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
    }, [isOfflineReadOnly]);

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
                const user = await getCurrentUser();
                currentUserIdRef.current = user.id;
                setCurrentUser(user);
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
                const user = await getCurrentUser();
                currentUserIdRef.current = user.id;
                setCurrentUser(user);
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
        taskListsRef.current = taskLists;
    }, [taskLists]);

    useEffect(() => {
        webhookSettingsRef.current = webhookSettings;
    }, [webhookSettings]);

    useEffect(() => {
        currentUserIdRef.current = currentUser?.id ?? null;
    }, [currentUser]);

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
        if (detailPanelMode !== "edit") {
            editStateSyncTaskIdRef.current = null;
            setEditState(null);
            return;
        }

        if (!selectedTask) {
            setEditState(null);
            return;
        }

        if (editStateSyncTaskIdRef.current === selectedTask.id) {
            return;
        }

        const recurrenceState = parseRecurrenceRule(
            selectedTask.recurrence_rule,
        );

        setEditState({
            title: selectedTask.title,
            notes: selectedTask.notes ?? "",
            scheduled_start:
                Boolean(selectedTask.all_day) && selectedTask.scheduled_start
                    ? toAllDayCalendarDate(selectedTask.scheduled_start)
                    : toDateTimeLocalValue(selectedTask.scheduled_start),
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
        setEditAccordionSection(getInitialEditAccordionSection(selectedTask));
        editStateSyncTaskIdRef.current = selectedTask.id;
    }, [detailPanelMode, selectedTask]);

    const applyCachedAppData = useCallback((record: TaskCacheRecord) => {
        locallyUpdatedTasksRef.current.clear();
        setTaskState({
            status: "ready",
            tasks: record.tasks,
        });
        setTaskLists(record.taskLists);
        setOfflineDataSource("cache");
        if (record.settings) {
            setWebhookSettings(record.settings);
            setWebhookSettingsDraft({
                discord_webhook_url: record.settings.discord_webhook_url ?? "",
                discord_message_template:
                    record.settings.discord_message_template ?? "",
            });
            if (!hasStoredWorkingHours()) {
                setWorkingHours((current) => ({
                    ...current,
                    start: normalizeWorkingHour(
                        record.settings?.working_hours_start,
                        current.start,
                    ),
                }));
            }
            setWeekStart(normalizeWeekStart(record.settings.week_start));
        }
    }, []);

    const loadCachedAppData = useCallback(
        async (userId: string): Promise<boolean> => {
            try {
                const cachedRecord = await loadTaskCache(userId);
                if (!cachedRecord) {
                    return false;
                }
                applyCachedAppData(cachedRecord);
                return true;
            } catch {
                return false;
            }
        },
        [applyCachedAppData],
    );

    const saveCurrentTaskCache = useCallback(
        async (overrides: Partial<TaskCacheData> = {}) => {
            const userId = currentUserIdRef.current;
            if (!userId) {
                return;
            }

            try {
                const existingRecord = await loadTaskCache(userId);
                await saveTaskCache(userId, {
                    tasks:
                        overrides.tasks ??
                        (tasksRef.current.length > 0
                            ? tasksRef.current
                            : (existingRecord?.tasks ?? tasksRef.current)),
                    taskLists:
                        overrides.taskLists ??
                        (taskListsRef.current.length > 0
                            ? taskListsRef.current
                            : (existingRecord?.taskLists ??
                              taskListsRef.current)),
                    settings:
                        overrides.settings === undefined
                            ? (webhookSettingsRef.current ??
                              existingRecord?.settings ??
                              null)
                            : overrides.settings,
                });
            } catch {
                // Offline cache persistence should not block normal online use.
            }
        },
        [],
    );

    const refreshTasks = useCallback(async (options?: { silent?: boolean }) => {
        const userId = currentUserIdRef.current;

        setTaskState((current) => ({
            status: current.tasks.length > 0 ? "refreshing" : "loading",
            tasks: current.tasks,
        }));

        if (!isBrowserOnline && userId) {
            const didLoadCache = await loadCachedAppData(userId);
            if (didLoadCache) {
                if (!options?.silent) {
                    setTaskSnackbarMessage(offlineReadOnlyMessage);
                }
                return;
            }
        }

        try {
            const loadedTasks = await listTasks();
            const nextTasks = mergeLocallyUpdatedTasks(
                loadedTasks,
                locallyUpdatedTasksRef.current,
            );
            setTaskState({
                status: "ready",
                tasks: nextTasks,
            });
            setOfflineDataSource("server");
            tasksRef.current = nextTasks;
            void saveCurrentTaskCache({ tasks: nextTasks });
        } catch (error) {
            if (isAuthError(error)) {
                handleAuthExpired();
                return;
            }
            if (userId && (isOfflineNetworkError(error) || !isBrowserOnline)) {
                const didLoadCache = await loadCachedAppData(userId);
                if (didLoadCache) {
                    if (!options?.silent) {
                        setTaskSnackbarMessage(offlineReadOnlyMessage);
                    }
                    return;
                }
            }
            if (options?.silent) {
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
    }, [
        handleAuthExpired,
        isBrowserOnline,
        loadCachedAppData,
        saveCurrentTaskCache,
    ]);

    useEffect(() => {
        if (!currentUser) {
            return;
        }

        if (taskState.status === "ready" && taskState.tasks.length > 0) {
            void saveCurrentTaskCache({ tasks: taskState.tasks });
            return;
        }

        if (
            taskState.status === "error" &&
            isOfflineNetworkError(new Error(taskState.message))
        ) {
            void (async () => {
                const didLoadCache = await loadCachedAppData(currentUser.id);
                if (didLoadCache) {
                    setTaskSnackbarMessage(offlineReadOnlyMessage);
                }
            })();
        }
    }, [currentUser, loadCachedAppData, saveCurrentTaskCache, taskState]);

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

    const refreshTaskLists = useCallback(
        async (options?: { silent?: boolean }) => {
            try {
                const loadedTaskLists = await listTaskLists();
                setTaskLists(loadedTaskLists);
                taskListsRef.current = loadedTaskLists;
                void saveCurrentTaskCache({ taskLists: loadedTaskLists });
            } catch (error) {
                if (isAuthError(error)) {
                    handleAuthExpired();
                    return;
                }
                if (options?.silent) {
                    return;
                }
                setFormError(
                    error instanceof Error
                        ? error.message
                        : "Unable to load categories",
                );
            }
        },
        [handleAuthExpired, saveCurrentTaskCache],
    );

    const handleConfirmBackupImport = useCallback(async (file: File | null) => {
        if (isOfflineReadOnly) {
            setTaskUndo(null);
            setTaskSnackbarMessage(offlineReadOnlyMessage);
            return;
        }
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
    }, [isOfflineReadOnly, refreshTaskLists, refreshTasks]);

    const handleBackupImportFileChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            if (isOfflineReadOnly) {
                setTaskUndo(null);
                setTaskSnackbarMessage(offlineReadOnlyMessage);
                event.target.value = "";
                return;
            }
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            setBackupImportFile(file);
            setBackupImportMessage(null);
            setBackupImportError(null);

            if (!file) {
                return;
            }
        },
        [isOfflineReadOnly],
    );

    const refreshWebhookSettings = useCallback(async () => {
        try {
            const loadedSettings = await getSettings();
            setWebhookSettings(loadedSettings);
            webhookSettingsRef.current = loadedSettings;
            setWebhookSettingsDraft({
                discord_webhook_url: loadedSettings.discord_webhook_url ?? "",
                discord_message_template:
                    loadedSettings.discord_message_template ?? "",
            });
            if (!hasStoredWorkingHours()) {
                setWorkingHours((current) => ({
                    ...current,
                    start: normalizeWorkingHour(
                        loadedSettings.working_hours_start,
                        current.start,
                    ),
                }));
            }
            setWeekStart(normalizeWeekStart(loadedSettings.week_start));
            void saveCurrentTaskCache({ settings: loadedSettings });
        } catch (error) {
            if (isAuthError(error)) {
                handleAuthExpired();
                return;
            }
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to load settings",
            );
        }
    }, [handleAuthExpired, saveCurrentTaskCache]);

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
        if (!authToken || typeof window === "undefined") {
            return;
        }

        const pollIntervalMs = 30 * 1000;

        const clearTaskSyncInterval = () => {
            if (taskSyncIntervalRef.current !== null) {
                window.clearInterval(taskSyncIntervalRef.current);
                taskSyncIntervalRef.current = null;
            }
        };

        const runTaskSyncRefresh = async () => {
            if (taskSyncInFlightRef.current || !authToken) {
                return;
            }

            taskSyncInFlightRef.current = true;
            try {
                await Promise.all([
                    refreshTasks({ silent: true }),
                    refreshTaskLists({ silent: true }),
                ]);
            } finally {
                taskSyncInFlightRef.current = false;
            }
        };

        const ensureTaskSyncInterval = () => {
            clearTaskSyncInterval();

            if (document.hidden) {
                return;
            }

            taskSyncIntervalRef.current = window.setInterval(() => {
                void runTaskSyncRefresh();
            }, pollIntervalMs);
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                clearTaskSyncInterval();
                return;
            }

            void runTaskSyncRefresh();
            ensureTaskSyncInterval();
        };

        const handleWindowFocus = () => {
            if (document.hidden) {
                return;
            }

            void runTaskSyncRefresh();
        };

        void runTaskSyncRefresh();
        ensureTaskSyncInterval();

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("focus", handleWindowFocus);

        return () => {
            clearTaskSyncInterval();
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
            window.removeEventListener("focus", handleWindowFocus);
        };
    }, [authToken, refreshTaskLists, refreshTasks]);

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
        saveShowCompletedTasks(showCompletedTasks);
    }, [showCompletedTasks]);

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
            .filter(
                (task) =>
                    !task.scheduled_start && !task.scheduled_end && !task.due_at,
            )
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

    useEffect(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return;
        }

        const mediaQuery = window.matchMedia(mobileLayoutQuery);
        const handleLayoutChange = () => {
            setIsMobileLayout((current) => {
                if (current === mediaQuery.matches) {
                    return current;
                }

                window.requestAnimationFrame(() => {
                    calendarRef.current?.getApi().updateSize();
                });
                return mediaQuery.matches;
            });
        };

        mediaQuery.addEventListener("change", handleLayoutChange);

        return () => {
            mediaQuery.removeEventListener("change", handleLayoutChange);
        };
    }, []);

    useEffect(() => {
        const handleViewportResize = () => {
            scheduleCalendarResize();
        };

        window.addEventListener("resize", handleViewportResize);

        return () => {
            window.removeEventListener("resize", handleViewportResize);
        };
    }, [scheduleCalendarResize]);

    useLayoutEffect(() => {
        const api = calendarRef.current?.getApi();
        if (!api) {
            return;
        }

        api.scrollToTime(`${workingHours.start}:00`);
        api.updateSize();
        if (!isTimeGridView) {
            return;
        }

        const resizeFrame = window.requestAnimationFrame(() => {
            calendarRef.current?.getApi().updateSize();
        });

        return () => {
            window.cancelAnimationFrame(resizeFrame);
        };
    }, [
        calendarView,
        isTimeGridView,
        isMobileLayout,
        isFullDayTimelineVisible,
        workingHours.end,
        workingHours.start,
    ]);

    useEffect(() => {
        const taskListElement = taskListRef.current;
        if (
            !taskListElement ||
            detailPanelMode ||
            isMobileLayout ||
            isOfflineReadOnly
        ) {
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
    }, [
        activeView,
        detailPanelMode,
        isDetailPanelClosing,
        isMobileLayout,
        isOfflineReadOnly,
    ]);

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
        if (!isMonthYearPickerOpen) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (
                target instanceof Node &&
                (monthYearPickerRef.current?.contains(target) ||
                    monthYearPickerTriggerRef.current?.contains(target))
            ) {
                return;
            }

            setIsMonthYearPickerOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsMonthYearPickerOpen(false);
                monthYearPickerTriggerRef.current?.focus();
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isMonthYearPickerOpen]);

    useLayoutEffect(() => {
        if (!isMonthYearPickerOpen || !isMobileLayout) {
            setMonthYearPickerStyle(null);
            return;
        }

        const updateMonthYearPickerPosition = () => {
            const triggerRect =
                monthYearPickerTriggerRef.current?.getBoundingClientRect();
            if (!triggerRect) {
                return;
            }

            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const margin = 12;
            const maxWidth = Math.min(360, viewportWidth - margin * 2);
            const top = Math.min(
                Math.max(triggerRect.bottom + 10, margin),
                viewportHeight - margin,
            );
            const centeredLeft = triggerRect.left + triggerRect.width / 2;
            const left = Math.min(
                Math.max(centeredLeft - maxWidth / 2, margin),
                viewportWidth - margin - maxWidth,
            );

            setMonthYearPickerStyle({
                position: "fixed",
                top,
                left,
                width: maxWidth,
                maxHeight: `calc(100vh - ${top + margin}px)`,
            });
        };

        updateMonthYearPickerPosition();

        const handleResize = () => {
            updateMonthYearPickerPosition();
        };

        window.addEventListener("resize", handleResize);
        window.addEventListener("scroll", handleResize, true);

        return () => {
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("scroll", handleResize, true);
        };
    }, [isMobileLayout, isMonthYearPickerOpen, monthYearPickerYear]);

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
        setMobileQuickActionTaskId(null);
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
        setTaskSnackbarMessage(null);
    }, []);

    const showTaskUndo = useCallback((undo: TaskUndoState) => {
        setTaskUndo(undo);
        setTaskSnackbarMessage(null);
    }, []);

    const showTaskSnackbarMessage = useCallback((message: string) => {
        setTaskUndo(null);
        setTaskSnackbarMessage(message);
    }, []);

    const guardOfflineMutation = useCallback(
        (message = offlineReadOnlyMessage): boolean => {
            if (!isOfflineReadOnly) {
                return false;
            }

            setTaskUndo(null);
            setTaskSnackbarMessage((current) =>
                current === message ? current : message,
            );
            return true;
        },
        [isOfflineReadOnly],
    );

    useEffect(() => {
        if (isOfflineReadOnly) {
            setTaskUndo(null);
            setTaskSnackbarMessage((current) =>
                current === offlineReadOnlyMessage
                    ? current
                    : offlineReadOnlyMessage,
            );
            return;
        }

        setTaskSnackbarMessage((current) =>
            current === offlineReadOnlyMessage ? null : current,
        );
    }, [isOfflineReadOnly]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const handleOnline = () => {
            setIsBrowserOnline(true);
            void refreshTasks();
            void refreshTaskLists({ silent: true });
            void refreshWebhookSettings();
        };
        const handleOffline = () => {
            setIsBrowserOnline(false);
            setTaskUndo(null);
            setTaskSnackbarMessage(offlineReadOnlyMessage);
            if (currentUserIdRef.current) {
                void loadCachedAppData(currentUserIdRef.current);
            }
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, [
        loadCachedAppData,
        refreshTaskLists,
        refreshTasks,
        refreshWebhookSettings,
    ]);

    const handleUndoTaskChange = useCallback(async () => {
        if (guardOfflineMutation()) {
            return;
        }
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
    }, [guardOfflineMutation, refreshTasks, reloadTasks, replaceTaskInState, taskUndo]);

    const runTaskDelete = useCallback(
        async (
            taskId: string,
            source: "detail" | "menu",
            deleteScope: "single" | "following" = "single",
        ) => {
            if (guardOfflineMutation()) {
                return;
            }
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
                    const undoState = buildDeleteTaskUndo(previousTask, deleteScope);
                    if (undoState) {
                        showTaskUndo(undoState);
                    }
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
        [
            clearUndoState,
            closeDetailPanel,
            reloadTasks,
            selectedTaskId,
            showTaskUndo,
            guardOfflineMutation,
        ],
    );

    const runTaskUpdate = useCallback(
        async (
            taskId: string,
            updates: Parameters<typeof updateTask>[1],
            updateScope: "single" | "series" = "single",
            source: "form" | "calendar" = "form",
        ) => {
            if (guardOfflineMutation()) {
                if (source === "calendar") {
                    pendingTaskEdit?.revert?.();
                    setPendingTaskEdit(null);
                }
                return;
            }
            setFormError(null);
            clearUndoState();
            setIsEditSaving(true);
            const previousTask = tasksRef.current.find(
                (task) => task.id === taskId,
            );

            try {
                let updatedTask: ScheduledTask;
                if (updateScope === "series") {
                    updatedTask = await updateTask(taskId, updates, { updateScope });
                } else {
                    updatedTask = await updateTask(taskId, updates);
                }
                if (previousTask) {
                    const undoState = buildUpdateTaskUndo(
                        previousTask,
                        updates,
                        updateScope,
                    );
                    if (undoState?.kind === "unavailable") {
                        showTaskSnackbarMessage(undoState.message);
                    } else if (undoState) {
                        showTaskUndo(undoState);
                    }
                }
                setPendingTaskEdit(null);
                if (source === "calendar") {
                    replaceTaskInState(updatedTask);
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
        [
            clearUndoState,
            closeDetailPanel,
            pendingTaskEdit,
            reloadTasks,
            replaceTaskInState,
            showTaskSnackbarMessage,
            showTaskUndo,
            guardOfflineMutation,
        ],
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

    const isMobileCalendarSwipeEnabled =
        isMobileLayout && mobileScreen === "calendar";

    const clearCalendarTapSuppressTimer = useCallback(() => {
        if (calendarTapSuppressTimerRef.current !== null) {
            window.clearTimeout(calendarTapSuppressTimerRef.current);
            calendarTapSuppressTimerRef.current = null;
        }
    }, []);

    const scheduleCalendarTapSuppressReset = useCallback(() => {
        clearCalendarTapSuppressTimer();
        calendarTapSuppressTimerRef.current = window.setTimeout(() => {
            suppressNextCalendarTapRef.current = false;
            calendarTapSuppressTimerRef.current = null;
        }, mobileCalendarTapSuppressResetMs);
    }, [clearCalendarTapSuppressTimer]);

    const markCalendarSwipeIntent = useCallback(() => {
        suppressNextCalendarTapRef.current = true;
    }, []);

    const handleCalendarTouchStart = useCallback(
        (event: ReactTouchEvent<HTMLElement>) => {
            const touch = event.touches[0];
            if (!isMobileCalendarSwipeEnabled || !touch) {
                calendarSwipeStateRef.current = null;
                return;
            }

            calendarSwipeStateRef.current = {
                startX: touch.clientX,
                startY: touch.clientY,
                currentX: touch.clientX,
                currentY: touch.clientY,
                blocked: shouldIgnoreCalendarSwipeTarget(event.target),
                isHorizontalSwipe: false,
            };
        },
        [isMobileCalendarSwipeEnabled],
    );

    const handleCalendarTouchMove = useCallback(
        (event: ReactTouchEvent<HTMLElement>) => {
            const swipeState = calendarSwipeStateRef.current;
            const touch = event.touches[0];
            if (
                !isMobileCalendarSwipeEnabled ||
                !swipeState ||
                swipeState.blocked ||
                !touch
            ) {
                return;
            }

            swipeState.currentX = touch.clientX;
            swipeState.currentY = touch.clientY;

            if (
                isHorizontalCalendarSwipeIntent(
                    swipeState.startX,
                    swipeState.startY,
                    swipeState.currentX,
                    swipeState.currentY,
                    mobileCalendarTapSuppressThresholdPx,
                )
            ) {
                swipeState.isHorizontalSwipe = true;
                markCalendarSwipeIntent();
            }
        },
        [isMobileCalendarSwipeEnabled, markCalendarSwipeIntent],
    );

    const handleCalendarTouchEnd = useCallback(
        (event: ReactTouchEvent<HTMLElement>) => {
            const swipeState = calendarSwipeStateRef.current;
            calendarSwipeStateRef.current = null;

            if (
                !isMobileCalendarSwipeEnabled ||
                !swipeState ||
                swipeState.blocked
            ) {
                return;
            }

            const touch = event.changedTouches[0];
            if (!touch) {
                return;
            }

            const deltaX = touch.clientX - swipeState.startX;
            const deltaY = touch.clientY - swipeState.startY;
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);
            const isHorizontalTapSuppressGesture =
                swipeState.isHorizontalSwipe ||
                isHorizontalCalendarSwipeIntent(
                    swipeState.startX,
                    swipeState.startY,
                    touch.clientX,
                    touch.clientY,
                    mobileCalendarTapSuppressThresholdPx,
                );

            if (isHorizontalTapSuppressGesture) {
                markCalendarSwipeIntent();
                scheduleCalendarTapSuppressReset();
            }

            if (
                absDeltaX < mobileCalendarSwipeThresholdPx ||
                absDeltaX <= absDeltaY * mobileCalendarSwipeHorizontalRatio
            ) {
                return;
            }

            navigateCalendar(deltaX < 0 ? "next" : "prev");
        },
        [
            isMobileCalendarSwipeEnabled,
            markCalendarSwipeIntent,
            navigateCalendar,
            scheduleCalendarTapSuppressReset,
        ],
    );

    const handleCalendarTouchCancel = useCallback(() => {
        calendarSwipeStateRef.current = null;
        scheduleCalendarTapSuppressReset();
    }, [scheduleCalendarTapSuppressReset]);

    const shouldSuppressCalendarCreateFromTap = useCallback(() => {
        if (!isMobileCalendarSwipeEnabled || !suppressNextCalendarTapRef.current) {
            return false;
        }

        suppressNextCalendarTapRef.current = false;
        scheduleCalendarTapSuppressReset();
        return true;
    }, [isMobileCalendarSwipeEnabled, scheduleCalendarTapSuppressReset]);

    useEffect(
        () => () => {
            clearCalendarTapSuppressTimer();
        },
        [clearCalendarTapSuppressTimer],
    );

    const goToToday = useCallback(() => {
        startCalendarTransition("today");
        calendarRef.current?.getApi().today();
        setIsMonthYearPickerOpen(false);
    }, [startCalendarTransition]);

    const changeCalendarView = useCallback((nextView: CalendarView) => {
        startCalendarTransition("view");
        calendarRef.current?.getApi().changeView(nextView);
        setIsMonthYearPickerOpen(false);
    }, [startCalendarTransition]);

    const cycleCalendarView = useCallback(() => {
        changeCalendarView(calendarViewCycle[calendarView]);
    }, [calendarView, changeCalendarView]);

    const toggleMonthYearPicker = useCallback(() => {
        setIsMonthYearPickerOpen((current) => {
            if (!current) {
                setMonthYearPickerYear(calendarDate.getFullYear());
            }
            return !current;
        });
    }, [calendarDate]);

    const selectCalendarMonth = useCallback(
        (monthIndex: number) => {
            const nextDate = new Date(calendarDate);
            nextDate.setDate(1);
            nextDate.setFullYear(monthYearPickerYear, monthIndex, 1);
            startCalendarTransition("today");
            calendarRef.current?.getApi().gotoDate(nextDate);
            setIsMonthYearPickerOpen(false);
        },
        [calendarDate, monthYearPickerYear, startCalendarTransition],
    );

    const handleEventDrop = useCallback(
        async (dropInfo: EventDropArg) => {
            if (guardOfflineMutation()) {
                dropInfo.revert();
                return;
            }
            if (isMobileLayout) {
                dropInfo.revert();
                return;
            }

            const task = tasksRef.current.find(
                (item) => item.id === dropInfo.event.id,
            );
            const updates = getCalendarEventScheduleUpdate(dropInfo.event, task);
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
                    const undoState = buildUpdateTaskUndo(
                        task,
                        updates,
                        "single",
                        "Task moved.",
                    );
                    if (undoState?.kind === "unavailable") {
                        showTaskSnackbarMessage(undoState.message);
                    } else if (undoState) {
                        showTaskUndo(undoState);
                    }
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
        [
            clearUndoState,
            isMobileLayout,
            reloadTasks,
            showTaskSnackbarMessage,
            showTaskUndo,
            guardOfflineMutation,
        ],
    );

    const handleEventResize = useCallback(
        async (resizeInfo: EventResizeDoneArg) => {
            if (guardOfflineMutation()) {
                resizeInfo.revert();
                return;
            }
            if (isMobileLayout) {
                resizeInfo.revert();
                return;
            }

            const task = tasksRef.current.find(
                (item) => item.id === resizeInfo.event.id,
            );
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
                    const undoState = buildUpdateTaskUndo(
                        task,
                        updates,
                        "single",
                        "Task resized.",
                    );
                    if (undoState?.kind === "unavailable") {
                        showTaskSnackbarMessage(undoState.message);
                    } else if (undoState) {
                        showTaskUndo(undoState);
                    }
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
        [
            clearUndoState,
            isMobileLayout,
            reloadTasks,
            showTaskSnackbarMessage,
            showTaskUndo,
            guardOfflineMutation,
        ],
    );

    const openCreatePanel = useCallback(
        (start: Date, end: Date) => {
            if (guardOfflineMutation()) {
                return;
            }
            setFormError(null);
            setIsViewMenuOpen(false);
            setIsCategoryMenuOpen(false);
            setIsAddingCategory(false);
            setContextMenu(null);
            setMobileQuickActionTaskId(null);
            if (isNarrowScreen()) {
                setIsSidebarOpen(true);
                setMobileScreen("calendar");
            }
            setDetailPanelMode("create");
            setSelectedTaskId(null);
            setCreateAccordionSection("schedule");
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
        [guardOfflineMutation, selectedListIdForForms],
    );

    const openDateOnlyCreatePanel = useCallback(
        (date: Date) => {
            if (guardOfflineMutation()) {
                return;
            }
            setFormError(null);
            setIsViewMenuOpen(false);
            setIsCategoryMenuOpen(false);
            setIsAddingCategory(false);
            setContextMenu(null);
            setMobileQuickActionTaskId(null);
            if (isNarrowScreen()) {
                setIsSidebarOpen(true);
                setMobileScreen("calendar");
            }
            setDetailPanelMode("create");
            setSelectedTaskId(null);
            setCreateAccordionSection("schedule");
            setFormState({
                ...initialFormState,
                list_id: selectedListIdForForms,
                scheduled_start: dateToDateInputValue(date),
                scheduled_end: "",
            });
            window.setTimeout(() => {
                createFormRef.current?.scrollIntoView?.({
                    block: "nearest",
                    behavior: "smooth",
                });
                titleInputRef.current?.focus();
            }, 0);
        },
        [guardOfflineMutation, selectedListIdForForms],
    );

    const openUnscheduledCreatePanel = useCallback(() => {
        if (guardOfflineMutation()) {
            return;
        }
        setFormError(null);
        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setIsAddingCategory(false);
        setContextMenu(null);
        setMobileQuickActionTaskId(null);
        setDetailPanelMode("create");
        setSelectedTaskId(null);
        setCreateAccordionSection("schedule");
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
    }, [guardOfflineMutation, selectedListIdForForms]);

    const openTaskDetailPanel = useCallback((taskId: string) => {
        setFormError(null);
        setIsViewMenuOpen(false);
        setIsCategoryMenuOpen(false);
        setIsAddingCategory(false);
        setContextMenu(null);
        setMobileQuickActionTaskId(null);
        setIsDetailPanelClosing(false);
        if (isNarrowScreen()) {
            setIsSidebarOpen(true);
        }
        setDetailPanelMode("edit");
        setSelectedTaskId(taskId);
        const task = tasksRef.current.find((candidate) => candidate.id === taskId);
        setEditAccordionSection(getInitialEditAccordionSection(task));
    }, []);

    const handleDateSelect = useCallback(
        (selectInfo: DateSelectArg) => {
            if (shouldSuppressCalendarCreateFromTap()) {
                return;
            }

            if (selectInfo.allDay) {
                openDateOnlyCreatePanel(selectInfo.start);
                return;
            }

            openCreatePanel(
                selectInfo.start,
                selectInfo.end,
            );
        },
        [
            openCreatePanel,
            openDateOnlyCreatePanel,
            shouldSuppressCalendarCreateFromTap,
        ],
    );

    const handleDateClick = useCallback(
        (clickInfo: DateClickArg) => {
            if (shouldSuppressCalendarCreateFromTap()) {
                return;
            }

            const isMobileCalendar = isNarrowScreen();
            if (calendarView === "dayGridMonth" && isMobileCalendar) {
                setMobileMonthPreviewDate(clickInfo.date);
                return;
            }

            const start = clickInfo.date;
            if (clickInfo.allDay) {
                openDateOnlyCreatePanel(start);
                return;
            }

            const end = clickInfo.allDay
                ? addLocalDays(start, 1)
                : new Date(start.getTime() + 60 * 60 * 1000);
            openCreatePanel(start, end);
        },
        [
            calendarView,
            openCreatePanel,
            openDateOnlyCreatePanel,
            shouldSuppressCalendarCreateFromTap,
        ],
    );

    const handleCheckboxChange = useCallback(
        async (task: ScheduledTask) => {
            if (guardOfflineMutation()) {
                return;
            }
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
        [clearUndoState, guardOfflineMutation, reloadTasks, showTaskUndo],
    );

    const applyMobileQuickAction = useCallback(
        async (task: ScheduledTask, action: MobileQuickAction) => {
            if (guardOfflineMutation()) {
                return;
            }
            if (task.all_day || !task.scheduled_start || !task.scheduled_end) {
                return;
            }

            const start = parseTaskDate(task.scheduled_start);
            const end = parseTaskDate(task.scheduled_end);
            const stepMs = 15 * 60 * 1000;
            const minimumDurationMs = stepMs;
            let nextStart = start;
            let nextEnd = end;

            if (action === "earlier") {
                nextStart = new Date(start.getTime() - stepMs);
                nextEnd = new Date(end.getTime() - stepMs);
            } else if (action === "later") {
                nextStart = new Date(start.getTime() + stepMs);
                nextEnd = new Date(end.getTime() + stepMs);
            } else if (action === "shorten") {
                if (end.getTime() - start.getTime() <= minimumDurationMs) {
                    return;
                }
                nextEnd = new Date(end.getTime() - stepMs);
            } else {
                nextEnd = new Date(end.getTime() + stepMs);
            }

            if (nextEnd <= nextStart) {
                return;
            }

            const updates = {
                scheduled_start: nextStart.toISOString(),
                scheduled_end: nextEnd.toISOString(),
                all_day: false,
            };

            if (shouldPromptRecurringTaskEdit(task, updates)) {
                setPendingTaskEdit({
                    taskId: task.id,
                    updates,
                    source: "calendar",
                });
                return;
            }

            await runTaskUpdate(task.id, updates, "single", "calendar");
        },
        [guardOfflineMutation, runTaskUpdate],
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

    const renderDayHeaderContent = useCallback(
        (dayHeaderInfo: DayHeaderContentArg) => {
            if (
                (dayHeaderInfo.view.type !== "timeGridWeek" &&
                    dayHeaderInfo.view.type !== "timeGridDay") ||
                !isMobileLayout
            ) {
                return dayHeaderInfo.text;
            }

            return (
                <span className="mobile-week-day-header">
                    <span className="mobile-week-day-label">
                        {new Intl.DateTimeFormat(undefined, {
                            weekday: "short",
                        }).format(dayHeaderInfo.date)}
                    </span>
                    <span className="mobile-week-date-label">
                        {new Intl.DateTimeFormat(undefined, {
                            day: "2-digit",
                        }).format(dayHeaderInfo.date)}
                    </span>
                </span>
            );
        },
        [isMobileLayout],
    );

    const mobileCalendarPeriodLabel = useMemo(
        () =>
            `${calendarDate.getFullYear()} ${new Intl.DateTimeFormat(undefined, {
                month: "short",
            }).format(calendarDate)}`,
        [calendarDate],
    );

    const renderSlotLabelContent = useCallback(
        (slotLabelInfo: SlotLabelContentArg) => {
            if (
                (slotLabelInfo.view.type !== "timeGridWeek" &&
                    slotLabelInfo.view.type !== "timeGridDay") ||
                !isMobileLayout
            ) {
                return slotLabelInfo.text;
            }

            return String(slotLabelInfo.date.getHours()).padStart(2, "0");
        },
        [isMobileLayout],
    );

    const renderEventContent = useCallback(
        (eventInfo: EventContentArg) => {
            const task =
                (eventInfo.event.extendedProps.task as ScheduledTask | undefined) ??
                tasksRef.current.find((item) => item.id === eventInfo.event.id);
            const isMobileMonthEvent =
                eventInfo.view.type === "dayGridMonth" && isMobileLayout;
            const isMobileWeekEvent =
                eventInfo.view.type === "timeGridWeek" && isMobileLayout;

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
                    <div
                        className="calendar-task calendar-task-month-summary"
                        data-testid="calendar-task-event"
                        data-task-id={task.id}
                    >
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
                <div
                    className="calendar-task"
                    data-testid="calendar-task-event"
                    data-task-id={task.id}
                >
                    {!isMobileWeekEvent && (
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
                    )}
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
        [completionTransition, handleCheckboxChange, isMobileLayout],
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

        if (isNarrowScreen()) {
            if (clickInfo.el.dataset.mobileLongPressOpened === "true") {
                delete clickInfo.el.dataset.mobileLongPressOpened;
                return;
            }

            setIsViewMenuOpen(false);
            setIsCategoryMenuOpen(false);
            setIsAddingCategory(false);
            setIsDetailPanelClosing(false);
            setDetailPanelMode(null);
            setSelectedTaskId(clickInfo.event.id);
            setMobileQuickActionTaskId(clickInfo.event.id);
            setContextMenu(null);
            setMobileScreen("calendar");
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
        setMobileQuickActionTaskId(null);
        setSelectedTaskId(clickInfo.event.id);
        setContextMenu(null);
    }, []);

    const applyLocalUnscheduledOrder = useCallback((nextOrder: string[]) => {
        unscheduledOrderRef.current = nextOrder;
        setUnscheduledOrder(nextOrder);
    }, []);

    const persistUnscheduledOrder = useCallback(
        (nextOrder: string[]) => {
            if (guardOfflineMutation()) {
                return;
            }
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
        [
            applyLocalUnscheduledOrder,
            clearUndoState,
            guardOfflineMutation,
            refreshTasks,
            replaceTasksInState,
        ],
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
            if (guardOfflineMutation()) {
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
        [activeView, applyLocalUnscheduledOrder, dragTargetMode, guardOfflineMutation],
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
            if (guardOfflineMutation()) {
                return;
            }
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
        [
            activeView,
            applyLocalUnscheduledOrder,
            guardOfflineMutation,
            persistUnscheduledOrder,
        ],
    );

    const moveUnscheduledTaskByOffset = useCallback(
        (taskId: string, offset: number) => {
            if (guardOfflineMutation()) {
                return;
            }
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
        [
            activeView,
            applyLocalUnscheduledOrder,
            guardOfflineMutation,
            persistUnscheduledOrder,
        ],
    );

    const endScheduleDragHighlight = useCallback(() => {
        scheduleDragCleanupRef.current?.();
        scheduleDragCleanupRef.current = null;
        setDragTargetMode((current) => (current === "schedule" ? null : current));
    }, []);

    const startScheduleDragHighlight = useCallback(() => {
        if (isOfflineReadOnly) {
            return;
        }
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
    }, [endScheduleDragHighlight, isOfflineReadOnly]);

    useEffect(() => {
        return () => {
            endScheduleDragHighlight();
        };
    }, [endScheduleDragHighlight]);

    const handleExternalTaskDrop = useCallback(
        async (dropInfo: DropArg) => {
            if (guardOfflineMutation()) {
                endScheduleDragHighlight();
                return;
            }
            if (isMobileLayout) {
                endScheduleDragHighlight();
                return;
            }

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
                const undoState = buildUpdateTaskUndo(
                    task,
                    updates,
                    "single",
                    "Task moved.",
                );
                if (undoState?.kind === "unavailable") {
                    showTaskSnackbarMessage(undoState.message);
                } else if (undoState) {
                    showTaskUndo(undoState);
                }
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
            isMobileLayout,
            refreshTasks,
            replaceTaskInState,
            showTaskSnackbarMessage,
            showTaskUndo,
            guardOfflineMutation,
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

        if (isNarrowScreen()) {
            let longPressTimer: number | null = null;
            let startX = 0;
            let startY = 0;

            const clearLongPressTimer = () => {
                if (longPressTimer !== null) {
                    window.clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            };
            const handlePointerDown = (event: PointerEvent) => {
                if (event.pointerType !== "touch") {
                    return;
                }

                startX = event.clientX;
                startY = event.clientY;
                clearLongPressTimer();
                longPressTimer = window.setTimeout(() => {
                    longPressTimer = null;
                    mountInfo.el.dataset.mobileLongPressOpened = "true";
                    openTaskDetailPanel(mountInfo.event.id);
                }, mobileCalendarLongPressDelayMs);
            };
            const handlePointerMove = (event: PointerEvent) => {
                if (event.pointerType !== "touch" || longPressTimer === null) {
                    return;
                }

                const moved =
                    Math.abs(event.clientX - startX) > 8 ||
                    Math.abs(event.clientY - startY) > 8;
                if (moved) {
                    clearLongPressTimer();
                }
            };
            const handlePointerEnd = () => {
                clearLongPressTimer();
            };
            const handleContextMenu = (event: MouseEvent) => {
                event.preventDefault();
            };

            mountInfo.el.addEventListener("pointerdown", handlePointerDown);
            mountInfo.el.addEventListener("pointermove", handlePointerMove);
            mountInfo.el.addEventListener("pointerup", handlePointerEnd);
            mountInfo.el.addEventListener("pointercancel", handlePointerEnd);
            mountInfo.el.addEventListener("contextmenu", handleContextMenu);
            mobileEventCleanupRef.current.set(mountInfo.el, () => {
                clearLongPressTimer();
                mountInfo.el.removeEventListener("pointerdown", handlePointerDown);
                mountInfo.el.removeEventListener("pointermove", handlePointerMove);
                mountInfo.el.removeEventListener("pointerup", handlePointerEnd);
                mountInfo.el.removeEventListener("pointercancel", handlePointerEnd);
                mountInfo.el.removeEventListener("contextmenu", handleContextMenu);
            });
            return;
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
    }, [openTaskDetailPanel]);

    const handleEventWillUnmount = useCallback((mountInfo: EventMountArg) => {
        const cleanup = mobileEventCleanupRef.current.get(mountInfo.el);
        cleanup?.();
        mobileEventCleanupRef.current.delete(mountInfo.el);
    }, []);

    const handleEventClassNames = useCallback(
        (eventInfo: EventContentArg) => {
            if (!isMobileLayout || eventInfo.event.id !== selectedTaskId) {
                return [];
            }

            return ["fc-event-selected", "calendar-task-event-selected"];
        },
        [isMobileLayout, selectedTaskId],
    );

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (guardOfflineMutation()) {
            return;
        }
        setFormError(null);

        if (!formState.title.trim()) {
            setFormError("Title is required");
            return;
        }

        const dateOnlyScheduledStart = getDateOnlyScheduledStartIso(
            formState.scheduled_start,
        );
        const isDateOnlyTask =
            Boolean(dateOnlyScheduledStart) && !formState.scheduled_end;

        if (
            !isDateOnlyTask &&
            (hasIncompleteDateTimeValue(formState.scheduled_start) ||
                hasIncompleteDateTimeValue(formState.scheduled_end))
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

        if (
            formState.recurrence_frequency &&
            !isDateOnlyTask &&
            !isCompleteDateTimeValue(formState.scheduled_start)
        ) {
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
            const notificationSettings = getNotificationSettings(
                formState,
                isDateOnlyTask,
            );
            await createTask({
                title: formState.title.trim(),
                list_id: formState.list_id || null,
                notes: formState.notes.trim() || null,
                scheduled_start: isDateOnlyTask
                    ? dateOnlyScheduledStart
                    : toIsoOrNull(formState.scheduled_start),
                scheduled_end: isDateOnlyTask
                    ? null
                    : toIsoOrNull(formState.scheduled_end),
                all_day: isDateOnlyTask,
                due_at: null,
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
        const clearedScheduleFields: Pick<
            TaskFormState,
            | "scheduled_start"
            | "scheduled_end"
            | "recurrence_frequency"
            | "recurrence_interval"
            | "recurrence_until"
            | "reminder_mode"
            | "notification_unit"
            | "notification_offset_value"
            | "notification_channel"
        > = {
            scheduled_start: "",
            scheduled_end: "",
            recurrence_frequency: "",
            recurrence_interval: "1",
            recurrence_until: "",
            reminder_mode: "NONE",
            notification_unit: "",
            notification_offset_value: "0",
            notification_channel: "",
        };

        if (detailPanelMode === "create") {
            setFormState((current) => ({
                ...current,
                ...clearedScheduleFields,
            }));
            return;
        }

        if (detailPanelMode === "edit") {
            setEditState((current) =>
                current
                    ? {
                          ...current,
                          ...clearedScheduleFields,
                      }
                    : current,
            );
        }
    }, [detailPanelMode]);

    const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (guardOfflineMutation()) {
            return;
        }
        setFormError(null);

        if (!selectedTask || !editState) {
            return;
        }

        if (!editState.title.trim()) {
            setFormError("Title is required");
            return;
        }

        const dateOnlyScheduledStart = getDateOnlyScheduledStartIso(
            editState.scheduled_start,
        );
        const isDateOnlyTask =
            Boolean(dateOnlyScheduledStart) && !editState.scheduled_end;

        if (
            !isDateOnlyTask &&
            (hasIncompleteDateTimeValue(editState.scheduled_start) ||
                hasIncompleteDateTimeValue(editState.scheduled_end))
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

        if (
            editState.recurrence_frequency &&
            !isDateOnlyTask &&
            !isCompleteDateTimeValue(editState.scheduled_start)
        ) {
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
        if (guardOfflineMutation()) {
            return;
        }
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
        setIsDeleteCategoryConfirming(false);
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
        if (guardOfflineMutation()) {
            return;
        }
        setIsAddingCategory(false);
        setIsDeleteCategoryConfirming(false);
        setEditingTaskListId(taskList.id);
        setEditingListName(taskList.name);
        setEditingListColor(taskList.color);
        window.setTimeout(() => categoryNameInputRef.current?.focus(), 0);
    }, [guardOfflineMutation]);

    const handleUpdateTaskList = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (guardOfflineMutation()) {
            return;
        }
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
        if (guardOfflineMutation()) {
            return;
        }
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
        if (guardOfflineMutation()) {
            return;
        }
        if (!selectedTask) {
            return;
        }

        if (promptRecurringTaskDelete(selectedTask, "detail")) {
            return;
        }

        await runTaskDelete(selectedTask.id, "detail");
    };

    const handleDeleteFromMenu = async () => {
        if (guardOfflineMutation()) {
            return;
        }
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
        if (guardOfflineMutation()) {
            return;
        }
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

    const normalizeWebhookMessageTemplate = (value: string) =>
        value.trim() || null;

    const saveWebhookSettings = async (): Promise<boolean> => {
        if (guardOfflineMutation()) {
            return false;
        }
        setFormError(null);
        setWebhookTestMessage(null);
        setIsWebhookSettingsSaving(true);

        try {
            const savedSettings = await updateSettings({
                discord_webhook_url:
                    webhookSettingsDraft.discord_webhook_url.trim() || null,
                discord_message_template: normalizeWebhookMessageTemplate(
                    webhookSettingsDraft.discord_message_template,
                ),
            });
            setWebhookSettings(savedSettings);
            setWebhookSettingsDraft({
                discord_webhook_url: savedSettings.discord_webhook_url ?? "",
                discord_message_template:
                    savedSettings.discord_message_template ?? "",
            });
            return true;
        } catch (error) {
            setFormError(
                error instanceof Error
                    ? error.message
                    : "Unable to save webhook settings",
            );
            return false;
        } finally {
            setIsWebhookSettingsSaving(false);
        }
    };

    const handleSaveWebhookSettings = async (
        event: FormEvent<HTMLFormElement>,
    ) => {
        event.preventDefault();
        const saved = await saveWebhookSettings();
        if (saved) {
            openSettingsMenu();
        }
    };

    const handleTestWebhookSettings = async () => {
        if (guardOfflineMutation()) {
            return;
        }
        setFormError(null);
        setWebhookTestMessage(null);
        setIsWebhookSettingsTesting(true);

        try {
            const result = await testSettings({
                discord_webhook_url:
                    webhookSettingsDraft.discord_webhook_url.trim() || null,
                discord_message_template: normalizeWebhookMessageTemplate(
                    webhookSettingsDraft.discord_message_template,
                ),
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

    const openSettingsMenu = () => {
        closeDetailPanel();
        closeSettingsPanels();
        resetAccountForms();
        setSettingsView("menu");
    };

    const openWebhookSettings = () => {
        closeDetailPanel();
        closeSettingsPanels();
        setSettingsView("webhook");
        setWebhookTestMessage(null);
        setWebhookSettingsDraft({
            discord_webhook_url: webhookSettings?.discord_webhook_url ?? "",
            discord_message_template:
                webhookSettings?.discord_message_template ?? "",
        });
    };

    const openCalendarDisplaySettings = () => {
        closeDetailPanel();
        closeSettingsPanels();
        setSettingsView("calendar-display");
    };

    const openBackupSettings = () => {
        closeDetailPanel();
        closeSettingsPanels();
        setBackupImportMessage(null);
        setBackupImportError(null);
        setBackupImportFile(null);
        setSettingsView("backup");
    };

    const openAccountSettings = () => {
        closeDetailPanel();
        closeSettingsPanels();
        resetAccountForms();
        setSettingsView("account");
    };

    const openChangePasswordSettings = () => {
        closeDetailPanel();
        closeSettingsPanels();
        resetAccountForms();
        setSettingsView("change-password");
    };

    const openDeleteAccountSettings = () => {
        closeDetailPanel();
        closeSettingsPanels();
        resetAccountForms();
        setSettingsView("delete-account");
    };

    const refreshAdminUsers = async () => {
        if (isOfflineReadOnly) {
            setAdminUsersError(offlineReadOnlyMessage);
            return;
        }
        setIsAdminUsersLoading(true);
        setAdminUsersError(null);
        try {
            setAdminUsers(await listAdminUsers());
        } catch (error) {
            setAdminUsersError(
                error instanceof Error
                    ? error.message
                    : "Unable to load users",
            );
        } finally {
            setIsAdminUsersLoading(false);
        }
    };

    const openAdminSettings = () => {
        closeDetailPanel();
        closeSettingsPanels();
        setSettingsView("admin");
        void refreshAdminUsers();
    };

    const handleSavePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (guardOfflineMutation()) {
            return;
        }
        setChangePasswordError(null);
        setChangePasswordSuccess(null);

        if (changePasswordNewPassword !== changePasswordConfirmNewPassword) {
            setChangePasswordError("New passwords do not match.");
            return;
        }

        setIsPasswordChanging(true);
        try {
            const result = await changePassword({
                current_password: changePasswordCurrentPassword,
                new_password: changePasswordNewPassword,
                confirm_new_password: changePasswordConfirmNewPassword,
            });
            setChangePasswordSuccess(result.message);
            setChangePasswordCurrentPassword("");
            setChangePasswordNewPassword("");
            setChangePasswordConfirmNewPassword("");
        } catch (error) {
            setChangePasswordError(
                error instanceof Error
                    ? error.message
                    : "Unable to change password",
            );
        } finally {
            setIsPasswordChanging(false);
        }
    };

    const handleDeleteAccount = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (guardOfflineMutation()) {
            return;
        }
        setDeleteAccountError(null);

        if (deleteAccountConfirmation !== "DELETE") {
            setDeleteAccountError('Type DELETE to continue.');
            return;
        }

        setIsDeletingAccount(true);
        try {
            await deleteAccount({
                confirmation: deleteAccountConfirmation,
            });
            clearStoredUserPreferences();
            handleLogout();
        } catch (error) {
            setDeleteAccountError(
                error instanceof Error
                    ? error.message
                    : "Unable to delete account",
            );
        } finally {
            setIsDeletingAccount(false);
        }
    };

    const openDeleteAdminUserConfirm = (user: AdminUser) => {
        if (guardOfflineMutation()) {
            return;
        }
        setAdminUsersError(null);
        setAdminUserDeleteCandidate(user);
    };

    const closeDeleteAdminUserConfirm = () => {
        if (deletingAdminUserId) {
            return;
        }
        setAdminUserDeleteCandidate(null);
    };

    const handleDeleteAdminUser = async () => {
        if (guardOfflineMutation()) {
            return;
        }
        if (!adminUserDeleteCandidate) {
            return;
        }

        const user = adminUserDeleteCandidate;
        setAdminUsersError(null);
        setDeletingAdminUserId(user.id);
        try {
            await deleteAdminUser(user.id);
            setAdminUserDeleteCandidate(null);
            await refreshAdminUsers();
        } catch (error) {
            setAdminUsersError(
                error instanceof Error
                    ? error.message
                    : "Unable to delete user",
            );
        } finally {
            setDeletingAdminUserId(null);
        }
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
        closeSettingsPanels();
        resetAccountForms();
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
    const isSettingsMenuOpen = settingsView === "menu";
    const isCalendarDisplaySettingsOpen =
        settingsView === "calendar-display";
    const isAccountSettingsOpen = settingsView === "account";
    const isChangePasswordSettingsOpen = settingsView === "change-password";
    const isDeleteAccountSettingsOpen = settingsView === "delete-account";
    const isAdminSettingsOpen = settingsView === "admin";
    const isWebhookSettingsOpen = settingsView === "webhook";
    const isBackupSettingsOpen = settingsView === "backup";
    const isSettingsSubviewOpen = settingsView !== null;
    const isSidebarTaskContentVisible =
        !detailPanelMode &&
        !isDetailPanelClosing &&
        !isSettingsSubviewOpen;
    const openMobileTaskScreen = useCallback(
        (screen: Extract<MobileScreen, "today" | "upcoming" | "unscheduled">) => {
            setMobileScreen(screen);
            setActiveView(screen);
            setIsSidebarOpen(true);
            closeSettingsPanels();
            resetAccountForms();
            closeDetailPanel();
        },
        [closeDetailPanel, closeSettingsPanels, resetAccountForms],
    );
    const openMobileCalendarScreen = useCallback(() => {
        setMobileScreen("calendar");
        setIsSidebarOpen(false);
        closeSettingsPanels();
        resetAccountForms();
        closeDetailPanel();
        window.setTimeout(() => {
            calendarRef.current?.getApi().updateSize();
        }, 0);
    }, [closeDetailPanel, closeSettingsPanels, resetAccountForms]);
    const openMobileSettingsScreen = useCallback(() => {
        setMobileScreen("settings");
        closeDetailPanel();
        setIsSidebarOpen(true);
        closeSettingsPanels();
        resetAccountForms();
        setSettingsView("menu");
    }, [closeDetailPanel, closeSettingsPanels, resetAccountForms]);

    const mobileQuickActionCanAdjust = Boolean(
        mobileQuickActionTask &&
            !mobileQuickActionTask.all_day &&
            mobileQuickActionTask.scheduled_start &&
            mobileQuickActionTask.scheduled_end,
    );

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
            className={`app-shell ${themeMode} ${isSidebarOpen ? "sidebar-open" : "sidebar-collapsed"} mobile-screen-${mobileScreen} ${detailPanelMode ? "detail-panel-open" : ""} ${mobileQuickActionTaskId ? "mobile-quick-action-open" : ""}`}
            style={appShellStyle}
            onTransitionEnd={(event) => {
                if (
                    event.target === event.currentTarget &&
                    event.propertyName === "grid-template-columns"
                ) {
                    scheduleCalendarResize();
                }
            }}
            onClick={(event) => {
                if (
                    event.target instanceof Element &&
                    event.target.closest(
                        ".admin-delete-button, .admin-confirm-delete-button, .dialog-backdrop, .choice-dialog",
                    )
                ) {
                    return;
                }
                closeSettingsPanels();
                resetAccountForms();
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
                                    if (isSettingsSubviewOpen) {
                                        closeSettingsPanels();
                                        resetAccountForms();
                                        return;
                                    }
                                    resetAccountForms();
                                    setSettingsView((current) =>
                                        current === "menu" ? null : "menu",
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
                                        className="settings-action-button settings-action-button-neutral"
                                        onClick={openCalendarDisplaySettings}
                                    >
                                        Calendar display
                                    </button>
                                    <button
                                        type="button"
                                        className="settings-action-button settings-action-button-neutral"
                                        onClick={openWebhookSettings}
                                    >
                                        Webhook
                                    </button>
                                    <button
                                        type="button"
                                        className="settings-action-button settings-action-button-neutral"
                                        onClick={openBackupSettings}
                                    >
                                        Backup &amp; Restore
                                    </button>
                                    <button
                                        type="button"
                                        className="settings-action-button settings-action-button-neutral"
                                        onClick={openAccountSettings}
                                    >
                                        Account
                                    </button>
                                    {currentUser?.is_admin ? (
                                        <button
                                            type="button"
                                            className="settings-action-button settings-action-button-warning"
                                            onClick={openAdminSettings}
                                        >
                                            Admin
                                        </button>
                                    ) : null}
                                </div>
                            </motion.section>
                        )}
                        {!detailPanelMode && isAdminSettingsOpen && (
                            <motion.section
                                key="admin-settings"
                                className="filter-section"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
                                <AdminSettingsPanel
                                    users={adminUsers}
                                    isLoading={isAdminUsersLoading}
                                    error={adminUsersError}
                                    deletingUserId={deletingAdminUserId}
                                    onBack={openSettingsMenu}
                                    onDeleteUser={openDeleteAdminUserConfirm}
                                />
                            </motion.section>
                        )}
                        {!detailPanelMode && isAccountSettingsOpen && (
                            <motion.section
                                key="account-settings"
                                className="filter-section"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
                                <div className="task-form account-settings-form">
                                    <div className="account-settings-heading">
                                        <h3 className="working-hours-title">
                                            Account
                                        </h3>
                                        <p className="muted">
                                            Manage your password or delete this
                                            account.
                                        </p>
                                </div>
                                    <button
                                        type="button"
                                        className="settings-action-button settings-action-button-primary"
                                        onClick={handleLogout}
                                    >
                                        Logout
                                    </button>
                                    <button
                                        type="button"
                                        className="settings-action-button settings-action-button-warning"
                                        onClick={openChangePasswordSettings}
                                    >
                                        Change Password
                                    </button>
                                    <button
                                        type="button"
                                        className="settings-action-button settings-action-button-danger"
                                        onClick={openDeleteAccountSettings}
                                    >
                                        Delete Account
                                    </button>
                                    <button
                                        type="button"
                                        className="settings-action-button settings-action-button-neutral"
                                        onClick={openSettingsMenu}
                                    >
                                        Back
                                    </button>
                                </div>
                            </motion.section>
                        )}
                        {!detailPanelMode && isChangePasswordSettingsOpen && (
                            <motion.section
                                key="change-password-settings"
                                className="filter-section"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
                                <form
                                    className="task-form account-settings-form"
                                    onSubmit={(event) =>
                                        void handleSavePasswordChange(event)
                                    }
                                >
                                    <div className="account-settings-heading">
                                        <h3 className="working-hours-title">
                                            Change Password
                                        </h3>
                                        <p className="muted">
                                            Pick a new password for the current
                                            account.
                                        </p>
                                    </div>
                                    <label>
                                        <span>Current password</span>
                                        <input
                                            type="password"
                                            autoComplete="current-password"
                                            value={changePasswordCurrentPassword}
                                            onChange={(event) => {
                                                setChangePasswordCurrentPassword(
                                                    event.target.value,
                                                );
                                                setChangePasswordError(null);
                                                setChangePasswordSuccess(null);
                                            }}
                                            required
                                        />
                                    </label>
                                    <label>
                                        <span>New password</span>
                                        <input
                                            type="password"
                                            autoComplete="new-password"
                                            value={changePasswordNewPassword}
                                            onChange={(event) => {
                                                setChangePasswordNewPassword(
                                                    event.target.value,
                                                );
                                                setChangePasswordError(null);
                                                setChangePasswordSuccess(null);
                                            }}
                                            required
                                        />
                                    </label>
                                    <label>
                                        <span>Confirm new password</span>
                                        <input
                                            type="password"
                                            autoComplete="new-password"
                                            value={changePasswordConfirmNewPassword}
                                            onChange={(event) => {
                                                setChangePasswordConfirmNewPassword(
                                                    event.target.value,
                                                );
                                                setChangePasswordError(null);
                                                setChangePasswordSuccess(null);
                                            }}
                                            required
                                        />
                                    </label>
                                    {changePasswordError && (
                                        <p className="form-error">
                                            {changePasswordError}
                                        </p>
                                    )}
                                    {changePasswordSuccess && (
                                        <p className="webhook-test-success">
                                            {changePasswordSuccess}
                                        </p>
                                    )}
                                    <div className="task-form-actions">
                                        <button
                                            type="submit"
                                            className="settings-action-button settings-action-button-warning"
                                            disabled={isPasswordChanging}
                                        >
                                            {isPasswordChanging
                                                ? "Changing..."
                                                : "Change"}
                                        </button>
                                        <button
                                            type="button"
                                            className="settings-action-button settings-action-button-neutral"
                                            disabled={isPasswordChanging}
                                            onClick={openAccountSettings}
                                        >
                                            Back
                                        </button>
                                    </div>
                                </form>
                            </motion.section>
                        )}
                        {!detailPanelMode && isDeleteAccountSettingsOpen && (
                            <motion.section
                                key="delete-account-settings"
                                className="filter-section"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
                                <form
                                    className="task-form account-settings-form"
                                    onSubmit={(event) =>
                                        void handleDeleteAccount(event)
                                    }
                                >
                                    <div className="account-settings-heading">
                                        <h3 className="working-hours-title">
                                            Delete Account
                                        </h3>
                                        <p className="muted">
                                            All account data will be permanently
                                            deleted.
                                        </p>
                                    </div>
                                    <p className="form-error account-delete-warning">
                                        This removes your tasks, categories,
                                        and account record. This cannot be
                                        undone.
                                    </p>
                                    <label>
                                        <span>Type DELETE to confirm</span>
                                        <input
                                            type="text"
                                            autoComplete="off"
                                            value={deleteAccountConfirmation}
                                            onChange={(event) => {
                                                setDeleteAccountConfirmation(
                                                    event.target.value,
                                                );
                                                setDeleteAccountError(null);
                                            }}
                                            placeholder="DELETE"
                                            required
                                        />
                                    </label>
                                    {deleteAccountError && (
                                        <p className="form-error">
                                            {deleteAccountError}
                                        </p>
                                    )}
                                    <div className="task-form-actions">
                                        <button
                                            type="submit"
                                            className="settings-action-button settings-action-button-danger"
                                            disabled={
                                                isDeletingAccount ||
                                                deleteAccountConfirmation !==
                                                    "DELETE"
                                            }
                                        >
                                            {isDeletingAccount
                                                ? "Deleting..."
                                                : "Delete"}
                                        </button>
                                        <button
                                            type="button"
                                            className="settings-action-button settings-action-button-neutral"
                                            disabled={isDeletingAccount}
                                            onClick={openAccountSettings}
                                        >
                                            Back
                                        </button>
                                    </div>
                                </form>
                            </motion.section>
                        )}
                        {!detailPanelMode && isCalendarDisplaySettingsOpen && (
                            <motion.section
                                key="calendar-display-settings"
                                className="filter-section"
                                onClick={(event) => event.stopPropagation()}
                                variants={panelVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                transition={panelTransition}
                            >
                                <form
                                    className="task-form calendar-display-form"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <div className="calendar-display-section">
                                        <span className="calendar-display-section-title">
                                            Week starts on
                                        </span>
                                        <div
                                            className="week-start-options"
                                            role="group"
                                            aria-label="Week start"
                                        >
                                            <button
                                                type="button"
                                                className={`week-start-option ${
                                                    weekStart === "sunday"
                                                        ? "week-start-option-active"
                                                        : ""
                                                }`}
                                                aria-pressed={
                                                    weekStart === "sunday"
                                                }
                                                onClick={() =>
                                                    updateWeekStart("sunday")
                                                }
                                            >
                                                Sunday
                                            </button>
                                            <button
                                                type="button"
                                                className={`week-start-option ${
                                                    weekStart === "monday"
                                                        ? "week-start-option-active"
                                                        : ""
                                                }`}
                                                aria-pressed={
                                                    weekStart === "monday"
                                                }
                                                onClick={() =>
                                                    updateWeekStart("monday")
                                                }
                                            >
                                                Monday
                                            </button>
                                        </div>
                                    </div>
                                    <div className="calendar-display-section">
                                        <span className="calendar-display-section-title">
                                            Working hours
                                        </span>
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
                                                        start: event.target
                                                            .value,
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
                                    </div>
                                    <div className="task-form-actions">
                                        <button
                                            type="button"
                                            className="settings-action-button settings-action-button-primary"
                                            onClick={openSettingsMenu}
                                        >
                                            Done
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
                                        className="settings-action-button settings-action-button-primary"
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
                                        className="settings-action-button settings-action-button-danger"
                                        disabled={isBackupImporting}
                                        onClick={() => {
                                            if (guardOfflineMutation()) {
                                                return;
                                            }
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
                                        className="settings-action-button settings-action-button-neutral"
                                        disabled={
                                            isBackupLoading || isBackupImporting
                                        }
                                        onClick={openSettingsMenu}
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
                                            onChange={(event) => {
                                                if (guardOfflineMutation()) {
                                                    return;
                                                }
                                                setWebhookSettingsDraft(
                                                    (current) => ({
                                                        ...current,
                                                        discord_webhook_url:
                                                            event.target.value,
                                                    }),
                                                );
                                            }}
                                        />
                                    </label>
                                    <label>
                                        <span>Message format</span>
                                        <textarea
                                            placeholder={
                                                DEFAULT_WEBHOOK_MESSAGE_TEMPLATE
                                            }
                                            value={
                                                webhookSettingsDraft.discord_message_template
                                            }
                                            onChange={(event) => {
                                                if (guardOfflineMutation()) {
                                                    return;
                                                }
                                                setWebhookSettingsDraft(
                                                    (current) => ({
                                                        ...current,
                                                        discord_message_template:
                                                            event.target.value,
                                                    }),
                                                );
                                            }}
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
                                            type="button"
                                            className="settings-action-button settings-action-button-primary"
                                            disabled={
                                                isWebhookSettingsSaving ||
                                                isWebhookSettingsTesting
                                            }
                                            onClick={() =>
                                                void (async () => {
                                                    const saved =
                                                        await saveWebhookSettings();
                                                    if (saved) {
                                                        openSettingsMenu();
                                                    }
                                                })()
                                            }
                                        >
                                            {isWebhookSettingsSaving
                                                ? "Saving..."
                                                : "Done"}
                                        </button>
                                        <button
                                            type="button"
                                            className="settings-action-button settings-action-button-warning"
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
                                    </div>
                                </form>
                            </motion.section>
                        )}
                    </AnimatePresence>

                    {adminUserDeleteCandidate && (
                        <div
                            className={`dialog-backdrop ${
                                isMobileLayout
                                    ? "dialog-backdrop--mobile-sheet"
                                    : ""
                            }`}
                            role="presentation"
                            onClick={closeDeleteAdminUserConfirm}
                        >
                            <div
                                className={`choice-dialog ${
                                    isMobileLayout
                                        ? "choice-dialog--mobile-sheet"
                                        : ""
                                }`}
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="delete-admin-user-title"
                                onClick={(event) => event.stopPropagation()}
                            >
                                <h2 id="delete-admin-user-title">
                                    Delete user {adminUserDeleteCandidate.username}?
                                </h2>
                                <p className="muted">
                                    This will permanently delete this account and its
                                    tasks.
                                </p>
                                <div className="choice-dialog-actions">
                                    <button
                                        type="button"
                                        className="secondary-button"
                                        disabled={
                                            deletingAdminUserId ===
                                            adminUserDeleteCandidate.id
                                        }
                                        onClick={closeDeleteAdminUserConfirm}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="admin-confirm-delete-button"
                                        disabled={
                                            deletingAdminUserId ===
                                            adminUserDeleteCandidate.id
                                        }
                                        onClick={() => void handleDeleteAdminUser()}
                                    >
                                        {deletingAdminUserId ===
                                        adminUserDeleteCandidate.id
                                            ? "Deleting..."
                                            : `Delete ${getAdminUserDisplayName(
                                                  adminUserDeleteCandidate,
                                              )}`}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {isSidebarTaskContentVisible && (
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
                                                            role="button"
                                                            tabIndex={0}
                                                            aria-label={`Edit ${taskList.name}`}
                                                            onClick={() =>
                                                                startEditingTaskList(
                                                                    taskList,
                                                                )
                                                            }
                                                            onKeyDown={(
                                                                event,
                                                            ) => {
                                                                if (
                                                                    event.key ===
                                                                        "Enter" ||
                                                                    event.key ===
                                                                        " "
                                                                ) {
                                                                    event.preventDefault();
                                                                    startEditingTaskList(
                                                                        taskList,
                                                                    );
                                                                }
                                                            }}
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
                                                        {isDeleteCategoryConfirming ? (
                                                            <div className="category-inline-actions category-inline-actions--confirm-delete">
                                                                <button
                                                                    type="button"
                                                                    className="compact-action-button compact-action-button--secondary compact-action-button--icon-only category-inline-actions__cancel"
                                                                    aria-label="Cancel"
                                                                    title="Cancel"
                                                                    onClick={() =>
                                                                        setIsDeleteCategoryConfirming(
                                                                            false,
                                                                        )
                                                                    }
                                                                >
                                                                    <span className="compact-action-button__icon">
                                                                        <IconClose />
                                                                    </span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="compact-action-button compact-action-button--danger compact-action-button--icon-only category-inline-actions__confirm-delete"
                                                                    disabled={
                                                                        isDeleting
                                                                    }
                                                                    aria-label="Delete category"
                                                                    title="Delete category"
                                                                    onClick={() =>
                                                                        void handleDeleteEditingTaskList()
                                                                    }
                                                                >
                                                                    <span className="compact-action-button__icon">
                                                                        <IconTrash />
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="category-inline-actions">
                                                                <button
                                                                    type="button"
                                                                    className="compact-action-button compact-action-button--secondary compact-action-button--icon-only"
                                                                    aria-label="Cancel"
                                                                    title="Cancel"
                                                                    onClick={() =>
                                                                        resetCategoryEditor()
                                                                    }
                                                                >
                                                                    <span className="compact-action-button__icon">
                                                                        <IconClose />
                                                                    </span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="compact-action-button compact-action-button--danger compact-action-button--icon-only"
                                                                    disabled={
                                                                        isDeleting
                                                                    }
                                                                    aria-label="Delete category"
                                                                    title="Delete category"
                                                                    onClick={() =>
                                                                        setIsDeleteCategoryConfirming(
                                                                            true,
                                                                        )
                                                                    }
                                                                >
                                                                    <span className="compact-action-button__icon">
                                                                        <IconTrash />
                                                                    </span>
                                                                </button>
                                                                <button
                                                                    type="submit"
                                                                    className="compact-action-button compact-action-button--primary compact-action-button--icon-only"
                                                                    aria-label="Save category"
                                                                    title="Save category"
                                                                >
                                                                    <span className="compact-action-button__icon">
                                                                        <IconCheck />
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        )}
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
                                                        <div className="category-inline-actions category-inline-actions--two">
                                                            <button
                                                                type="button"
                                                                className="compact-action-button compact-action-button--secondary compact-action-button--icon-only"
                                                                aria-label="Cancel"
                                                                title="Cancel"
                                                                onClick={() => {
                                                                    resetCategoryEditor();
                                                                }}
                                                            >
                                                                <span className="compact-action-button__icon">
                                                                    <IconClose />
                                                                </span>
                                                            </button>
                                                            <button
                                                                type="submit"
                                                                className="compact-action-button compact-action-button--primary compact-action-button--icon-only"
                                                                aria-label="Add category"
                                                                title="Add category"
                                                            >
                                                                <span className="compact-action-button__icon">
                                                                    <IconCheck />
                                                                </span>
                                                            </button>
                                                        </div>
                                                    </form>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="filter-add-button compact-action-button compact-action-button--primary compact-action-button--icon-only"
                                                        aria-label="Add category"
                                                        title="Add category"
                                                        onClick={() => {
                                                            if (
                                                                guardOfflineMutation()
                                                            ) {
                                                                return;
                                                            }
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
                                                        <span className="compact-action-button__icon">
                                                            <IconPlus />
                                                        </span>
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
                                    className="sidebar-create-task-button compact-action-button compact-action-button--primary compact-action-button--icon-only"
                                    aria-label="Create task"
                                    title="Create task"
                                    onClick={openUnscheduledCreatePanel}
                                >
                                    <span className="compact-action-button__icon">
                                        <IconPlus />
                                    </span>
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
                                        <>
                                            <button
                                                type="button"
                                                className="floating-panel-action floating-panel-icon-button floating-panel-close"
                                                aria-label="Close"
                                                title="Close"
                                                onClick={closeDetailPanel}
                                            >
                                                <span className="floating-panel-icon">
                                                    <IconClose />
                                                </span>
                                            </button>
                                            <button
                                                type="submit"
                                                form="task-create-form"
                                                className="floating-panel-action floating-panel-icon-button floating-panel-create"
                                                disabled={isSaving}
                                                aria-label="Create"
                                                title="Create"
                                            >
                                                <span className="floating-panel-icon">
                                                    <IconSave />
                                                </span>
                                            </button>
                                        </>
                                    ) : selectedTask && editState ? (
                                        <>
                                            <button
                                                type="button"
                                                className="floating-panel-action floating-panel-icon-button floating-panel-delete"
                                                disabled={isDeleting}
                                                aria-label="Delete"
                                                title="Delete"
                                                onClick={() =>
                                                    void handleDeleteSelectedTask()
                                                }
                                            >
                                                <span className="floating-panel-icon">
                                                    <IconTrash />
                                                </span>
                                            </button>
                                            <div className="task-detail-header-actions-group">
                                                <button
                                                    type="button"
                                                    className="floating-panel-action floating-panel-icon-button floating-panel-close floating-panel-cancel"
                                                    disabled={isEditSaving}
                                                    aria-label="Cancel"
                                                    title="Cancel"
                                                    onClick={closeDetailPanel}
                                                >
                                                    <span className="floating-panel-icon">
                                                        <IconClose />
                                                    </span>
                                                </button>
                                                <button
                                                    type="submit"
                                                    form="task-edit-form"
                                                    className="floating-panel-action floating-panel-icon-button floating-panel-done"
                                                    disabled={isEditSaving}
                                                    aria-label="Done"
                                                    title="Done"
                                                >
                                                    <span className="floating-panel-icon">
                                                        <IconCheck />
                                                    </span>
                                                </button>
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            </div>

                            {detailPanelMode === "create" ? (
                                <form
                                    id="task-create-form"
                                    ref={createFormRef}
                                    className="task-form"
                                    onSubmit={(event) =>
                                        void handleSubmit(event)
                                    }
                                >
                                    <div className="task-composer-title">
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
                                    </div>

                                    <TaskFormAccordionSection
                                        id="schedule"
                                        title="Schedule"
                                        isExpanded={
                                            createAccordionSection === "schedule"
                                        }
                                        onToggle={toggleCreateAccordionSection}
                                    >
                                        {hasScheduleClearableData(formState) ? (
                                            <div className="task-schedule-clear-row">
                                                <button
                                                    type="button"
                                                    className="secondary-button task-form-clear-button schedule-clear-button"
                                                    onClick={handleMoveToNoTime}
                                                    title="Clear schedule"
                                                >
                                                    Clear schedule
                                                </button>
                                            </div>
                                        ) : null}
                                        <div className="task-form-row task-form-schedule-row">
                                            <LabeledDateTimeInput
                                                label="Start"
                                                visibleLabel={null}
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
                                                visibleLabel="To"
                                                value={formState.scheduled_end}
                                                onChange={(value) =>
                                                    setFormState({
                                                        ...formState,
                                                        scheduled_end: value,
                                                    })
                                                }
                                            />
                                        </div>
                                        <RecurrenceComposer
                                            state={formState}
                                            onChange={(updates) =>
                                                setFormState({
                                                    ...formState,
                                                    ...updates,
                                                })
                                            }
                                        />
                                        <ReminderComposer
                                            state={formState}
                                            allDay={isAllDayFormTask(formState)}
                                            onChange={(updates) =>
                                                setFormState({
                                                    ...formState,
                                                    ...updates,
                                                })
                                            }
                                        />
                                    </TaskFormAccordionSection>

                                    <TaskFormAccordionSection
                                        id="organization"
                                        title="Categories"
                                        isExpanded={
                                            createAccordionSection ===
                                            "organization"
                                        }
                                        onToggle={toggleCreateAccordionSection}
                                    >
                                        <LabeledSelect
                                            label="Category"
                                            visibleLabel={null}
                                            value={formState.list_id}
                                            onChange={(value) =>
                                                setFormState({
                                                    ...formState,
                                                    list_id: value,
                                                })
                                            }
                                            options={taskLists}
                                        />
                                    </TaskFormAccordionSection>

                                    <TaskFormAccordionSection
                                        id="notes"
                                        title="Notes"
                                        isExpanded={
                                            createAccordionSection === "notes"
                                        }
                                        onToggle={toggleCreateAccordionSection}
                                    >
                                        <label className="task-composer-notes">
                                            <span>Notes</span>
                                            <textarea
                                                value={formState.notes}
                                                onChange={(event) =>
                                                    setFormState({
                                                        ...formState,
                                                        notes: event.target.value,
                                                    })
                                                }
                                                rows={2}
                                            />
                                        </label>
                                    </TaskFormAccordionSection>
                                </form>
                            ) : selectedTask && editState ? (
                                <form
                                    id="task-edit-form"
                                    className="task-form"
                                    onSubmit={(event) =>
                                        void handleEditSubmit(event)
                                    }
                                >
                                    <div className="task-composer-title-row">
                                        <span className="task-composer-title-kicker">
                                            TITLE
                                        </span>
                                        <label className="task-form-inline-toggle task-composer-completed">
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
                                    <div className="task-composer-title task-composer-title-edit">
                                        <input
                                            ref={titleInputRef}
                                            type="text"
                                            value={editState.title}
                                            onChange={(event) =>
                                                setEditState({
                                                    ...editState,
                                                    title: event.target.value,
                                                })
                                            }
                                            required
                                            aria-label="Title"
                                        />
                                    </div>

                                    <TaskFormAccordionSection
                                        id="schedule"
                                        title="Schedule"
                                        isExpanded={
                                            editAccordionSection === "schedule"
                                        }
                                        onToggle={toggleEditAccordionSection}
                                    >
                                        {hasScheduleClearableData(editState) ? (
                                            <div className="task-schedule-clear-row">
                                                <button
                                                    type="button"
                                                    className="secondary-button task-form-clear-button schedule-clear-button"
                                                    onClick={handleMoveToNoTime}
                                                    title="Clear schedule"
                                                >
                                                    Clear schedule
                                                </button>
                                            </div>
                                        ) : null}
                                        <div className="task-form-row task-form-schedule-row">
                                            <LabeledDateTimeInput
                                                label="Start"
                                                visibleLabel={null}
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
                                                visibleLabel="To"
                                                value={editState.scheduled_end}
                                                onChange={(value) =>
                                                    setEditState({
                                                        ...editState,
                                                        scheduled_end: value,
                                                    })
                                                }
                                            />
                                        </div>
                                        <RecurrenceComposer
                                            state={editState}
                                            onChange={(updates) =>
                                                setEditState({
                                                    ...editState,
                                                    ...updates,
                                                })
                                            }
                                        />
                                        <ReminderComposer
                                            state={editState}
                                            allDay={isAllDayFormTask(editState)}
                                            onChange={(updates) =>
                                                setEditState({
                                                    ...editState,
                                                    ...updates,
                                                })
                                            }
                                        />
                                    </TaskFormAccordionSection>

                                    <TaskFormAccordionSection
                                        id="organization"
                                        title="Categories"
                                        isExpanded={
                                            editAccordionSection ===
                                            "organization"
                                        }
                                        onToggle={toggleEditAccordionSection}
                                    >
                                        <LabeledSelect
                                            label="Category"
                                            visibleLabel={null}
                                            value={editState.list_id}
                                            onChange={(value) =>
                                                setEditState({
                                                    ...editState,
                                                    list_id: value,
                                                })
                                            }
                                            options={taskLists}
                                        />
                                    </TaskFormAccordionSection>

                                    <TaskFormAccordionSection
                                        id="notes"
                                        title="Notes"
                                        isExpanded={
                                            editAccordionSection === "notes"
                                        }
                                        onToggle={toggleEditAccordionSection}
                                    >
                                        <label className="task-composer-notes">
                                            <span>Notes</span>
                                            <textarea
                                                value={editState.notes}
                                                onChange={(event) =>
                                                    setEditState({
                                                        ...editState,
                                                        notes: event.target.value,
                                                    })
                                                }
                                                rows={2}
                                            />
                                        </label>
                                    </TaskFormAccordionSection>
                                </form>
                            ) : (
                                <p className="muted">
                                    Select a task to edit it.
                                </p>
                            )}
                                </motion.section>
                        )}
                    </AnimatePresence>

                    {isSidebarTaskContentVisible && (
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
                                                    data-testid="task-row"
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
                                                            data-testid="task-schedule-drag-handle"
                                                            data-task-id={
                                                                task.id
                                                            }
                                                            aria-label="Drag to calendar"
                                                            title="Drag to calendar"
                                                            onPointerDown={(
                                                                event,
                                                            ) => {
                                                                event.stopPropagation();
                                                                if (!isMobileLayout) {
                                                                    startScheduleDragHighlight();
                                                                }
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
                data-testid="calendar-panel"
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
                {taskSnackbarMessage && (
                    <motion.div
                        key="task-snackbar-message"
                        className="undo-snackbar undo-snackbar--message"
                        role="status"
                        aria-live="polite"
                        initial={{
                            opacity: 0,
                            y: 20,
                            x: 18,
                            scale: 0.96,
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
                        <span className="undo-snackbar-message">
                            {taskSnackbarMessage}
                        </span>
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
                        {!isMobileLayout && (
                            <>
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
                            </>
                        )}
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
                            <div className="calendar-month-year-control">
                                <div className="filter-dropdown calendar-month-year-dropdown">
                                    <button
                                        ref={monthYearPickerTriggerRef}
                                        type="button"
                                        className="calendar-year-button calendar-month-year-trigger"
                                        aria-haspopup="dialog"
                                        aria-expanded={isMonthYearPickerOpen}
                                        onClick={toggleMonthYearPicker}
                                    >
                                        {new Intl.DateTimeFormat(undefined, {
                                            month: "long",
                                            year: "numeric",
                                        }).format(calendarDate)}
                                        <span aria-hidden="true">▼</span>
                                    </button>
                                    <AnimatePresence initial={false}>
                                        {isMonthYearPickerOpen && (
                                            <motion.div
                                                ref={monthYearPickerRef}
                                                key="calendar-month-year-picker"
                                                className="filter-menu calendar-month-year-menu"
                                                style={monthYearPickerStyle ?? undefined}
                                                initial="hidden"
                                                animate="visible"
                                                exit="exit"
                                                variants={dropdownVariants}
                                                transition={dropdownTransition}
                                                role="dialog"
                                                aria-label="Choose calendar month"
                                            >
                                                <div className="calendar-month-year-header">
                                                    <button
                                                        type="button"
                                                        className="calendar-month-year-nav"
                                                        aria-label="Previous year"
                                                        onClick={() =>
                                                            setMonthYearPickerYear(
                                                                (year) => year - 1,
                                                            )
                                                        }
                                                    >
                                                        ‹
                                                    </button>
                                                    <span className="calendar-month-year-current">
                                                        {monthYearPickerYear}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className="calendar-month-year-nav"
                                                        aria-label="Next year"
                                                        onClick={() =>
                                                            setMonthYearPickerYear(
                                                                (year) => year + 1,
                                                            )
                                                        }
                                                    >
                                                        ›
                                                    </button>
                                                </div>
                                                <div className="calendar-month-grid">
                                                    {calendarMonthOptions.map(
                                                        (month) => {
                                                            const isSelected =
                                                                monthYearPickerYear ===
                                                                    calendarDate.getFullYear() &&
                                                                month.monthIndex ===
                                                                    calendarDate.getMonth();

                                                            return (
                                                                <button
                                                                    key={month.shortLabel}
                                                                    type="button"
                                                                    className={`calendar-month-option ${
                                                                        isSelected
                                                                            ? "active"
                                                                            : ""
                                                                    }`}
                                                                    aria-label={
                                                                        month.longLabel
                                                                    }
                                                                    aria-pressed={
                                                                        isSelected
                                                                    }
                                                                    onClick={() =>
                                                                        selectCalendarMonth(
                                                                            month.monthIndex,
                                                                        )
                                                                    }
                                                                >
                                                                    {
                                                                        month.shortLabel
                                                                    }
                                                                </button>
                                                            );
                                                        },
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        ) : isTimeGridView && isMobileLayout ? (
                            <span className="calendar-toolbar-period-label">
                                {mobileCalendarPeriodLabel}
                            </span>
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
                    className={`calendar-transition-shell calendar-shell ${isMobileLayout ? "calendar-shell--mobile-readonly" : ""} calendar-view-${calendarView}`}
                    animate={calendarTransitionControls}
                    initial={false}
                    onTouchStart={handleCalendarTouchStart}
                    onTouchMove={handleCalendarTouchMove}
                    onTouchEnd={handleCalendarTouchEnd}
                    onTouchCancel={handleCalendarTouchCancel}
                >
                    <FullCalendar
                        key={`calendar-interactions-${calendarInteractionMode}-${isOfflineReadOnly ? "readonly" : "editable"}`}
                        ref={calendarRef}
                        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                        initialView={calendarView}
                        initialDate={calendarDate}
                        fixedMirrorParent={document.body}
                        headerToolbar={false}
                        firstDay={calendarFirstDay}
                        events={events}
                        eventTimeFormat={{
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                        }}
                        eventContent={renderEventContent}
                        eventClassNames={handleEventClassNames}
                        dayCellContent={renderDayCellContent}
                        dayHeaderContent={renderDayHeaderContent}
                        dayMaxEventRows={
                            calendarView === "dayGridMonth" && isMobileLayout
                                ? true
                                : false
                        }
                        eventClick={handleEventClick}
                        eventDidMount={handleEventDidMount}
                        eventWillUnmount={handleEventWillUnmount}
                        dateClick={handleDateClick}
                        datesSet={handleDatesSet}
                        eventDrop={handleEventDrop}
                        eventResize={handleEventResize}
                        drop={handleExternalTaskDrop}
                        slotLabelFormat={{
                            hour: "2-digit",
                            ...((calendarView === "timeGridWeek" ||
                                calendarView === "timeGridDay") &&
                            isMobileLayout
                                ? {}
                                : { minute: "2-digit" }),
                            hour12: false,
                        }}
                        slotLabelContent={renderSlotLabelContent}
                        slotLabelInterval={
                            (calendarView === "timeGridWeek" ||
                                calendarView === "timeGridDay") &&
                            isMobileLayout
                                ? "01:00:00"
                                : undefined
                        }
                        eventMinHeight={
                            calendarView === "timeGridWeek" && isMobileLayout
                                ? 18
                                : undefined
                        }
                        select={handleDateSelect}
                        editable={!isMobileLayout && !isOfflineReadOnly}
                        eventStartEditable={!isMobileLayout && !isOfflineReadOnly}
                        eventDurationEditable={!isMobileLayout && !isOfflineReadOnly}
                        eventDragMinDistance={
                            isMobileLayout ? 9999 : 8
                        }
                        droppable={!isMobileLayout && !isOfflineReadOnly}
                        selectable={!isOfflineReadOnly}
                        longPressDelay={
                            isMobileLayout
                                ? mobileCalendarReadonlyLongPressDelayMs
                                : undefined
                        }
                        selectLongPressDelay={
                            isMobileLayout
                                ? mobileCalendarReadonlyLongPressDelayMs
                                : undefined
                        }
                        eventLongPressDelay={
                            isMobileLayout
                                ? mobileCalendarReadonlyLongPressDelayMs
                                : undefined
                        }
                        stickyFooterScrollbar={false}
                        scrollTimeReset={false}
                        eventResizableFromStart={!isMobileLayout && !isOfflineReadOnly}
                        nowIndicator
                        scrollTime={`${workingHours.start}:00`}
                        slotMinTime={calendarSlotMinTime}
                        slotMaxTime={calendarSlotMaxTime}
                        expandRows={isTimeGridView}
                        height="100%"
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
                                        className="floating-panel-action floating-panel-icon-button mobile-month-task-preview-action mobile-month-task-preview-close"
                                        aria-label="Close selected day tasks"
                                        title="Close"
                                        onClick={() =>
                                            setMobileMonthPreviewDate(null)
                                        }
                                    >
                                        <span className="floating-panel-icon">
                                            <IconClose />
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className="floating-panel-action floating-panel-icon-button mobile-month-task-preview-action mobile-month-task-preview-add"
                                        aria-label="Add task for selected day"
                                        title="Add"
                                        onClick={() => {
                                            const selectedDate =
                                                mobileMonthPreviewDate;
                                            if (!selectedDate) {
                                                return;
                                            }

                                            setMobileMonthPreviewDate(null);
                                            openDateOnlyCreatePanel(
                                                selectedDate,
                                            );
                                        }}
                                    >
                                        <span className="floating-panel-icon">
                                            <IconPlus />
                                        </span>
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

            <AnimatePresence initial={false}>
                {isMobileLayout && mobileQuickActionTask && (
                    <motion.section
                        key={mobileQuickActionTask.id}
                        className="mobile-calendar-action-sheet"
                        aria-label="Calendar task actions"
                        variants={panelVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        transition={panelTransition}
                    >
                        <div className="mobile-calendar-action-header">
                            <span className="mobile-calendar-action-copy">
                                <strong>{mobileQuickActionTask.title}</strong>
                                <span>
                                    {formatQuickActionRange(
                                        mobileQuickActionTask,
                                    )}
                                </span>
                            </span>
                            <button
                                type="button"
                                className="floating-panel-action floating-panel-icon-button mobile-calendar-action-close"
                                aria-label="Close"
                                title="Close"
                                onClick={() => setMobileQuickActionTaskId(null)}
                            >
                                <span className="floating-panel-icon">
                                    <IconClose />
                                </span>
                            </button>
                        </div>
                        <label className="mobile-calendar-complete-row">
                            <span>Complete</span>
                            <input
                                type="checkbox"
                                className="task-checkbox"
                                checked={mobileQuickActionTask.completed}
                                aria-label="Toggle task completion"
                                onChange={() =>
                                    void handleCheckboxChange(
                                        mobileQuickActionTask,
                                    )
                                }
                            />
                        </label>
                        <div className="mobile-calendar-adjust-grid">
                            <button
                                type="button"
                                className="quick-action-button quick-action-button--blue"
                                aria-label="Move earlier 15 minutes"
                                disabled={
                                    isEditSaving || !mobileQuickActionCanAdjust
                                }
                                onClick={() =>
                                    void applyMobileQuickAction(
                                        mobileQuickActionTask,
                                        "earlier",
                                    )
                                }
                            >
                                <span className="quick-action-button__icon">
                                    <IconArrowUp />
                                </span>
                                <span className="quick-action-button__label">
                                    15 mins
                                </span>
                            </button>
                            <button
                                type="button"
                                className="quick-action-button quick-action-button--blue"
                                aria-label="Move later 15 minutes"
                                disabled={
                                    isEditSaving || !mobileQuickActionCanAdjust
                                }
                                onClick={() =>
                                    void applyMobileQuickAction(
                                        mobileQuickActionTask,
                                        "later",
                                    )
                                }
                            >
                                <span className="quick-action-button__icon">
                                    <IconArrowDown />
                                </span>
                                <span className="quick-action-button__label">
                                    15 mins
                                </span>
                            </button>
                            <button
                                type="button"
                                className="quick-action-button quick-action-button--green"
                                aria-label="Shorten by 15 minutes"
                                disabled={
                                    isEditSaving ||
                                    !canShortenQuickActionTask(
                                        mobileQuickActionTask,
                                    )
                                }
                                onClick={() =>
                                    void applyMobileQuickAction(
                                        mobileQuickActionTask,
                                        "shorten",
                                    )
                                }
                            >
                                <span className="quick-action-button__icon">
                                    <IconMinus />
                                </span>
                                <span className="quick-action-button__label">
                                    15 mins
                                </span>
                            </button>
                            <button
                                type="button"
                                className="quick-action-button quick-action-button--green"
                                aria-label="Extend by 15 minutes"
                                disabled={
                                    isEditSaving || !mobileQuickActionCanAdjust
                                }
                                onClick={() =>
                                    void applyMobileQuickAction(
                                        mobileQuickActionTask,
                                        "extend",
                                    )
                                }
                            >
                                <span className="quick-action-button__icon">
                                    <IconPlus />
                                </span>
                                <span className="quick-action-button__label">
                                    15 mins
                                </span>
                            </button>
                        </div>
                        <div className="mobile-calendar-action-row">
                            <button
                                type="button"
                                className="quick-action-button quick-action-button--yellow quick-action-button--icon-only"
                                aria-label="Edit details"
                                onClick={() =>
                                    openTaskDetailPanel(mobileQuickActionTask.id)
                                }
                            >
                                <span className="quick-action-button__icon">
                                    <IconEdit />
                                </span>
                            </button>
                            <button
                                type="button"
                                className="quick-action-button quick-action-button--red quick-action-button--icon-only"
                                aria-label="Delete task"
                                disabled={isDeleting}
                                onClick={() => {
                                    if (
                                        promptRecurringTaskDelete(
                                            mobileQuickActionTask,
                                            "detail",
                                        )
                                    ) {
                                        setMobileQuickActionTaskId(null);
                                        return;
                                    }

                                    setMobileQuickActionTaskId(null);
                                    void runTaskDelete(
                                        mobileQuickActionTask.id,
                                        "detail",
                                    );
                                }}
                            >
                                <span className="quick-action-button__icon">
                                    <IconTrash />
                                </span>
                            </button>
                        </div>
                    </motion.section>
                )}
            </AnimatePresence>

            {pendingDeleteTask && (
                <div
                    className={`dialog-backdrop ${
                        isMobileLayout ? "dialog-backdrop--mobile-sheet" : ""
                    }`}
                    role="presentation"
                    onClick={() => !isDeleting && setPendingTaskDelete(null)}
                >
                    <div
                        className={`choice-dialog ${
                            isMobileLayout ? "choice-dialog--mobile-sheet" : ""
                        }`}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-recurring-task-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h2 id="delete-recurring-task-title">
                            Delete recurring task
                        </h2>
                        <p className="choice-dialog-warning">
                            Undo is not available for recurring series deletes.
                        </p>
                        <div className="choice-dialog-actions">
                            <button
                                type="button"
                                className="recurring-delete-action"
                                style={recurringTaskChoiceActionStyle}
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
                                className="recurring-delete-action"
                                style={recurringTaskChoiceActionStyle}
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
                                    : "Delete all recurring tasks"}
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
                    className={`dialog-backdrop ${
                        isMobileLayout ? "dialog-backdrop--mobile-sheet" : ""
                    }`}
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
                        className={`choice-dialog ${
                            isMobileLayout ? "choice-dialog--mobile-sheet" : ""
                        }`}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="edit-recurring-task-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h2 id="edit-recurring-task-title">
                            Edit recurring task
                        </h2>
                        <p className="choice-dialog-warning">
                            Undo is not available for recurring series edits.
                        </p>
                        <div className="choice-dialog-actions">
                            <button
                                type="button"
                                className="recurring-edit-action"
                                style={recurringTaskChoiceActionStyle}
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
                                className="recurring-edit-action"
                                style={recurringTaskChoiceActionStyle}
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

            {contextMenu && !isNarrowScreen() && (
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
                    {isRegistering ? "Register" : "Welcome back"}
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
                        Login
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
                        Register
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
                              ? "Register"
                              : "Login"}
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
    visibleLabel?: string | null;
};

function LabeledDateTimeInput({
    label,
    value,
    onChange,
    visibleLabel = label,
}: LabeledDateTimeInputProps) {
    const { datePart, timePart } = splitDateTimeInputValue(value);
    const showDatePlaceholder = !datePart;
    const showTimePlaceholder = !timePart;

    return (
        <label className="task-form-datetime">
            {visibleLabel ? <span>{visibleLabel}</span> : null}
            <div className="task-form-datetime-row">
                <div
                    className={`task-datetime-shell${
                        showDatePlaceholder ? " task-datetime-shell-empty" : ""
                    }`}
                >
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
                    <span className="task-datetime-placeholder">
                        Select date
                    </span>
                </div>
                <div
                    className={`task-datetime-shell task-datetime-shell-time${
                        showTimePlaceholder ? " task-datetime-shell-empty" : ""
                    }`}
                >
                    <input
                        type="time"
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
                    <span className="task-datetime-placeholder">
                        Time
                    </span>
                </div>
            </div>
        </label>
    );
}

type TaskComposerDropdownOption = {
    value: string;
    label: string;
    color?: string;
    mutedDot?: boolean;
};

type TaskComposerDropdownProps = {
    label: string;
    value: string;
    options: TaskComposerDropdownOption[];
    onChange: (value: string) => void;
    escapeClipping?: boolean;
};

function TaskComposerDropdown({
    label,
    value,
    options,
    onChange,
    escapeClipping = false,
}: TaskComposerDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [menuPlacement, setMenuPlacement] = useState<"down" | "up">("down");
    const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null);
    const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const selectedOption =
        options.find((option) => option.value === value) ?? options[0];
    const selectedOptionHasDot =
        Boolean(selectedOption?.color) || Boolean(selectedOption?.mutedDot);

    const updateMenuPlacement = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger || typeof window === "undefined") {
            return;
        }

        const viewportMargin = 12;
        const triggerRect = trigger.getBoundingClientRect();
        const estimatedMenuHeight = Math.min(
            Math.max(options.length * 39, 44),
            260,
        );
        const spaceBelow =
            window.innerHeight - triggerRect.bottom - viewportMargin;
        const spaceAbove = triggerRect.top - viewportMargin;
        const shouldOpenUp =
            spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
        const availableSpace = Math.max(
            shouldOpenUp ? spaceAbove : spaceBelow,
            escapeClipping ? 44 : 120,
        );
        const nextMaxHeight = Math.min(estimatedMenuHeight, availableSpace);
        const inheritedTheme = escapeClipping
            ? taskFormDropdownThemeVariables.reduce<Record<string, string>>(
                  (variables, name) => {
                      const value = getComputedStyle(trigger)
                          .getPropertyValue(name)
                          .trim();
                      if (value) {
                          variables[name] = value;
                      }
                      return variables;
                  },
                  {},
              )
            : null;

        setMenuPlacement(shouldOpenUp ? "up" : "down");
        setMenuMaxHeight(nextMaxHeight);
        setMenuStyle(
            escapeClipping
                ? ({
                      ...inheritedTheme,
                      position: "fixed",
                      left: `${triggerRect.left}px`,
                      width: `${triggerRect.width}px`,
                      top: shouldOpenUp
                          ? "auto"
                          : `${triggerRect.bottom + 6}px`,
                      bottom: shouldOpenUp
                          ? `${window.innerHeight - triggerRect.top + 6}px`
                          : "auto",
                      zIndex: 120,
                      "--task-form-dropdown-menu-max-height": `${nextMaxHeight}px`,
                  } as CSSProperties)
                : null,
        );
    }, [escapeClipping, options.length]);

    useLayoutEffect(() => {
        if (!isOpen) {
            setMenuStyle(null);
            return;
        }

        updateMenuPlacement();

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(target) &&
                (!menuRef.current || !menuRef.current.contains(target))
            ) {
                setIsOpen(false);
            }
        };
        const handleViewportChange = () => updateMenuPlacement();

        document.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);
        return () =>
            {
                document.removeEventListener(
                    "pointerdown",
                    handlePointerDown,
                );
                window.removeEventListener("resize", handleViewportChange);
                window.removeEventListener(
                    "scroll",
                    handleViewportChange,
                    true,
                );
            };
    }, [isOpen, updateMenuPlacement]);

    const menu = isOpen ? (
        <motion.div
            ref={menuRef}
            key={`${label}-menu`}
            className={`filter-menu task-form-dropdown-menu task-form-dropdown-menu-${menuPlacement}`}
            role="listbox"
            aria-label={`${label} options`}
            style={
                escapeClipping
                    ? (menuStyle ?? undefined)
                    : menuMaxHeight
                      ? ({
                            "--task-form-dropdown-menu-max-height": `${menuMaxHeight}px`,
                        } as CSSProperties)
                      : undefined
            }
            variants={{
                hidden: { opacity: 0, y: -4, scale: 0.98 },
                visible: { opacity: 1, y: 0, scale: 1 },
                exit: { opacity: 0, y: -4, scale: 0.98 },
            }}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={motionTimings.dropdown}
        >
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    className={`filter-option ${option.value === value ? "active" : ""}`}
                    onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                    }}
                >
                    {option.color || option.mutedDot ? (
                        <span
                            className={`task-form-dropdown-dot ${
                                option.mutedDot
                                    ? "task-form-dropdown-dot-muted"
                                    : ""
                            }`}
                            style={
                                option.color
                                    ? {
                                          backgroundColor: option.color,
                                      }
                                    : undefined
                            }
                            aria-hidden="true"
                        />
                    ) : null}
                    <span>{option.label}</span>
                </button>
            ))}
        </motion.div>
    ) : null;
    const menuLayer = (
        <AnimatePresence initial={false}>{menu}</AnimatePresence>
    );

    return (
        <div
            className="filter-dropdown task-form-custom-dropdown"
            ref={dropdownRef}
        >
            <button
                ref={triggerRef}
                type="button"
                className="filter-trigger task-form-dropdown-trigger"
                aria-label={label}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={() => {
                    if (!isOpen) {
                        updateMenuPlacement();
                    }
                    setIsOpen((current) => !current);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        setIsOpen(false);
                    }
                }}
            >
                <span className="filter-trigger-value">
                    {selectedOptionHasDot ? (
                        <span
                            className={`task-form-dropdown-dot ${
                                selectedOption?.mutedDot
                                    ? "task-form-dropdown-dot-muted"
                                    : ""
                            }`}
                            style={
                                selectedOption?.color
                                    ? { backgroundColor: selectedOption.color }
                                    : undefined
                            }
                            aria-hidden="true"
                        />
                    ) : null}
                    {selectedOption?.label ?? ""}
                </span>
                <span className="filter-chevron" aria-hidden="true">
                    ▾
                </span>
            </button>
            {escapeClipping && typeof document !== "undefined"
                ? createPortal(menuLayer, document.body)
                : menuLayer}
        </div>
    );
}

type RecurrenceComposerState = Pick<
    TaskFormState,
    | "scheduled_start"
    | "recurrence_frequency"
    | "recurrence_interval"
    | "recurrence_until"
>;

type RecurrenceComposerProps = {
    state: RecurrenceComposerState;
    onChange: (updates: Partial<RecurrenceComposerState>) => void;
};

function RecurrenceComposer({ state, onChange }: RecurrenceComposerProps) {
    const endsMode = state.recurrence_until ? "ON_DATE" : "NEVER";
    const intervalValue = parsePositiveIntegerOrZero(
        state.recurrence_interval,
    );
    const recurrenceFrequencyDisplayOptions = recurrenceFrequencyOptions.map(
        (option) =>
            option.value && intervalValue > 1
                ? { ...option, label: `${option.label}s` }
                : option,
    );

    return (
        <div className="task-composer-control-group task-recurrence-composer">
            {state.recurrence_frequency ? (
                <div className="task-schedule-field-label">Repeats every</div>
            ) : null}
            <div className="task-recurrence-controls">
                {state.recurrence_frequency ? (
                    <>
                        <input
                            type="number"
                            min={1}
                            step={1}
                            value={state.recurrence_interval}
                            onChange={(event) =>
                                onChange({
                                    recurrence_interval: event.target.value,
                                })
                            }
                            aria-label="Repeats every"
                            className="task-form-control task-recurrence-count"
                        />
                    </>
                ) : null}
                <TaskComposerDropdown
                    label="Repeat"
                    value={state.recurrence_frequency}
                    options={recurrenceFrequencyDisplayOptions}
                    onChange={(value) =>
                        onChange({
                            recurrence_frequency: value as RecurrenceFrequency,
                            recurrence_interval:
                                value && !state.recurrence_interval
                                    ? "1"
                                    : state.recurrence_interval,
                            recurrence_until: value
                                ? state.recurrence_until
                                : "",
                        })
                    }
                />
            </div>

            {state.recurrence_frequency ? (
                <div className="task-schedule-field-group task-recurrence-until">
                    <div className="task-recurrence-until-controls">
                        <TaskComposerDropdown
                            label="Until"
                            value={endsMode}
                            options={recurrenceEndsOptions}
                            onChange={(value) =>
                                onChange({
                                    recurrence_until:
                                        value === "NEVER"
                                            ? ""
                                            : state.recurrence_until ||
                                              splitDateTimeInputValue(
                                                  state.scheduled_start,
                                              ).datePart,
                                })
                            }
                        />
                        {endsMode === "ON_DATE" ? (
                            <label className="task-date-only-input">
                                <input
                                    className="task-form-control"
                                    type="date"
                                    value={state.recurrence_until}
                                    onChange={(event) =>
                                        onChange({
                                            recurrence_until:
                                                event.target.value,
                                        })
                                    }
                                    aria-label="Repeat end date"
                                />
                            </label>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

type ReminderComposerState = Pick<
    TaskFormState,
    "reminder_mode" | "notification_unit" | "notification_offset_value"
>;

type ReminderComposerProps = {
    state: ReminderComposerState;
    onChange: (updates: Partial<ReminderComposerState>) => void;
    allDay: boolean;
};

function getReminderMode(state: ReminderComposerState): ReminderMode {
    return state.reminder_mode;
}

function getReminderUnit(state: ReminderComposerState, allDay: boolean): NotificationUnit {
    if (allDay) {
        return "DAYS";
    }

    return state.notification_unit || "MINUTES";
}

function getDefaultReminderAmount(allDay: boolean): string {
    return allDay ? "1" : "15";
}

function ReminderComposer({ state, onChange, allDay }: ReminderComposerProps) {
    const reminderMode = getReminderMode(state);
    const isBeforeReminder = reminderMode === "BEFORE";
    const reminderUnit = getReminderUnit(state, allDay);
    const reminderAmount = parsePositiveIntegerOrZero(
        state.notification_offset_value,
    );
    const reminderUnitOptions = notificationUnits.map((unit) => {
        if (allDay) {
            return { value: unit.id, label: unit.label };
        }

        return {
            value: unit.id,
            label: reminderAmount === 1 ? unit.label.slice(0, -1) : unit.label,
        };
    });

    return (
        <div className="task-composer-control-group task-reminder-composer">
            {reminderMode !== "NONE" ? (
                <div className="task-schedule-field-label">Remind</div>
            ) : null}
            <div className="task-reminder-select-label">
                <TaskComposerDropdown
                    label="Reminder"
                    value={reminderMode}
                    options={reminderOptions}
                    onChange={(selectedValue) => {
                        if (selectedValue === "ON_TIME") {
                            onChange({
                                reminder_mode: "ON_TIME",
                                notification_unit: allDay ? "DAYS" : "MINUTES",
                                notification_offset_value: "0",
                            });
                            return;
                        }

                        if (selectedValue === "BEFORE") {
                            const nextAmount =
                                parsePositiveIntegerOrZero(
                                    state.notification_offset_value,
                                ) > 0
                                    ? state.notification_offset_value
                                    : getDefaultReminderAmount(allDay);
                            onChange({
                                reminder_mode: "BEFORE",
                                notification_unit: allDay ? "DAYS" : "MINUTES",
                                notification_offset_value: nextAmount,
                            });
                            return;
                        }

                        onChange({
                            reminder_mode: "NONE",
                            notification_unit: "",
                            notification_offset_value: "0",
                        });
                    }}
                />
            </div>
            {allDay ? (
                <p className="task-reminder-helper">
                    All-day reminders use the start of your working hours.
                </p>
            ) : null}
            {isBeforeReminder ? (
                <div className="task-reminder-custom">
                    <label>
                        <input
                            className="task-form-control"
                            type="number"
                            min={0}
                            step={1}
                            value={state.notification_offset_value}
                            onChange={(event) =>
                                onChange({
                                    notification_offset_value:
                                        event.target.value,
                                })
                            }
                            onBlur={() => {
                                if (
                                    parsePositiveIntegerOrZero(
                                        state.notification_offset_value,
                                    ) < 1
                                ) {
                                    onChange({
                                        notification_offset_value:
                                            getDefaultReminderAmount(allDay),
                                    });
                                }
                            }}
                            aria-label="Reminder amount"
                        />
                    </label>
                    {allDay ? (
                        <span className="task-reminder-fixed-unit">days</span>
                    ) : (
                        <div className="task-form-field">
                            <TaskComposerDropdown
                                label="Reminder unit"
                                value={reminderUnit}
                                options={reminderUnitOptions}
                                onChange={(value) =>
                                    onChange({
                                        notification_unit:
                                            value as NotificationUnit,
                                    })
                                }
                            />
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

type LabeledSelectProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: TaskList[];
    visibleLabel?: string | null;
};

function LabeledSelect({
    label,
    value,
    onChange,
    options,
    visibleLabel = label,
}: LabeledSelectProps) {
    const categoryOptions: TaskComposerDropdownOption[] = [
        { value: "", label: "None", mutedDot: true },
        ...options.map((option) => ({
            value: option.id,
            label: option.name,
            color: option.color,
        })),
    ];

    return (
        <div className="task-form-field">
            {visibleLabel ? <span>{visibleLabel}</span> : null}
            <TaskComposerDropdown
                label={label}
                value={value}
                options={categoryOptions}
                onChange={onChange}
                escapeClipping
            />
        </div>
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
    const dateOnlyScheduledStart = getDateOnlyScheduledStartIso(
        editState.scheduled_start,
    );
    const isDateOnlyTask = isAllDayFormTask(editState);
    const scheduledStart = isDateOnlyTask
        ? dateOnlyScheduledStart
        : toIsoOrNull(editState.scheduled_start);
    const scheduledEnd = isDateOnlyTask
        ? null
        : toIsoOrNull(editState.scheduled_end);
    const allDay = isDateOnlyTask;
    const recurrenceRule = buildRecurrenceRule(editState);
    const notificationSettings = getNotificationSettings(editState, allDay);
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
    if (allDay !== Boolean(selectedTask.all_day)) {
        updates.all_day = allDay;
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

function isAllDayFormTask(
    state: Pick<TaskFormState, "scheduled_start" | "scheduled_end">,
): boolean {
    return (
        Boolean(getDateOnlyScheduledStartIso(state.scheduled_start)) &&
        !state.scheduled_end
    );
}

function getInitialEditAccordionSection(
    task?: ScheduledTask | null,
): TaskFormAccordionSectionId {
    if (!task) {
        return "schedule";
    }

    if (
        task.scheduled_start ||
        task.scheduled_end ||
        task.recurrence_rule ||
        task.notification_enabled
    ) {
        return "schedule";
    }

    if (task.list_id) {
        return "organization";
    }

    if (task.notes?.trim()) {
        return "notes";
    }

    return "schedule";
}

function hasScheduleClearableData(
    state:
        | TaskFormState
        | EditFormState
        | Pick<
              TaskFormState,
              | "scheduled_start"
              | "scheduled_end"
              | "recurrence_frequency"
              | "recurrence_interval"
              | "recurrence_until"
              | "reminder_mode"
              | "notification_unit"
              | "notification_offset_value"
              | "notification_channel"
          >,
): boolean {
    return Boolean(
        state.scheduled_start ||
            state.scheduled_end ||
            state.recurrence_frequency ||
            state.recurrence_until ||
            state.reminder_mode !== "NONE" ||
            state.notification_unit ||
            state.notification_offset_value !== "0" ||
            state.notification_channel,
    );
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
        all_day: Boolean(task.all_day),
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
        case "all_day":
            update.all_day = snapshot.all_day;
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
): TaskUndoState | null {
    if (
        updateScope === "series" ||
        updates.recurrence_rule !== undefined ||
        (task.recurrence_series_id && hasRecurringDetachUpdate(updates))
    ) {
        return null;
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
): TaskUndoState | null {
    if (
        deleteScope !== "single" ||
        task.recurrence_series_id ||
        task.recurrence_rule
    ) {
        return null;
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
        "all_day",
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
        all_day: Boolean(task.all_day),
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
        all_day: Boolean(task.all_day),
        due_at: task.due_at,
        timezone: task.timezone,
        priority: task.priority,
        unscheduled_order:
            !task.scheduled_start && !task.scheduled_end && !task.due_at
                ? task.unscheduled_order
                : null,
        notification_enabled: task.notification_enabled,
        notification_offset_minutes: task.notification_offset_minutes,
        notification_channel: task.notification_channel,
    };
}

function notificationFormStateFromTask(task: ScheduledTask): Pick<
    TaskFormState,
    "reminder_mode" | "notification_unit" | "notification_offset_value"
> {
    if (!task.notification_enabled) {
        return {
            reminder_mode: "NONE",
            notification_unit: "",
            notification_offset_value: "0",
        };
    }

    const notificationOffsetMinutes = task.notification_offset_minutes ?? 0;
    const reminderMode: ReminderMode =
        notificationOffsetMinutes === 0 ? "ON_TIME" : "BEFORE";
    if (notificationOffsetMinutes > 0 && notificationOffsetMinutes % 1_440 === 0) {
        return {
            reminder_mode: reminderMode,
            notification_unit: "DAYS",
            notification_offset_value: String(
                notificationOffsetMinutes / 1_440,
            ),
        };
    }
    if (notificationOffsetMinutes > 0 && notificationOffsetMinutes % 60 === 0) {
        return {
            reminder_mode: reminderMode,
            notification_unit: "HOURS",
            notification_offset_value: String(notificationOffsetMinutes / 60),
        };
    }

    return {
        reminder_mode: reminderMode,
        notification_unit: "MINUTES",
        notification_offset_value: String(notificationOffsetMinutes),
    };
}

function getNotificationSettings(
    state: Pick<
        TaskFormState,
        "reminder_mode" | "notification_unit" | "notification_offset_value"
    >,
    allDay = false,
): {
    enabled: boolean;
    offsetMinutes: number;
    channel: "discord" | null;
} {
    if (state.reminder_mode === "NONE") {
        return {
            enabled: false,
            offsetMinutes: 0,
            channel: null,
        };
    }

    if (state.reminder_mode === "ON_TIME") {
        return {
            enabled: true,
            offsetMinutes: 0,
            channel: "discord",
        };
    }

    const parsedNotificationValue = parsePositiveIntegerOrZero(
        state.notification_offset_value,
    );
    const notificationValue =
        parsedNotificationValue > 0
            ? parsedNotificationValue
            : Number.parseInt(getDefaultReminderAmount(allDay), 10);
    if (allDay) {
        return {
            enabled: true,
            offsetMinutes: notificationValue * 1_440,
            channel: "discord",
        };
    }

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
        "all_day",
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
            return (
                !task.completed &&
                !task.scheduled_start &&
                !task.scheduled_end &&
                !task.due_at
            );
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
        (task) => !task.scheduled_start && !task.scheduled_end && !task.due_at,
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

function isBeforeLocalDay(left: Date, right: Date): boolean {
    const leftDay = new Date(left.getFullYear(), left.getMonth(), left.getDate());
    const rightDay = new Date(
        right.getFullYear(),
        right.getMonth(),
        right.getDate(),
    );
    return leftDay < rightDay;
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

    if (task.all_day) {
        return formatDateOnlyLabel(toAllDayCalendarDate(task.scheduled_start));
    }

    const start = formatDateTime(task.scheduled_start);
    const end = task.scheduled_end ? formatDateTime(task.scheduled_end) : "";
    return end ? `${start} - ${end}` : start;
}

function formatQuickActionRange(task: ScheduledTask): string {
    if (!task.scheduled_start) {
        return "No scheduled time";
    }

    if (task.all_day) {
        return formatDateOnlyLabel(toAllDayCalendarDate(task.scheduled_start));
    }

    const start = formatTimeOnly(task.scheduled_start);
    const end = task.scheduled_end ? formatTimeOnly(task.scheduled_end) : "";
    return end ? `${start}-${end}` : start;
}

function canShortenQuickActionTask(task: ScheduledTask): boolean {
    if (task.all_day || !task.scheduled_start || !task.scheduled_end) {
        return false;
    }

    const start = parseTaskDate(task.scheduled_start);
    const end = parseTaskDate(task.scheduled_end);
    return end.getTime() - start.getTime() > 15 * 60 * 1000;
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

    if (task.all_day && task.scheduled_start) {
        return isBeforeLocalDay(parseTaskDate(task.scheduled_start), now);
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

function formatTimeOnly(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
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

function formatDateOnlyLabel(value: string): string {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(year, month - 1, day));
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
    const leftDate = left.scheduled_start ?? left.due_at;
    const rightDate = right.scheduled_start ?? right.due_at;
    const leftTime = leftDate
        ? parseTaskDate(leftDate).getTime()
        : 0;
    const rightTime = rightDate
        ? parseTaskDate(rightDate).getTime()
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
    return dateToDateInputValue(date);
}

function dateToDateInputValue(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function dateOnlyToApiDateTime(value: string): string {
    return `${value}T00:00:00`;
}

function getDateOnlyScheduledStartIso(value: string): string | null {
    const { datePart, timePart } = splitDateTimeInputValue(value);
    return datePart && !timePart ? dateOnlyToApiDateTime(datePart) : null;
}

function endOfLocalDateToIso(value: string): string {
    const date = new Date(`${value}T23:59:59.999`);
    return date.toISOString();
}

function getCalendarEventScheduleUpdate(event: EventApi, task?: ScheduledTask): {
    scheduled_start: string | null;
    scheduled_end: string | null;
    all_day: boolean;
    due_at?: string | null;
} {
    if (!event.start) {
        return { scheduled_start: null, scheduled_end: null, all_day: false, due_at: null };
    }

    if (event.allDay) {
        return {
            scheduled_start: dateOnlyToApiDateTime(
                dateToDateInputValue(event.start),
            ),
            scheduled_end: null,
            all_day: true,
            ...(task?.due_at ? { due_at: null } : {}),
        };
    }

    return {
        scheduled_start: event.start.toISOString(),
        scheduled_end: event.end?.toISOString() ?? null,
        all_day: false,
        ...(task?.due_at ? { due_at: null } : {}),
    };
}

function getCalendarDropScheduleUpdate(
    task: ScheduledTask,
    dropInfo: DropArg,
): {
    scheduled_start: string | null;
    scheduled_end: string | null;
    all_day: boolean;
    due_at?: string | null;
} {
    const start = dropInfo.date;
    if (dropInfo.allDay) {
        return {
            scheduled_start: dateOnlyToApiDateTime(dateToDateInputValue(start)),
            scheduled_end: null,
            all_day: true,
            ...(task.due_at ? { due_at: null } : {}),
        };
    }

    const durationMinutes = getTaskDragDurationMinutes(task, dropInfo.allDay);
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    return {
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        all_day: false,
        ...(task.due_at ? { due_at: null } : {}),
    };
}

function addLocalDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
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

function toAllDayCalendarDate(value: string): string {
    return value.slice(0, 10);
}

function addCalendarDateDays(value: string, days: number): string {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    return dateToDateInputValue(date);
}

function mapTaskToCalendarEvent(
    task: ScheduledTask,
    categoryColorById: Map<string, string>,
): EventInput {
    const color = taskCategoryColor(task, categoryColorById);
    const scheduledStart = task.scheduled_start;
    const allDay = Boolean(task.all_day);
    const allDayStart =
        allDay && scheduledStart
            ? toAllDayCalendarDate(scheduledStart)
            : undefined;
    const classNames = task.completed
        ? ["task-event", "task-event--completed"]
        : ["task-event"];

    return {
        id: task.id,
        title: task.title,
        start:
            allDayStart ?? scheduledStart ?? undefined,
        end:
            allDay && !task.scheduled_end
                ? allDayStart
                    ? addCalendarDateDays(allDayStart, 1)
                    : undefined
                : allDay && task.scheduled_end
                  ? toAllDayCalendarDate(task.scheduled_end)
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

function hasStoredWorkingHours(): boolean {
    try {
        return window.localStorage?.getItem("calendar-working-hours") !== null;
    } catch {
        return false;
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

function getInitialShowCompletedTasks(): boolean {
    try {
        const stored = window.localStorage?.getItem(
            "calendar-show-completed-tasks",
        );
        if (stored === null) {
            return true;
        }

        const parsed = JSON.parse(stored);
        return typeof parsed === "boolean" ? parsed : true;
    } catch {
        return true;
    }
}

function saveShowCompletedTasks(showCompletedTasks: boolean): void {
    try {
        window.localStorage?.setItem(
            "calendar-show-completed-tasks",
            JSON.stringify(showCompletedTasks),
        );
    } catch {
        // Completed-task visibility persistence is optional.
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

function clearStoredUserPreferences(): void {
    try {
        window.localStorage?.removeItem("calendar-theme");
        window.localStorage?.removeItem("calendar-sidebar");
        window.localStorage?.removeItem("calendar-sidebar-width");
        window.localStorage?.removeItem("calendar-working-hours");
        window.localStorage?.removeItem("calendar-show-completed-tasks");
        window.localStorage?.removeItem("calendar-unscheduled-order");
    } catch {
        // Preference clearing is optional.
    }
}

function normalizeWorkingHour(value: string | undefined, fallback: string): string {
    return value && workingHourOptions.includes(value) ? value : fallback;
}

function normalizeWeekStart(value: string | null | undefined): WeekStart {
    return value === "monday" ? "monday" : "sunday";
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

function isOfflineNetworkError(error: unknown): boolean {
    return (
        error instanceof TypeError ||
        (error instanceof Error &&
            /failed to fetch|network|load failed/i.test(error.message))
    );
}

function formatBackupDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}
