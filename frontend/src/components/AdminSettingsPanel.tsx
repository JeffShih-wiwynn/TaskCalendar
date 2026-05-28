import type { AdminUser } from "../api/admin";

type AdminSettingsPanelProps = {
    users: AdminUser[];
    isLoading: boolean;
    error: string | null;
    deletingUserId: string | null;
    onBack: () => void;
    onDeleteUser: (user: AdminUser) => void;
};

export function AdminSettingsPanel({
    users,
    isLoading,
    error,
    deletingUserId,
    onBack,
    onDeleteUser,
}: AdminSettingsPanelProps) {
    const adminCount = users.filter((user) => user.is_admin).length;

    return (
        <div className="task-form account-settings-form">
            <div className="account-settings-heading">
                <h3 className="working-hours-title">Admin</h3>
                <p className="muted">Manage local user accounts.</p>
            </div>
            {isLoading ? (
                <p className="muted">Loading users...</p>
            ) : (
                <div className="admin-user-list" aria-label="Admin users">
                    {users.map((user) => {
                        const isLastVisibleAdmin =
                            user.is_admin && adminCount <= 1;

                        return (
                            <div key={user.id} className="admin-user-row">
                                <div className="admin-user-summary">
                                    <span className="admin-user-name">
                                        {user.username}
                                    </span>
                                    <span
                                        className={`admin-user-role ${
                                            user.is_admin
                                                ? "admin-user-role-admin"
                                                : "admin-user-role-user"
                                        }`}
                                    >
                                        {user.is_admin ? "Admin" : "User"}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="admin-user-delete-button admin-delete-button"
                                    aria-label={`Delete ${user.username}`}
                                    disabled={
                                        deletingUserId === user.id ||
                                        isLastVisibleAdmin
                                    }
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onDeleteUser(user);
                                    }}
                                >
                                    {deletingUserId === user.id
                                        ? "Deleting..."
                                        : "Delete"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
            {error && <p className="form-error">{error}</p>}
            <button
                type="button"
                className="settings-action-button settings-action-button-neutral"
                onClick={onBack}
            >
                Back
            </button>
        </div>
    );
}
