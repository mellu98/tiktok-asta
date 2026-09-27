import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { DeviceManager } from "../devices/device-manager";
import { adbSource } from "../adb/devices";
import { scrcpyLauncher } from "../scrcpy/launcher";
import { buildRouter } from "./routes";
import { activityLog } from "./logging";
import { WsHub } from "./ws";

/**
 * Server locale del POC: Express (REST) + WebSocket (eventi live) + DeviceManager.
 * Restano SU localhost: nessuna porta esposta su Internet, nessuna credenziale.
 */

const PORT = Number(process.env.POC_PORT) || 5175;
const DASHBOARD_DIST = join(
  new URL("../../", import.meta.url).pathname,
  "dist",
  "dashboard",
);

const manager = new DeviceManager(adbSource);
const wsHub = new WsHub();
const app = express();

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
wsHub.attach(httpServer);

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
  activityLog.add(
    "info",
    "server",
    `Server POC avviato su http://127.0.0.1:${PORT}`,
  );
  activityLog.add(
    "info",
    "server",
    existsSync(join(DASHBOARD_DIST, "index.html"))
      ? "Dashboard buildata servita dal server"
      : "Modalità dev: apri http://localhost:5174 (Vite)",
  );
  manager.start();
});

function shutdown(signal: string): void {
  activityLog.add("info", "server", `Spegnimento (${signal})…`);
  manager.stop();
  scrcpyLauncher.stopAll();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
