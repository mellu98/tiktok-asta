import type { AndroidDevice } from "../../../src/shared/types";

interface Props {
    device: AndroidDevice;
    selected: boolean;
    onSelect: () => void;
}

const STATUS_LABEL: Record<string, string> = {
    device: "Authorized",
    unauthorized: "Non autorizzato",
    offline: "Offline",
    recovery: "Recovery",
    bootloader: "Bootloader",
    unknown: "Sconosciuto",
};

export function DeviceCard({ device, selected, onSelect }: Props) {
    const online = device.authorized;
    const unauthorized = device.adbStatus === "unauthorized";

    const badgeClass = online
        ? "badge online"
        : unauthorized
          ? "badge warn"
          : "badge bad";
    const badgeText = online
        ? "ONLINE"
        : unauthorized
          ? "IN ATTESA AUTH"
          : (STATUS_LABEL[device.adbStatus]?.toUpperCase() ?? "OFFLINE");

    return (
        <div
            className={`device-card${selected ? " selected" : ""}`}
            onClick={onSelect}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect();
            }}
        >
            <div className="device-row">
                <strong className="device-name">{device.model}</strong>
                <span className={badgeClass}>{badgeText}</span>
            </div>
            <div className="device-meta">
                {device.manufacturer ? `${device.manufacturer} · ` : ""}Android{" "}
                {device.androidVersion || "?"}
                {device.sdkVersion ? ` (SDK ${device.sdkVersion})` : ""}
            </div>
            <div className="device-meta">Serial: {device.serial}</div>
            <div className="device-meta">
                ADB: {STATUS_LABEL[device.adbStatus] ?? device.adbStatus}
            </div>
            {unauthorized && (
                <div className="device-hint">
                    Controlla lo schermo del telefono e accetta la richiesta
                    «Consentire debug USB?».
                </div>
            )}
        </div>
    );
}
