import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAuctionCard } from "../../src/auction/card";
import { parseOcrOutput } from "../../src/vision/ocr";
import type { AuctionCard, OcrLine } from "../../src/shared/types";

/** Fixture reale: righe OCR (Vision) grezze, confidenza 0-1. */
export interface OcrFixture {
  w: number;
  h: number;
  lines: { text: string; conf: number; x1: number; y1: number; x2: number; y2: number }[];
}

export function loadOcrFixture(name: string): OcrFixture {
  const file = fileURLToPath(new URL(`../fixtures/ocr/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, "utf8")) as OcrFixture;
}

export function ocrLinesOf(fx: OcrFixture): OcrLine[] {
  return parseOcrOutput(JSON.stringify({ w: fx.w, h: fx.h, ms: 0, lines: fx.lines })).lines;
}

/** Sostituisce il testo di una riga (per varianti sintetiche di una fixture reale). */
export function withText(fx: OcrFixture, from: string, to: string): OcrFixture {
  return { ...fx, lines: fx.lines.map((l) => (l.text === from ? { ...l, text: to } : l)) };
}

export function cardOf(fx: OcrFixture): AuctionCard | null {
  return parseAuctionCard(ocrLinesOf(fx), fx.w, fx.h);
}
