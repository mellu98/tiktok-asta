import express from "express";
import type { Request, Response, NextFunction } from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { DeviceManager } from "../devices/device-manager";
import { adbSource } from "../adb/devices";
import { scrcpyLauncher } from "../scrcpy/launcher";
import { closeAllShellSessions } from "../adb/shell-session";
import { buildRouter } from "./routes";
import { activityLog } from "./logging";
import { WsHub } from "./ws";
import { setDataDir, logsDir } from "../auction/base-dir";
import { setConfigBaseDir } from "../auction/config";
import { setSafetyBaseDir } from "../auction/safety";
import { setStateBaseDir } from "../auction/state";

/**
 * Server locale del POC: Express (REST) + WebSocket (eventi live) + DeviceManager.
 *
 * SICUREZZA:
 * - bind SOLO su 127.0.0.1
 * - modalità app Tauri: PORTA DINAMICA (POC_PORT=0) + TOKEN DI SESSIONE
 *   generato dal shell Rust e verificato su ogni richiesta / upgrade WS
 * - modalità dev (npm run dev): porta fissa 5175 senza token, solo localhost
 */

const RAW_PORT = process.env.POC_PORT;
const PORT =
  RAW_PORT !== undefined && RAW_PORT !== "" ? Number(RAW_PORT) : 5175;
const SESSION_TOKEN = process.env.POC_SESSION_TOKEN || null;

// Percorsi canonici: un'unica radice per dev e app (logs, screenshots, ui-dumps,
// stato asta, journal, config).
const DATA_DIR = process.env.POC_DATA_DIR || process.cwd();
setDataDir(DATA_DIR);
setConfigBaseDir(DATA_DIR);
setSafetyBaseDir(DATA_DIR);
setStateBaseDir(DATA_DIR);
const DASHBOARD_DIST = join(
  new URL("../../", import.meta.url).pathname,
  "dist",
  "dashboard",
);

const manager = new DeviceManager(adbSource);
const wsHub = new WsHub();
const app = express();

// Token di sessione: presente solo quando il shell Rust lo passa all'app.
if (SESSION_TOKEN) {
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.header("x-session-token") !== SESSION_TOKEN) {
      res.status(401).json({ error: "Token di sessione non valido" });
      return;
    }
    next();
  });
}

app.use(express.json({ limit: "1mb" }));
app.use("/api", buildRouter({ manager, wsHub }));

// In modalità `npm start` serve la dashboard buildata; in dev serve Vite (5174)
if (existsSync(join(DASHBOARD_DIST, "index.html"))) {
  app.use(express.static(DASHBOARD_DIST));
  app.use((req, res, next) => {
    if (
      req.method === "GET" &&
      !req.path.startsWith("/api") &&
      !req.path.startsWith("/ws")
    ) {
      res.sendFile(join(DASHBOARD_DIST, "index.html"));
      return;
    }
    next();
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint non trovato" });
});

const httpServer = createServer(app);
wsHub.attach(httpServer, SESSION_TOKEN);

// Eventi live → dashboard
manager.on("change", (devices, updatedAt) => {
  wsHub.broadcast({ type: "devices", devices, updatedAt });
});
manager.on("log", (level, message) => {
  activityLog.add(level, "device", message);
});
manager.on("pollError", (message) => {
  activityLog.add("error", "adb", message);
});
activityLog.on("entry", (entry) => {
  wsHub.broadcast({ type: "log", entry });
});

httpServer.on("error", (err) => {
  activityLog.add(
    "error",
    "server",
    `Impossibile avviare il server interno: ${err.message}. Se un'altra istanza è attiva, chiudila e riprova.`,
  );
  process.exit(1);
});

httpServer.listen(PORT, "127.0.0.1", () => {
  const addr = httpServer.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : PORT;

  activityLog.add(
    "info",
    "server",
    `Server POC avviato su http://127.0.0.1:${actualPort}`,
  );
  activityLog.add(
    "info",
    "server",
    existsSync(join(DASHBOARD_DIST, "index.html"))
      ? "Dashboard buildata servita dal server"
      : `Modalità dev: apri http://localhost:5174 (Vite) · log in ${logsDir()}`,
  );

  // Marcatore per il shell Tauri: comunica la porta effettiva (dinamica).
  console.log(
    `#[tauri-session] ${JSON.stringify({
      port: actualPort,
      token: SESSION_TOKEN,
    })}`,
  );

  manager.start();
});

function shutdown(signal: string): void {
  activityLog.add("info", "server", `Spegnimento (${signal})…`);
  manager.stop();
  scrcpyLauncher.stopAll();
  closeAllShellSessions();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
