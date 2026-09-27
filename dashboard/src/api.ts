import type {
  HardwareKey,
  LogEntry,
  ScreenshotResult,
} from "../../src/shared/types";

/**
 * Client REST verso il server locale. Tutti gli errori diventano Error con messaggio italiano.
 *
 * Base URL:
 * - dev (`npm run dev`) e `npm start`: stesso origine → path relativi (Vite proxy / server statico)
 * - app Tauri (webview su tauri://): il server sidecar è su 127.0.0.1:5175 → URL assoluti
 */
const SAME_ORIGIN =
  typeof window !== "undefined" && window.location.protocol.startsWith("http");

const DEV_WS_PROTO =
  typeof window !== "undefined" && window.location.protocol === "https:"
    ? "wss:"
    : "ws:";

export const SERVER_HTTP = SAME_ORIGIN ? "" : "http://127.0.0.1:5175";
export const SERVER_WS = SAME_ORIGIN
  ? `${DEV_WS_PROTO}//${window.location.host}/ws`
  : "ws://127.0.0.1:5175/ws";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_HTTP}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new Error(
      "Server interno non raggiungibile — riavvia l'app (in dev: npm run dev)",
    );
  }
  if (!res.ok) {
    let message = `Errore HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // corpo non JSON: usa il messaggio di default
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const Api = {
  devices: () =>
    api<import("../../src/shared/types").AndroidDevice[]>("/api/devices"),
  logs: () => api<LogEntry[]>("/api/logs"),
  screenshot: (serial: string) =>
    api<ScreenshotResult>(
      `/api/devices/${encodeURIComponent(serial)}/screenshot`,
      {
        method: "POST",
      },
    ),
  apps: (serial: string) =>
    api<{ packages: string[] }>(
      `/api/devices/${encodeURIComponent(serial)}/apps`,
    ),
  launchApp: (serial: string, pkg: string) =>
    api<{ launched: string }>(
      `/api/devices/${encodeURIComponent(serial)}/apps/${encodeURIComponent(pkg)}/launch`,
      { method: "POST" },
    ),
  scrcpyStart: (serial: string) =>
    api<{ started: boolean }>(
      `/api/devices/${encodeURIComponent(serial)}/scrcpy/start`,
      {
        method: "POST",
      },
    ),
  adbRestart: () =>
    api<{ restarted: boolean }>("/api/adb/restart", { method: "POST" }),
  tap: (serial: string, x: number, y: number) =>
    api<{ done: boolean }>(
      `/api/devices/${encodeURIComponent(serial)}/input/tap`,
      {
        method: "POST",
        body: JSON.stringify({ x, y }),
      },
    ),
  swipe: (
    serial: string,
    v: { x1: number; y1: number; x2: number; y2: number; durationMs: number },
  ) =>
    api<{ done: boolean }>(
      `/api/devices/${encodeURIComponent(serial)}/input/swipe`,
      {
        method: "POST",
        body: JSON.stringify(v),
      },
    ),
  text: (serial: string, text: string) =>
    api<{ sent: string }>(
      `/api/devices/${encodeURIComponent(serial)}/input/text`,
      {
        method: "POST",
        body: JSON.stringify({ text }),
      },
    ),
  key: (serial: string, key: HardwareKey) =>
    api<{ done: boolean }>(
      `/api/devices/${encodeURIComponent(serial)}/input/key`,
      {
        method: "POST",
        body: JSON.stringify({ key }),
      },
    ),
};
