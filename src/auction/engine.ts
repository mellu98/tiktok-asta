/**
 * Motore dell'automazione offerte. Un round:
 *   lettura (screenshot raw + OCR) → card asta → guardie fail-closed →
 *   seconda lettura di conferma → (solo mode "live" E dry-run spento) UN tap
 *   al centro di «Offri N €» → verifica sul prezzo.
 *
 * FAIL-CLOSED: qualunque incertezza (estop, fase non attiva, timer ambiguo,
 * letture poco affidabili o sfasate, limiti, lock occupato) → decision=skip.
 *
 * Nessun loop automatico aggressivo: la ripetizione è demandata al chiamante.
 */

import { performance } from "node:perf_hooks";
import { framePath, saveReading } from "./artifacts";
import { parseAuctionCard } from "./card";
import { loadConfig } from "./config";
import { assessCard, confirmCard, verifyOffer } from "./decide";
import { appendJournal } from "./journal";
import { isEmergencyStopped } from "./safety";
import {
  computeAuctionId,
  getOffersSpentForItem,
  recordOfferSpent,
  withDeviceLock,
} from "./state";
import { tap as adbTap } from "../adb/commands";
import { runInShellSession } from "../adb/shell-session";
import { readScreen, type ScreenReading } from "../vision/ocr";
import type {
  AuctionCard,
  JournalEntry,
  RoundResult,
  RoundTimings,
} from "../shared/types";

/** Attesa prima di rileggere il prezzo dopo il tap. */
const VERIFY_DELAY_MS = 1200;

function now(): number {
  return performance.now();
}

