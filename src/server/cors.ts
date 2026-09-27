import type { RequestHandler } from "express";

/**
 * CORS per la sola webview dell'app Tauri.
 *
 * Nell'app (.dmg) la dashboard gira su tauri://localhost e chiama il sidecar su
 * http://127.0.0.1:5175: ogni fetch è cross-origin e, per il Content-Type JSON,
 * preceduta da un preflight OPTIONS. Senza questi header WebKit blocca la
 * richiesta e la dashboard mostra «Server interno non raggiungibile».
 * (Il WebSocket non è soggetto a CORS: per questo card e log funzionavano.)
 *
 * Allowlist, mai "*": questo server comanda il telefono, un sito web qualunque
 * aperto nel browser non deve poterlo chiamare. In dev (proxy Vite) e da curl
 * le richieste sono stessa-origine o senza Origin e restano invariate.
 */

export const TAURI_WEBVIEW_ORIGIN = "tauri://localhost";

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([TAURI_WEBVIEW_ORIGIN]);
const PREFLIGHT_MAX_AGE_SEC = 600;

export const webviewCors: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    next();
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.vary("Origin");

  if (req.method !== "OPTIONS") {
    next();
    return;
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", String(PREFLIGHT_MAX_AGE_SEC));
  res.status(204).end();
};
