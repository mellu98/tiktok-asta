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
 * Importi riconosciuti: "1.234 €", "1234 euro", "€ 500", "12,50 €", "999€",
 * anche senza simbolo se il nodo è adiacente a parole di asta (chiamante).
 */
const AMOUNT_RE = /(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?\s*(?:€|eur\b)|€\s*(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?/gi;

export interface PriceCandidate {
  /** Valore numerico normalizzato in euro (Number). */
  amountEur: number
  /** Testo originale del nodo. */
  raw: string
  node: UiNode
}

/** Parsing di un importo italiano → euro. Ritorna null se non interpretabile. */
export function parseAmountEur(raw: string): number | null {
  const m = AMOUNT_RE.exec(raw);
  AMOUNT_RE.lastIndex = 0;
  if (!m) return null;
  let token = (m[0] ?? "").replace(/[€\s]|eur/gi, "");

  // Separatori it-IT vs en-US: l'ultimo separatore è il decimale; i gruppi
  // da 3 cifre finali indicano migliaia.
  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      token = token.replace(/\./g, "").replace(",", ".");
    } else {
      token = token.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    token = /,\d{1,2}$/.test(token)
      ? token.replace(",", ".")
      : token.replace(/,/g, "");
  } else if (lastDot !== -1) {
    token = /(\.\d{3})+$/.test(token) ? token.replace(/\./g, "") : token;
  }

  const value = Number(token);
  return Number.isFinite(value) ? value : null;
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
  amountEur: number
  confidence: number
  candidates: PriceCandidate[]
  reason: string
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
  const distinctTops = new Set(topCandidates.map((c) => Math.round(c.amountEur * 100))).size;

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
        verticalDistance(a.node, offerButton) - verticalDistance(b.node, offerButton),
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
    return { ...estimate, confidence, reason: `${estimate.reason} — SOPRA SOGLIA NO` };
  }
  return estimate;
}

function verticalDistance(a: UiNode, b: UiNode): number {
  return Math.abs((a.bounds.y1 + a.bounds.y2) / 2 - (b.bounds.y1 + b.bounds.y2) / 2);
}
