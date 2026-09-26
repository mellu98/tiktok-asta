/**
 * Tipi condivisi tra server (Node) e dashboard (React).
 * Non importare codice Node qui: questo file gira anche nel browser.
 */

/** Stato della connessione ADB di un dispositivo (output di `adb devices`). */
export type AdbState =
    | "device"
    | "unauthorized"
    | "offline"
    | "recovery"
    | "bootloader"
    | "unknown";

/** Riga grezza estratta da `adb devices -l`, prima dell'arricchimento con getprop. */
export interface ParsedAdbDevice {
    serial: string;
    state: AdbState;
    model: string | null;
    product: null | string;
    transportId: string | null;
}

/** Modello canonico di un dispositivo Android gestito dalla dashboard. */
export interface AndroidDevice {
    /** Identificativo univoco per la UI: coincide con il seriale ADB. */
    id: string;
    serial: string;
    manufacturer: string;
    model: string;
    androidVersion: string;
    sdkVersion: string;
    adbStatus: AdbState;
    /** true se presente nella lista `adb devices` (anche unauthorized). */
    connected: boolean;
    /** true solo se adbStatus === 'device' (debug USB autorizzato). */
    authorized: boolean;
    transportId: string | null;
    firstSeenAt: number;
    lastSeenAt: number;
}

export type LogLevel = "info" | "success" | "warn" | "error";
export type LogSource = "adb" | "scrcpy" | "device" | "server" | "input";

/** Voce del log operativo mostrato in dashboard. */
export interface LogEntry {
    id: number;
    ts: number;
    level: LogLevel;
    source: LogSource;
    message: string;
}

/** Messaggi inviati dal server alla dashboard via WebSocket. */
export type WsServerMessage =
    | { type: "hello"; port: number }
    | { type: "devices"; devices: AndroidDevice[]; updatedAt: number }
    | { type: "log"; entry: LogEntry }
    | {
          type: "scrcpy";
          serial: string;
          status: "starting" | "running" | "exited";
          code?: number | null;
      };

/** Chiavi di input hardware supportate dalla V0. */
export type HardwareKey = "BACK" | "HOME" | "ENTER";

/** Risposta di POST /api/devices/:serial/screenshot */
export interface ScreenshotResult {
    file: string;
    dataUrl: string;
}
