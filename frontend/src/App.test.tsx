import {
    act,
    fireEvent,
    render,
    screen,
    within,
    waitFor,
    waitForElementToBeRemoved,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EventInput } from "@fullcalendar/core";
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useState,
    type ForwardedRef,
    type ReactNode,
} from "react";

import { App } from "./App";

const mocks = vi.hoisted(() => ({
    AuthError: class MockAuthError extends Error {
        constructor(message = "Authentication required") {
            super(message);
            this.name = "AuthError";
        }
    },
    fullCalendarProps: {
        events: [] as EventInput[],
        dateClick: undefined as
            | ((arg: { date: Date; allDay: boolean }) => void)
            | undefined,
        drop: undefined as
            | ((arg: {
                  date: Date;
                  allDay: boolean;
                  draggedEl: HTMLElement;
                  jsEvent: MouseEvent;
                  view: unknown;
              }) => void)
            | undefined,
        eventDrop: undefined as
            | ((arg: {
                  event: {
                      id: string;
                      start: Date;
                      end: Date | null;
                      allDay: boolean;
                  };
                  revert: () => void;
              }) => void)
            | undefined,
        eventClick: undefined as
            | ((arg: {
                  el: HTMLElement;
                  event: { id: string; start: Date | null };
                  view: { type: string };
              }) => void)
              | undefined,
        eventResize: undefined as
            | ((arg: {
                  event: {
                      id: string;
                      start: Date;
                      end: Date | null;
                      allDay: boolean;
                  };
                  revert: () => void;
              }) => void)
            | undefined,
        scrollTime: undefined as string | undefined,
        scrollTimeReset: undefined as boolean | undefined,
        slotMinTime: undefined as string | undefined,
        slotMaxTime: undefined as string | undefined,
        expandRows: undefined as boolean | undefined,
        dayMaxEventRows: undefined as number | boolean | undefined,
        longPressDelay: undefined as number | undefined,
        selectLongPressDelay: undefined as number | undefined,
        eventLongPressDelay: undefined as number | undefined,
        eventDragMinDistance: undefined as number | undefined,
        editable: undefined as boolean | undefined,
        eventStartEditable: undefined as boolean | undefined,
        eventDurationEditable: undefined as boolean | undefined,
    },
    fullCalendarMount: vi.fn(),
    fullCalendarRefetchEvents: vi.fn(),
    fullCalendarUpdateSize: vi.fn(),
    dragRevert: vi.fn(),
    draggableConstruct: vi.fn(),
    draggableDestroy: vi.fn(),
    getCurrentUser: vi.fn(async () => ({
        id: "user-1",
        username: "alice",
        created_at: "",
        updated_at: "",
    })),
    login: vi.fn(async () => {
        window.localStorage.setItem("calendar-auth-token", "test-token");
        return "test-token";
    }),
    fetchBackupExport: vi.fn(async () => ({
        schema_version: 1,
        exported_at: "2026-05-14T00:00:00.000Z",
        tasks: [
            {
                id: "task-1",
                title: "Alpha",
            },
        ],
        task_lists: [
            {
                id: "list-1",
                name: "Work",
            },
        ],
    })),
    importBackup: vi.fn(async () => ({
        imported_task_lists: 1,
        imported_tasks: 1,
    })),
    downloadBackupPayload: vi.fn(),
    register: vi.fn(async () => ({
        id: "user-1",
        username: "alice",
        created_at: "",
        updated_at: "",
    })),
    taskLists: [
        {
            id: "list-1",
            user_id: "user-1",
            name: "Work",
            color: "#2f80ed",
            created_at: "",
            updated_at: "",
        },
    ],
    tasks: [] as Array<Record<string, unknown>>,
    listTasks: vi.fn(),
    listTaskLists: vi.fn(async () => mocks.taskLists),
    createTask: vi.fn(async () => ({ id: "task-new" })),
    deleteTask: vi.fn(async () => undefined),
    completeTask: vi.fn(
        async (taskId: string): Promise<Record<string, unknown>> => ({
            id: taskId,
        }),
    ),
    uncompleteTask: vi.fn(
        async (taskId: string): Promise<Record<string, unknown>> => ({
            id: taskId,
        }),
    ),
    deleteTaskList: vi.fn(async () => undefined),
    updateTask: vi.fn(
        async (taskId: string, input: Record<string, unknown> = {}) => {
            const currentTask = mocks.tasks.find((task) => task.id === taskId) ?? {
                id: taskId,
            };
            const updatedTask = {
                ...currentTask,
                ...input,
            };
            mocks.tasks = mocks.tasks.map((task) =>
                task.id === taskId ? updatedTask : task,
            );
            return updatedTask;
        },
    ),
    settings: {
        id: 1,
        discord_webhook_url: null,
        discord_message_template: null,
        created_at: "",
        updated_at: "",
    },
    updateSettings: vi.fn(async (input: Record<string, unknown>) => ({
        id: 1,
        discord_webhook_url:
            (input.discord_webhook_url as string | null | undefined) ?? null,
        discord_message_template:
            (input.discord_message_template as string | null | undefined) ??
            null,
        created_at: "",
        updated_at: "",
    })),
    testSettings: vi.fn(async () => ({
        message: "Test webhook sent",
    })),
    updateTaskList: vi.fn(
        async (
            _taskListId: string,
            input: { name?: string; color?: string },
        ) => ({
            id: "list-1",
            user_id: "user-1",
            name: input.name ?? "Work",
            color: input.color ?? "#2f80ed",
            created_at: "",
            updated_at: "",
        }),
    ),
}));

vi.mock("@fullcalendar/interaction", async () => {
    class MockDraggable {
        constructor(...args: unknown[]) {
            mocks.draggableConstruct(...args);
        }

        destroy = mocks.draggableDestroy;
    }

    return {
        default: {},
        Draggable: MockDraggable,
    };
});

vi.mock("@fullcalendar/react", () => ({
    default: forwardRef(function MockFullCalendar(
        {
            dateClick,
            datesSet,
            drop,
            eventClick,
            eventClassNames,
            eventDrop,
            eventResize,
            eventContent,
            events,
            initialView,
            scrollTime,
            scrollTimeReset,
            slotMinTime,
            slotMaxTime,
            expandRows,
            dayMaxEventRows,
            longPressDelay,
            selectLongPressDelay,
            eventLongPressDelay,
            eventDragMinDistance,
            editable,
            eventStartEditable,
            eventDurationEditable,
        }: {
            dateClick?: (arg: { date: Date; allDay: boolean }) => void;
            datesSet?: (arg: {
                view: { type: string; title: string };
                start: Date;
            }) => void;
            drop?: (arg: {
                date: Date;
                allDay: boolean;
                draggedEl: HTMLElement;
                jsEvent: MouseEvent;
                view: unknown;
            }) => void;
            eventClick?: (arg: {
                el: HTMLElement;
                event: { id: string; start: Date | null };
                view: { type: string };
            }) => void;
            eventClassNames?: (arg: {
                event: {
                    id: string;
                    title: string;
                    start: Date | null;
                    end: Date | null;
                    allDay: boolean;
                    extendedProps: Record<string, unknown>;
                };
                view: { type: string };
            }) => string[];
            eventDrop?: (arg: {
                event: {
                    id: string;
                    start: Date;
                    end: Date | null;
                    allDay: boolean;
                };
                revert: () => void;
            }) => void;
            eventResize?: (arg: {
                event: {
                    id: string;
                    start: Date;
                    end: Date | null;
                    allDay: boolean;
                };
                revert: () => void;
            }) => void;
            eventContent?: (arg: {
                event: {
                    id: string;
                    title: string;
                    start: Date | null;
                    end: Date | null;
                    allDay: boolean;
                    extendedProps: Record<string, unknown>;
                };
                view: { type: string };
            }) => ReactNode;
            events?: EventInput[];
            initialView?: string;
            scrollTime?: string;
            scrollTimeReset?: boolean;
            slotMinTime?: string;
            slotMaxTime?: string;
            expandRows?: boolean;
            dayMaxEventRows?: number | boolean;
            longPressDelay?: number;
            selectLongPressDelay?: number;
            eventLongPressDelay?: number;
            eventDragMinDistance?: number;
            editable?: boolean;
            eventStartEditable?: boolean;
            eventDurationEditable?: boolean;
        },
        ref: ForwardedRef<{
            getApi: () => {
                prev: () => void;
                next: () => void;
                today: () => void;
                changeView: (view: string) => void;
                gotoDate: (date: Date) => void;
                getDate: () => Date;
                refetchEvents: () => void;
                updateSize: () => void;
                scrollToTime: (time: string) => void;
            };
        }>,
    ) {
        const [view, setView] = useState(initialView ?? "timeGridWeek");
        const [currentDate, setCurrentDate] = useState(
            new Date("2026-05-08T00:00:00Z"),
        );
        const [showExternalMirror, setShowExternalMirror] = useState(false);

        useEffect(() => {
            mocks.fullCalendarMount();
        }, []);

        useImperativeHandle(
            ref,
            () => ({
                getApi: () => ({
                    prev: () =>
                        setCurrentDate(
                            (current) =>
                                new Date(
                                    current.getTime() - 24 * 60 * 60 * 1000,
                                ),
                        ),
                    next: () =>
                        setCurrentDate(
                            (current) =>
                                new Date(
                                    current.getTime() + 24 * 60 * 60 * 1000,
                                ),
                        ),
                    today: () =>
                        setCurrentDate(new Date("2026-05-08T00:00:00Z")),
                    changeView: (nextView: string) => setView(nextView),
                    gotoDate: (date: Date) => setCurrentDate(new Date(date)),
                    getDate: () => currentDate,
                    refetchEvents: () => mocks.fullCalendarRefetchEvents(),
                    updateSize: () => mocks.fullCalendarUpdateSize(),
                    scrollToTime: (time: string) => {
                        mocks.fullCalendarProps.scrollTime = time;
                    },
                }),
            }),
            [currentDate],
        );

        useEffect(() => {
            const title =
                view === "dayGridMonth"
                    ? "May 2026"
                    : view === "timeGridDay"
                      ? "May 8, 2026"
                      : "May 4 – 10, 2026";
            datesSet?.({
                view: { type: view, title },
                start: currentDate,
            });
        }, [currentDate, datesSet, view]);

        mocks.fullCalendarProps.events = events ?? [];
        mocks.fullCalendarProps.dateClick = dateClick;
        mocks.fullCalendarProps.drop = drop;
        mocks.fullCalendarProps.eventDrop = eventDrop;
        mocks.fullCalendarProps.eventClick = eventClick;
        mocks.fullCalendarProps.eventResize = eventResize;
        mocks.fullCalendarProps.scrollTime = scrollTime;
        mocks.fullCalendarProps.scrollTimeReset = scrollTimeReset;
        mocks.fullCalendarProps.slotMinTime = slotMinTime;
        mocks.fullCalendarProps.slotMaxTime = slotMaxTime;
        mocks.fullCalendarProps.expandRows = expandRows;
        mocks.fullCalendarProps.dayMaxEventRows = dayMaxEventRows;
        mocks.fullCalendarProps.longPressDelay = longPressDelay;
        mocks.fullCalendarProps.selectLongPressDelay = selectLongPressDelay;
        mocks.fullCalendarProps.eventLongPressDelay = eventLongPressDelay;
        mocks.fullCalendarProps.eventDragMinDistance = eventDragMinDistance;
        mocks.fullCalendarProps.editable = editable;
        mocks.fullCalendarProps.eventStartEditable = eventStartEditable;
        mocks.fullCalendarProps.eventDurationEditable = eventDurationEditable;
        const renderMockEvent = (
            event: EventInput & {
                extendedProps?: Record<string, unknown>;
            },
        ) => {
            const id = String(event.id ?? "");
            const title = String(event.title ?? "");
            const start =
                typeof event.start === "string" || event.start instanceof Date
                    ? new Date(event.start)
                    : null;
            const end =
                typeof event.end === "string" || event.end instanceof Date
                    ? new Date(event.end)
                    : null;
            const eventArg = {
                event: {
                    id,
                    title,
                    start,
                    end,
                    allDay: Boolean(event.allDay),
                    extendedProps: event.extendedProps ?? {},
                },
                view: { type: view },
            };

            return (
                <div
                    key={id}
                    data-testid={`calendar-event-${id}`}
                    className={eventClassNames?.(eventArg).join(" ")}
                    onClick={(clickEvent) =>
                        eventClick?.({
                            el: clickEvent.currentTarget,
                            event: { id, start },
                            view: { type: view },
                        })
                    }
                >
                    {eventContent?.(eventArg) ?? title}
                </div>
            );
        };

        return (
            <>
                <button
                    type="button"
                    onClick={() =>
                        dateClick?.({
                            date: new Date("2026-05-08T09:00:00Z"),
                            allDay: false,
                        })
                    }
                >
                    Open create task
                </button>
                <button
                    type="button"
                    onClick={() =>
                        dateClick?.({
                            date: new Date("2026-05-07T16:00:00Z"),
                            allDay: true,
                        })
                    }
                >
                    Open all-day create task
                </button>
                <button
                    type="button"
                    onClick={() =>
                        eventDrop?.({
                            event: {
                                id: "task-1",
                                start: new Date(2026, 4, 18, 0, 0, 0, 0),
                                end: null,
                                allDay: true,
                            },
                            revert: vi.fn(),
                        })
                    }
                >
                    Drop all-day task
                </button>
                <button
                    type="button"
                    onClick={() =>
                        eventDrop?.({
                            event: {
                                id: "task-recurring-drag",
                                start: new Date("2026-05-10T09:30:00Z"),
                                end: new Date("2026-05-10T10:30:00Z"),
                                allDay: false,
                            },
                            revert: mocks.dragRevert,
                        })
                    }
                >
                    Drop recurring task
                </button>
                <button
                    type="button"
                    onClick={() =>
                        eventResize?.({
                            event: {
                                id: "task-1",
                                start: new Date("2026-05-08T09:00:00Z"),
                                end: new Date("2026-05-08T11:30:00Z"),
                                allDay: false,
                            },
                            revert: vi.fn(),
                        })
                    }
                >
                    Resize task
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setShowExternalMirror(true);
                        const draggedEl = document.createElement("button");
                        draggedEl.dataset.taskId = "task-external";
                        drop?.({
                            date: new Date("2026-05-08T13:00:00Z"),
                            allDay: false,
                            draggedEl,
                            jsEvent: new MouseEvent("drop"),
                            view: {},
                        });
                    }}
                >
                    Receive external task
                </button>
                <button
                    type="button"
                    onClick={() =>
                        dateClick?.({
                            date: new Date(2026, 4, 8, 0, 0, 0, 0),
                            allDay: true,
                        })
                    }
                >
                    Select month day
                </button>
                <div data-testid="calendar-events">
                    {showExternalMirror &&
                        renderMockEvent({
                            id: "external-mirror",
                            title: "External mirror",
                        })}
                    {(events ?? [])
                        .filter((event) => event.id === "task-external")
                        .map((event) => renderMockEvent(event))}
                </div>
            </>
        );
    }),
}));

