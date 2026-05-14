import {
    fireEvent,
    render,
    screen,
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
        scrollTimeReset: undefined as boolean | undefined,
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
    createTask: vi.fn(async () => ({ id: "task-new" })),
    deleteTask: vi.fn(async () => undefined),
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
            eventDrop,
            eventContent,
            events,
            initialView,
            scrollTimeReset,
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
            }) => ReactNode;
            events?: EventInput[];
            initialView?: string;
            scrollTimeReset?: boolean;
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
        mocks.fullCalendarProps.scrollTimeReset = scrollTimeReset;
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

            return (
                <div key={id} data-testid={`calendar-event-${id}`}>
                    {eventContent?.({
                        event: {
                            id,
                            title,
                            start,
                            end,
                            allDay: Boolean(event.allDay),
                            extendedProps: event.extendedProps ?? {},
                        },
                    }) ?? title}
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
                                start: new Date("2026-05-07T16:00:00Z"),
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
    completeTask: vi.fn(),
    uncompleteTask: vi.fn(),
    mapTaskToEvent: vi.fn(),
    deleteTask: mocks.deleteTask,
}));

vi.mock("./api/taskLists", () => ({
    listTaskLists: () => Promise.resolve(mocks.taskLists),
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

describe("App", () => {
    beforeEach(() => {
        window.localStorage.clear();
        window.localStorage.setItem("calendar-auth-token", "test-token");
        mocks.tasks = [];
        mocks.listTasks.mockClear();
        mocks.listTasks.mockImplementation(() =>
            Promise.resolve([...mocks.tasks].sort(sortTasksForApiMock)),
        );
        mocks.createTask.mockClear();
        mocks.deleteTask.mockClear();
        mocks.deleteTaskList.mockClear();
        createdTaskCounter = 0;
        mocks.createTask.mockImplementation(
            async (input: Record<string, unknown> = {}) => ({
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
                    (input.scheduled_end as string | null | undefined) ?? null,
                due_at: (input.due_at as string | null | undefined) ?? null,
                timezone:
                    (input.timezone as string | undefined) ?? "Asia/Taipei",
                priority:
                    (input.priority as number | null | undefined) ?? null,
                unscheduled_order:
                    (input.unscheduled_order as number | null | undefined) ??
                    null,
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
                    (input.notification_channel as string | null | undefined) ??
                    null,
                notification_sent_at: null,
                created_at: "2026-05-08T00:00:00.000Z",
                updated_at: "2026-05-08T00:00:00.000Z",
                completed_at: null,
            }),
        );
        mocks.fullCalendarMount.mockClear();
        mocks.fullCalendarRefetchEvents.mockClear();
        mocks.fullCalendarProps.events = [];
        mocks.dragRevert.mockClear();
        mocks.draggableConstruct.mockClear();
        mocks.draggableDestroy.mockClear();
        mocks.updateTask.mockClear();
        mocks.updateSettings.mockClear();
        mocks.testSettings.mockClear();
        mocks.login.mockClear();
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
        expect(
            screen.queryByRole("button", { name: "Close" }),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("Create task")).not.toBeInTheDocument();
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
            await screen.findByRole("button", { name: "No time tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
        );

        const reorderedRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("Second task"),
            expect.stringContaining("Third task"),
            expect.stringContaining("First task"),
        ]);
    });

    it("ignores category filtering in the no time tasks view", async () => {
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
        fireEvent.click(screen.getByRole("button", { name: "Work" }));
        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "No time tasks" }),
        );

        expect(await screen.findByText("Work inbox")).toBeInTheDocument();
        expect(screen.getByText("Home inbox")).toBeInTheDocument();
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
            await screen.findByRole("button", { name: "No time tasks" }),
        );

        await waitFor(() =>
            expect(mocks.draggableConstruct).toHaveBeenCalledTimes(1),
        );
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
        await waitFor(() =>
            expect(mocks.draggableDestroy).toHaveBeenCalledTimes(1),
        );

        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.draggableConstruct).toHaveBeenCalledTimes(2),
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
            expect(mocks.fullCalendarUpdateSize).toHaveBeenCalledTimes(1),
        );

        fireEvent.click(screen.getByRole("button", { name: "⇥" }));
        await waitFor(() =>
            expect(mocks.fullCalendarUpdateSize).toHaveBeenCalledTimes(2),
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
            screen.getByRole("button", { name: "Webhook settings" }),
        );

        fireEvent.change(screen.getByLabelText("Webhook URL"), {
            target: { value: "https://discord.example/webhook" },
        });
        fireEvent.change(screen.getByLabelText("Message format"), {
            target: { value: "Task {title}" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
            screen.getByRole("button", { name: "Webhook settings" }),
        );
        fireEvent.change(screen.getByLabelText("Webhook URL"), {
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
            screen.getByRole("button", { name: "Webhook settings" }),
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
        fireEvent.change(screen.getByLabelText("Repeat"), {
            target: { value: "DAILY" },
        });
        fireEvent.change(screen.getByLabelText("Every"), {
            target: { value: "3" },
        });
        fireEvent.change(screen.getByLabelText("Until"), {
            target: { value: "2026-06-08" },
        });
        fireEvent.change(screen.getByLabelText("Notification"), {
            target: { value: "HOURS" },
        });
        fireEvent.change(screen.getByLabelText("Before"), {
            target: { value: "4" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
            await screen.findByRole("button", { name: "Open all-day create task" }),
        );
        fireEvent.change(screen.getByLabelText("Title"), {
            target: { value: "New task" },
        });
        fireEvent.change(screen.getByLabelText("Repeat"), {
            target: { value: "DAILY" },
        });
        fireEvent.change(screen.getByLabelText("Until"), {
            target: { value: "2026-05-07" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
        fireEvent.change(screen.getByLabelText("Until"), {
            target: { value: "2026-05-07" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
            screen.getByRole("button", { name: "Clear time" }),
        );

        expect(screen.getByLabelText("Start date")).toHaveValue("");
        expect(screen.getByLabelText("Start time")).toHaveValue("");
        expect(screen.getByLabelText("End date")).toHaveValue("");
        expect(screen.getByLabelText("End time")).toHaveValue("");

        fireEvent.click(screen.getByRole("button", { name: "Save" }));

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

        expect(screen.getByLabelText("Notification")).toHaveValue("MINUTES");
        expect(screen.getByLabelText("Before")).toHaveValue(15);

        fireEvent.change(screen.getByLabelText("Notification"), {
            target: { value: "DAYS" },
        });
        fireEvent.change(screen.getByLabelText("Before"), {
            target: { value: "2" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith(
                "task-notify-edit",
                expect.objectContaining({
                    notification_offset_minutes: 2880,
                }),
            ),
        );
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
            screen.getByRole("button", { name: "Cancel" }),
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
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

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

    it("filters tasks without a category from the category dropdown", async () => {
        mocks.tasks = [
            {
                id: "task-unclassified",
                user_id: "user-1",
                list_id: null,
                title: "Unclassified task",
                notes: null,
                completed: false,
                scheduled_start: null,
                scheduled_end: null,
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
                scheduled_start: null,
                scheduled_end: null,
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task view" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "All tasks" }));

        fireEvent.click(screen.getByRole("button", { name: "Task category" }));
        fireEvent.click(screen.getByRole("button", { name: "Unclassified" }));

        expect(
            screen.getByRole("button", { name: "Task category" }),
        ).toHaveTextContent("Unclassified");
        expect(screen.getByText("Unclassified task")).toBeInTheDocument();
        expect(screen.queryByText("Classified task")).not.toBeInTheDocument();
    });

    it("marks midnight day-span tasks as all-day calendar events", async () => {
        mocks.tasks = [
            {
                id: "task-1",
                user_id: "user-1",
                list_id: "list-1",
                title: "All day task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-07T16:00:00Z",
                scheduled_end: "2026-05-08T16:00:00Z",
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

    it("saves an all-day drop with a one-day end when FullCalendar omits the end", async () => {
        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Drop all-day task" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith("task-1", {
                scheduled_start: "2026-05-07T16:00:00.000Z",
                scheduled_end: "2026-05-08T16:00:00.000Z",
            }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
        );
        expect(await screen.findByText("Inbox task")).toBeInTheDocument();

        fireEvent.click(
            await screen.findByRole("button", { name: "Receive external task" }),
        );

        await waitFor(() =>
            expect(mocks.updateTask).toHaveBeenCalledWith("task-external", {
                scheduled_start: "2026-05-08T13:00:00.000Z",
                scheduled_end: "2026-05-08T14:00:00.000Z",
            }),
        );
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );
        await waitFor(() =>
            expect(mocks.listTasks).toHaveBeenCalledTimes(2),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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

    it("opens the create form with a full-day range when clicking the all-day lane", async () => {
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
        expect(screen.getByLabelText("End date")).toBeInTheDocument();
        expect(screen.getByDisplayValue("2026-05-09")).toBeInTheDocument();
        expect(screen.getByLabelText("End time")).toBeInTheDocument();
        expect(screen.getAllByDisplayValue("00:00")).toHaveLength(2);
    });

    it("clears scheduled fields in the create form when moving a task to no time", async () => {
        render(<App />);

        expect(
            await screen.findByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Open all-day create task" }),
        );

        fireEvent.click(
            screen.getByRole("button", { name: "Clear time" }),
        );

        expect(screen.getByLabelText("Start date")).toHaveValue("");
        expect(screen.getByLabelText("Start time")).toHaveValue("");
        expect(screen.getByLabelText("End date")).toHaveValue("");
        expect(screen.getByLabelText("End time")).toHaveValue("");
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

    it("shows overdue tasks and hides completed ones in the overdue view", async () => {
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

        fireEvent.click(
            await screen.findByRole("button", { name: "Task view" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Overdue" }));

        expect(
            screen.getByRole("button", { name: "Task view" }),
        ).toHaveTextContent("Overdue");
        expect(screen.getByText("Overdue task")).toBeInTheDocument();
        expect(screen.getByText("Due task")).toBeInTheDocument();
        expect(
            screen.queryByText("Completed overdue task"),
        ).not.toBeInTheDocument();
    });

    it("toggles completed tasks on the calendar from the completed view", async () => {
        mocks.tasks = [
            {
                id: "task-completed",
                user_id: "user-1",
                list_id: "list-1",
                title: "Completed calendar task",
                notes: null,
                completed: true,
                scheduled_start: "2026-05-08T10:00:00Z",
                scheduled_end: "2026-05-08T11:00:00Z",
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: "2026-05-08T11:00:00Z",
            },
        ];

        render(<App />);

        fireEvent.click(
            await screen.findByRole("button", { name: "Task view" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Completed" }));

        expect(screen.getByText("Show on calendar")).toBeInTheDocument();
        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );
        expect(mocks.fullCalendarProps.events[0]).toMatchObject({
            backgroundColor: "rgba(47, 128, 237, 0.32)",
            borderColor: "#2f80ed",
        });

        fireEvent.click(screen.getByLabelText("Show on calendar"));

        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(0),
        );

        fireEvent.click(screen.getByLabelText("Show on calendar"));

        await waitFor(() =>
            expect(mocks.fullCalendarProps.events).toHaveLength(1),
        );
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
        mocks.tasks = [
            {
                id: "task-delete-open",
                user_id: "user-1",
                list_id: "list-1",
                title: "Delete open task",
                notes: null,
                completed: false,
                scheduled_start: "2026-05-08T10:00:00Z",
                scheduled_end: "2026-05-08T11:00:00Z",
                due_at: null,
                timezone: "Asia/Taipei",
                priority: null,
                created_at: "2026-05-07T00:00:00Z",
                updated_at: "2026-05-07T00:00:00Z",
                completed_at: null,
            },
        ];

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Task view" }));
        fireEvent.click(
            await screen.findByRole("button", { name: "All tasks" }),
        );

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
                screen.getByRole("region", { name: "all tasks" }),
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
            await screen.findByRole("button", { name: "No time tasks" }),
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

    it("opens a year input from the month view title", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Month" }));
        fireEvent.click(screen.getByRole("button", { name: "2026" }));

        expect(screen.getByLabelText("Calendar year")).toHaveValue(2026);
    });
});
