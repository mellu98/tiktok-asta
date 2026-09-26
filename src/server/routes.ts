import { Router, type Request, type Response } from "express";
import { mkdirSync, writeFileSync } from "node:fs";
import { listInstalledApps, launchApp } from "../adb/apps";
import {
  pressKey,
  swipe,
  tap,
  inputText,
  sanitizeInputText,
} from "../adb/commands";
import { listDevices } from "../adb/devices";
import { takeScreenshot } from "../adb/screenshots";
import { AdbError } from "../adb/client";
import type { DeviceManager } from "../devices/device-manager";
import { scrcpyLauncher } from "../scrcpy/launcher";
import type { ScreenshotResult } from "../shared/types";
import { activityLog } from "./logging";
import type { WsHub } from "./ws";

/**
 * REST API della dashboard. Ogni endpoint:
 * 1. valida l'input,
 * 2. chiama un servizio del command layer (mai shell sparse),
 * 3. logga l'esito.
 */

const REPO_ROOT = new URL("../../", import.meta.url);
const SCREENSHOT_DIR = process.env.POC_SCREENSHOT_DIR ?? "screenshots";

interface Deps {
  manager: DeviceManager;
  wsHub: WsHub;
}

function ok(res: Response, body: unknown): void {
  res.json(body);
}

function fail(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof AdbError ? 502 : 400;
  activityLog.add("error", "server", message);
  res.status(code).json({ error: message });
}

function requireSerial(req: Request): string {
  const raw = req.params.serial;
  const serial = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!serial || serial.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(serial)) {
    throw new Error("Seriale dispositivo mancante o non valido");
  }
  return serial;
}

export function buildRouter(deps: Deps): Router {
  const router = Router();
  const { manager, wsHub } = deps;

  router.get("/health", (_req, res) => {
    ok(res, { ok: true, uptimeSec: Math.round(process.uptime()) });
  });

  // ── Dispositivi ────────────────────────────────────────────────────────────
  router.get("/devices", (_req, res) => {
    ok(res, manager.list());
  });

  router.post("/devices/:serial/screenshot", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const png = await takeScreenshot(serial);
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const safeSerial = serial.replace(/[^A-Za-z0-9._-]/g, "_");
      const file = `${SCREENSHOT_DIR}/screen_${safeSerial}_${stamp}.png`;
      writeFileSync(file, png);
      const result: ScreenshotResult = {
        file,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      };
      activityLog.add("success", "adb", `Screenshot salvato: ${file}`);
      ok(res, result);
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/devices/:serial/apps", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const packages = await listInstalledApps(serial);
      activityLog.add(
        "info",
        "adb",
        `Elenco app ricevuto (${packages.length} app)`,
      );
      ok(res, { packages });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/devices/:serial/apps/:pkg/launch", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const pkg = req.params.pkg ?? "";
      await launchApp(serial, pkg);
      activityLog.add("success", "adb", `App avviata: ${pkg}`);
      ok(res, { launched: pkg });
    } catch (err) {
      fail(res, err);
    }
  });

  // ── Input manuale ──────────────────────────────────────────────────────────
  router.post("/devices/:serial/input/tap", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const { x, y } = req.body as { x?: number; y?: number };
      await tap(serial, Number(x), Number(y));
      activityLog.add("info", "input", `Tap (${x}, ${y})`);
      ok(res, { done: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/devices/:serial/input/swipe", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const { x1, y1, x2, y2, durationMs } = req.body as Record<
        string,
        number | undefined
      >;
      await swipe(
        serial,
        Number(x1),
        Number(y1),
        Number(x2),
        Number(y2),
        durationMs === undefined ? 300 : Number(durationMs),
      );
      activityLog.add("info", "input", `Swipe (${x1},${y1}) → (${x2},${y2})`);
      ok(res, { done: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/devices/:serial/input/text", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const raw = String(req.body?.text ?? "");
      const sent = await inputText(serial, raw);
      activityLog.add(
        "info",
        "input",
        `Testo inviato: "${sanitizeInputText(raw).replace(/%s/g, " ")}"`,
      );
      ok(res, { sent });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/devices/:serial/input/key", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const key = String(req.body?.key ?? "").toUpperCase();
      if (key !== "BACK" && key !== "HOME" && key !== "ENTER") {
        throw new Error(`Tasto non supportato: ${key}`);
      }
      await pressKey(serial, key);
      activityLog.add("info", "input", `Tasto ${key}`);
      ok(res, { done: true });
    } catch (err) {
      fail(res, err);
    }
  });

  // ── scrcpy & ADB ───────────────────────────────────────────────────────────
  router.post("/devices/:serial/scrcpy/start", async (req, res) => {
    try {
      const serial = requireSerial(req);
      if (scrcpyLauncher.isRunning(serial)) {
        activityLog.add("warn", "scrcpy", `Mirroring già attivo per ${serial}`);
        ok(res, { started: false, alreadyRunning: true });
        return;
      }
      const device = manager.list().find((d) => d.serial === serial);
      if (!device)
        throw new Error(
          "Dispositivo non trovato: collega il telefono e riprova",
        );
      if (!device.authorized) {
        throw new Error(
          'Dispositivo non autorizzato: accetta la richiesta "Consentire debug USB?" sul telefono',
        );
      }
      const title = `${device.model} (${serial})`;
      activityLog.add("info", "scrcpy", `Avvio mirroring per ${title}…`);
      wsHub.broadcast({ type: "scrcpy", serial, status: "starting" });
      scrcpyLauncher.start(serial, title, {
        onStarted: (s) => {
          activityLog.add("success", "scrcpy", `Mirroring attivo (${s})`);
          wsHub.broadcast({ type: "scrcpy", serial: s, status: "running" });
        },
        onExit: (s, code) => {
          activityLog.add(
            "info",
            "scrcpy",
            `Mirroring terminato (${s}), codice ${code ?? "?"}`,
          );
          wsHub.broadcast({
            type: "scrcpy",
            serial: s,
            status: "exited",
            code,
          });
        },
        onError: (s, message) => {
          activityLog.add("error", "scrcpy", message);
          wsHub.broadcast({
            type: "scrcpy",
            serial: s,
            status: "exited",
            code: -1,
          });
        },
      });
      ok(res, { started: true });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/adb/restart", async (_req, res) => {
    try {
      await listDevices(); // ensures daemon handles exist
      const { execAdbText } = await import("../adb/client");
      await execAdbText(["kill-server"]);
      await execAdbText(["start-server"]);
      activityLog.add("success", "adb", "Server ADB riavviato");
      ok(res, { restarted: true });
    } catch (err) {
      fail(res, err);
    }
  });

  // ── Log ────────────────────────────────────────────────────────────────────
  router.get("/logs", (_req, res) => {
    ok(res, activityLog.list(200));
  });

  // Riferimento per il server: usato per broadcast iniziale
  void REPO_ROOT;
  return router;
}
