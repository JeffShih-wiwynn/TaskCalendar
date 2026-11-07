import { useEffect, useState } from "react";
import { getRegistrationStatus, setRegistrationWindow, type RegistrationStatus } from "../api/registration";

export function RegistrationControl() {
    const [status, setStatus] = useState<RegistrationStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        let active = true;
        void getRegistrationStatus().then((value) => {
            if (active) setStatus(value);
        }).catch(() => { if (active) setError("Unable to load registration settings"); });
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => { active = false; window.clearInterval(timer); };
    }, []);
    const remaining = status?.open_until ? Math.max(0, Math.ceil((Date.parse(status.open_until) - now) / 1000)) : 0;
    const open = remaining > 0;
    async function toggle() {
        setBusy(true);
        setError(null);
        try {
            setStatus(await setRegistrationWindow(open ? 0 : 5));
            setNow(Date.now());
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to update registration");
        } finally { setBusy(false); }
    }
    return (
        <section aria-label="Registration">
            <div className="sidebar-settings-row preferences-toggle-row registration-row" aria-busy={busy}>
                <span>
                    Public registration
                    {open && <span className="registration-countdown">
                        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
                    </span>}
                </span>
                <button
                    type="button"
                    role="switch"
                    className={`sidebar-switch ${open ? "sidebar-switch-on" : ""}`}
                    aria-label="Public registration"
                    aria-checked={open}
                    disabled={!status || busy}
                    onClick={() => void toggle()}
                >
                    <span className="sidebar-switch-knob" />
                </button>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
        </section>
    );
}
