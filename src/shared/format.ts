import type { RoundTimings } from "./types";

/** Latenze di un round in una riga (log server e dashboard). */
export function formatTimings(t: RoundTimings): string {
  const parts = [
    `lettura ${t.captureMs}+${t.ocrMs}ms`,
    `parse ${t.parseMs}ms`,
    `decisione ${t.decideMs}ms`,
  ];
  if (t.confirmMs !== null) parts.push(`conferma ${t.confirmMs}ms`);
  if (t.tapMs !== null) parts.push(`tap ${t.tapMs}ms`);
  if (t.verifyMs !== null) parts.push(`verifica ${t.verifyMs}ms`);
  return parts.join(" · ");
}
