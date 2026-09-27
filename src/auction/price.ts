/**
 * Estrazione del prezzo dell'asta dall'albero UI.
 *
 * FAIL-CLOSED: il prezzo viene restituito SOLO con un valore numerico
 * interpretabile e un punteggio di confidenza. Ambiguità (importi multipli
 * incoerenti, nessun match) → confidence bassa → chi usa questo modulo NON
 * deve offrire sotto soglia.
 */

import type { UiNode } from "../shared/types";

/**
 * Importi riconosciuti: numero con separatori adiacente al simbolo €
 * (prima o dopo) oppure alla parola "eur".
 */
const AMOUNT_RE = /€\s*(\d[\d.,]*\d|\d)|(\d[\d.,]*\d|\d)\s*(?:€|\beur\b)/i;

export interface PriceCandidate {
  /** Valore numerico normalizzato in euro (Number). */
  amountEur: number;
  /** Testo originale del nodo. */
  raw: string;
  node: UiNode;
}

function toNum(token: string): number | null {
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizzazione SEPARATORS, regola it-IT documentata:
 * - entrambi i separatori presenti → l'ULTIMO è il decimale, l'altro migliaia
 *   ("1.234,50" → 1234.50; "1,234.50" → 1234.50)
 * - solo virgola → SEMPRE decimale (it-IT rigoroso): "12,50" → 12.5;
 *   "1,234" → 1.234 (esplicito: si intende 1,234 € = un euro e 234 centesimi)
 * - solo punto → migliaia se tutti i gruppi dopo la prima cifra sono da 3
 *   ("1.234" → 1234; "12.345.678" → 12345678); altrimenti decimale
 *   ("12.50" → 12.5)
 */
function normalizeNumericToken(token: string): number | null {
  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      return toNum(token.replace(/\./g, "").replace(",", "."));
    }
    return toNum(token.replace(/,/g, ""));
  }
  if (lastComma !== -1) {
    return toNum(token.replace(/,/g, "."));
  }
  if (lastDot !== -1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(token)) {
      return toNum(token.replace(/\./g, ""));
    }
    return toNum(token);
  }
  return toNum(token);
}

/**
 * Parsing di un importo con € adiacente → euro. Ritorna null se non
 * interpretabile o se il numero non è adiacente a €/eur.
 */
export function parseAmountEur(raw: string): number | null {
  const m = AMOUNT_RE.exec(raw);
  if (!m) return null;
  const token = (m[1] ?? m[2] ?? "").trim();
  return normalizeNumericToken(token);
}

/** Importi presenti nell'albero (nodi testo con importi riconoscibili). */
export function extractPriceCandidates(nodes: UiNode[]): PriceCandidate[] {
  const out: PriceCandidate[] = [];
  for (const node of nodes) {
    const haystack = `${node.text} ${node.contentDesc}`.trim();
    if (!haystack) continue;
    const amount = parseAmountEur(haystack);
    if (amount === null) continue;
    out.push({ amountEur: amount, raw: haystack, node });
  }
  return out;
}

export interface PriceEstimate {
  amountEur: number;
  confidence: number;
  candidates: PriceCandidate[];
  reason: string;
}

/**
 * Stima del "prezzo prossima offerta" con punteggio di confidenza.
 *
 * Euristica dichiarata (da rivedere sul dump reale del Samsung):
 * - importo massimo visibile come stima della prossima offerta
 * - penalità se ci sono più importi massimi DIVERSI (ambiguità)
 * - bonus se il nodo è vicino (stesso schermo, distanza verticale) al centro
 *   del pulsante Offri candidato
 */
export function estimateNextBid(
  nodes: UiNode[],
  offerButton: UiNode | null,
  priceConfidenceThreshold: number,
): PriceEstimate | null {
  const candidates = extractPriceCandidates(nodes);
  if (candidates.length === 0) {
    return null;
  }

  const maxAmount = Math.max(...candidates.map((c) => c.amountEur));
  const topCandidates = candidates.filter((c) => c.amountEur === maxAmount);
  const distinctTops = new Set(
    topCandidates.map((c) => Math.round(c.amountEur * 100)),
  ).size;

  let confidence = 100;
  const reasons: string[] = [];

  if (distinctTops > 1) {
    confidence -= 50;
    reasons.push("importi massimi diversi nella schermata (ambiguità)");
  }
  if (topCandidates.length === 1) {
    confidence -= 20;
    reasons.push("singola occorrenza dell'importo massimo");
  }

  if (offerButton) {
    const nearest = [...candidates].sort(
      (a, b) =>
        verticalDistance(a.node, offerButton) -
        verticalDistance(b.node, offerButton),
    )[0];
    if (nearest && verticalDistance(nearest.node, offerButton) <= 900) {
      confidence += 15;
      reasons.push("importo vicino al pulsante Offri");
    }
  }

  confidence = Math.max(0, Math.min(100, confidence));

  const estimate: PriceEstimate = {
    amountEur: maxAmount,
    confidence,
    candidates,
    reason: reasons.join("; ") || "coerente",
  };

  // Fail-closed: sotto soglia il chiamante deve trattarla come non disponibile.
  if (confidence < priceConfidenceThreshold) {
    return {
      ...estimate,
      confidence,
      reason: `${estimate.reason} — SOPRA SOGLIA NO`,
    };
  }
  return estimate;
}

function verticalDistance(a: UiNode, b: UiNode): number {
  return Math.abs(
    (a.bounds.y1 + a.bounds.y2) / 2 - (b.bounds.y1 + b.bounds.y2) / 2,
  );
}
