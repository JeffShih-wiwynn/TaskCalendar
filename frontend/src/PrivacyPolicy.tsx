export function PrivacyPolicy() {
    return (
        <main className="privacy-page">
            <article className="privacy-card">
                <p className="privacy-eyebrow">TaskCalendar</p>
                <h1>TaskCalendar Privacy Policy</h1>
                <p>
                    TaskCalendar accesses Google Calendar data only for the
                    purpose of synchronizing calendar events for the
                    authenticated user.
                </p>
                <p>Google user data is not sold or shared with third parties.</p>
                <p>
                    Authentication tokens are stored securely and are used only
                    to maintain calendar synchronization.
                </p>
                <p>
                    Users may revoke TaskCalendar&apos;s access at any time
                    through their Google Account settings.
                </p>
                <p className="privacy-updated">
                    Last updated: <time dateTime="2026-10">October 2026</time>
                </p>
            </article>
        </main>
    );
}
