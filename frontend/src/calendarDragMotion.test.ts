import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revertCalendarEventWithMotion, startCalendarDragMotion, startExternalTaskDragMotion } from "./calendarDragMotion";

describe("calendar drag motion", () => {
    let frames: Map<number, FrameRequestCallback>;
    let nextFrame: number;
    let reduced: boolean;
    const animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => { cancel: () => void }>(
        () => ({ cancel: vi.fn() }),
    );

    function tick() {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(0));
    }

    function element(className: string, rect: () => DOMRect) {
        const node = document.createElement("div");
        node.className = className;
        node.getBoundingClientRect = rect;
        node.animate = animate as unknown as HTMLElement["animate"];
        return node;
    }

    beforeEach(() => {
        frames = new Map();
        nextFrame = 0;
        reduced = false;
        animate.mockClear();
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
        vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.unstubAllGlobals();
    });

    it("interpolates same-column movement and a remounted cross-column preview", () => {
        const root = document.createElement("div");
        document.body.append(root);
        const source = element("fc-event fc-timegrid-event", () => new DOMRect(20, 20, 100, 40));
        root.append(source);
        let x = 20;
        let y = 20;
        const rect = () => new DOMRect(x, y, 100, 40);
        const harness = element("", rect);
        let mirror = element("fc-timegrid-event fc-event-mirror", rect);
        root.append(harness);
        harness.append(mirror);
        const motion = startCalendarDragMotion(root, source, "task");
        tick();
        y = 80;
        tick();
        expect(animate.mock.calls[animate.mock.calls.length - 1]?.[0]).toEqual([
            { transform: "translate(0px, -60px)" }, { transform: "translate(0, 0)" },
        ]);
        mirror.remove();
        x = 140;
        mirror = element("fc-timegrid-event fc-event-mirror", rect);
        harness.append(mirror);
        tick();
        expect(animate.mock.calls[animate.mock.calls.length - 1]?.[0]).toEqual([
            { transform: "translate(-120px, 0px)" }, { transform: "translate(0, 0)" },
        ]);
        motion.cancel();
        expect(frames.size).toBe(0);
        expect(mirror.classList.contains("calendar-task-drag-preview")).toBe(false);
    });

    it("lands at the committed event position and cancels pending work on cleanup", () => {
        const root = document.createElement("div");
        let y = 20;
        const source = element("fc-event fc-timegrid-event", () => new DOMRect(20, y, 100, 40));
        source.dataset.calendarTaskId = "task";
        root.append(source);
        const motion = startCalendarDragMotion(root, source, "task");
        motion.finish();
        y = 80;
        tick();
        expect(animate.mock.calls[animate.mock.calls.length - 1]?.[0]).toEqual([
            { transform: "translate(0px, -60px)" }, { transform: "translate(0, 0)" },
        ]);
        expect(frames.size).toBe(0);
        motion.cancel();
        expect(animate.mock.results[animate.mock.results.length - 1]?.value.cancel).toHaveBeenCalled();
    });

    it("smooths an external handle and lands on a card rendered after the save", () => {
        const source = element("task-drag-handle", () => new DOMRect(20, 20, 30, 30));
        source.dataset.taskId = "task";
        let x = 20;
        let y = 20;
        const mirror = element("task-drag-handle fc-event-dragging", () => new DOMRect(x, y, 30, 30));
        mirror.dataset.taskId = "task";
        Object.defineProperty(mirror, "offsetLeft", { get: () => x });
        Object.defineProperty(mirror, "offsetTop", { get: () => y });
        document.body.append(source, mirror);
        const motion = startExternalTaskDragMotion(source);
        tick();
        x = 300;
        y = 70;
        tick();
        expect(animate.mock.calls[animate.mock.calls.length - 1]?.[0]).toEqual([
            { transform: "translate(-280px, -50px)" }, { transform: "translate(0, 0)" },
        ]);
        motion.stop();
        mirror.remove();
        expect(frames.size).toBe(0);
        const root = document.createElement("div");
        const card = element("fc-event", () => new DOMRect(400, 80, 100, 40));
        card.dataset.calendarTaskId = "task";
        root.append(card);
        motion.finish(root, "task");
        tick();
        expect(animate.mock.calls[animate.mock.calls.length - 1]?.[0]).toEqual([
            { transform: "translate(-100px, -10px)" }, { transform: "translate(0, 0)" },
        ]);
        motion.cancel();
        expect(frames.size).toBe(0);
    });

    it("transfers external motion to FullCalendar's visible in-grid preview", () => {
        const source = element("task-drag-handle", () => new DOMRect(20, 20, 30, 30));
        source.dataset.taskId = "task";
        const handle = element("task-drag-handle fc-event-dragging", () => new DOMRect(20, 20, 30, 30));
        handle.dataset.taskId = "task";
        const root = document.createElement("div");
        document.body.append(source, handle, root);
        const motion = startExternalTaskDragMotion(source, root);
        tick();
        const rect = () => new DOMRect(400, 80, 100, 40);
        const harness = element("", rect);
        const preview = element("fc-event fc-timegrid-event fc-event-mirror", rect);
        root.append(harness);
        harness.append(preview);
        tick();
        expect(handle.classList.contains("calendar-task-drag-preview")).toBe(false);
        expect(preview.classList.contains("calendar-task-drag-preview")).toBe(true);
        expect(animate.mock.calls[animate.mock.calls.length - 1]?.[0]).toEqual([
            { transform: "translate(-380px, -60px)" }, { transform: "translate(0, 0)" },
        ]);
        motion.cancel();
        expect(frames.size).toBe(0);
    });

    it("always reverts failed saves, skipping animation when reduced motion is enabled", () => {
        const root = document.createElement("div");
        let y = 80;
        const source = element("fc-event fc-timegrid-event", () => new DOMRect(20, y, 100, 40));
        source.dataset.calendarTaskId = "task";
        root.append(source);
        const revert = vi.fn(() => { y = 20; });
        revertCalendarEventWithMotion(root, "task", revert);
        tick();
        expect(revert).toHaveBeenCalledOnce();
        expect(animate).toHaveBeenCalledOnce();
        animate.mockClear();
        reduced = true;
        revertCalendarEventWithMotion(root, "task", revert);
        tick();
        expect(revert).toHaveBeenCalledTimes(2);
        expect(animate).not.toHaveBeenCalled();
    });
});