function elapsed(since: number): number {
  return Math.round(now() - since);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function applyCard(base: RoundResult, card: AuctionCard | null): void {
  const confs = [card?.offer?.conf, card?.timerConf, card?.priceConf].filter(
    (c): c is number => typeof c === "number",
  );
  base.phase = card?.phase ?? null;
  base.timerSec = card?.timerSec ?? null;
  base.itemTitle = card?.itemTitle ?? null;
  base.currentPriceEur = card?.currentPriceEur ?? null;
  base.offerAmountEur = card?.offer?.amountEur ?? null;
  base.offerLabel = card?.offer?.label ?? null;
  base.offerCenter = card?.offer?.center ?? null;
  base.ocrConfidence = confs.length > 0 ? Math.min(...confs) : null;
}

function journalKind(mode: RoundResult["mode"]): "evaluate" | "dry" {
  return mode === "evaluate" ? "evaluate" : "dry";
}

function toJournal(
  base: RoundResult,
  kind: JournalEntry["kind"],
  commandError: string | null,
): JournalEntry {
  return {
    ts: Date.now(),
    serial: base.serial,
    auctionId: base.auctionId,
    kind,
    decision: base.decision,
    reason: base.reason,
    phase: base.phase,
    timerSec: base.timerSec,
    itemTitle: base.itemTitle,
    currentPriceEur: base.currentPriceEur,
    offerAmountEur: base.offerAmountEur,
    offerCenter: base.offerCenter,
    limits: {
      maxBidEur: base.limits.maxBidEur,
      maxOffersPerAuction: base.limits.maxOffersPerAuction,
      offersSpent: base.offersSpent,
      confidenceThreshold: base.limits.confidenceThreshold,
    },
    readingFile: base.readingFile,
    screenshotFile: base.screenshotFile,
    commandError,
    verifyOutcome: base.verifyOutcome,
    timings: base.timings,
  };
}

function skip(base: RoundResult, reason: string): RoundResult {
  base.decision = "skip";
  base.reason = reason;
  appendJournal(toJournal(base, journalKind(base.mode), null));
  return base;
}

/** Una lettura interpretata; lancia se screenshot o OCR falliscono. */
async function readCard(
  serial: string,
  saveImage?: string,
): Promise<{ reading: ScreenReading; card: AuctionCard | null; parseMs: number }> {
  const reading = await readScreen(serial, { saveImage });
  const t = now();
  const card = parseAuctionCard(reading.lines, reading.width, reading.height);
  return { reading, card, parseMs: elapsed(t) };
}

/** UN tap: sessione shell persistente, con ripiego su un adb dedicato. */
async function sendTap(serial: string, x: number, y: number): Promise<void> {
  try {
    await runInShellSession(serial, `input tap ${x} ${y}`);
  } catch {
    await adbTap(serial, x, y);
  }
}

function emptyResult(serial: string, mode: RoundResult["mode"]): RoundResult {
  const config = loadConfig();
  const timings: RoundTimings = {
    captureMs: 0,
    ocrMs: 0,
    parseMs: 0,
    decideMs: 0,
    confirmMs: null,
    tapMs: null,
    verifyMs: null,
  };
  return {
    serial,
    mode,
    auctionId: null,
    decision: "skip",
    reason: "",
    phase: null,
    timerSec: null,
    itemTitle: null,
    currentPriceEur: null,
    offerAmountEur: null,
    offerLabel: null,
    offerCenter: null,
    ocrConfidence: null,
    offersSpent: 0,
    limits: {
      maxBidEur: config.maxBidEur,
      maxOffersPerAuction: config.maxOffersPerAuction,
      confidenceThreshold: config.confidenceThreshold,
      priceConfidenceThreshold: config.priceConfidenceThreshold,
      dryRun: config.dryRun,
      estopEngaged: isEmergencyStopped(),
    },
    readingFile: null,
    screenshotFile: null,
    verifyOutcome: null,
    uiChangedAfterTap: null,
    error: null,
    timings,
  };
}

async function lockedRound(base: RoundResult): Promise<RoundResult> {
  const { serial, mode, timings } = base;
  const config = loadConfig();

  // ── 1. LETTURA ─────────────────────────────────────────────────────────
  let first: Awaited<ReturnType<typeof readCard>>;
  try {
    first = await readCard(serial, framePath(serial, "round", "decisione"));
  } catch (err) {
    base.error = errorMessage(err);
    return skip(base, "lettura dello schermo non riuscita");
  }
  timings.captureMs = first.reading.captureMs;
  timings.ocrMs = first.reading.ocrMs;
  timings.parseMs = first.parseMs;
  base.screenshotFile = first.reading.imageFile;
  base.readingFile = saveReading(serial, first.reading, first.card);
  applyCard(base, first.card);

  // ── 2. DECISIONE (guardie fail-closed) ─────────────────────────────────
  const tDecide = now();
  const itemKey = first.card?.itemKey ?? null;
  base.auctionId = itemKey ? computeAuctionId(itemKey) : null;
  base.offersSpent = itemKey ? getOffersSpentForItem(itemKey) : 0;
  const verdict = assessCard(first.card, config, {
    estop: isEmergencyStopped(),
    offersSpent: base.offersSpent,
  });
  timings.decideMs = elapsed(tDecide);
  if (!verdict.ok) return skip(base, verdict.reason);

  // ── 3. CONFERMA: seconda lettura subito prima di agire ─────────────────
  const tConfirm = now();
  let second: Awaited<ReturnType<typeof readCard>>;
  try {
    second = await readCard(serial, framePath(serial, "round", "conferma"));
  } catch (err) {
    timings.confirmMs = elapsed(tConfirm);
    base.error = errorMessage(err);
    return skip(base, "conferma fallita: lettura dello schermo non riuscita");
  }
  timings.confirmMs = elapsed(tConfirm);
  const confirmed = second.card;
  const confirmation = confirmCard(first.card, confirmed, config, {
    estop: isEmergencyStopped(),
    offersSpent: base.offersSpent,
  });
  if (!confirmation.ok) return skip(base, confirmation.reason);
  // Da qui si agisce sulla lettura di conferma: valori, frame e righe OCR coerenti.
  applyCard(base, confirmed);
  base.screenshotFile = second.reading.imageFile;
  base.readingFile = saveReading(serial, second.reading, confirmed);

  // Il tap reale avviene SOLO in mode "live" E con dry-run spento (doppia conferma).
  if (mode !== "live" || config.dryRun) {
    base.decision = "offer";
    base.reason =
      mode !== "live"
        ? "condizioni soddisfatte e confermate (valutazione, nessun tap)"
        : "condizioni soddisfatte e confermate — dry-run attivo in configurazione, nessun tap";
    appendJournal(toJournal(base, journalKind(mode), null));
    return base;
  }

  // ── 4. TAP REALE (uno solo) ────────────────────────────────────────────
  const target = confirmed?.offer;
  if (!target || !base.auctionId || !itemKey) {
    // Difesa in profondità: irraggiungibile dopo le guardie sopra.
    return skip(base, "stato interno incoerente (pulsante assente)");
  }
  let tapError: string | null = null;
  const tTap = now();
  try {
    await sendTap(serial, target.center.x, target.center.y);
  } catch (err) {
    tapError = errorMessage(err);
  }
  timings.tapMs = elapsed(tTap);

  if (tapError === null) {
    // Fail-closed: il tap è partito → conta come offerta anche se la verifica è incerta.
    recordOfferSpent(base.auctionId, itemKey);
    base.offersSpent = getOffersSpentForItem(itemKey);

    // ── 5. VERIFICA sul prezzo ─────────────────────────────────────────
    await sleep(VERIFY_DELAY_MS);
    const tVerify = now();
    try {
      const after = await readCard(serial, framePath(serial, "round", "verifica"));
      const verdictAfter = verifyOffer(target.amountEur, after.card);
      base.verifyOutcome = verdictAfter.outcome;
      base.uiChangedAfterTap = verdictAfter.changed;
    } catch {
      base.verifyOutcome = "verifica non disponibile";
    }
    timings.verifyMs = elapsed(tVerify);
  }

  base.decision = tapError === null ? "offer" : "skip";
  base.error = tapError;
  base.reason =
    tapError !== null
      ? `errore durante il tap: ${tapError}`
      : `tap eseguito su «${target.label}» — ${base.verifyOutcome ?? "verifica non disponibile"}`;
  appendJournal(toJournal(base, "offer", tapError));
  return base;
}

/**
 * Esegue UN round. Con mode="live" il tap reale avviene SOLO se passano
 * tutte le guardie su due letture consecutive e il dry-run è spento.
 */
export async function runRound(
  serial: string,
  mode: "evaluate" | "dry" | "live",
): Promise<RoundResult> {
  const base = emptyResult(serial, mode);
  // Lock per device: se un round è già in corso, rifiuta senza accodare.
  const locked = await withDeviceLock(serial, () => lockedRound(base));
  return locked ?? { ...base, reason: "round già in corso per questo device (lock attivo)" };
}
