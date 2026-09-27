/**
 * Stato per-asta: quante offerte sono state realmente spese su ciascuna asta
 * identificata. Persistito su file → il conteggio resta coerente attraverso
 * retry, errori e riavvii dell'app. Il lock in-process impedisce tap
 * concorrenti sullo stesso device.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { stateFile, setDataDir } from "./base-dir";

interface AuctionEntry {
  auctionId: string;
  offersSpent: number;
  firstSeenAt: number;
  lastOfferAt: number | null;
}

interface AuctionStateFile {
  version: 1;
  currentAuctionId: string | null;
  auctions: Record<string, AuctionEntry>;
}

let cached: AuctionStateFile | null = null;

/** Imposta la data dir e invalida la cache. */
export function setStateBaseDir(dir: string): void {
  setDataDir(dir);
  cached = null;
}

function loadState(): AuctionStateFile {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(stateFile(), "utf8")) as AuctionStateFile;
    cached =
      raw && raw.version === 1 && typeof raw.auctions === "object"
        ? raw
        : { version: 1, currentAuctionId: null, auctions: {} };
  } catch {
    cached = { version: 1, currentAuctionId: null, auctions: {} };
  }
  return cached;
}

function saveState(): void {
  if (!cached) return;
  mkdirSync(dirname(stateFile()), { recursive: true });
  writeFileSync(stateFile(), `${JSON.stringify(cached, null, 2)}\n`, "utf8");
}

/**
 * Identificatore deterministico e stabile dell'asta corrente.
 *
 * NOTE SULLA ROBUSTEZZA (documentato, onesto): l'id deriva dagli importi
 * visibili + la firma forte dell'albero. Se TikTok cambia pagina o l'importo
 * cambia, l'id cambia: il contatore per-asta protegge da DOPPIE offerte sulla
 * stessa schermata, non dall'identità business dell'asta. I limiti difensivi
 * veri restano maxOffersPerAuction + maxBidEur + estop.
 */
export function computeAuctionId(
  uiSignatureStrong: string,
  amounts: number[],
): string {
  const amountsKey = [...amounts].sort((a, b) => a - b).join(",");
  const h = createHash("sha1");
  h.update(`${uiSignatureStrong.slice(0, 120)}::${amountsKey}`);
  return h.digest("hex").slice(0, 16);
}

export interface AuctionCounters {
  auctionId: string;
  offersSpent: number;
}

/** Contatore corrente per l'asta indicata (0 se mai usata). */
export function getOffersSpent(auctionId: string): number {
  const state = loadState();
  state.currentAuctionId = auctionId;
  return state.auctions[auctionId]?.offersSpent ?? 0;
}

/**
 * Registra UNA offerta realmente spesa. Da chiamare SOLO dopo l'invio del
 * comando di tap (o in caso di esito incerto: fail-closed conta comunque).
 */
export function recordOfferSpent(auctionId: string): AuctionCounters {
  const state = loadState();
  state.currentAuctionId = auctionId;
  const entry: AuctionEntry = state.auctions[auctionId] ?? {
    auctionId,
    offersSpent: 0,
    firstSeenAt: Date.now(),
    lastOfferAt: null,
  };
  entry.offersSpent += 1;
  entry.lastOfferAt = Date.now();
  state.auctions[auctionId] = entry;
  saveState();
  return { auctionId, offersSpent: entry.offersSpent };
}

/** Reset manuale (nuova asta): azzera il contatore dell'asta indicata o di tutte. */
export function resetAuction(auctionId: string | null): void {
  const state = loadState();
  if (auctionId === null) {
    state.auctions = {};
  } else {
    delete state.auctions[auctionId];
  }
  saveState();
}

/** Elenco per la UI (più recenti prima). */
export function listAuctions(): AuctionEntry[] {
  return Object.values(loadState().auctions).sort(
    (a, b) =>
      (b.lastOfferAt ?? b.firstSeenAt) - (a.lastOfferAt ?? a.firstSeenAt),
  );
}

// ── Lock per device: un solo tap "in volo" alla volta ──────────────────────
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Esegue fn in modo serializzato per il device indicato: se un round è già
 * in corso, il nuovo tentativo viene rifiutato (fail-closed, nessuna coda).
 */
export function withDeviceLock<T>(
  serial: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (inFlight.has(serial)) return Promise.resolve(null);
  const p = fn().finally(() => inFlight.delete(serial));
  inFlight.set(serial, p);
  return p;
}

export function isDeviceBusy(serial: string): boolean {
  return inFlight.has(serial);
}
