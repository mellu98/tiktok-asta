/**
 * Riconoscimento del pulsante "Offri" con PUNTEGGIO DI CONFIDENZA.
 *
 * Non ci si basa sulla sola parola: il punteggio combina testo, stato dei
 * controlli, presenza e posizione del prezzo. Sotto soglia → nessun tap.
 */

import type { UiNode } from "../shared/types";
import { extractPriceCandidates } from "./price";

export interface OfferButtonEvaluation {
  node: UiNode | null;
  score: number;
  reasons: string[];
  rejected: { node: UiNode; score: number; reason: string }[];
}

/** Sanity check: etichette che CONTENGONO "offri" ma NON sono un CTA. */
const NEGATIVE_TEXT_RE = /^\s*non\b|^\s*(smettere|stop)\s+(di\s+)?offr/i;

function labelRank(node: UiNode): { rank: number; reason: string } {
  const label = `${node.text} ${node.contentDesc}`.trim().toLowerCase();
  if (!/offri/.test(label)) return { rank: 0, reason: "no match" };
  if (
    NEGATIVE_TEXT_RE.test(node.text) ||
    NEGATIVE_TEXT_RE.test(node.contentDesc)
  ) {
    return {
      rank: 0,
      reason: "testo negativo (contiene offri ma non è un CTA)",
    };
  }
  if (/^offri$/.test(label))
    return { rank: 60, reason: "testo esatto «offri»" };
  if (label.startsWith("offri"))
    return { rank: 45, reason: "inizia con «offri»" };
  return { rank: 30, reason: "contiene «offri»" };
}

/** Punteggio 0-100 di un singolo nodo come pulsante Offri. */
export function scoreOfferButton(
  node: UiNode,
  nodes: UiNode[],
): { score: number; reasons: string[] } {
  const { rank, reason } = labelRank(node);
  if (rank === 0) return { score: 0, reasons: [reason] };

  const reasons: string[] = [reason];
  let score = rank;

  if (node.clickable) {
    score += 15;
    reasons.push("clickable");
  } else {
    score -= 25;
    reasons.push("NON clickable");
  }
  if (node.enabled) {
    score += 10;
    reasons.push("enabled");
  } else {
    score -= 25;
    reasons.push("NON enabled");
  }

  // Contesto: c'è un importo nella stessa schermata? bonus moderato.
  const priceNodes = extractPriceCandidates(nodes);
  if (priceNodes.length > 0) {
    score += 10;
    reasons.push(`importo presente (${priceNodes.length})`);
  }

  // Sanity: nodo fuori dallo schermo o di dimensioni assurde → scarto netto.
  const w = node.bounds.x2 - node.bounds.x1;
  const h = node.bounds.y2 - node.bounds.y1;
  if (w <= 0 || h <= 0 || w > 2000 || h > 2000) {
    reasons.push("bounds implausibili → scarto");
    return { score: 0, reasons };
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/**
 * Miglior candidato pulsante Offri con soglia di confidenza.
 * Ritorna null se nessun nodo supera la soglia (fail-closed).
 */
export function evaluateOfferButton(
  nodes: UiNode[],
  confidenceThreshold: number,
): OfferButtonEvaluation {
  const area = (n: UiNode): number =>
    (n.bounds.x2 - n.bounds.x1) * (n.bounds.y2 - n.bounds.y1);

  // Tutti i candidati con punteggio > 0, ordinati per:
  // punteggio ↓ → area ↑ (CTA più compatta = più specifica) → ordine documento.
  const scored = nodes
    .map((node) => ({ node, ...scoreOfferButton(node, nodes) }))
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        area(a.node) - area(b.node) ||
        a.node.order - b.node.order,
    );

  const rejected: OfferButtonEvaluation["rejected"] = [];
  const best = scored[0] ?? null;
  for (const s of scored.slice(1)) {
    rejected.push({
      node: s.node,
      score: s.score,
      reason: s.reasons.join(", "),
    });
  }

  if (best === null) {
    return {
      node: null,
      score: 0,
      reasons: ["nessun nodo candidato"],
      rejected,
    };
  }

  if (best.score < confidenceThreshold) {
    rejected.unshift({
      node: best.node,
      score: best.score,
      reason: `sotto soglia (${confidenceThreshold})`,
    });
    return {
      node: null,
      score: best.score,
      reasons: best.reasons,
      rejected,
    };
  }

  return {
    node: best.node,
    score: best.score,
    reasons: best.reasons,
    rejected,
  };
}
