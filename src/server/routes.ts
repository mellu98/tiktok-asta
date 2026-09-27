import { Router, type Request, type Response } from "express";
import { writeFileSync } from "node:fs";
import { listInstalledApps, launchApp } from "../adb/apps";
import {
  pressKey,
  swipe,
  tap,
  inputText,
  sanitizeInputText,
} from "../adb/commands";
import { listDevices } from "../adb/devices";
import { AdbError } from "../adb/client";
import {
  dumpUiHierarchy,
  findCandidateAuctionNodes,
  parseUiHierarchy,
} from "../adb/auction";
import { captureAndSave } from "../adb/screenshots";
import { runRound } from "../auction/engine";
import {
  loadConfig,
  saveConfig,
  type AuctionConfig,
} from "../auction/config";
import { loadSafety, setEmergencyStop } from "../auction/safety";
import { listAuctions, resetAuction } from "../auction/state";
import { readJournal } from "../auction/journal";
import { uiDumpsDir } from "../auction/base-dir";
import type { DeviceManager } from "../devices/device-manager";
import { scrcpyLauncher } from "../scrcpy/launcher";
import type { AuctionAnalysis } from "../shared/types";
import { activityLog } from "./logging";
import type { WsHub } from "./ws";

/**
 * REST API della dashboard. Ogni endpoint:
 * 1. valida l'input,
 * 2. chiama un servizio del command layer (mai shell sparse),
 * 3. logga l'esito.
 *
 * Sicurezza automazione: i tap reali passano SOLO da /auction/round con
 * mode=live, che applica TUTTE le guardie (estop, dry-run, punteggio,
 * prezzo, limiti) — fail-closed.
 */

function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function safeSerial(serial: string): string {
  return serial.replace(/[^A-Za-z0-9._-]/g, "_");
}

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
      const result = await captureAndSave(serial);
      activityLog.add("success", "adb", `Screenshot salvato: ${result.file}`);
      ok(res, result);
    } catch (err) {
      fail(res, err);
    }
  });

  // ── Diagnostica asta TikTok (uiautomator, sola lettura) ───────────────────
  router.post("/devices/:serial/auction/analyze", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const xml = await dumpUiHierarchy(serial);
      const nodes = parseUiHierarchy(xml);
      const matches = findCandidateAuctionNodes(nodes);

      const { mkdirSync } = await import("node:fs");
      mkdirSync(uiDumpsDir(), { recursive: true });
      const xmlFile = `${uiDumpsDir()}/window_${safeSerial(serial)}_${stampNow()}.xml`;
      writeFileSync(xmlFile, xml, "utf8");

      const screenshot = await captureAndSave(serial);

      let width = 0;
      let height = 0;
      for (const n of nodes) {
        if (n.bounds.x2 > width) width = n.bounds.x2;
        if (n.bounds.y2 > height) height = n.bounds.y2;
      }

      const analysis: AuctionAnalysis = {
        screenshot,
        xmlFile,
        nodeCount: nodes.length,
        matches,
        clickableNodes: nodes.filter((n) => n.clickable).slice(0, 120),
        screenSize: { width, height },
      };
      activityLog.add(
        matches.length > 0 ? "success" : "warn",
        "adb",
        `Analisi schermata: ${nodes.length} nodi, ${matches.length} candidati Offri/offerta/€/prezzo — XML: ${xmlFile}`,
      );
      ok(res, analysis);
    } catch (err) {
      fail(res, err);
    }
  });

  // ── Automazione asta: configurazione e sicurezza ──────────────────────────
  router.get("/auction/state", (_req, res) => {
    ok(res, {
      config: loadConfig(),
      safety: loadSafety(),
      auctions: listAuctions(),
    });
  });

  router.put("/auction/config", (req, res) => {
    try {
      const patch = (req.body ?? {}) as Partial<AuctionConfig>;
      const config = saveConfig(patch);
      activityLog.add(
        "info",
        "server",
        `Configurazione asta aggiornata: maxBid=${config.maxBidEur}€, maxOffers=${config.maxOffersPerAuction}, soglia=${config.confidenceThreshold}, dryRun=${config.dryRun}`,
      );
      ok(res, { config });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/auction/estop", (req, res) => {
    try {
      const engaged = (req.body as { engaged?: boolean } | undefined)?.engaged === true;
      const reason =
        (req.body as { reason?: string } | undefined)?.reason ?? null;
      const safety = setEmergencyStop(engaged, reason);
      activityLog.add(
        engaged ? "error" : "success",
        "server",
        engaged
          ? "ARRESTO DI EMERGENZA ATTIVATO — tap reali bloccati"
          : "Arresto di emergenza disarmato: tap reali abilitati",
      );
      ok(res, { safety });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/auction/reset", (req, res) => {
    try {
      const auctionId =
        (req.body as { auctionId?: string } | undefined)?.auctionId ?? null;
      resetAuction(auctionId);
      activityLog.add(
        "info",
        "server",
        auctionId
          ? `Contatore azzerrato per asta ${auctionId}`
          : "Contatori azzerrati per tutte le aste",
      );
      ok(res, { auctions: listAuctions() });
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/auction/journal", (req, res) => {
    const limit = Math.min(
      500,
      Math.max(1, Number(req.query.limit) || 50),
    );
    ok(res, readJournal(limit));
  });

  // ── Automazione asta: round (valutazione / dry / live) ────────────────────
  router.post("/devices/:serial/auction/round", async (req, res) => {
    try {
      const serial = requireSerial(req);
      const mode = String(
        (req.body as { mode?: string } | undefined)?.mode ?? "evaluate",
      );
      if (mode !== "evaluate" && mode !== "dry" && mode !== "live") {
        throw new Error(`Modalità non valida: ${mode}`);
      }
      const result = await runRound(serial, mode);
      activityLog.add(
        result.decision === "offer" ? "success" : "info",
        "server",
        `Round ${mode} su ${serial}: ${result.decision} — ${result.reason}` +
          (result.timings
            ? ` [dump ${result.timings.dumpMs}ms, parse ${result.timings.parseMs}ms, decide ${result.timings.decideMs}ms${result.timings.tapMs !== null ? `, tap ${result.timings.tapMs}ms` : ""}]`
            : ""),
      );
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
        onExit: (s, code, detail) => {
          activityLog.add(
            detail ? "error" : "info",
            "scrcpy",
            detail
              ? `Mirroring fallito (${s}) — ${detail}`
              : `Mirroring terminato (${s}), codice ${code ?? "?"}`,
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

  return router;
}
