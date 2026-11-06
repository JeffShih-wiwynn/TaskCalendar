import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RegistrationControl } from "./RegistrationControl";
import { getRegistrationStatus, setRegistrationWindow } from "../api/registration";

vi.mock("../api/registration", () => ({
    getRegistrationStatus: vi.fn(),
    setRegistrationWindow: vi.fn(),
}));

afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
});

it("opens for five minutes, counts down, and switches off on expiry", async () => {
    vi.useFakeTimers();
    vi.mocked(getRegistrationStatus).mockResolvedValue({
        setup_required: false, registration_open: false, open_until: null,
    });
    vi.mocked(setRegistrationWindow).mockResolvedValue({
        setup_required: false, registration_open: true,
        open_until: new Date(Date.now() + 300000).toISOString(),
    });
    await act(async () => { render(<RegistrationControl />); });
    const toggle = screen.getByRole("switch", { name: "Public registration" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(toggle); });
    expect(setRegistrationWindow).toHaveBeenCalledWith(5);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("5:00")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("4:59")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(299000));
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("0:00")).not.toBeInTheDocument();
});

it("lets the admin close registration before it expires", async () => {
    vi.mocked(getRegistrationStatus).mockResolvedValue({
        setup_required: false, registration_open: true,
        open_until: new Date(Date.now() + 300000).toISOString(),
    });
    vi.mocked(setRegistrationWindow).mockResolvedValue({
        setup_required: false, registration_open: false, open_until: null,
    });
    await act(async () => { render(<RegistrationControl />); });
    const toggle = screen.getByRole("switch", { name: "Public registration" });
    await act(async () => { fireEvent.click(toggle); });
    expect(setRegistrationWindow).toHaveBeenCalledWith(0);
    expect(toggle).toHaveAttribute("aria-checked", "false");
});
