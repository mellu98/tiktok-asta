import type { AuctionPhase } from "../../src/shared/types";

export { formatTimings } from "../../src/shared/format";

export const PHASE_LABEL: Record<AuctionPhase, string> = {
  coming: "in arrivo",
  running: "in corso",
  final: "ultimi secondi",
  closing: "in chiusura (0s)",
  sold: "aggiudicata",
  waiting: "in attesa del prossimo articolo",
  unknown: "non leggibile",
};

export function euro(value: number | null): string {
  return value === null ? "n/d" : `${value}€`;
}