let createdTaskCounter = 0;

vi.mock("./api/tasks", () => ({
    listTasks: mocks.listTasks,
    createTask: mocks.createTask,
    updateTask: mocks.updateTask,
    completeTask: mocks.completeTask,
    uncompleteTask: mocks.uncompleteTask,
    mapTaskToEvent: vi.fn(),
    deleteTask: mocks.deleteTask,
}));

vi.mock("./api/taskLists", () => ({
    listTaskLists: mocks.listTaskLists,
    createTaskList: vi.fn(),
    updateTaskList: mocks.updateTaskList,
    deleteTaskList: mocks.deleteTaskList,
}));

vi.mock("./api/settings", () => ({
    getSettings: () => Promise.resolve(mocks.settings),
    testSettings: mocks.testSettings,
    updateSettings: mocks.updateSettings,
}));

vi.mock("./api/auth", () => ({
    AuthError: mocks.AuthError,
    clearStoredAuthToken: () =>
        window.localStorage.removeItem("calendar-auth-token"),
    getCurrentUser: mocks.getCurrentUser,
    getStoredAuthToken: () => window.localStorage.getItem("calendar-auth-token"),
    isAuthError: (error: unknown) => error instanceof mocks.AuthError,
    login: mocks.login,
    register: mocks.register,
}));

vi.mock("./api/backup", () => ({
    downloadBackupPayload: mocks.downloadBackupPayload,
    fetchBackupExport: mocks.fetchBackupExport,
    importBackup: mocks.importBackup,
}));

function mockTaskRowRects(rows: Element[]): void {
    rows.forEach((row, index) => {
        vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
            top: index * 50,
            height: 40,
            bottom: index * 50 + 40,
            left: 0,
            right: 280,
            width: 280,
            x: 0,
            y: index * 50,
            toJSON: () => ({}),
        });
    });
}

function sortTasksForApiMock(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
): number {
    const leftScheduledStart = left.scheduled_start as string | null;
    const rightScheduledStart = right.scheduled_start as string | null;
    const leftScheduledEnd = left.scheduled_end as string | null;
    const rightScheduledEnd = right.scheduled_end as string | null;
    const leftIsUnscheduled = !leftScheduledStart && !leftScheduledEnd;
    const rightIsUnscheduled = !rightScheduledStart && !rightScheduledEnd;

    if (leftIsUnscheduled !== rightIsUnscheduled) {
        return Number(leftIsUnscheduled) - Number(rightIsUnscheduled);
    }

    if (leftIsUnscheduled && rightIsUnscheduled) {
        const leftOrder = left.unscheduled_order as number | null;
        const rightOrder = right.unscheduled_order as number | null;
        if (leftOrder !== null && rightOrder !== null) {
            return leftOrder - rightOrder;
        }
        if (leftOrder !== null) {
            return -1;
        }
        if (rightOrder !== null) {
            return 1;
        }
    }

    const leftDate = (leftScheduledStart ?? left.created_at) as string | null;
    const rightDate = (rightScheduledStart ?? right.created_at) as string | null;
    return String(leftDate).localeCompare(String(rightDate));
}

function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return { promise, resolve, reject };
}

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const now = new Date();
    const todayAtNine = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        9,
        0,
        0,
        0,
    );
    const todayAtTen = new Date(todayAtNine.getTime() + 60 * 60 * 1000);

    return {
        id: "task-1",
        user_id: "user-1",
        list_id: "list-1",
        title: "Task",
        notes: null,
        completed: false,
        scheduled_start: todayAtNine.toISOString(),
        scheduled_end: todayAtTen.toISOString(),
        all_day: false,
        due_at: null,
        timezone: "Asia/Taipei",
        priority: null,
        unscheduled_order: null,
        recurrence_rule: null,
        recurrence_series_id: null,
        notification_enabled: false,
        notification_offset_minutes: 0,
        notification_channel: null,
        notification_sent_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        completed_at: null,
        ...overrides,
    };
}

type MockMediaQueryList = {
    matches: boolean;
    media: string;
    onchange: null;
    addEventListener: (
        type: string,
        listener: (event: MediaQueryListEvent) => void,
    ) => void;
    removeEventListener: (
        type: string,
        listener: (event: MediaQueryListEvent) => void,
    ) => void;
    addListener: (listener: (event: MediaQueryListEvent) => void) => void;
    removeListener: (listener: (event: MediaQueryListEvent) => void) => void;
    dispatchEvent: (event: Event) => boolean;
};

let mockMediaQueryList: MockMediaQueryList | null = null;
const mockMediaQueryListeners = new Set<(event: MediaQueryListEvent) => void>();

function setMobileLayout(matches: boolean): void {
    if (!mockMediaQueryList) {
        mockMediaQueryList = {
            matches,
            media: "(max-width: 860px)",
            onchange: null,
            addEventListener: (_type, listener) => {
                mockMediaQueryListeners.add(listener);
            },
            removeEventListener: (_type, listener) => {
                mockMediaQueryListeners.delete(listener);
            },
            addListener: (listener) => {
                mockMediaQueryListeners.add(listener);
            },
            removeListener: (listener) => {
                mockMediaQueryListeners.delete(listener);
            },
            dispatchEvent: (event) => {
                mockMediaQueryListeners.forEach((listener) =>
                    listener(event as MediaQueryListEvent),
                );
                return true;
            },
        };
    }

    mockMediaQueryList.matches = matches;
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: vi.fn((query: string) => {
            if (mockMediaQueryList) {
                mockMediaQueryList.media = query;
            }
            return mockMediaQueryList as MockMediaQueryList;
        }),
    });
}

function dispatchMobileLayoutChange(matches: boolean): void {
    if (!mockMediaQueryList) {
        setMobileLayout(matches);
        return;
    }

    const mediaQueryList = mockMediaQueryList;
    mediaQueryList.matches = matches;
    mockMediaQueryListeners.forEach((listener) =>
        listener({
            matches,
            media: mediaQueryList.media,
        } as MediaQueryListEvent),
    );
}

async function selectTaskDropdownOption(
    label: string,
    option: string,
): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: label }));
    const listbox = await screen.findByRole("listbox", {
        name: `${label} options`,
    });
    fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

