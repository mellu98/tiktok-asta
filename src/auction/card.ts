/**
 * Interpretazione della card asta di TikTok LIVE a partire dalle righe OCR.
 *
 * Geometria ricavata dalle letture reali (Samsung SM-A057G, 1080×2400) e
 * scalata sulla larghezza dello schermo:
 *   riga timer (badge sulla miniatura, a sinistra) + prezzo  ~185 px sopra il pulsante
 *   titolo «Prolungata • <articolo>»                          ~120 px sopra
 *   «2 € di spedizione • …»                                    ~70 px sopra (a volte assente)
 *   «Personalizzato» | «Offri N €»                             riga del pulsante
 *
 * FAIL-CLOSED: il pulsante vale solo se «Personalizzato» è sulla stessa riga
 * (un commento «Offri 5 €» non basta); timer ambiguo → fase unknown.
 */

import type { AuctionCard, AuctionPhase, OcrLine } from "../shared/types";
import { parseAmountEur } from "./price";

const REF_WIDTH = 1080;
/** Il badge del timer sta sulla miniatura: a sinistra del prezzo. */
const TIMER_MAX_X = 0.32;
/** Il prezzo inizia dopo la miniatura, nella metà sinistra. */
const PRICE_MIN_X = 0.26;
const PRICE_MAX_X = 0.5;
/** Soglia fra "in corso" (MM:SS) e "ultimi secondi" (Ns). */
const FINAL_PHASE_SEC = 10;

const OFFER_RE = /^\s*Offri\s+(.*€)\s*$/i;
const PERSONALIZED_RE = /^\s*Personalizzat/i;
const TITLE_RE = /Pro\S*ngata\s*[•·.]\s*(.+)$/i;
const LEADING_PRICE_RE = /^\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*€/;
const FINAL_OFFER_RE = /Offerta finale\s+(.+€)/i;

/** Secondi dal badge del timer, oppure null se la lettura è ambigua. */
export function parseTimerText(text: string): number | null {
  // L'icona del martelletto negli ultimi secondi viene letta come ">".
  const t = text.trim().replace(/^[>›»<\s]+/, "");
  const mmss = /^(\d{1,2}):(\d{2})[^\d:]?$/.exec(t);
  if (mmss) {
    const sec = Number(mmss[2]);
    return sec < 60 ? Number(mmss[1]) * 60 + sec : null;
  }
  const secs = /^([0-9Oo]{1,2})\s?s$/.exec(t);
  return secs ? Number((secs[1] ?? "").replace(/[Oo]/g, "0")) : null;
}

/**
 * Chiave stabile dell'articolo: niente contatore #N, niente puntini, spazi
 * uniformi. Scelta prudente: «#1 46- SWEATER…» e «#2 46- SWEATER…» (unità
 * successive dello stesso prodotto, viste in LIVE) contano come UN articolo
 * per il limite di offerte; «♻ Nuova asta» azzera il contatore.
 */
