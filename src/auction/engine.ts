/**
 * Motore dell'automazione offerte: un round = dump UI → riconoscimento
 * pulsante → stima prezzo → guardie fail-closed → (solo se TUTTO passa e il
 * modo è "live") UN tap → verifica del cambio UI.
 *
 * FAIL-CLOSED: qualunque incertezza (estop, dry-run, soglie, prezzo ambiguo,
 * limite raggiunto, lock occupato) porta a decision=skip.
 *
 * Nessun loop automatico aggressivo: la ripetizione è demandata al chiamante
 * (endpoint con intervallo configurabile, default disattivato).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { uiDumpsDir } from "./base-dir";
import { loadConfig } from "./config";
import { appendJournal } from "./journal";
import { isEmergencyStopped } from "./safety";
import {
  computeAuctionId,
  getOffersSpent,
  recordOfferSpent,
  withDeviceLock,
} from "./state";
import { dumpUiHierarchy, parseUiHierarchy } from "../adb/auction";
import { tap as adbTap } from "../adb/commands";
import { runInShellSession } from "../adb/shell-session";
import { captureAndSave } from "../adb/screenshots";
import { evaluateOfferButton } from "./button";
import { estimateNextBid } from "./price";
import type { JournalEntry } from "./journal";
import type { RoundResult, RoundTimings, UiNode } from "../shared/types";

const TAP_SETTLE_MS = 2000;

function now(): number {
  return performance.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Salva l'XML nella cartella canonica e ritorna il percorso. */
export function saveXmlDump(serial: string, xml: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeSerial = serial.replace(/[^A-Za-z0-9._-]/g, "_");
  const dir = uiDumpsDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `window_${safeSerial}_${stamp}.xml`);
  writeFileSync(file, xml, "utf8");
  return file;
}

function emptyTimings(): RoundTimings {
  return { dumpMs: 0, parseMs: 0, decideMs: 0, tapMs: null, verifyMs: null };
}