describe("App", () => {
    beforeEach(() => {
        mockMediaQueryList = null;
        mockMediaQueryListeners.clear();
        setMobileLayout(false);
        window.localStorage.clear();
        window.localStorage.setItem("calendar-auth-token", "test-token");
        mocks.tasks = [];
        mocks.taskLists = [
            {
                id: "list-1",
                user_id: "user-1",
                name: "Work",
                color: "#2f80ed",
                created_at: "",
                updated_at: "",
            },
        ];
        mocks.listTasks.mockClear();
        mocks.listTaskLists.mockClear();
        mocks.listTasks.mockImplementation(() =>
            Promise.resolve([...mocks.tasks].sort(sortTasksForApiMock)),
        );
        mocks.createTask.mockClear();
        mocks.deleteTask.mockClear();
        mocks.deleteTaskList.mockClear();
        createdTaskCounter = 0;
        mocks.createTask.mockImplementation(
            async (input: Record<string, unknown> = {}) => {
                const createdTask = {
                    id: `task-new-${++createdTaskCounter}`,
                    user_id: "user-1",
                    list_id:
                        (input.list_id as string | null | undefined) ?? null,
                    title: String(input.title ?? "New task"),
                    notes: (input.notes as string | null | undefined) ?? null,
                    completed: Boolean(input.completed ?? false),
                    scheduled_start:
                        (input.scheduled_start as string | null | undefined) ??
                        null,
                    scheduled_end:
                        (input.scheduled_end as string | null | undefined) ??
                        null,
                    all_day: Boolean(input.all_day ?? false),
                    due_at: (input.due_at as string | null | undefined) ?? null,
                    timezone:
                        (input.timezone as string | undefined) ?? "Asia/Taipei",
                    priority:
                        (input.priority as number | null | undefined) ?? null,
                    unscheduled_order:
                        (input.unscheduled_order as
                            | number
                            | null
                            | undefined) ?? null,
                    recurrence_rule:
                        (input.recurrence_rule as string | null | undefined) ??
                        null,
                    recurrence_series_id: null,
                    notification_enabled: Boolean(
                        input.notification_enabled ?? false,
                    ),
                    notification_offset_minutes: Number(
                        input.notification_offset_minutes ?? 0,
                    ),
                    notification_channel:
                        (input.notification_channel as
                            | string
                            | null
                            | undefined) ?? null,
                    notification_sent_at: null,
                    created_at: "2026-05-08T00:00:00.000Z",
                    updated_at: "2026-05-08T00:00:00.000Z",
                    completed_at: null,
                };
                mocks.tasks = [...mocks.tasks, createdTask];
                return createdTask;
            },
        );
        mocks.completeTask.mockClear();
        mocks.completeTask.mockImplementation(async (taskId: string) => {
            const currentTask = mocks.tasks.find((task) => task.id === taskId) ?? {
                id: taskId,
            };
            const updatedTask = {
                ...currentTask,
                completed: true,
                completed_at: "2026-05-08T00:00:00.000Z",
            };
            mocks.tasks = mocks.tasks.map((task) =>
                task.id === taskId ? updatedTask : task,
            );
            return updatedTask;
        });
        mocks.uncompleteTask.mockClear();
        mocks.uncompleteTask.mockImplementation(async (taskId: string) => {
            const currentTask = mocks.tasks.find((task) => task.id === taskId) ?? {
                id: taskId,
            };
            const updatedTask = {
                ...currentTask,
                completed: false,
                completed_at: null,
            };
            mocks.tasks = mocks.tasks.map((task) =>
                task.id === taskId ? updatedTask : task,
            );
            return updatedTask;
        });
        mocks.fullCalendarMount.mockClear();
        mocks.fullCalendarRefetchEvents.mockClear();
        mocks.fullCalendarProps.events = [];
        mocks.fullCalendarProps.dateClick = undefined;
        mocks.fullCalendarProps.drop = undefined;
        mocks.fullCalendarProps.eventDrop = undefined;
        mocks.fullCalendarProps.eventClick = undefined;
        mocks.fullCalendarProps.eventResize = undefined;
        mocks.fullCalendarProps.dayMaxEventRows = undefined;
        mocks.fullCalendarProps.longPressDelay = undefined;
        mocks.fullCalendarProps.selectLongPressDelay = undefined;
        mocks.fullCalendarProps.eventLongPressDelay = undefined;
        mocks.fullCalendarProps.eventDragMinDistance = undefined;
        mocks.fullCalendarProps.editable = undefined;
        mocks.fullCalendarProps.eventStartEditable = undefined;
        mocks.fullCalendarProps.eventDurationEditable = undefined;
        mocks.dragRevert.mockClear();
        mocks.draggableConstruct.mockClear();
        mocks.draggableDestroy.mockClear();
        mocks.updateTask.mockClear();
        mocks.updateSettings.mockClear();
        mocks.testSettings.mockClear();
        mocks.login.mockClear();
        mocks.fetchBackupExport.mockClear();
        mocks.importBackup.mockClear();
        mocks.importBackup.mockResolvedValue({
            imported_task_lists: 1,
            imported_tasks: 1,
        });
        mocks.downloadBackupPayload.mockClear();
        mocks.register.mockClear();
        mocks.getCurrentUser.mockClear();
        mocks.getCurrentUser.mockResolvedValue({
            id: "user-1",
            username: "alice",
            created_at: "",
            updated_at: "",
        });
    });

    it("shows the auth screen when no token exists", () => {
        window.localStorage.removeItem("calendar-auth-token");

        render(<App />);

        expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Task view" })).not.toBeInTheDocument();
    });

    it("logs in and renders the calendar app", async () => {
        window.localStorage.removeItem("calendar-auth-token");

        render(<App />);

        fireEvent.change(screen.getByLabelText("Username"), {
            target: { value: "alice" },
        });
        fireEvent.change(screen.getByLabelText("Password"), {
            target: { value: "secret-password" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

        await waitFor(() =>
            expect(mocks.login).toHaveBeenCalledWith({
                username: "alice",
                password: "secret-password",
            }),
        );
        expect(window.localStorage.getItem("calendar-auth-token")).toBe("test-token");
        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toHaveTextContent("Today");
    });

    it("clears an invalid token and returns to login", async () => {
        mocks.getCurrentUser.mockRejectedValueOnce(
            new mocks.AuthError("Could not validate credentials"),
        );

        render(<App />);

        expect(
            await screen.findByText("Session expired. Please log in again."),
        ).toBeInTheDocument();
        expect(window.localStorage.getItem("calendar-auth-token")).toBeNull();
        expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    });

    it("logs out from the settings menu", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(screen.getByRole("button", { name: "Logout" }));

        expect(window.localStorage.getItem("calendar-auth-token")).toBeNull();
        expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    });

    it("toggles dark mode from the sidebar settings menu", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        const darkModeSwitch = screen.getByRole("switch", {
            name: "Dark mode",
        });

        expect(darkModeSwitch).toHaveAttribute("aria-checked", "false");
        fireEvent.click(darkModeSwitch);

        await waitFor(() =>
            expect(
                screen.getByRole("switch", { name: "Dark mode" }),
            ).toHaveAttribute("aria-checked", "true"),
        );
        expect(
            screen.getByRole("switch", { name: "Dark mode" }),
        ).toHaveClass("sidebar-switch-on");
        expect(window.localStorage.getItem("calendar-theme")).toBe("dark");
    });

    it("shows completed tasks toggle in settings and defaults it on", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        const showCompletedSwitch = screen.getByRole("switch", {
            name: "Show completed tasks",
        });

        expect(showCompletedSwitch).toHaveAttribute("aria-checked", "true");
        expect(showCompletedSwitch).toHaveClass("sidebar-switch-on");
    });

    it("shows working hours settings with default values", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(
            screen.getByRole("button", { name: "Working hours" }),
        );

        expect(
            await screen.findByRole("heading", { name: "Working hours" }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Start time")).toHaveValue("08:00");
        expect(screen.getByLabelText("End time")).toHaveValue("22:00");
        expect(screen.getByLabelText("Start time")).toHaveAttribute(
            "type",
            "time",
        );
        expect(screen.getByLabelText("Start time")).toHaveAttribute(
            "step",
            "3600",
        );
        expect(screen.getByLabelText("Start time")).toHaveAttribute(
            "lang",
            "en-GB",
        );
        expect(
            screen.getByRole("button", { name: "Return to sidebar" }),
        ).toHaveTextContent("☰");
        expect(screen.queryByRole("button", { name: "Task view" })).toBeNull();
        expect(
            screen.queryByRole("heading", { name: "Task filters" }),
        ).toBeNull();
    });

    it("loads persisted working hours from localStorage", async () => {
        window.localStorage.setItem(
            "calendar-working-hours",
            JSON.stringify({ start: "09:00", end: "18:00" }),
        );

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(
            screen.getByRole("button", { name: "Working hours" }),
        );

        await screen.findByRole("heading", { name: "Working hours" });
        expect(screen.getByLabelText("Start time")).toHaveValue("09:00");
        expect(screen.getByLabelText("End time")).toHaveValue("18:00");
    });

    it("returns from working hours to the settings menu and sidebar", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(
            screen.getByRole("button", { name: "Working hours" }),
        );

        await screen.findByRole("heading", { name: "Working hours" });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(
            await screen.findByRole("button", { name: "Working hours" }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Return to sidebar" }));
        expect(
            screen.getByRole("button", { name: "Settings" }),
        ).toBeInTheDocument();
    });

    it("focuses the calendar on the configured working-hours start time", async () => {
        window.localStorage.setItem(
            "calendar-working-hours",
            JSON.stringify({ start: "09:00", end: "18:00" }),
        );

        render(<App />);

        await waitFor(() =>
            expect(mocks.fullCalendarProps.scrollTime).toBe("09:00:00"),
        );
    });

    it("updates the calendar focus when working hours change", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(
            screen.getByRole("button", { name: "Working hours" }),
        );

        await screen.findByRole("heading", { name: "Working hours" });
        fireEvent.change(screen.getByLabelText("Start time"), {
            target: { value: "09:00" },
        });

        await waitFor(() =>
            expect(mocks.fullCalendarProps.scrollTime).toBe("09:00:00"),
        );
    });

    it("uses the configured working-hours range as the default calendar viewport", async () => {
        window.localStorage.setItem(
            "calendar-working-hours",
            JSON.stringify({ start: "08:00", end: "22:00" }),
        );

        render(<App />);

        await waitFor(() =>
            expect(mocks.fullCalendarProps.slotMinTime).toBe("08:00:00"),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.slotMaxTime).toBe("22:00:00"),
        );
        expect(mocks.fullCalendarProps.expandRows).toBe(true);
        expect(
            screen.getByRole("button", { name: "Work" }),
        ).toBeInTheDocument();
    });

    it("toggles between working-hours and full-day calendar viewport", async () => {
        render(<App />);

        mocks.fullCalendarUpdateSize.mockClear();

        fireEvent.click(
            await screen.findByRole("button", { name: "Work" }),
        );

        await waitFor(() =>
            expect(mocks.fullCalendarUpdateSize).toHaveBeenCalled(),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.slotMinTime).toBe("00:00:00"),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.slotMaxTime).toBe("24:00:00"),
        );
        expect(
            screen.getByRole("button", { name: "Full" }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Full" }));
        await waitFor(() =>
            expect(mocks.fullCalendarUpdateSize).toHaveBeenCalled(),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.slotMinTime).toBe("08:00:00"),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.slotMaxTime).toBe("22:00:00"),
        );
        expect(mocks.fullCalendarProps.expandRows).toBe(true);
    });

    it("hides the working-hours toggle in month view", async () => {
        render(<App />);

        mocks.fullCalendarUpdateSize.mockClear();

        await act(async () => {
            fireEvent.click(await screen.findByRole("button", { name: "Week" }));
        });
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument(),
        );

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Day" }));
        });
        await waitFor(() =>
            expect(mocks.fullCalendarUpdateSize).toHaveBeenCalled(),
        );
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument(),
        );

        expect(
            screen.queryByRole("button", { name: "Work" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Full" }),
        ).not.toBeInTheDocument();
        expect(mocks.fullCalendarProps.expandRows).toBe(false);
    });

    it("uses FullCalendar overflow and summary-only events for mobile month view", async () => {
        setMobileLayout(true);
        mocks.tasks = [
            makeTask({
                id: "task-external",
                title: "Compact mobile title",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        const weekEvent = await screen.findByTestId("calendar-event-task-external");
        expect(weekEvent.querySelector(".task-checkbox")).not.toBeNull();
        expect(mocks.fullCalendarProps.dayMaxEventRows).toBe(false);

        await act(async () => {
            fireEvent.click(await screen.findByRole("button", { name: "Week" }));
        });
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument(),
        );

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Day" }));
        });
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument(),
        );

        await waitFor(() =>
            expect(mocks.fullCalendarProps.dayMaxEventRows).toBe(true),
        );
        const monthEvent = screen.getByTestId("calendar-event-task-external");
        expect(monthEvent).toHaveTextContent("Compact mobile title");
        expect(monthEvent.querySelector(".task-checkbox")).toBeNull();
    });

    it("opens the edit panel from the selected-day list on first mobile month tap", async () => {
        setMobileLayout(true);
        mocks.tasks = [
            makeTask({
                id: "task-external",
                title: "Preview edit task",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Mobile Calendar" }));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Week" })).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Week" }));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Day" }));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument(),
        );

        fireEvent.click(screen.getByRole("button", { name: "Select month day" }));

        const previewRegion = screen.getByRole("region", {
            name: "Selected day tasks",
        });
        const previewTaskText = await within(previewRegion).findByText(
            "Preview edit task",
        );
        fireEvent.click(previewTaskText.closest("button") as HTMLButtonElement);

        expect(screen.getByRole("main")).toHaveClass("detail-panel-open");
        expect(document.querySelector(".task-sidebar")).not.toHaveAttribute(
            "inert",
        );
        expect(screen.getByLabelText("Edit task panel")).toBeInTheDocument();
        expect(screen.getByLabelText("Title")).toHaveValue("Preview edit task");
    });

    it("remounts the calendar when mobile interaction mode changes", async () => {
        render(<App />);

        await screen.findByRole("button", { name: "Task view" });
        expect(mocks.fullCalendarMount).toHaveBeenCalledTimes(1);
        expect(mocks.fullCalendarProps.editable).toBe(true);
        expect(mocks.fullCalendarProps.eventStartEditable).toBe(true);
        expect(mocks.fullCalendarProps.eventDurationEditable).toBe(true);
        expect(mocks.fullCalendarProps.eventDragMinDistance).toBe(8);

        dispatchMobileLayoutChange(true);

        await waitFor(() =>
            expect(mocks.fullCalendarMount).toHaveBeenCalledTimes(2),
        );
        expect(mocks.fullCalendarProps.editable).toBe(false);
        expect(mocks.fullCalendarProps.eventStartEditable).toBe(false);
        expect(mocks.fullCalendarProps.eventDurationEditable).toBe(false);
        expect(mocks.fullCalendarProps.eventDragMinDistance).toBe(9999);
        expect(mocks.fullCalendarProps.longPressDelay).toBe(60 * 60 * 1000);
        expect(mocks.fullCalendarProps.selectLongPressDelay).toBe(60 * 60 * 1000);
        expect(mocks.fullCalendarProps.eventLongPressDelay).toBe(60 * 60 * 1000);

        dispatchMobileLayoutChange(false);

        await waitFor(() =>
            expect(mocks.fullCalendarMount).toHaveBeenCalledTimes(3),
        );
        expect(mocks.fullCalendarProps.editable).toBe(true);
        expect(mocks.fullCalendarProps.eventStartEditable).toBe(true);
        expect(mocks.fullCalendarProps.eventDurationEditable).toBe(true);
        expect(mocks.fullCalendarProps.eventDragMinDistance).toBe(8);
    });

    it("reverts mobile calendar drag, resize, and external drop without persisting", async () => {
        setMobileLayout(true);
        mocks.tasks = [
            makeTask({
                id: "task-mobile-drag",
                title: "Mobile drag task",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
            {
                id: "task-mobile-external",
                user_id: "user-1",
                list_id: null,
                title: "Mobile external task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                all_day: false,
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: 0,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                notification_sent_at: null,
                created_at: "2026-05-08T00:00:00.000Z",
                updated_at: "2026-05-08T00:00:00.000Z",
                completed_at: null,
            },
        ];

        render(<App />);

        await screen.findByRole("button", { name: "Mobile Calendar" });
        expect(document.querySelector(".calendar-shell--mobile-readonly")).not.toBeNull();
        expect(mocks.fullCalendarProps.editable).toBe(false);
        expect(mocks.fullCalendarProps.eventStartEditable).toBe(false);
        expect(mocks.fullCalendarProps.eventDurationEditable).toBe(false);
        expect(mocks.fullCalendarProps.longPressDelay).toBe(60 * 60 * 1000);
        expect(mocks.fullCalendarProps.selectLongPressDelay).toBe(60 * 60 * 1000);
        expect(mocks.fullCalendarProps.eventLongPressDelay).toBe(60 * 60 * 1000);
        expect(mocks.fullCalendarProps.eventDrop).toBeDefined();
        expect(mocks.fullCalendarProps.eventResize).toBeDefined();
        expect(mocks.fullCalendarProps.drop).toBeDefined();

        mocks.fullCalendarProps.eventDrop?.({
            event: {
                id: "task-mobile-drag",
                start: new Date("2026-05-08T11:00:00.000Z"),
                end: new Date("2026-05-08T12:00:00.000Z"),
                allDay: false,
            },
            revert: mocks.dragRevert,
        });
        mocks.fullCalendarProps.eventResize?.({
            event: {
                id: "task-mobile-drag",
                start: new Date("2026-05-08T09:00:00.000Z"),
                end: new Date("2026-05-08T11:30:00.000Z"),
                allDay: false,
            },
            revert: mocks.dragRevert,
        });

        const draggedEl = document.createElement("button");
        draggedEl.dataset.taskId = "task-mobile-external";
        mocks.fullCalendarProps.drop?.({
            date: new Date("2026-05-08T13:00:00.000Z"),
            allDay: false,
            draggedEl,
            jsEvent: new MouseEvent("drop"),
            view: {},
        });

        expect(mocks.dragRevert).toHaveBeenCalledTimes(2);
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    it("opens the create panel from the mobile month selected-day list", async () => {
        setMobileLayout(true);
        mocks.tasks = [
            makeTask({
                id: "task-external",
                title: "Preview create task",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Mobile Calendar" }));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Week" })).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Week" }));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Day" }));
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument(),
        );

        fireEvent.click(screen.getByRole("button", { name: "Select month day" }));

        const previewRegion = screen.getByRole("region", {
            name: "Selected day tasks",
        });
        const addButton = within(previewRegion).getByRole("button", {
            name: "Add task for selected day",
        });
        const closeButton = within(previewRegion).getByRole("button", {
            name: "Close selected day tasks",
        });
        expect(addButton).toHaveClass(
            "floating-panel-action",
            "floating-panel-icon-button",
            "mobile-month-task-preview-add",
        );
        expect(closeButton).toHaveClass(
            "floating-panel-action",
            "floating-panel-icon-button",
            "mobile-month-task-preview-close",
        );
        fireEvent.click(
            addButton,
        );

        expect(screen.getByRole("main")).toHaveClass("detail-panel-open");
        expect(screen.getByLabelText("Create task panel")).toBeInTheDocument();
        expect(screen.getByLabelText("Start date")).toHaveValue("2026-05-08");
    });

    it("uses intentional mobile calendar taps for time-grid create and edit", async () => {
        setMobileLayout(true);
        mocks.tasks = [
            makeTask({
                id: "task-external",
                title: "Mobile tap task",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Mobile Calendar" }));
        await waitFor(() =>
            expect(mocks.fullCalendarProps.longPressDelay).toBe(60 * 60 * 1000),
        );
        expect(mocks.fullCalendarProps.selectLongPressDelay).toBe(60 * 60 * 1000);
        expect(mocks.fullCalendarProps.eventLongPressDelay).toBe(60 * 60 * 1000);
        expect(mocks.fullCalendarProps.editable).toBe(false);
        expect(mocks.fullCalendarProps.eventStartEditable).toBe(false);
        expect(mocks.fullCalendarProps.eventDurationEditable).toBe(false);

        fireEvent.click(screen.getByRole("button", { name: "Open create task" }));
        expect(
            await screen.findByLabelText("Create task panel"),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Start date")).toHaveValue("2026-05-08");
        expect(screen.getByLabelText("Start time")).toHaveValue("17:00");
        expect(screen.getByLabelText("End time")).toHaveValue("18:00");
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        await waitFor(() =>
            expect(screen.queryByLabelText("Create task panel")).not.toBeInTheDocument(),
        );

        fireEvent.click(screen.getByTestId("calendar-event-task-external"));

        await waitFor(() =>
            expect(
                screen.getByTestId("calendar-event-task-external"),
            ).toHaveClass("fc-event-selected"),
        );
        expect(
            screen.getByRole("region", { name: "Calendar task actions" }),
        ).toBeInTheDocument();
        expect(screen.getByText(/:00-.*:00/)).toBeInTheDocument();
        expect(screen.getByText("Complete")).toBeInTheDocument();
        expect(screen.queryByText("Uncomplete")).not.toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: "Move later 15 minutes" }),
        );
        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith("task-external", {
                scheduled_start: "2026-05-08T09:15:00.000Z",
                scheduled_end: "2026-05-08T10:15:00.000Z",
                all_day: false,
            }),
        );
        expect(screen.queryByLabelText("Edit task panel")).not.toBeInTheDocument();
    });

    it("keeps the mobile quick action completion label as Complete when already completed", async () => {
        setMobileLayout(true);
        mocks.tasks = [
            makeTask({
                id: "task-external",
                title: "Mobile completed task",
                completed: true,
                completed_at: "2026-05-08T08:00:00.000Z",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Mobile Calendar" }));
        fireEvent.click(screen.getByTestId("calendar-event-task-external"));

        await waitFor(() =>
            expect(
                screen.getByRole("region", { name: "Calendar task actions" }),
            ).toBeInTheDocument(),
        );
        expect(screen.getByText("Complete")).toBeInTheDocument();
        expect(screen.queryByText("Uncomplete")).not.toBeInTheDocument();
        expect(
            screen.getByRole("checkbox", { name: "Toggle task completion" }),
        ).toBeChecked();
    });

    it("does not open the desktop context menu on mobile task rows", async () => {
        setMobileLayout(true);
        mocks.tasks = [
            makeTask({
                id: "task-mobile-context",
                title: "Mobile context task",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Mobile Today" }));
        const taskRow = await screen.findByRole("button", {
            name: /Mobile context task/i,
        });
        fireEvent.contextMenu(taskRow, { clientX: 120, clientY: 180 });

        expect(screen.queryByRole("button", { name: "Duplicate" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });

    it("refreshes authenticated data on focus without resetting an open edit form", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-external",
                title: "Original title",
                notes: "Original notes",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        fireEvent.click(await screen.findByTestId("calendar-event-task-external"));
        await waitFor(() =>
            expect(screen.getByLabelText("Edit task panel")).toBeInTheDocument(),
        );

        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "Draft title" },
        });
        expect(screen.getByLabelText("Title")).toHaveValue("Draft title");

        const initialTaskCalls = mocks.listTasks.mock.calls.length;
        const initialTaskListCalls = mocks.listTaskLists.mock.calls.length;

        mocks.tasks = [
            makeTask({
                id: "task-external",
                title: "Remote title",
                notes: "Remote notes",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        fireEvent.focus(window);

        await waitFor(() =>
            expect(mocks.listTasks.mock.calls.length).toBe(
                initialTaskCalls + 1,
            ),
        );
        await waitFor(() =>
            expect(mocks.listTaskLists.mock.calls.length).toBe(
                initialTaskListCalls + 1,
            ),
        );
        expect(screen.getByLabelText("Title")).toHaveValue("Draft title");
    });

    it("stops authenticated polling after logout", async () => {
        render(<App />);

        const initialTaskCalls = mocks.listTasks.mock.calls.length;
        const initialTaskListCalls = mocks.listTaskLists.mock.calls.length;

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(await screen.findByRole("button", { name: "Logout" }));
        fireEvent.focus(window);

        expect(mocks.listTasks.mock.calls.length).toBe(initialTaskCalls);
        expect(mocks.listTaskLists.mock.calls.length).toBe(
            initialTaskListCalls,
        );
    });

    it("shows backup summary before downloading", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(screen.getByRole("button", { name: "Backup & Restore" }));
        fireEvent.click(await screen.findByRole("button", { name: "Backup" }));

        expect(await screen.findByText("Tasks:")).toBeInTheDocument();
        expect(screen.getByText("Categories:")).toBeInTheDocument();
        expect(screen.getByText("Schema version:")).toBeInTheDocument();
        expect(screen.getByText("Exported:")).toBeInTheDocument();

        await waitFor(() =>
            expect(mocks.downloadBackupPayload).toHaveBeenCalledWith(
                expect.objectContaining({
                    schema_version: 1,
                    exported_at: "2026-05-14T00:00:00.000Z",
                }),
            ),
        );
    });

    it("imports a selected backup after explicit confirmation", async () => {
        render(<App />);
        const payload = {
            schema_version: 1,
            exported_at: "2026-05-14T00:00:00.000Z",
            tasks: [],
            task_lists: [],
        };
        const file = new File([JSON.stringify(payload)], "backup.json", {
            type: "application/json",
        });

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(screen.getByRole("button", { name: "Backup & Restore" }));
        fireEvent.change(await screen.findByLabelText("Import backup (.json)"), {
            target: { files: [file] },
        });
        expect(
            await screen.findByText(
                /replace existing calendar and account data/i,
            ),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));

        await waitFor(() =>
            expect(mocks.importBackup).toHaveBeenCalledWith(payload),
        );
        expect(
            await screen.findByText("Imported 1 tasks and 1 categories."),
        ).toBeInTheDocument();
        expect(mocks.listTasks).toHaveBeenCalledTimes(3);
    });

    it("shows a readable backup import error and keeps settings usable", async () => {
        mocks.importBackup.mockRejectedValueOnce(new Error("Backup file is not valid."));
        render(<App />);
        const file = new File(
            [
                JSON.stringify({
                    schema_version: 1,
                    exported_at: "2026-05-14T00:00:00.000Z",
                    tasks: [],
                    task_lists: [],
                }),
            ],
            "backup.json",
            { type: "application/json" },
        );

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(screen.getByRole("button", { name: "Backup & Restore" }));
        fireEvent.change(await screen.findByLabelText("Import backup (.json)"), {
            target: { files: [file] },
        });
        fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));

        expect(await screen.findByText("Backup file is not valid.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Backup" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Confirm restore" })).toBeEnabled();
    });

    it("resets auth inputs when switching modes", async () => {
        window.localStorage.removeItem("calendar-auth-token");

        render(<App />);

        fireEvent.change(screen.getByLabelText("Username"), {
            target: { value: "alice" },
        });
        fireEvent.change(screen.getByLabelText("Password"), {
            target: { value: "secret-password" },
        });

        fireEvent.click(screen.getByRole("tab", { name: "Create account" }));

        expect(screen.getByLabelText("Username")).toHaveValue("");
        expect(screen.getByLabelText("Password")).toHaveValue("");

        fireEvent.change(screen.getByLabelText("Username"), {
            target: { value: "bob" },
        });
        fireEvent.change(screen.getByLabelText("Password"), {
            target: { value: "another-password" },
        });

        fireEvent.click(screen.getByRole("tab", { name: "Use an existing account" }));

        expect(screen.getByLabelText("Username")).toHaveValue("");
        expect(screen.getByLabelText("Password")).toHaveValue("");
    });

    it("renders task views and keeps the floating panel hidden by default", async () => {
        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toHaveTextContent("Today");
        expect(
            screen.getByRole("button", { name: "Task category" }),
        ).toHaveTextContent("All");
        fireEvent.click(screen.getByRole("button", { name: "Task view" }));
        expect(
            screen
                .getAllByRole("button", { name: "Today" })
                .some((button) => button.classList.contains("filter-option")),
        ).toBe(true);
        expect(
            screen.getByRole("button", { name: "Upcoming" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "All tasks" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Completed" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Overdue" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Close" }),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("Create task")).not.toBeInTheDocument();
        expect(screen.queryByText("Show on calendar")).not.toBeInTheDocument();
    });

    it("shows a no time tasks view with a create task button", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled",
                user_id: "user-1",
                list_id: null,
                title: "Inbox task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        expect(
            await screen.findByRole("button", { name: "Create task" }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Create task" }));

        expect(
            await screen.findByRole("heading", {
                name: "Create task",
            }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Title")).toHaveValue("");
    });

    it("reorders no time tasks by dragging within the list", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled-a",
                user_id: "user-1",
                list_id: null,
                title: "First task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-b",
                user_id: "user-1",
                list_id: null,
                title: "Second task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-c",
                user_id: "user-1",
                list_id: null,
                title: "Third task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-09T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        const taskRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(taskRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("First task"),
            expect.stringContaining("Second task"),
            expect.stringContaining("Third task"),
        ]);

        mockTaskRowRects(Array.from(taskRows));

        fireEvent.mouseDown(taskRows[1], {
            button: 0,
            buttons: 1,
            clientX: 20,
            clientY: 80,
        });
        fireEvent.mouseMove(taskRows[1], {
            buttons: 1,
            clientX: 20,
            clientY: 10,
        });
        fireEvent.mouseUp(taskRows[1]);

        const reorderedRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("Second task"),
            expect.stringContaining("First task"),
            expect.stringContaining("Third task"),
        ]);
        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-unscheduled-b",
                { unscheduled_order: 0 },
            ),
        );
        expect(
            window.localStorage.getItem("calendar-unscheduled-order"),
        ).toContain("task-unscheduled-b");

    });

    it("highlights the no time list while dragging a task to reorder", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled-a",
                user_id: "user-1",
                list_id: null,
                title: "First task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-b",
                user_id: "user-1",
                list_id: null,
                title: "Second task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        const taskRows = document.querySelectorAll(".task-list .task-row");
        mockTaskRowRects(Array.from(taskRows));

        fireEvent.mouseDown(taskRows[1], {
            button: 0,
            buttons: 1,
            clientX: 20,
            clientY: 80,
        });
        fireEvent.mouseMove(taskRows[1], {
            buttons: 1,
            clientX: 20,
            clientY: 10,
        });

        expect(
            screen.getByLabelText("unscheduled tasks"),
        ).toHaveClass("drag-target-list-active");
        expect(
            screen.getByLabelText("Scheduled tasks calendar"),
        ).not.toHaveClass("drag-target-calendar-active");
    });

    it("moves the drag-to-calendar button to the right and highlights the calendar while pressed", async () => {
        mocks.tasks = [
            {
                id: "task-schedule-a",
                user_id: "user-1",
                list_id: null,
                title: "Schedule me",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        const taskRow = document.querySelector(
            '[data-task-id="task-schedule-a"][role="button"]',
        ) as HTMLElement;
        const orderButtons = taskRow.querySelectorAll(".task-order-actions button");

        expect(orderButtons).toHaveLength(2);
        expect(orderButtons[0]).toHaveAttribute("aria-label", "Move Schedule me to top");
        expect(orderButtons[1]).toHaveAttribute("aria-label", "Drag to calendar");

        fireEvent.pointerDown(screen.getByRole("button", { name: "Drag to calendar" }), {
            button: 0,
        });
        fireEvent.mouseDown(screen.getByRole("button", { name: "Drag to calendar" }), {
            button: 0,
        });

        expect(
            screen.getByLabelText("Scheduled tasks calendar"),
        ).toHaveClass("drag-target-calendar-active");
        expect(
            screen.getByLabelText("unscheduled tasks"),
        ).not.toHaveClass("drag-target-list-active");
    });

    it("shows the drag-to-calendar affordance in today, upcoming, and inbox rows", async () => {
        const now = new Date();
        const todayStart = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            10,
            0,
            0,
            0,
        );
        const upcomingStart = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
            10,
            0,
            0,
            0,
        );
        mocks.tasks = [
            makeTask({
                id: "task-today-drag",
                title: "Today draggable",
                scheduled_start: todayStart.toISOString(),
                scheduled_end: new Date(
                    todayStart.getTime() + 60 * 60 * 1000,
                ).toISOString(),
            }),
            makeTask({
                id: "task-upcoming-drag",
                title: "Upcoming draggable",
                scheduled_start: upcomingStart.toISOString(),
                scheduled_end: new Date(
                    upcomingStart.getTime() + 60 * 60 * 1000,
                ).toISOString(),
            }),
            makeTask({
                id: "task-inbox-drag",
                title: "Inbox draggable",
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                list_id: null,
            }),
        ];

        render(<App />);

        const todayRow = await screen.findByRole("button", {
            name: /Today draggable/i,
        });
        expect(
            todayRow.querySelector(".task-drag-handle"),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Task view" }));
        fireEvent.click(screen.getByRole("button", { name: "Upcoming" }));
        const upcomingRow = await screen.findByRole("button", {
            name: /Upcoming draggable/i,
        });
        expect(
            upcomingRow.querySelector(".task-drag-handle"),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Task view" }));
        fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
        await screen.findByText("Inbox draggable");
        const inboxRow = document.querySelector(
            '[data-task-id="task-inbox-drag"][role="button"]',
        ) as HTMLElement;
        expect(
            inboxRow.querySelector(".task-drag-handle"),
        ).toBeInTheDocument();
    });

    it("reorders no time tasks with explicit priority controls", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled-a",
                user_id: "user-1",
                list_id: null,
                title: "First task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-b",
                user_id: "user-1",
                list_id: null,
                title: "Second task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Move Second task to top" }),
        );

        const reorderedRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("Second task"),
            expect.stringContaining("First task"),
        ]);
        expect(
            window.localStorage.getItem("calendar-unscheduled-order"),
        ).toContain("task-unscheduled-b");
        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-unscheduled-b",
                { unscheduled_order: 0 },
            ),
        );
    });

    it("moves a no time task directly to the top", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled-a",
                user_id: "user-1",
                list_id: null,
                title: "First task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-b",
                user_id: "user-1",
                list_id: null,
                title: "Second task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-c",
                user_id: "user-1",
                list_id: null,
                title: "Third task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-09T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Move Third task to top" }),
        );

        const reorderedRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("Third task"),
            expect.stringContaining("First task"),
            expect.stringContaining("Second task"),
        ]);
        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-unscheduled-c",
                { unscheduled_order: 0 },
            ),
        );
    });

    it("keeps no time task order after reload once it is saved", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled-a",
                user_id: "user-1",
                list_id: null,
                title: "First task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-b",
                user_id: "user-1",
                list_id: null,
                title: "Second task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-c",
                user_id: "user-1",
                list_id: null,
                title: "Third task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                created_at: "2026-05-09T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
        ];

        const rendered = render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Move Third task to top" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-unscheduled-c",
                { unscheduled_order: 0 },
            ),
        );

        rendered.unmount();
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        const reorderedRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("Third task"),
            expect.stringContaining("First task"),
            expect.stringContaining("Second task"),
        ]);
    });

    it("keeps no time task order from the backend after localStorage is cleared", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled-a",
                user_id: "user-1",
                list_id: null,
                title: "First task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: 2,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-b",
                user_id: "user-1",
                list_id: null,
                title: "Second task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: 0,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-c",
                user_id: "user-1",
                list_id: null,
                title: "Third task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: 1,
                created_at: "2026-05-09T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
        ];

        window.localStorage.removeItem("calendar-unscheduled-order");

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        const reorderedRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("Second task"),
            expect.stringContaining("Third task"),
            expect.stringContaining("First task"),
        ]);
    });

    it("applies category visibility filtering in the inbox view", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled-work",
                user_id: "user-1",
                list_id: "list-1",
                title: "Work inbox",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
            {
                id: "task-unscheduled-home",
                user_id: "user-1",
                list_id: "list-2",
                title: "Home inbox",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task category" }),
        );
        fireEvent.click(screen.getByRole("switch", { name: "All" }));
        fireEvent.click(screen.getByRole("switch", { name: "Work" }));
        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        expect(screen.queryByText("Work inbox")).not.toBeInTheDocument();
        expect(await screen.findByText("Home inbox")).toBeInTheDocument();
    });

    it("disables the time-grid scroll reset when navigating dates", async () => {
        render(<App />);

        expect(mocks.fullCalendarProps.scrollTimeReset).toBe(false);
    });

    it("sets up an external drag handle in the no time tasks view", async () => {
        mocks.tasks = [
            {
                id: "task-unscheduled",
                user_id: "user-1",
                list_id: null,
                title: "Inbox task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        mocks.draggableConstruct.mockClear();

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        await waitFor(() => expect(mocks.draggableConstruct).toHaveBeenCalled());
        expect(mocks.draggableConstruct).toHaveBeenCalledWith(
            expect.any(HTMLElement),
            expect.objectContaining({
                itemSelector: ".task-drag-handle[data-task-id]",
            }),
        );
        expect(
            await screen.findByRole("button", {
                name: "Drag to calendar",
            }),
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: "Open create task" }),
        );
        expect(
            await screen.findByRole("heading", { name: "Create task" }),
        ).toBeInTheDocument();
        const constructCountAfterOpeningPanel =
            mocks.draggableConstruct.mock.calls.length;
        const destroyCountAfterOpeningPanel =
            mocks.draggableDestroy.mock.calls.length;
        expect(destroyCountAfterOpeningPanel).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.draggableConstruct.mock.calls.length).toBeGreaterThan(
                constructCountAfterOpeningPanel,
            ),
        );
    });

    it("hides and restores the sidebar", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Hide sidebar" }),
        );

        expect(
            screen.queryByRole("button", { name: "Task view" }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "⇥" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "⇥" }));

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
    });

    it("updates the calendar size after the sidebar transition finishes", async () => {
        render(<App />);

        expect(await screen.findByRole("button", { name: "Hide sidebar" }))
            .toBeInTheDocument();
        mocks.fullCalendarUpdateSize.mockClear();

        fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
        await waitFor(() =>
            expect(mocks.fullCalendarUpdateSize).toHaveBeenCalled(),
        );
        const resizeCountAfterCollapse =
            mocks.fullCalendarUpdateSize.mock.calls.length;

        fireEvent.click(screen.getByRole("button", { name: "⇥" }));
        await waitFor(() =>
            expect(mocks.fullCalendarUpdateSize.mock.calls.length).toBeGreaterThan(
                resizeCountAfterCollapse,
            ),
        );
    });

    it("restores a saved sidebar width", async () => {
        window.localStorage.setItem("calendar-sidebar-width", "360");

        render(<App />);

        expect(await screen.findByRole("separator", { name: "Resize sidebar" }))
            .toBeInTheDocument();
        expect(screen.getByRole("main")).toHaveStyle(
            "--sidebar-width: 360px",
        );
    });

    it("replaces filters with the task form while creating and restores them on close", async () => {
        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("region", { name: "today tasks" }),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Open create task" }),
        );

        expect(
            screen.getByRole("heading", { name: "Create task" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Task view" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Task category" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("region", { name: "today tasks" }),
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Close" }));

        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Task view" }),
            ).toBeInTheDocument(),
        );
        expect(
            screen.getByRole("button", { name: "Task category" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("region", { name: "today tasks" }),
        ).toBeInTheDocument();
    });

    it("lets existing categories open an edit form with color and name", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task category" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Edit Work" }));

        expect(screen.getByLabelText("Edit category name")).toHaveValue("Work");
        expect(screen.getByLabelText("Edit category color")).toHaveValue(
            "#2f80ed",
        );
    });

    it("resets category edit mode when the dropdown is folded", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task category" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Edit Work" }));
        expect(screen.getByLabelText("Edit category name")).toHaveValue("Work");

        fireEvent.click(screen.getByRole("button", { name: "Task category" }));
        fireEvent.click(screen.getByRole("button", { name: "Task category" }));

        expect(
            screen.queryByLabelText("Edit category name"),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    it("deletes a category from the inline edit form", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task category" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Edit Work" }));
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        await waitFor(() =>
            expect(mocks.deleteTaskList).toHaveBeenCalledWith("list-1"),
        );
        await waitFor(() =>
            expect(
                screen.queryByLabelText("Edit category name"),
            ).not.toBeInTheDocument(),
        );
    });

    it("shows webhook inputs from a button and saves the webhook settings", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Settings" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Webhook" }),
        );

        expect(await screen.findByLabelText("Message format")).toHaveAttribute(
            "placeholder",
            "Task due: {title}\nWhen: {when}\nNotes: {notes}\nOpen app: {app_url}",
        );

        fireEvent.change(await screen.findByLabelText("Webhook URL"), {
            target: { value: "https://discord.example/webhook" },
        });
        fireEvent.change(screen.getByLabelText("Message format"), {
            target: { value: "Task {title}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        await waitFor(() =>
            expect(mocks.updateSettings).toHaveBeenCalledWith({
                discord_webhook_url: "https://discord.example/webhook",
                discord_message_template: "Task {title}",
            }),
        );
        await waitFor(() =>
            expect(
                screen.queryByLabelText("Webhook URL"),
            ).not.toBeInTheDocument(),
        );
    });

    it("tests webhook settings from the expanded webhook form", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Settings" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Webhook" }),
        );
        fireEvent.change(await screen.findByLabelText("Webhook URL"), {
            target: { value: "https://discord.example/webhook" },
        });
        fireEvent.change(screen.getByLabelText("Message format"), {
            target: { value: "Task {title}" },
        });

        fireEvent.click(screen.getByRole("button", { name: "Test" }));

        await waitFor(() =>
            expect(mocks.testSettings).toHaveBeenCalledWith({
                discord_webhook_url: "https://discord.example/webhook",
                discord_message_template: "Task {title}",
            }),
        );
        expect(
            await screen.findByText("Test webhook sent"),
        ).toBeInTheDocument();
    });

    it("uses the default webhook format when the message format is blank", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Settings" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Webhook" }),
        );
        fireEvent.change(await screen.findByLabelText("Webhook URL"), {
            target: { value: "https://discord.example/webhook" },
        });
        fireEvent.change(screen.getByLabelText("Message format"), {
            target: { value: "   " },
        });

        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        await waitFor(() =>
            expect(mocks.updateSettings).toHaveBeenCalledWith({
                discord_webhook_url: "https://discord.example/webhook",
                discord_message_template: null,
            }),
        );
    });

    it("tests webhook settings with the default format when the message format is blank", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Settings" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Webhook" }),
        );
        fireEvent.change(await screen.findByLabelText("Webhook URL"), {
            target: { value: "https://discord.example/webhook" },
        });
        fireEvent.change(screen.getByLabelText("Message format"), {
            target: { value: "   " },
        });

        fireEvent.click(screen.getByRole("button", { name: "Test" }));

        await waitFor(() =>
            expect(mocks.testSettings).toHaveBeenCalledWith({
                discord_webhook_url: "https://discord.example/webhook",
                discord_message_template: null,
            }),
        );
    });

    it("closes the create panel when opening webhook settings", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Open create task" }),
        );
        expect(
            await screen.findByRole("heading", { name: "Create task" }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Settings" }));
        fireEvent.click(
            screen.getByRole("button", { name: "Webhook" }),
        );

        await waitForElementToBeRemoved(() =>
            screen.queryByRole("heading", { name: "Create task" }),
        );
        expect(await screen.findByLabelText("Webhook URL")).toBeInTheDocument();
    });

    it("closes the create panel after saving a task", async () => {
        const expectedRepeatUntil = new Date(
            "2026-06-08T23:59:59.999",
        ).toISOString();

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Open create task" }),
        );
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "New task" },
        });
        await selectTaskDropdownOption("Repeat", "Daily");
        fireEvent.change(screen.getByLabelText("Every"), {
            target: { value: "3" },
        });
        await selectTaskDropdownOption("Ends", "On date");
        fireEvent.change(screen.getByLabelText("Repeat end date"), {
            target: { value: "2026-06-08" },
        });
        await selectTaskDropdownOption("Reminder", "Custom");
        await selectTaskDropdownOption("Reminder unit", "Hours");
        fireEvent.change(screen.getByLabelText("Reminder amount"), {
            target: { value: "4" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() =>
            expect(
                screen.queryByRole("heading", { name: "Create task" }),
            ).not.toBeInTheDocument(),
        );
        expect(
            screen.getByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Task category" }),
        ).toBeInTheDocument();
        expect(mocks.createTask).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "New task",
                recurrence_rule: `FREQ=DAILY;INTERVAL=3;UNTIL=${expectedRepeatUntil}`,
                notification_enabled: true,
                notification_offset_minutes: 240,
                notification_channel: "discord",
            }),
        );
    });

    it("blocks creating a recurring task when until is before the start date", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Open create task" }),
        );
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "New task" },
        });
        await selectTaskDropdownOption("Repeat", "Daily");
        await selectTaskDropdownOption("Ends", "On date");
        fireEvent.change(screen.getByLabelText("Repeat end date"), {
            target: { value: "2026-05-07" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        expect(
            await screen.findByText(
                "Repeat until must be on or after the start date",
            ),
        ).toBeInTheDocument();
        expect(mocks.createTask).not.toHaveBeenCalled();
        expect(
            screen.getByRole("heading", { name: "Create task" }),
        ).toBeInTheDocument();
    });

    it("closes the edit panel after saving a task", async () => {
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
                id: "task-edit",
                user_id: "user-1",
                list_id: "list-1",
                title: "Edit me",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: /Edit me/i }),
        );
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "Edited task" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        await waitFor(() =>
            expect(
                screen.queryByRole("heading", { name: "Edit task" }),
            ).not.toBeInTheDocument(),
        );
        expect(
            screen.getByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Task category" }),
        ).toBeInTheDocument();
        expect(mocks.updateTask).toHaveBeenCalledWith(
            "task-edit",
            expect.objectContaining({ title: "Edited task" }),
        );
    });

    it("cancels edit changes without saving", async () => {
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
                id: "task-edit-cancel",
                user_id: "user-1",
                list_id: "list-1",
                title: "Cancel me",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: /Cancel me/i }),
        );
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "Edited but canceled" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        await waitFor(() =>
            expect(
                screen.queryByRole("heading", { name: "Edit task" }),
            ).not.toBeInTheDocument(),
        );
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    it("undoes a sidebar task edit and category change", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-edit-undo",
                title: "Original task",
                list_id: "list-1",
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: /Original task/i }),
        );
        fireEvent.change(await screen.findByLabelText("Title"), {
            target: { value: "Edited task" },
        });
        await selectTaskDropdownOption("Category", "None");
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        await screen.findByRole("button", { name: "Undo task change" });
        fireEvent.click(
            screen.getByRole("button", { name: "Undo task change" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenLastCalledWith(
                "task-edit-undo",
                expect.objectContaining({
                    title: "Original task",
                    list_id: "list-1",
                }),
            ),
        );
    });

    it("blocks saving an edit when repeat until is before the start date", async () => {
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
                id: "task-edit-recurring",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring task",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-edit-until",
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", {
                name: /^Toggle Recurring task Recurring task/i,
            }),
        );
        await screen.findByRole("heading", { name: "Edit task" });
        await selectTaskDropdownOption("Ends", "On date");
        fireEvent.change(screen.getByLabelText("Repeat end date"), {
            target: { value: "2026-05-07" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        expect(
            await screen.findByText(
                "Repeat until must be on or after the start date",
            ),
        ).toBeInTheDocument();
        expect(mocks.updateTask).not.toHaveBeenCalled();
        expect(screen.getByRole("heading", { name: "Edit task" })).toBeInTheDocument();
    });

    it("moves a scheduled task back to no time from the edit form", async () => {
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
                id: "task-no-time-edit",
                user_id: "user-1",
                list_id: "list-1",
                title: "Reschedule me",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: /Reschedule me/i }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Remove schedule" }),
        );

        expect(screen.getByLabelText("Start date")).toHaveValue("");
        expect(screen.getByLabelText("Start time")).toHaveValue("");
        expect(screen.getByLabelText("End date")).toHaveValue("");
        expect(screen.getByLabelText("End time")).toHaveValue("");

        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-no-time-edit",
                expect.objectContaining({
                    scheduled_start: null,
                    scheduled_end: null,
                }),
            ),
        );
    });

    it("saves notifications from the dropdown as minutes", async () => {
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
                id: "task-notify-edit",
                user_id: "user-1",
                list_id: "list-1",
                title: "Notify me",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                notification_enabled: true,
                notification_offset_minutes: 15,
                notification_channel: "discord",
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: /Notify me/i }),
        );

        expect(screen.getByRole("button", { name: "Reminder" })).toHaveTextContent(
            "Custom",
        );
        expect(
            screen.getByRole("button", { name: "Reminder unit" }),
        ).toHaveTextContent("Minutes");
        expect(screen.getByLabelText("Reminder amount")).toHaveValue(15);

        await selectTaskDropdownOption("Reminder unit", "Days");
        fireEvent.change(screen.getByLabelText("Reminder amount"), {
            target: { value: "2" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-notify-edit",
                expect.objectContaining({
                    notification_offset_minutes: 2880,
                }),
            ),
        );
    });

    it("undoes completing a task", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-complete-undo",
                title: "Complete undo task",
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("checkbox", {
                name: "Toggle Complete undo task",
            }),
        );

        await screen.findByRole("button", { name: "Undo task change" });
        fireEvent.click(
            screen.getByRole("button", { name: "Undo task change" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenLastCalledWith(
                "task-complete-undo",
                expect.objectContaining({
                    completed: false,
                }),
            ),
        );
    });

    it("clears an existing undo when a new task is created", async () => {
        const createDeferredTask = createDeferred<Record<string, unknown>>();
        mocks.createTask.mockImplementationOnce(
            async () =>
                (await createDeferredTask.promise) as { id: string },
        );
        mocks.tasks = [
            makeTask({
                id: "task-create-clear-undo",
                title: "Create clear undo",
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("checkbox", {
                name: "Toggle Create clear undo",
            }),
        );
        await screen.findByRole("button", { name: "Undo task change" });

        fireEvent.click(
            screen.getByRole("button", { name: "Open create task" }),
        );
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "New task" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() =>
            expect(
                screen.queryByRole("button", { name: "Undo task change" }),
            ).not.toBeInTheDocument(),
        );

        createDeferredTask.resolve({
            id: "task-created",
            user_id: "user-1",
        });

        await waitFor(() =>
            expect(
                screen.queryByRole("button", { name: "Undo task change" }),
            ).not.toBeInTheDocument(),
        );
    });

    it("replaces an existing undo when another undoable edit is saved", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-replace-undo-complete",
                title: "Complete me first",
            }),
            makeTask({
                id: "task-replace-undo-edit",
                title: "Original task",
                list_id: "list-1",
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("checkbox", {
                name: "Toggle Complete me first",
            }),
        );
        await screen.findByRole("button", { name: "Undo task change" });

        fireEvent.click(
            await screen.findByRole("button", { name: /Original task/i }),
        );
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "Edited task" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        expect(
            screen.queryByRole("button", { name: "Undo task change" }),
        ).not.toBeInTheDocument();

        await screen.findByRole("button", { name: "Undo task change" });
    });

    it("closes the edit panel after deleting a task", async () => {
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
                id: "task-delete",
                user_id: "user-1",
                list_id: "list-1",
                title: "Delete me",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: /Delete me/i }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        await waitFor(() =>
            expect(
                screen.queryByRole("heading", { name: "Edit task" }),
            ).not.toBeInTheDocument(),
        );
        expect(
            screen.getByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Task category" }),
        ).toBeInTheDocument();
        expect(mocks.deleteTask).toHaveBeenCalledWith("task-delete", {
            deleteScope: "single",
        });
    });

    it("undoes deleting a task by recreating its snapshot", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-delete-undo",
                title: "Delete undo task",
                notes: "Restore these notes",
                list_id: null,
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: /Delete undo task/i }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        await screen.findByRole("button", { name: "Undo task change" });
        fireEvent.click(
            screen.getByRole("button", { name: "Undo task change" }),
        );

        await waitFor(() =>
            expect(mocks.createTask).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    title: "Delete undo task",
                    notes: "Restore these notes",
                    list_id: null,
                }),
            ),
        );
    });

    it("asks how to delete a recurring task before removing it", async () => {
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
                id: "task-recurring",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring task",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-1",
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", {
                name: /^Toggle Recurring task Recurring task/i,
            }),
        );
        fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

        expect(
            await screen.findByRole("dialog", {
                name: "Delete recurring task",
            }),
        ).toBeInTheDocument();
        expect(mocks.deleteTask).not.toHaveBeenCalled();

        expect(
            screen.getByRole("button", { name: "Delete only this" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Delete the recurrsive" }),
        ).toBeInTheDocument();
        expect(
            within(
                screen.getByRole("dialog", {
                    name: "Delete recurring task",
                }),
            ).getByRole("button", { name: "Cancel" }),
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: "Delete the recurrsive" }),
        );

        await waitFor(() =>
            expect(mocks.deleteTask).toHaveBeenCalledWith("task-recurring", {
                deleteScope: "following",
            }),
        );
    });

    it("does not offer undo after deleting a recurring occurrence", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-recurring-delete-undo",
                title: "Recurring delete undo",
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-delete-undo",
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", {
                name: /^Toggle Recurring delete undo Recurring delete undo/i,
            }),
        );
        fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Delete only this" }),
        );

        expect(
            await screen.findByRole("button", {
                name: "Dismiss undo message",
            }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Undo task change" }),
        ).not.toBeInTheDocument();
    });

    it("asks how to edit a recurring task before updating the whole series", async () => {
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
                id: "task-recurring-edit",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring task",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-edit-1",
                notification_enabled: true,
                notification_offset_minutes: 15,
                notification_channel: "discord",
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", {
                name: /^Toggle Recurring task Recurring task/i,
            }),
        );
        fireEvent.change(await screen.findByLabelText("Title"), {
            target: { value: "Renamed recurring task" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        expect(
            await screen.findByRole("dialog", {
                name: "Edit recurring task",
            }),
        ).toBeInTheDocument();
        expect(mocks.updateTask).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole("button", { name: "Edit all recurring tasks" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-recurring-edit",
                expect.objectContaining({
                    title: "Renamed recurring task",
                }),
                { updateScope: "series" },
            ),
        );
    });

    it("asks how to edit a recurring task when changing notes", async () => {
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
                id: "task-recurring-notes",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring note task",
                notes: "Original recurring note",
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-notes-1",
                notification_enabled: true,
                notification_offset_minutes: 15,
                notification_channel: "discord",
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                notification_sent_at: null,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "2026-05-08T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", {
                name: /^Toggle Recurring note task Recurring note task/i,
            }),
        );
        fireEvent.change(await screen.findByLabelText("Notes"), {
            target: { value: "Updated recurring note" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        expect(
            await screen.findByRole("dialog", {
                name: "Edit recurring task",
            }),
        ).toBeInTheDocument();
        expect(mocks.updateTask).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole("button", { name: "Edit all recurring tasks" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-recurring-notes",
                expect.objectContaining({
                    notes: "Updated recurring note",
                }),
                { updateScope: "series" },
            ),
        );
    });

    it("undoes a safe single-occurrence recurring note edit without recurrence fields", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-recurring-note-undo",
                title: "Recurring note undo",
                notes: "Original note",
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-note-undo",
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", {
                name: /^Toggle Recurring note undo Recurring note undo/i,
            }),
        );
        fireEvent.change(await screen.findByLabelText("Notes"), {
            target: { value: "Updated note" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Edit only this" }),
        );

        await screen.findByRole("button", { name: "Undo task change" });
        fireEvent.click(
            screen.getByRole("button", { name: "Undo task change" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenLastCalledWith(
                "task-recurring-note-undo",
                { notes: "Original note" },
            ),
        );
    });

    it("undoes completing a recurring occurrence without recurrence fields", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-recurring-complete-undo",
                title: "Recurring completion undo",
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-complete-undo",
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("checkbox", {
                name: "Toggle Recurring completion undo",
            }),
        );

        await screen.findByRole("button", { name: "Undo task change" });
        fireEvent.click(
            screen.getByRole("button", { name: "Undo task change" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenLastCalledWith(
                "task-recurring-complete-undo",
                { completed: false },
            ),
        );
    });

    it("asks how to edit a recurring task when dragging it on the calendar", async () => {
        mocks.tasks = [
            {
                id: "task-recurring-drag",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring drag task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-09T09:00:00Z",
                scheduled_end: "2026-05-09T10:00:00Z",
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-drag-1",
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Drop recurring task" }),
        );

        expect(
            await screen.findByRole("dialog", {
                name: "Edit recurring task",
            }),
        ).toBeInTheDocument();
        expect(mocks.updateTask).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(mocks.dragRevert).toHaveBeenCalledTimes(1);
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    it("does not offer undo after detaching a recurring occurrence by dragging it", async () => {
        mocks.tasks = [
            {
                id: "task-recurring-drag",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring drag task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-09T09:00:00Z",
                scheduled_end: "2026-05-09T10:00:00Z",
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-drag-1",
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                notification_sent_at: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Drop recurring task" }),
        );
        fireEvent.click(
            await screen.findByRole("button", { name: "Edit only this" }),
        );

        expect(
            await screen.findByRole("button", {
                name: "Dismiss undo message",
            }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Undo task change" }),
        ).not.toBeInTheDocument();
    });

    it("removes the old undo before a non-undoable recurring delete completes", async () => {
        const deleteDeferredTask = createDeferred<undefined>();
        mocks.deleteTask.mockImplementationOnce(
            async () => await deleteDeferredTask.promise,
        );
        mocks.tasks = [
            makeTask({
                id: "task-recurring-delete-lifecycle-complete",
                title: "Recurring lifecycle complete",
            }),
            makeTask({
                id: "task-recurring-delete-lifecycle",
                title: "Recurring delete lifecycle",
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-delete-lifecycle",
            }),
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("checkbox", {
                name: "Toggle Recurring lifecycle complete",
            }),
        );
        await screen.findByRole("button", { name: "Undo task change" });

        fireEvent.click(
            await screen.findByRole("button", {
                name: /^Toggle Recurring delete lifecycle/i,
            }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));
        fireEvent.click(
            screen.getByRole("button", { name: "Delete only this" }),
        );

        expect(
            screen.queryByRole("button", { name: "Undo task change" }),
        ).not.toBeInTheDocument();

        deleteDeferredTask.resolve(undefined);
    });

    it("refreshes the calendar after editing all recurring tasks from a drag prompt", async () => {
        mocks.tasks = [
            {
                id: "task-recurring-drag",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring drag task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-09T09:00:00Z",
                scheduled_end: "2026-05-09T10:00:00Z",
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-drag-1",
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        expect(mocks.fullCalendarMount).toHaveBeenCalledTimes(1);

        fireEvent.click(
            await screen.findByRole("button", { name: "Drop recurring task" }),
        );

        fireEvent.click(
            await screen.findByRole("button", {
                name: "Edit all recurring tasks",
            }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-recurring-drag",
                {
                    scheduled_start: "2026-05-10T09:30:00.000Z",
                    scheduled_end: "2026-05-10T10:30:00.000Z",
                    all_day: false,
                },
                { updateScope: "series" },
            ),
        );

        expect(mocks.fullCalendarMount).toHaveBeenCalledTimes(1);
    });

    it("shows only the first recurring occurrence in the task list", async () => {
        mocks.tasks = [
            {
                id: "task-recurring-1",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-08T10:00:00Z",
                scheduled_end: "2026-05-08T11:00:00Z",
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-1",
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
            {
                id: "task-recurring-2",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-09T10:00:00Z",
                scheduled_end: "2026-05-09T11:00:00Z",
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-1",
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        const recurringRows = await screen.findAllByRole("button", {
            name: /Recurring task/i,
        });

        expect(recurringRows).toHaveLength(1);
    });

    it("shows category visibility toggles and keeps the dropdown open", async () => {
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
        const todayAtEleven = new Date(todayAtTen.getTime() + 60 * 60 * 1000);
        mocks.tasks = [
            {
                id: "task-unclassified",
                user_id: "user-1",
                list_id: null,
                title: "Unclassified task",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: todayAtEleven.toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
            {
                id: "task-classified",
                user_id: "user-1",
                list_id: "list-1",
                title: "Classified task",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: todayAtEleven.toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toHaveTextContent("Today");

        fireEvent.click(screen.getByRole("button", { name: "Task category" }));

        const allSwitch = screen.getByRole("switch", { name: "All" });
        const noneSwitch = screen.getByRole("switch", { name: "None" });
        const workSwitch = screen.getByRole("switch", { name: "Work" });

        expect(allSwitch).toHaveAttribute("aria-checked", "true");
        expect(noneSwitch).toBeDisabled();
        expect(workSwitch).toBeDisabled();
        expect(screen.getByText("Unclassified task")).toBeInTheDocument();
        expect(screen.getByText("Classified task")).toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events.map((event) => event.id)).toEqual(
                expect.arrayContaining(["task-unclassified", "task-classified"]),
            ),
        );

        fireEvent.click(allSwitch);

        expect(
            screen.getByRole("listbox", { name: "Task category options" }),
        ).toBeInTheDocument();
        expect(noneSwitch).not.toBeDisabled();
        expect(workSwitch).not.toBeDisabled();
        expect(noneSwitch).toHaveAttribute("aria-checked", "true");
        expect(workSwitch).toHaveAttribute("aria-checked", "true");
        expect(
            screen.getByRole("button", { name: "Task category" }),
        ).toHaveTextContent("Filtered");

        fireEvent.click(noneSwitch);

        expect(
            screen.getByRole("listbox", { name: "Task category options" }),
        ).toBeInTheDocument();
        expect(screen.queryByText("Unclassified task")).not.toBeInTheDocument();
        expect(screen.getByText("Classified task")).toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events.map((event) => event.id)).toEqual([
                "task-classified",
            ]),
        );

        fireEvent.click(workSwitch);

        expect(screen.queryByText("Classified task")).not.toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(0),
        );

        fireEvent.click(noneSwitch);
        expect(screen.getByText("Unclassified task")).toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events.map((event) => event.id)).toEqual([
                "task-unclassified",
            ]),
        );

        fireEvent.click(allSwitch);
        expect(allSwitch).toHaveAttribute("aria-checked", "true");
        expect(noneSwitch).toBeDisabled();
        expect(workSwitch).toBeDisabled();
        expect(screen.getByText("Unclassified task")).toBeInTheDocument();
        expect(screen.getByText("Classified task")).toBeInTheDocument();

        fireEvent.click(allSwitch);
        expect(workSwitch).toHaveAttribute("aria-checked", "false");
        expect(noneSwitch).toHaveAttribute("aria-checked", "true");
        expect(screen.getByText("Unclassified task")).toBeInTheDocument();
        expect(screen.queryByText("Classified task")).not.toBeInTheDocument();
    });

    it("opens category edit mode from the row", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task category" }),
        );

        expect(screen.getByRole("button", { name: "Edit Work" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Edit Work" }));
        expect(screen.getByLabelText("Edit category name")).toHaveValue("Work");
    });

    it("keeps the category switch from opening edit mode", async () => {
        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task category" }),
        );

        fireEvent.click(screen.getByRole("switch", { name: "All" }));
        fireEvent.click(screen.getByRole("switch", { name: "Work" }));

        expect(
            screen.queryByLabelText("Edit category name"),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("switch", { name: "Work" })).toBeInTheDocument();
    });

    it("maps explicit all-day tasks to all-day calendar events", async () => {
        mocks.tasks = [
            {
                id: "task-1",
                user_id: "user-1",
                list_id: "list-1",
                title: "All day task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-08T00:00:00",
                scheduled_end: null,
                all_day: true,
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );
        expect(mocks.fullCalendarProps.events[0]).toMatchObject({
            title: "All day task",
            allDay: true,
            start: "2026-05-08",
            end: "2026-05-09",
        });
    });

    it("keeps explicit midnight timed tasks in the timed grid", async () => {
        mocks.tasks = [
            {
                id: "task-midnight",
                user_id: "user-1",
                list_id: "list-1",
                title: "Midnight timed task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-07T16:00:00Z",
                scheduled_end: "2026-05-07T17:00:00Z",
                all_day: false,
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );
        expect(mocks.fullCalendarProps.events[0]).toMatchObject({
            title: "Midnight timed task",
            allDay: false,
            start: "2026-05-07T16:00:00Z",
            end: "2026-05-07T17:00:00Z",
        });
    });

    it("saves an all-day drop as a date-only task when FullCalendar omits the end", async () => {
        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Drop all-day task" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith("task-1", {
                scheduled_start: "2026-05-18T00:00:00",
                scheduled_end: null,
                all_day: true,
            }),
        );
    });

    it("undoes a calendar drag reschedule", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-1",
                title: "Drag undo task",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Drop all-day task" }),
        );

        await screen.findByRole("button", { name: "Undo task change" });
        fireEvent.click(screen.getByRole("button", { name: "Undo task change" }));

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenLastCalledWith(
                "task-1",
                expect.objectContaining({
                    scheduled_start: "2026-05-08T09:00:00.000Z",
                    scheduled_end: "2026-05-08T10:00:00.000Z",
                    all_day: false,
                }),
            ),
        );
    });

    it("undoes a calendar resize", async () => {
        mocks.tasks = [
            makeTask({
                id: "task-1",
                title: "Resize undo task",
                scheduled_start: "2026-05-08T09:00:00.000Z",
                scheduled_end: "2026-05-08T10:00:00.000Z",
            }),
        ];

        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Resize task" }));

        await screen.findByRole("button", { name: "Undo task change" });
        fireEvent.click(
            screen.getByRole("button", { name: "Undo task change" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenLastCalledWith(
                "task-1",
                expect.objectContaining({
                    scheduled_start: "2026-05-08T09:00:00.000Z",
                    scheduled_end: "2026-05-08T10:00:00.000Z",
                }),
            ),
        );
    });

    it("schedules a task when dropped from the task list onto the calendar", async () => {
        mocks.tasks = [
            {
                id: "task-external",
                user_id: "user-1",
                list_id: null,
                title: "Inbox task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                notification_sent_at: null,
                created_at: "",
                updated_at: "",
                completed_at: null,
            },
        ];

        render(<App />);

        await screen.findByText("No tasks in this view.");

        fireEvent.click(
            await screen.findByRole("button", { name: "Receive external task" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith("task-external", {
                scheduled_start: "2026-05-08T13:00:00.000Z",
                scheduled_end: "2026-05-08T14:00:00.000Z",
                all_day: false,
            }),
        );
    });

    it("updates the no time list and calendar immediately after dropping a task into the calendar", async () => {
        mocks.tasks = [
            {
                id: "task-external",
                user_id: "user-1",
                list_id: null,
                title: "Inbox task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                notification_sent_at: null,
                created_at: "",
                updated_at: "",
                completed_at: null,
            },
        ];
        mocks.updateTask.mockImplementationOnce(
            async (taskId: string, input: Record<string, unknown> = {}) => ({
                ...mocks.tasks.find((task) => task.id === taskId),
                ...input,
            }),
        );

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );
        expect(await screen.findByText("Inbox task")).toBeInTheDocument();

        fireEvent.click(
            await screen.findByRole("button", { name: "Receive external task" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith("task-external", {
                scheduled_start: "2026-05-08T13:00:00.000Z",
                scheduled_end: "2026-05-08T14:00:00.000Z",
                all_day: false,
            }),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );
            await waitFor(() =>
                expect(mocks.listTasks).toHaveBeenCalledTimes(3),
            );
        expect(mocks.fullCalendarRefetchEvents).not.toHaveBeenCalled();
        expect(
            mocks.fullCalendarProps.events[0],
        ).toMatchObject({
            id: "task-external",
            title: "Inbox task",
            start: "2026-05-08T13:00:00.000Z",
            end: "2026-05-08T14:00:00.000Z",
        });
        expect(screen.getByTestId("calendar-event-task-external")).toHaveTextContent(
            "Inbox task",
        );
        expect(screen.getByLabelText("unscheduled tasks")).not.toHaveTextContent(
            "Inbox task",
        );
    });

    it("keeps a dropped no time task visible on the calendar when a stale refresh resolves after scheduling", async () => {
        const unscheduledTask = {
            id: "task-external",
            user_id: "user-1",
            list_id: null,
            title: "Inbox task",
            notes: null,
            completed: false,
            scheduled_start: null,
            scheduled_end: null,
            due_at: null,
            timezone: "Asia/Taipei",
            priority: null,
            unscheduled_order: 0,
            recurrence_rule: null,
            recurrence_series_id: null,
            notification_enabled: false,
            notification_offset_minutes: 0,
            notification_channel: null,
            notification_sent_at: null,
            created_at: "2026-05-08T00:00:00.000Z",
            updated_at: "2026-05-08T00:00:00.000Z",
            completed_at: null,
        };
        const scheduledTask = {
            ...unscheduledTask,
            scheduled_start: "2026-05-08T13:00:00.000Z",
            scheduled_end: "2026-05-08T14:00:00.000Z",
            unscheduled_order: null,
            updated_at: "2026-05-08T13:00:01.000Z",
        };
        const staleRefresh = createDeferred<Array<Record<string, unknown>>>();
        mocks.tasks = [unscheduledTask];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );
        expect(await screen.findByText("Inbox task")).toBeInTheDocument();

        mocks.listTasks.mockImplementationOnce(() => staleRefresh.promise);
        fireEvent.click(screen.getByRole("button", { name: "Next period" }));
        expect(await screen.findByText("Refreshing tasks...")).toBeInTheDocument();

        mocks.updateTask.mockResolvedValueOnce(scheduledTask);
        fireEvent.click(
            await screen.findByRole("button", { name: "Receive external task" }),
        );

        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );

        staleRefresh.resolve([unscheduledTask]);
        await waitFor(() =>
            expect(screen.queryByText("Refreshing tasks...")).not.toBeInTheDocument(),
        );

        expect(mocks.fullCalendarProps.events).toHaveLength(1);
        expect(mocks.fullCalendarProps.events[0]).toMatchObject({
            id: "task-external",
            start: "2026-05-08T13:00:00.000Z",
            end: "2026-05-08T14:00:00.000Z",
        });
        expect(screen.getByTestId("calendar-event-task-external")).toHaveTextContent(
            "Inbox task",
        );
        expect(screen.getByLabelText("unscheduled tasks")).not.toHaveTextContent(
            "Inbox task",
        );
    });

    it("opens the create form with a date-only value when clicking the all-day lane", async () => {
        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Open all-day create task" }),
        );

        expect(
            screen.getByRole("heading", { name: "Create task" }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Start date")).toBeInTheDocument();
        expect(screen.getByDisplayValue("2026-05-08")).toBeInTheDocument();
        expect(screen.getByLabelText("Start time")).toBeInTheDocument();
        expect(screen.getByLabelText("Start time")).toHaveValue("");
        expect(screen.getByLabelText("End date")).toBeInTheDocument();
        expect(screen.getByLabelText("End date")).toHaveValue("");
        expect(screen.getByLabelText("End time")).toBeInTheDocument();
        expect(screen.getByLabelText("End time")).toHaveValue("");

        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "Date-only task" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() =>
            expect(mocks.createTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: "Date-only task",
                    scheduled_start: "2026-05-08T00:00:00",
                    scheduled_end: null,
                    all_day: true,
                    due_at: null,
                }),
            ),
        );
    });

    it("does not show schedule removal in the create form", async () => {
        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Open all-day create task" }),
        );

        expect(
            screen.queryByRole("button", { name: "Remove schedule" }),
        ).not.toBeInTheDocument();

        expect(screen.getByLabelText("Start date")).toHaveValue("2026-05-08");
        expect(screen.getByLabelText("Start time")).toHaveValue("");
        expect(screen.getByLabelText("End date")).toHaveValue("");
        expect(screen.getByLabelText("End time")).toHaveValue("");

        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "Date-only task" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() =>
            expect(mocks.createTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: "Date-only task",
                    scheduled_start: "2026-05-08T00:00:00",
                    scheduled_end: null,
                    all_day: true,
                    due_at: null,
                }),
            ),
        );
    });

    it("filters upcoming tasks by a custom day window including today", async () => {
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
                id: "task-today",
                user_id: "user-1",
                list_id: "list-1",
                title: "Today task",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
            {
                id: "task-later",
                user_id: "user-1",
                list_id: "list-1",
                title: "Later task",
                notes: null,
                completed: false,
                scheduled_start: sevenDaysOutAtTen.toISOString(),
                scheduled_end: new Date(
                    sevenDaysOutAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
            {
                id: "task-outside",
                user_id: "user-1",
                list_id: "list-1",
                title: "Outside task",
                notes: null,
                completed: false,
                scheduled_start: eightDaysOutAtTen.toISOString(),
                scheduled_end: new Date(
                    eightDaysOutAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task view" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Upcoming" }));

        expect(screen.getByDisplayValue(7)).toBeInTheDocument();
        expect(screen.getByText("Today task")).toBeInTheDocument();
        expect(screen.getByText("Later task")).toBeInTheDocument();
        expect(screen.queryByText("Outside task")).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole("spinbutton"), {
            target: { value: "1" },
        });

        expect(screen.getByText("Today task")).toBeInTheDocument();
        expect(screen.queryByText("Later task")).not.toBeInTheDocument();
    });

    it("toggles completed tasks visibility from settings", async () => {
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
        const todayAtEleven = new Date(todayAtTen.getTime() + 60 * 60 * 1000);
        mocks.tasks = [
            {
                id: "task-completed-visible",
                user_id: "user-1",
                list_id: "list-1",
                title: "Completed today task",
                notes: null,
                completed: true,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: todayAtEleven.toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: now.toISOString(),
            },
        ];

        render(<App />);

        expect(await screen.findByText("Completed today task")).toBeInTheDocument();

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(
            screen.getByRole("switch", { name: "Show completed tasks" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Return to sidebar" }),
        );

        await waitFor(() =>
            expect(
                screen.queryByText("Completed today task"),
            ).not.toBeInTheDocument(),
        );

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(screen.getByRole("switch", { name: "Show completed tasks" }));
        fireEvent.click(
            screen.getByRole("button", { name: "Return to sidebar" }),
        );

        await waitFor(() =>
            expect(screen.getByText("Completed today task")).toBeInTheDocument(),
        );
    });

    it("hides completed scheduled tasks from the calendar when the setting is off", async () => {
        mocks.tasks = [
            {
                id: "task-calendar-completed",
                user_id: "user-1",
                list_id: "list-1",
                title: "Calendar completed task",
                notes: null,
                completed: true,
                scheduled_start: "2026-05-08T10:00:00Z",
                scheduled_end: "2026-05-08T11:00:00Z",
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: "2026-05-08T11:00:00Z",
            },
        ];

        render(<App />);

        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(
            screen.getByRole("switch", { name: "Show completed tasks" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Return to sidebar" }),
        );

        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(0),
        );

        fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
        fireEvent.click(
            screen.getByRole("switch", { name: "Show completed tasks" }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Return to sidebar" }),
        );

        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );
    });

    it("shows overdue tasks and hides completed ones in the today view", async () => {
        const now = new Date();
        const overdueStart = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 1,
            10,
            0,
            0,
            0,
        );
        const overdueEnd = new Date(overdueStart.getTime() + 60 * 60 * 1000);
        const duePast = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 1,
            8,
            0,
            0,
            0,
        );
        mocks.tasks = [
            {
                id: "task-overdue",
                user_id: "user-1",
                list_id: "list-1",
                title: "Overdue task",
                notes: null,
                completed: false,
                scheduled_start: overdueStart.toISOString(),
                scheduled_end: overdueEnd.toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
            {
                id: "task-due",
                user_id: "user-1",
                list_id: "list-1",
                title: "Due task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: duePast.toISOString(),
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
            {
                id: "task-completed",
                user_id: "user-1",
                list_id: "list-1",
                title: "Completed overdue task",
                notes: null,
                completed: true,
                scheduled_start: overdueStart.toISOString(),
                scheduled_end: overdueEnd.toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: now.toISOString(),
            },
        ];

        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toHaveTextContent("Today");
        expect(screen.getByText("Overdue task")).toBeInTheDocument();
        expect(screen.getByText("Due task")).toBeInTheDocument();
        expect(
            screen.queryByText("Completed overdue task"),
        ).not.toBeInTheDocument();
    });

    it("deletes a task from the task list context menu on right click", async () => {
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
                id: "task-delete",
                user_id: "user-1",
                list_id: "list-1",
                title: "Delete me",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                completed_at: null,
            },
        ];

        render(<App />);

        const taskRow = await screen.findByRole("button", {
            name: /Delete me/i,
        });
        fireEvent.contextMenu(taskRow, { clientX: 120, clientY: 180 });

        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        await waitFor(() =>
            expect(mocks.deleteTask).toHaveBeenCalledWith("task-delete", {
                deleteScope: "single",
            }),
        );
    });

    it("closes the edit panel when deleting the open task from the context menu", async () => {
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
        const todayAtEleven = new Date(todayAtTen.getTime() + 60 * 60 * 1000);
        mocks.tasks = [
            {
                id: "task-delete-open",
                user_id: "user-1",
                list_id: "list-1",
                title: "Delete open task",
                notes: null,
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: todayAtEleven.toISOString(),
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toHaveTextContent("Today");

        const taskRow = await screen.findByRole("button", {
            name: /Delete open task/i,
        });

        fireEvent.click(taskRow);
        expect(
            await screen.findByRole("heading", { name: "Edit task" }),
        ).toBeInTheDocument();

        fireEvent.contextMenu(taskRow, { clientX: 120, clientY: 180 });
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        await waitFor(() =>
            expect(mocks.deleteTask).toHaveBeenCalledWith("task-delete-open", {
                deleteScope: "single",
            }),
        );
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Task view" }),
            ).toBeInTheDocument(),
        );
        expect(
            screen.getByRole("button", { name: "Task category" }),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(
                screen.queryByRole("heading", { name: "Edit task" }),
            ).not.toBeInTheDocument(),
        );
        await waitFor(() =>
            expect(
                screen.queryByRole("button", { name: "Delete" }),
            ).not.toBeInTheDocument(),
        );
        await waitFor(() =>
            expect(
                screen.getByRole("region", { name: "today tasks" }),
            ).toBeInTheDocument(),
        );
    });

    it("duplicates a no time task below the original and closes the context menu", async () => {
        mocks.tasks = [
            {
                id: "task-no-time-a",
                user_id: "user-1",
                list_id: "list-1",
                title: "Inbox A",
                notes: "Original note",
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: true,
                notification_offset_minutes: 60,
                notification_channel: "discord",
                timezone: "Asia/Taipei",
                priority: 1,
                unscheduled_order: 0,
                notification_sent_at: null,
                created_at: "2026-05-07T00:00:00.000Z",
                updated_at: "2026-05-07T00:00:00.000Z",
                completed_at: null,
            },
            {
                id: "task-no-time-b",
                user_id: "user-1",
                list_id: "list-1",
                title: "Inbox B",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                recurrence_rule: null,
                recurrence_series_id: null,
                notification_enabled: false,
                notification_offset_minutes: 0,
                notification_channel: null,
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: 1,
                notification_sent_at: null,
                created_at: "2026-05-08T00:00:00.000Z",
                updated_at: "2026-05-08T00:00:00.000Z",
                completed_at: null,
            },
        ];

        mocks.createTask.mockImplementationOnce(async (input: Record<string, unknown> = {}) => ({
            id: "task-no-time-copy",
            user_id: "user-1",
            list_id: (input.list_id as string | null | undefined) ?? null,
            title: String(input.title ?? "Inbox A"),
            notes: (input.notes as string | null | undefined) ?? null,
            completed: Boolean(input.completed ?? false),
            scheduled_start:
                (input.scheduled_start as string | null | undefined) ?? null,
            scheduled_end:
                (input.scheduled_end as string | null | undefined) ?? null,
            due_at: (input.due_at as string | null | undefined) ?? null,
            timezone:
                (input.timezone as string | undefined) ?? "Asia/Taipei",
            priority: (input.priority as number | null | undefined) ?? null,
            unscheduled_order:
                (input.unscheduled_order as number | null | undefined) ?? null,
            recurrence_rule:
                (input.recurrence_rule as string | null | undefined) ?? null,
            recurrence_series_id: null,
            notification_enabled: Boolean(input.notification_enabled ?? false),
            notification_offset_minutes: Number(
                input.notification_offset_minutes ?? 0,
            ),
            notification_channel:
                (input.notification_channel as string | null | undefined) ??
                null,
            notification_sent_at: null,
            created_at: "2026-05-08T00:00:01.000Z",
            updated_at: "2026-05-08T00:00:01.000Z",
            completed_at: null,
        }));

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "Inbox" }),
        );

        await waitFor(() =>
            expect(
                document.querySelector(
                    '[data-task-id="task-no-time-a"][role="button"]',
                ),
            ).not.toBeNull(),
        );
        fireEvent.contextMenu(
            document.querySelector(
                '[data-task-id="task-no-time-a"][role="button"]',
            ) as HTMLElement,
            { clientX: 120, clientY: 180 },
        );

        fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

        await waitFor(() =>
            expect(mocks.createTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: "Inbox A",
                    list_id: "list-1",
                    notes: "Original note",
                    completed: false,
                    notification_enabled: true,
                    notification_offset_minutes: 60,
                    notification_channel: "discord",
                    unscheduled_order: 0,
                }),
            ),
        );
        await waitFor(() =>
            expect(
                screen.queryByRole("button", { name: "Duplicate" }),
            ).not.toBeInTheDocument(),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(0),
        );
        await waitFor(() =>
            expect(
                Array.from(
                    document.querySelectorAll(".task-list .task-row"),
                ).map((row) => row.getAttribute("data-task-id")),
            ).toEqual([
                "task-no-time-a",
                "task-no-time-copy",
                "task-no-time-b",
            ]),
        );
    });

    it("duplicates a scheduled task and shows it on the calendar immediately", async () => {
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
        const scheduledTask = {
            id: "task-scheduled-original",
            user_id: "user-1",
            list_id: "list-1",
            title: "Calendar task",
            notes: "Scheduled note",
            completed: false,
            scheduled_start: todayAtTen.toISOString(),
            scheduled_end: new Date(
                todayAtTen.getTime() + 60 * 60 * 1000,
            ).toISOString(),
            due_at: new Date(
                todayAtTen.getTime() + 2 * 60 * 60 * 1000,
            ).toISOString(),
            recurrence_rule: null,
            recurrence_series_id: null,
            notification_enabled: true,
            notification_offset_minutes: 15,
            notification_channel: "discord",
            timezone: "Asia/Taipei",
            priority: 2,
            unscheduled_order: null,
            notification_sent_at: null,
            created_at: "2026-05-08T00:00:00Z",
            updated_at: "2026-05-08T00:00:00Z",
            completed_at: null,
        };
        mocks.tasks = [scheduledTask];

        mocks.createTask.mockImplementationOnce(async (input: Record<string, unknown> = {}) => ({
            id: "task-scheduled-copy",
            user_id: "user-1",
            list_id: (input.list_id as string | null | undefined) ?? null,
            title: String(input.title ?? "Calendar task"),
            notes: (input.notes as string | null | undefined) ?? null,
            completed: Boolean(input.completed ?? false),
            scheduled_start:
                (input.scheduled_start as string | null | undefined) ?? null,
            scheduled_end:
                (input.scheduled_end as string | null | undefined) ?? null,
            due_at: (input.due_at as string | null | undefined) ?? null,
            timezone:
                (input.timezone as string | undefined) ?? "Asia/Taipei",
            priority: (input.priority as number | null | undefined) ?? null,
            unscheduled_order:
                (input.unscheduled_order as number | null | undefined) ?? null,
            recurrence_rule:
                (input.recurrence_rule as string | null | undefined) ?? null,
            recurrence_series_id: null,
            notification_enabled: Boolean(input.notification_enabled ?? false),
            notification_offset_minutes: Number(
                input.notification_offset_minutes ?? 0,
            ),
            notification_channel:
                (input.notification_channel as string | null | undefined) ??
                null,
            notification_sent_at: null,
            created_at: "2026-05-08T00:00:01.000Z",
            updated_at: "2026-05-08T00:00:01.000Z",
            completed_at: null,
        }));

        render(<App />);

        await waitFor(() =>
            expect(
                document.querySelector(
                    '[data-task-id="task-scheduled-original"][role="button"]',
                ),
            ).not.toBeNull(),
        );
        fireEvent.contextMenu(
            document.querySelector(
                '[data-task-id="task-scheduled-original"][role="button"]',
            ) as HTMLElement,
            { clientX: 100, clientY: 160 },
        );
        fireEvent.click(
            await screen.findByRole("button", { name: "Duplicate" }),
        );

        await waitFor(() =>
            expect(mocks.createTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: "Calendar task",
                    scheduled_start: todayAtTen.toISOString(),
                    scheduled_end: new Date(
                        todayAtTen.getTime() + 60 * 60 * 1000,
                    ).toISOString(),
                    due_at: new Date(
                        todayAtTen.getTime() + 2 * 60 * 60 * 1000,
                    ).toISOString(),
                    completed: false,
                    notification_enabled: true,
                    notification_offset_minutes: 15,
                    notification_channel: "discord",
                }),
            ),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(2),
        );
        expect(
            mocks.fullCalendarProps.events.some(
                (event) => event.id === "task-scheduled-copy",
            ),
        ).toBe(true);
        expect(
            screen.queryByRole("button", { name: "Duplicate" }),
        ).not.toBeInTheDocument();
    });

    it("duplicates a recurring task as a normal non-recurring task", async () => {
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
                id: "task-recurring-original",
                user_id: "user-1",
                list_id: "list-1",
                title: "Recurring task",
                notes: "Keep this note",
                completed: false,
                scheduled_start: todayAtTen.toISOString(),
                scheduled_end: new Date(
                    todayAtTen.getTime() + 60 * 60 * 1000,
                ).toISOString(),
                due_at: null,
                recurrence_rule: "FREQ=DAILY;INTERVAL=1",
                recurrence_series_id: "series-1",
                notification_enabled: true,
                notification_offset_minutes: 240,
                notification_channel: "discord",
                timezone: "Asia/Taipei",
                priority: null,
                unscheduled_order: null,
                notification_sent_at: null,
                created_at: "2026-05-08T00:00:00Z",
                updated_at: "2026-05-08T00:00:00Z",
                completed_at: null,
            },
        ];

        mocks.createTask.mockImplementationOnce(async (input: Record<string, unknown> = {}) => ({
            id: "task-recurring-copy",
            user_id: "user-1",
            list_id: (input.list_id as string | null | undefined) ?? null,
            title: String(input.title ?? "Recurring task"),
            notes: (input.notes as string | null | undefined) ?? null,
            completed: Boolean(input.completed ?? false),
            scheduled_start:
                (input.scheduled_start as string | null | undefined) ?? null,
            scheduled_end:
                (input.scheduled_end as string | null | undefined) ?? null,
            due_at: (input.due_at as string | null | undefined) ?? null,
            timezone:
                (input.timezone as string | undefined) ?? "Asia/Taipei",
            priority: (input.priority as number | null | undefined) ?? null,
            unscheduled_order:
                (input.unscheduled_order as number | null | undefined) ?? null,
            recurrence_rule:
                (input.recurrence_rule as string | null | undefined) ?? null,
            recurrence_series_id: null,
            notification_enabled: Boolean(input.notification_enabled ?? false),
            notification_offset_minutes: Number(
                input.notification_offset_minutes ?? 0,
            ),
            notification_channel:
                (input.notification_channel as string | null | undefined) ??
                null,
            notification_sent_at: null,
            created_at: "2026-05-08T00:00:01.000Z",
            updated_at: "2026-05-08T00:00:01.000Z",
            completed_at: null,
        }));

        render(<App />);

        await waitFor(() =>
            expect(
                document.querySelector(
                    '[data-task-id="task-recurring-original"][role="button"]',
                ),
            ).not.toBeNull(),
        );
        fireEvent.contextMenu(
            document.querySelector(
                '[data-task-id="task-recurring-original"][role="button"]',
            ) as HTMLElement,
            { clientX: 100, clientY: 160 },
        );
        fireEvent.click(
            await screen.findByRole("button", { name: "Duplicate" }),
        );

        await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
        const duplicateCalls = mocks.createTask.mock.calls as unknown[][];
        const duplicateCall = duplicateCalls[0];
        if (!duplicateCall) {
            throw new Error("Expected duplicate create call");
        }
        const duplicateInput = duplicateCall[0] as Record<string, unknown>;
        expect(duplicateInput.title).toBe("Recurring task");
        expect(duplicateInput.completed).toBe(false);
        expect(duplicateInput.notification_enabled).toBe(true);
        expect(duplicateInput.notification_offset_minutes).toBe(240);
        expect(duplicateInput.notification_channel).toBe("discord");
        expect(duplicateInput).not.toHaveProperty("recurrence_rule");

        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(2),
        );
        expect(
            mocks.fullCalendarProps.events.some(
                (event) => event.id === "task-recurring-copy",
            ),
        ).toBe(true);
        expect(
            mocks.fullCalendarProps.events.find(
                (event) => event.id === "task-recurring-copy",
            )?.extendedProps?.task?.recurrence_rule,
        ).toBeNull();
        expect(
            screen.queryByRole("button", { name: "Duplicate" }),
        ).not.toBeInTheDocument();
    });

    it("cycles calendar views in order", async () => {
        render(<App />);

        const cycleButton = await screen.findByRole("button", { name: "Week" });
        await act(async () => {
            fireEvent.click(cycleButton);
        });
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument(),
        );

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Day" }));
        });
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument(),
        );

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Month" }));
        });
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Week" })).toBeInTheDocument(),
        );
    });
});
