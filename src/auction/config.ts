/**
 * Configurazione dell'automazione offerte: limiti economici e modalità.
 *
 * Persistita su file (auction-config.json nella data dir) così che i limiti
 * sopravvivano ai riavvii dell'app. Validazione fail-closed: valori assenti
 * o non sensati ricadono sui default SICURI.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AuctionConfig } from "../shared/types";
import { configFile, setDataDir } from "./base-dir";

export type { AuctionConfig };

/** Default sicuri: con maxBid/maxOffers a 0 nessuna offerta è mai possibile. */
export const DEFAULT_CONFIG: AuctionConfig = {
  maxBidEur: 0,
  maxOffersPerAuction: 0,
  confidenceThreshold: 70,
  priceConfidenceThreshold: 60,
  dryRun: true,
  autoRoundMs: 0,
};

export function sanitizeConfig(
  raw: Partial<AuctionConfig> | null | undefined,
): AuctionConfig {
  const num = (
    v: unknown,
    def: number,
    min: number,
    max: number,
    integer = false,
  ): number => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return def;
    const clamped = Math.min(max, Math.max(min, n));
    return integer ? Math.round(clamped) : clamped;
  };
  return {
    maxBidEur: num(raw?.maxBidEur, DEFAULT_CONFIG.maxBidEur, 0, 1_000_000),
    maxOffersPerAuction: num(
      raw?.maxOffersPerAuction,
      DEFAULT_CONFIG.maxOffersPerAuction,
      0,
      999,
      true,
    ),
    confidenceThreshold: num(
      raw?.confidenceThreshold,
      DEFAULT_CONFIG.confidenceThreshold,
      0,
      100,
    ),
    priceConfidenceThreshold: num(
      raw?.priceConfidenceThreshold,
      DEFAULT_CONFIG.priceConfidenceThreshold,
      0,
      100,
    ),
    dryRun:
      typeof raw?.dryRun === "boolean" ? raw.dryRun : DEFAULT_CONFIG.dryRun,
    autoRoundMs: num(
      raw?.autoRoundMs,
      DEFAULT_CONFIG.autoRoundMs,
      0,
      600000,
      true,
    ),
  };
}

let cached: AuctionConfig | null = null;

/** Imposta la data dir e invalida la cache. */
export function setConfigBaseDir(dir: string): void {
  setDataDir(dir);
  cached = null;
}

export function loadConfig(): AuctionConfig {
  if (cached) return cached;
  try {
    const raw = JSON.parse(
      readFileSync(configFile(), "utf8"),
    ) as Partial<AuctionConfig>;
    cached = sanitizeConfig(raw);
  } catch {
    cached = { ...DEFAULT_CONFIG };
  }
  return cached;
}

export function saveConfig(next: Partial<AuctionConfig>): AuctionConfig {
  const sanitized = sanitizeConfig({ ...loadConfig(), ...next });
  mkdirSync(dirname(configFile()), { recursive: true });
  writeFileSync(
    configFile(),
    `${JSON.stringify(sanitized, null, 2)}\n`,
    "utf8",
  );
  cached = sanitized;
  return sanitized;
}

/** Reset usato nei test. */
export function resetConfigCache(
  next: Partial<AuctionConfig> = {},
): AuctionConfig {
  cached = sanitizeConfig(next);
  return cached;
}