export function normalizeItemKey(title: string): string | null {
  const key = title
    .replace(/^\s*#\d+\s*/, "")
    .replace(/[.…\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return key.length > 0 ? key : null;
}

/** Distanza di Levenshtein (titoli brevi: ~20-40 caratteri). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** Errori OCR tollerati sul titolo: 1 carattere ogni 7 (minimo 1). */
const TITLE_EDIT_RATIO = 1 / 7;

/**
 * Stesso articolo anche con qualche carattere letto male dall'OCR. Direzione
 * prudente: due prodotti con titoli quasi identici contano come uno solo per
 * il limite di offerte, mai il contrario.
 */
export function isSameItem(a: string, b: string): boolean {
  if (a === b) return true;
  const tolerance = Math.max(1, Math.floor(Math.max(a.length, b.length) * TITLE_EDIT_RATIO));
  return editDistance(a, b) <= tolerance;
}

function midY(line: OcrLine): number {
  return (line.bounds.y1 + line.bounds.y2) / 2;
}

/** Pulsante «Offri N €» con «Personalizzato» alla sua sinistra, sulla stessa riga. */
function findOfferRow(lines: OcrLine[], scale: number): { offer: OcrLine; amount: number } | null {
  const personalized = lines.filter((l) => PERSONALIZED_RE.test(l.text));
  for (const line of lines) {
    const m = OFFER_RE.exec(line.text);
    if (!m) continue;
    const amount = parseAmountEur(m[1] ?? "");
    if (amount === null) continue;
    const paired = personalized.some(
      (p) => Math.abs(midY(p) - midY(line)) <= 30 * scale && p.bounds.x2 < line.bounds.x1,
    );
    if (paired) return { offer: line, amount };
  }
  return null;
}

function titleOf(lines: OcrLine[]): OcrLine | null {
  return lines.find((l) => TITLE_RE.test(l.text)) ?? null;
}

function textMatches(lines: OcrLine[], re: RegExp): boolean {
  return lines.some((l) => re.test(l.text));
}

/**
 * Card asta dalle righe OCR. null = nessuna card riconoscibile sullo schermo.
 * width/height: dimensioni dello schermo in pixel (quelle dello screenshot).
 */
export function parseAuctionCard(
  allLines: OcrLine[],
  width: number,
  height: number,
): AuctionCard | null {
  const scale = width / REF_WIDTH;
  const lower = allLines.filter((l) => l.bounds.y1 >= height * 0.4);

  const offerRow = findOfferRow(lower, scale);
  const title = titleOf(lower);
  const finalLine = lower.find((l) => FINAL_OFFER_RE.test(l.text)) ?? null;

  // Fascia verticale della card: ancorata al pulsante, altrimenti al titolo.
  let band: OcrLine[] = [];
  if (offerRow) {
    const y = offerRow.offer.bounds.y1;
    band = lower.filter((l) => l.bounds.y1 >= y - 230 * scale && l.bounds.y1 <= y + 30 * scale);
  } else if (title) {
    const y = title.bounds.y1;
    band = lower.filter((l) => l.bounds.y1 >= y - 110 * scale && l.bounds.y1 <= y + 190 * scale);
  }

  const waiting = textMatches(lower, /In attesa del prossimo articolo/i);
  const coming = textMatches(lower, /^\s*In arrivo\s*$/i);
  if (!offerRow && !title && !finalLine && !waiting && !coming) return null;

  // Timer: badge sulla miniatura. Più letture diverse → ambiguo.
  const timerCandidates = band
    .filter((l) => l.bounds.x2 <= width * TIMER_MAX_X)
    .map((l) => ({ line: l, sec: parseTimerText(l.text) }))
    .filter((c): c is { line: OcrLine; sec: number } => c.sec !== null);
  const timerValues = new Set(timerCandidates.map((c) => c.sec));
  const timer = timerValues.size === 1 ? (timerCandidates[0] ?? null) : null;

  // Prezzo attuale: primo importo della riga di intestazione, a destra della miniatura.
  const priceLine =
    band.find(
      (l) =>
        l.bounds.x1 >= width * PRICE_MIN_X &&
        l.bounds.x1 <= width * PRICE_MAX_X &&
        LEADING_PRICE_RE.test(l.text),
    ) ?? null;
  const priceMatch = priceLine ? LEADING_PRICE_RE.exec(priceLine.text) : null;
  const currentPriceEur = priceMatch ? parseAmountEur(`${priceMatch[1]} €`) : null;

  const finalMatch = finalLine ? FINAL_OFFER_RE.exec(finalLine.text) : null;
  const itemTitle = title ? (TITLE_RE.exec(title.text)?.[1] ?? "").trim() || null : null;

  let phase: AuctionPhase;
  if (finalLine) phase = "sold";
  else if (waiting) phase = "waiting";
  else if (coming && !offerRow) phase = "coming";
  else if (!offerRow || !timer) phase = "unknown";
  else if (timer.sec === 0) phase = "closing";
  else if (timer.sec <= FINAL_PHASE_SEC) phase = "final";
  else phase = "running";

  const offer = offerRow
    ? {
        label: offerRow.offer.text.trim(),
        amountEur: offerRow.amount,
        conf: offerRow.offer.conf,
        bounds: offerRow.offer.bounds,
        center: offerRow.offer.center,
      }
    : null;

  return {
    phase,
    timerSec: timer ? timer.sec : null,
    timerText: timer ? timer.line.text : null,
    timerConf: timer ? timer.line.conf : null,
    currentPriceEur,
    priceConf: priceLine ? priceLine.conf : null,
    startingPrice: textMatches(band, /Offerta iniziale/i),
    hasBids: textMatches(band, /ha fatto l.offerta pi/i),
    resetNotice: textMatches(band, /ripristinan/i),
    offer: phase === "sold" || phase === "waiting" || phase === "coming" ? null : offer,
    itemTitle,
    itemTitleConf: itemTitle && title ? title.conf : null,
    itemKey: itemTitle ? normalizeItemKey(itemTitle) : null,
    finalPriceEur: finalMatch ? parseAmountEur(finalMatch[1] ?? "") : null,
  };
}
