import type {
  AuctionAnalysis,
  AuctionConfig,
  HardwareKey,
  JournalEntry,
  LogEntry,
  RoundResult,
  ScreenshotResult,
} from "../../src/shared/types";

/**
 * Client verso il server interno.
 *
 * Bootstrap sessione:
 * - dev (`npm run dev`) e `npm start`: stesso origine (Vite proxy / server statico)
 * - app Tauri (webview su tauri://): porta dinamica + token via comando IPC
 *   `session_info` (il server verifica il token su ogni richiesta)
 */

interface SessionInfo {
  port: number;
  token: string | null;
}

// Mutabili: rilevati una sola volta via IPC Tauri (porta dinamica + token).
// Accesso via getter (niente export mutabili).
let SERVER_HTTP = "";
let SERVER_WS = "";
let TOKEN: string | null = null;
let sessionPromise: Promise<void> | null = null;

export function serverHttp(): string {
  return SERVER_HTTP;
}

export function serverWs(): string {
  return SERVER_WS;
}

export function currentServerHttp(): string {
  return SERVER_HTTP;
}

async function detectSession(): Promise<void> {
  // SAFETY: `window.__TAURI__` esiste solo quando tauri.conf ha
  // withGlobalTauri=true; l'assenza implica modalità browser/dev.
  const w = window as unknown as {
    __TAURI__?: {
      core?: {
        invoke?: (cmd: string) => Promise<SessionInfo>;
      };
    };
  };
  const invoke = w.__TAURI__?.core?.invoke;
  if (invoke) {
    const s = await invoke("session_info");
    SERVER_HTTP = `http://127.0.0.1:${s.port}`;
    SERVER_WS = `ws://127.0.0.1:${s.port}/ws?token=${encodeURIComponent(s.token ?? "")}`;
    TOKEN = s.token;
    return;
  }
  // Browser/dev: stesso origine, il Vite proxy gestisce /api e /ws
  SERVER_HTTP = "";
  SERVER_WS = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
  TOKEN = null;
}

/** Risolve porta+token una sola volta; in caso di errore permette il retry. */
export function ensureSession(): Promise<void> {
  if (!sessionPromise) {
    sessionPromise = detectSession().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  await ensureSession();
  let res: Response;
  try {
    res = await fetch(`${SERVER_HTTP}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(TOKEN ? { "x-session-token": TOKEN } : {}),
      },
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
      { method: "POST" },
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
      { method: "POST" },
    ),
  adbRestart: () => api<{ restarted: boolean }>("/api/adb/restart", { method: "POST" }),
  tap: (serial: string, x: number, y: number) =>
    api<{ done: boolean }>(`/api/devices/${encodeURIComponent(serial)}/input/tap`, {
      method: "POST",
      body: JSON.stringify({ x, y }),
    }),
  swipe: (
    serial: string,
    v: { x1: number; y1: number; x2: number; y2: number; durationMs: number },
  ) =>
    api<{ done: boolean }>(`/api/devices/${encodeURIComponent(serial)}/input/swipe`, {
      method: "POST",
      body: JSON.stringify(v),
    }),
  text: (serial: string, text: string) =>
    api<{ sent: string }>(`/api/devices/${encodeURIComponent(serial)}/input/text`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  key: (serial: string, key: HardwareKey) =>
    api<{ done: boolean }>(`/api/devices/${encodeURIComponent(serial)}/input/key`, {
      method: "POST",
      body: JSON.stringify({ key }),
    }),

  // ── Automazione asta ────────────────────────────────────────────────────
  auctionAnalyze: (serial: string) =>
    api<AuctionAnalysis>(
      `/api/devices/${encodeURIComponent(serial)}/auction/analyze`,
      { method: "POST" },
    ),
  round: (serial: string, mode: "evaluate" | "dry" | "live") =>
    api<RoundResult>(`/api/devices/${encodeURIComponent(serial)}/auction/round`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  auctionState: () =>
    api<{
      config: AuctionConfig;
      safety: { estopEngaged: boolean; reason: string | null };
      auctions: { auctionId: string; offersSpent: number }[];
    }>("/api/auction/state"),
  saveAuctionConfig: (patch: Partial<AuctionConfig>) =>
    api<{ config: AuctionConfig }>("/api/auction/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  setEstop: (engaged: boolean) =>
    api<{ safety: unknown }>("/api/auction/estop", {
      method: "POST",
      body: JSON.stringify({ engaged }),
    }),
  resetAuction: (auctionId: string | null) =>
    api<{ auctions: unknown[] }>("/api/auction/reset", {
      method: "POST",
      body: JSON.stringify({ auctionId }),
    }),
  journal: (limit = 30) => api<JournalEntry[]>(`/api/auction/journal?limit=${limit}`),
};
