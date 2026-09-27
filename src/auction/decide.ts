/**
 * Regole di decisione sulla card asta letta via OCR. Funzioni pure,
 * FAIL-CLOSED: qualunque dubbio → nessuna offerta, con il motivo leggibile.
 *
 * Tempi osservati su TikTok LIVE: un'offerta negli ultimi 10 s riporta il
 * timer a 10 s, quindi offrire all'ultimo secondo non serve; il rischio vero
 * è agire su una lettura vecchia o su una card ferma a 0s (vista anche per
 * minuti con il pulsante ancora visibile).
 */

import { isSameItem } from "./card";
import type { AuctionCard, AuctionConfig } from "../shared/types";

/** Sotto questa soglia la lettura (~1,3 s) + il tap arriverebbero tardi. */
export const MIN_TIMER_SEC = 2;

export interface Assessment {
  ok: boolean;
  reason: string;
}

export interface DecisionContext {
  estop: boolean;
  offersSpent: number;
}

const PHASE_BLOCKS: Record<string, string> = {
  coming: "asta in arrivo: offerte non ancora aperte",
  waiting: "in attesa del prossimo articolo",
  sold: "asta già aggiudicata",
  closing: "timer a 0s: asta in chiusura, il pulsante non va toccato",
  unknown: "stato dell'asta non leggibile (timer assente o ambiguo)",
};

const skip = (reason: string): Assessment => ({ ok: false, reason });

/** Guardie in ordine di severità sulla singola lettura. */
export function assessCard(
  card: AuctionCard | null,
  config: AuctionConfig,
  ctx: DecisionContext,
): Assessment {
  if (ctx.estop) return skip("ARRESTO DI EMERGENZA attivo — riarmare dall'interfaccia");
  if (!card) return skip("card asta non visibile sullo schermo");

  const blocked = PHASE_BLOCKS[card.phase];
  if (blocked) return skip(blocked);

  const { offer, timerSec, currentPriceEur } = card;
  if (!offer) return skip("pulsante Offri non letto");
  if (timerSec === null || timerSec < MIN_TIMER_SEC) {
    return skip(`timer sotto ${MIN_TIMER_SEC}s: troppo tardi per un'offerta affidabile`);
  }
  if (offer.conf < config.confidenceThreshold) {
    return skip(`lettura del pulsante poco affidabile (${offer.conf} < ${config.confidenceThreshold})`);
  }
  if (!card.itemKey) {
    return skip("articolo non identificabile: il limite di offerte per articolo non sarebbe applicabile");
  }
  const minConf = Math.min(card.timerConf ?? 0, card.priceConf ?? 0, card.itemTitleConf ?? 0);
  if (minConf < config.priceConfidenceThreshold) {
    return skip(
      `lettura di timer, prezzo o articolo poco affidabile (${minConf} < ${config.priceConfidenceThreshold})`,
    );
  }
  if (currentPriceEur === null) return skip("prezzo attuale non letto");
  if (
    offer.amountEur < currentPriceEur ||
    (card.hasBids && offer.amountEur <= currentPriceEur)
  ) {
    return skip(
      `prezzo (${currentPriceEur}€) e pulsante (${offer.amountEur}€) incoerenti: letture sfasate`,
    );
  }
  if (offer.amountEur > config.maxBidEur) {
    return skip(`prossima offerta ${offer.amountEur}€ sopra il massimo consentito ${config.maxBidEur}€`);
  }
  if (ctx.offersSpent >= config.maxOffersPerAuction) {
    return skip(
      `numero massimo di offerte per questo articolo raggiunto (${ctx.offersSpent}/${config.maxOffersPerAuction})`,
    );
  }
  return { ok: true, reason: "condizioni soddisfatte" };
}

/**
 * Seconda lettura subito prima di agire: deve passare le stesse guardie e
 * mostrare lo stesso articolo con lo stesso importo sul pulsante.
 */
export function confirmCard(
  first: AuctionCard | null,
  second: AuctionCard | null,
  config: AuctionConfig,
  ctx: DecisionContext,
): Assessment {
  const again = assessCard(second, config, ctx);
  if (!again.ok) return skip(`conferma fallita: ${again.reason}`);
  if (!first || !second) return skip("conferma fallita: lettura mancante");
  if (!first.itemKey || !second.itemKey || !isSameItem(first.itemKey, second.itemKey)) {
    return skip("conferma fallita: articolo cambiato fra le due letture");
  }
  const a = first.offer?.amountEur;
  const b = second.offer?.amountEur;
  if (a !== b) {
    return skip(`conferma fallita: il pulsante è cambiato (${a} € → ${b} €)`);
  }
  return { ok: true, reason: "condizioni soddisfatte e confermate" };
}

/**
 * Esito dopo il tap, letto sul prezzo. "UI cambiata" non vale nulla su una
 * LIVE: commenti e spettatori cambiano di continuo.
 */
export function verifyOffer(
  amountEur: number,
  after: AuctionCard | null,
): { outcome: string; changed: boolean | null } {
  const price = after?.currentPriceEur ?? null;
  if (price === null) return { outcome: "verifica non disponibile", changed: null };
  if (price === amountEur && after?.hasBids) {
    return { outcome: `offerta a ${amountEur} € registrata come più alta`, changed: true };
  }
  if (price > amountEur) {
    return { outcome: `superata: prezzo attuale ${price} €`, changed: true };
  }
  return { outcome: `nessun effetto visibile (prezzo ${price} €)`, changed: false };
}