function uiSignature(nodes: UiNode[]): string {
  const texts = nodes
    .map((n) => n.text || n.contentDesc)
    .filter((t) => t.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `${nodes.length}|${texts.join("|").slice(0, 400)}`;
}

function skipResult(
  base: RoundResult,
  reason: string,
  kind: "evaluate" | "dry",
): RoundResult {
  base.reason = reason;
  appendJournal(toJournal(base, kind, null, null, null));
  return base;
}

function toJournal(
  base: RoundResult,
  kind: JournalEntry["kind"],
  commandError: string | null,
  uiChangedAfterTap: boolean | null,
  timings: RoundTimings | null,
): JournalEntry {
  return {
    ts: Date.now(),
    serial: base.serial,
    auctionId: base.auctionId,
    kind,
    decision: base.decision,
    reason: base.reason,
    priceEur: base.priceEur,
    priceConfidence: base.priceConfidence,
    buttonScore: base.buttonScore,
    buttonCenter: base.buttonCenter,
    limits: {
      maxBidEur: base.limits.maxBidEur,
      maxOffersPerAuction: base.limits.maxOffersPerAuction,
      offersSpent: base.offersSpent,
      confidenceThreshold: base.limits.confidenceThreshold,
    },
    xmlFile: base.xmlFile,
    screenshotFile: base.screenshotFile,
    commandError,
    uiChangedAfterTap,
    timings: timings ?? undefined,
  };
}

/**
 * Esegue UN round. Con mode="live" il tap reale avviene SOLO se superano
 * tutte le guardie (estop, dry-run, punteggio, prezzo, limiti).
 */
export async function runRound(
  serial: string,
  mode: "evaluate" | "dry" | "live",
): Promise<RoundResult> {
  const config = loadConfig();
  const timings = emptyTimings();

  const base: RoundResult = {
    serial,
    mode,
    auctionId: null,
    decision: "skip",
    reason: "",
    buttonScore: null,
    buttonLabel: null,
    buttonCenter: null,
    priceEur: null,
    priceConfidence: null,
    offersSpent: 0,
    limits: {
      maxBidEur: config.maxBidEur,
      maxOffersPerAuction: config.maxOffersPerAuction,
      confidenceThreshold: config.confidenceThreshold,
      priceConfidenceThreshold: config.priceConfidenceThreshold,
      dryRun: config.dryRun,
      estopEngaged: isEmergencyStopped(),
    },
    xmlFile: null,
    screenshotFile: null,
    uiChangedAfterTap: null,
    error: null,
    timings,
  };

  // Lock per device: se un round è già in corso, rifiuta senza accodare.
  const locked = await withDeviceLock(
    serial,
    async (): Promise<RoundResult> => {
      // ── 1. ACQUISIZIONE ────────────────────────────────────────────────
      let xml = "";
      try {
        const t = now();
        xml = await dumpUiHierarchy(serial);
        timings.dumpMs = Math.round(now() - t);
      } catch (err) {
        base.error = err instanceof Error ? err.message : String(err);
        return skipResult(base, "dump UI non riuscito", "evaluate");
      }
      base.xmlFile = saveXmlDump(serial, xml);

      // ── 2. RICONOSCIMENTO ──────────────────────────────────────────────
      const tParse = now();
      const nodes: UiNode[] = parseUiHierarchy(xml);
      const button = evaluateOfferButton(nodes, config.confidenceThreshold);
      const offerNode: UiNode | null = button.node;
      const price = estimateNextBid(
        nodes,
        offerNode,
        config.priceConfidenceThreshold,
      );
      timings.parseMs = Math.round(now() - tParse);

      base.buttonScore = offerNode ? button.score : null;
      base.buttonLabel = offerNode
        ? offerNode.text || offerNode.contentDesc || null
        : null;
      base.buttonCenter = offerNode ? offerNode.center : null;
      base.priceEur = price ? price.amountEur : null;
      base.priceConfidence = price ? price.confidence : null;

      // ── 3. DECISIONE (fail-closed, in ordine di severità) ──────────────
      const tDecide = now();
      const auctionId = computeAuctionId(
        uiSignature(nodes),
        price ? [price.amountEur] : [],
      );
      base.auctionId = auctionId;
      base.offersSpent = getOffersSpent(auctionId);

      let proceed = true;
      let reason = "";

      if (isEmergencyStopped()) {
        proceed = false;
        reason = "ARRESTO DI EMERGENZA attivo — riarmare dall'interfaccia";
      } else if (!offerNode) {
        proceed = false;
        reason = "pulsante Offri non individuato con confidenza sufficiente";
      } else if (button.score < config.confidenceThreshold) {
        proceed = false;
        reason = `punteggio pulsante ${button.score} sotto soglia ${config.confidenceThreshold}`;
      } else if (!price || price.confidence < config.priceConfidenceThreshold) {
        proceed = false;
        reason = "prezzo non leggibile con affidabilità sufficiente";
      } else if (price.amountEur > config.maxBidEur) {
        proceed = false;
        reason = `prezzo ${price.amountEur}€ sopra il massimo consentito ${config.maxBidEur}€`;
      } else if (base.offersSpent >= config.maxOffersPerAuction) {
        proceed = false;
        reason = `numero massimo di offerte per asta raggiunto (${base.offersSpent}/${config.maxOffersPerAuction})`;
      }

      timings.decideMs = Math.round(now() - tDecide);
      if (!proceed) {
        return skipResult(
          base,
          reason,
          mode === "evaluate" ? "evaluate" : "dry",
        );
      }

      // Da qui in poi: condizioni OK. Il tap reale avviene SOLO in mode "live"
      // E con dry-run disattivato in configurazione (doppia conferma).
      if (mode !== "live" || config.dryRun) {
        base.decision = "offer";
        base.reason =
          mode !== "live"
            ? "condizioni soddisfatte (valutazione, nessun tap)"
            : "condizioni soddisfatte — dry-run attivo in configurazione, nessun tap";
        appendJournal(
          toJournal(
            base,
            mode === "evaluate" ? "evaluate" : "dry",
            null,
            null,
            timings,
          ),
        );
        return base;
      }

      // ── 4. TAP REALE (uno solo) ────────────────────────────────────────
      if (!offerNode) {
        // Difesa in profondità: irraggiungibile dopo le guardie sopra.
        timings.decideMs = timings.decideMs ?? 0;
        return skipResult(
          base,
          "stato interno incoerente (pulsante assente)",
          "evaluate",
        );
      }
      const center = offerNode.center;
      let tapError: string | null = null;
      const tTap = now();
      try {
        try {
          await runInShellSession(serial, `input tap ${center.x} ${center.y}`);
        } catch {
          // fallback: percorso classico (spawn adb dedicato)
          await adbTap(serial, center.x, center.y);
        }
        timings.tapMs = Math.round(now() - tTap);
      } catch (err) {
        timings.tapMs = Math.round(now() - tTap);
        tapError = err instanceof Error ? err.message : String(err);
      }

      let uiChanged: boolean | null = null;

      if (tapError === null) {
        // Fail-closed: il tap è stato inviato → conta come spesa anche se la
        // verifica resta ambigua.
        recordOfferSpent(auctionId);
        base.offersSpent = getOffersSpent(auctionId);

        await sleep(TAP_SETTLE_MS);
        const tVerify = now();
        try {
          const xmlAfter = await dumpUiHierarchy(serial);
          const afterNodes = parseUiHierarchy(xmlAfter);
          uiChanged = uiSignature(afterNodes) !== uiSignature(nodes);
          timings.verifyMs = Math.round(now() - tVerify);
        } catch {
          timings.verifyMs = Math.round(now() - tVerify);
        }
      }

      try {
        const shot = await captureAndSave(serial);
        base.screenshotFile = shot.file;
      } catch {
        // screenshot non critico per la decisione
      }

      base.decision = tapError === null ? "offer" : "skip";
      base.uiChangedAfterTap = uiChanged;
      base.error = tapError;
      base.reason =
        tapError !== null
          ? `errore durante il tap: ${tapError}`
          : uiChanged === true
            ? "tap eseguito — UI cambiata"
            : uiChanged === false
              ? "tap eseguito — UI invariata (verificare manualmente)"
              : "tap eseguito — verifica UI non disponibile";

      appendJournal(toJournal(base, "offer", tapError, uiChanged, timings));
      return base;
    },
  );

  // Lock occupato: un round è già in volo per questo device.
  return (
    locked ?? {
      ...base,
      reason: "round già in corso per questo device (lock attivo)",
    }
  );
}
