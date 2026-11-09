export type AssetIconName =
    | "admin"
    | "bell"
    | "change-password"
    | "calendar"
    | "check-square"
    | "delete-account"
    | "download"
    | "log-out"
    | "google-calendar"
    | "home"
    | "pencil"
    | "plus-circle"
    | "preferences"
    | "settings"
    | "trash"
    | "upload";

export function AssetIcon({
    name,
    className = "",
}: {
    name: AssetIconName;
    className?: string;
}) {
    const mask = `url("/icons/${name}.svg")`;
    return (
        <span
            aria-hidden="true"
            className={`asset-icon ${className}`.trim()}
            style={{
                maskImage: mask,
                WebkitMaskImage: mask,
                maskMode: "alpha",
            }}
        />
    );
}
