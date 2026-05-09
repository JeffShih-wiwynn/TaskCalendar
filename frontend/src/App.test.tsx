import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EventInput } from "@fullcalendar/core";
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useState,
    type ForwardedRef,
} from "react";

import { App } from "./App";

const mocks = vi.hoisted(() => ({
    fullCalendarProps: { events: [] as EventInput[] },
    fullCalendarMount: vi.fn(),
    dragRevert: vi.fn(),
    draggableConstruct: vi.fn(),
    draggableDestroy: vi.fn(),
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
    createTask: vi.fn(async () => ({ id: "task-new" })),
    deleteTask: vi.fn(async () => undefined),
    deleteTaskList: vi.fn(async () => undefined),
    updateTask: vi.fn(async () => ({})),
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
            events,
            initialView,
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
            events?: EventInput[];
            initialView?: string;
        },
        ref: ForwardedRef<{
            getApi: () => {
                prev: () => void;
                next: () => void;
                today: () => void;
                changeView: (view: string) => void;
                gotoDate: (date: Date) => void;
                getDate: () => Date;
            };
        }>,
    ) {
        const [view, setView] = useState(initialView ?? "timeGridWeek");
        const [currentDate, setCurrentDate] = useState(
            new Date("2026-05-08T00:00:00Z"),
        );

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
            </>
        );
    }),
}));

vi.mock("./api/tasks", () => ({
    listTasks: () => Promise.resolve(mocks.tasks),
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

describe("App", () => {
    beforeEach(() => {
        window.localStorage.clear();
        mocks.tasks = [];
        mocks.createTask.mockClear();
        mocks.deleteTask.mockClear();
        mocks.deleteTaskList.mockClear();
        mocks.fullCalendarMount.mockClear();
        mocks.fullCalendarProps.events = [];
        mocks.dragRevert.mockClear();
        mocks.draggableConstruct.mockClear();
        mocks.draggableDestroy.mockClear();
        mocks.updateTask.mockClear();
        mocks.updateSettings.mockClear();
        mocks.testSettings.mockClear();
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
        expect(
            window.localStorage.getItem("calendar-unscheduled-order"),
        ).toContain("task-unscheduled-b");

        fireEvent.click(
            screen.getByRole("button", { name: "Move Second task down" }),
        );

        const reorderedBackRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedBackRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("First task"),
            expect.stringContaining("Second task"),
            expect.stringContaining("Third task"),
        ]);

        mockTaskRowRects(Array.from(reorderedBackRows));
        fireEvent.mouseDown(reorderedBackRows[0], {
            button: 0,
            buttons: 1,
            clientX: 20,
            clientY: 10,
        });
        fireEvent.mouseMove(window, {
            buttons: 1,
            clientX: 20,
            clientY: 65,
        });
        mockTaskRowRects(
            Array.from(document.querySelectorAll(".task-list .task-row")),
        );
        fireEvent.mouseMove(window, {
            buttons: 1,
            clientX: 20,
            clientY: 130,
        });
        fireEvent.mouseUp(window);

        const reorderedDownRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedDownRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("Second task"),
            expect.stringContaining("Third task"),
            expect.stringContaining("First task"),
        ]);
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
            screen.getByRole("button", { name: "Move Second task up" }),
        );

        const reorderedRows = document.querySelectorAll(".task-list .task-row");
        expect(Array.from(reorderedRows).map((row) => row.textContent)).toEqual([
            expect.stringContaining("Second task"),
            expect.stringContaining("First task"),
        ]);
        expect(
            window.localStorage.getItem("calendar-unscheduled-order"),
        ).toContain("task-unscheduled-b");
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

    it("keeps row dragging dedicated to ordering in the no time tasks view", async () => {
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

        expect(mocks.draggableConstruct).not.toHaveBeenCalled();
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

        expect(
            screen.getByRole("button", { name: "Task view" }),
        ).toBeInTheDocument();
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

        expect(screen.queryByRole("heading", { name: "Create task" })).not.toBeInTheDocument();
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

        await waitFor(() =>
            expect(mocks.fullCalendarMount).toHaveBeenCalledTimes(2),
        );
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
                screen.queryByRole("heading", { name: "Edit task" }),
            ).not.toBeInTheDocument(),
        );
        await waitFor(() =>
            expect(
                screen.queryByRole("button", { name: "Delete" }),
            ).not.toBeInTheDocument(),
        );
    });

    it("opens a year input from the month view title", async () => {
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Month" }));
        fireEvent.click(screen.getByRole("button", { name: "2026" }));

        expect(screen.getByLabelText("Calendar year")).toHaveValue(2026);
    });
});
