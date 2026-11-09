const duration = 130;
const easing = "cubic-bezier(0.22, 1, 0.36, 1)";

function animateFrom(element: HTMLElement, from: DOMRect): Animation | undefined {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = element.getBoundingClientRect();
    const x = from.left - target.left;
    const y = from.top - target.top;
    if (!x && !y) return;
    return element.animate(
        [{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }],
        { duration, easing },
    );
}

function findEvent(root: HTMLElement, id: string): HTMLElement | undefined {
    return Array.from(root.querySelectorAll<HTMLElement>(".fc-event:not(.fc-event-mirror)"))
        .find((element) => element.dataset.calendarTaskId === id);
}

export function startExternalTaskDragMotion(source: HTMLElement, calendarRoot?: HTMLElement | null) {
    let frame = 0;
    let landingFrame = 0;
    let animation: Animation | undefined;
    let mirror: HTMLElement | undefined;
    let targetKey = "";
    let visualRect = source.getBoundingClientRect();
    const sourceStyle = getComputedStyle(source);

    const update = () => {
        const handleMirror = Array.from(document.querySelectorAll<HTMLElement>(".task-drag-handle.fc-event-dragging"))
            .find((element) => element.dataset.taskId === source.dataset.taskId);
        const next = calendarRoot?.querySelector<HTMLElement>(".fc-event-mirror") ?? handleMirror;
        if (next) {
            // Calendar previews use a positioned harness; the external handle is viewport-fixed.
            const target = next.classList.contains("fc-event-mirror")
                ? next.parentElement!.getBoundingClientRect()
                : new DOMRect(next.offsetLeft, next.offsetTop, next.offsetWidth, next.offsetHeight);
            const key = `${target.x},${target.y},${target.width},${target.height}`;
            if (next !== mirror || key !== targetKey) {
                animation?.cancel();
                if (next !== mirror) {
                    mirror?.classList.remove("calendar-task-drag-preview");
                    mirror = next;
                    for (const token of ["--panel-bg", "--border", "--field-border", "--text", "--accent", "--accent-soft", "--shadow"]) {
                        mirror.style.setProperty(token, sourceStyle.getPropertyValue(token));
                    }
                    mirror.classList.add("calendar-task-drag-preview");
                }
                targetKey = key;
                animation = animateFrom(mirror, visualRect);
            }
            visualRect = next.getBoundingClientRect();
        }
        frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);

    const stop = () => {
        if (mirror?.isConnected) visualRect = mirror.getBoundingClientRect();
        cancelAnimationFrame(frame);
        animation?.cancel();
        mirror?.classList.remove("calendar-task-drag-preview");
    };
    return {
        stop,
        cancel() {
            stop();
            cancelAnimationFrame(landingFrame);
        },
        finish(root: HTMLElement, id: string) {
            stop();
            landingFrame = requestAnimationFrame(() => {
                const event = findEvent(root, id);
                if (event) animation = animateFrom(event, visualRect);
            });
        },
    };
}

export function startCalendarDragMotion(root: HTMLElement, source: HTMLElement, id: string) {
    let frame = 0;
    let animation: Animation | undefined;
    let mirror: HTMLElement | undefined;
    let targetKey = "";
    let visualRect = source.getBoundingClientRect();

    const update = () => {
        const next = root.querySelector<HTMLElement>(".fc-timegrid-event.fc-event-mirror");
        const harness = next?.parentElement;
        if (next && harness) {
            const target = harness.getBoundingClientRect();
            const key = `${target.x},${target.y},${target.width},${target.height}`;
            if (next !== mirror || key !== targetKey) {
                animation?.cancel();
                mirror?.classList.remove("calendar-task-drag-preview");
                mirror = next;
                targetKey = key;
                mirror.classList.add("calendar-task-drag-preview");
                animation = animateFrom(mirror, visualRect);
            }
            visualRect = next.getBoundingClientRect();
        }
        frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);

    const cancel = () => {
        cancelAnimationFrame(frame);
        animation?.cancel();
        mirror?.classList.remove("calendar-task-drag-preview");
    };

    return {
        cancel,
        finish() {
            if (mirror?.isConnected) visualRect = mirror.getBoundingClientRect();
            cancel();
            // FullCalendar commits the drop immediately after eventDragStop.
            frame = requestAnimationFrame(() => {
                const event = findEvent(root, id);
                if (event) animation = animateFrom(event, visualRect);
            });
        },
    };
}

export function revertCalendarEventWithMotion(root: HTMLElement, id: string, revert: () => void) {
    const event = findEvent(root, id);
    const from = event?.getBoundingClientRect();
    revert();
    if (!from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    requestAnimationFrame(() => {
        const restored = findEvent(root, id);
        if (restored) animateFrom(restored, from);
    });
}
