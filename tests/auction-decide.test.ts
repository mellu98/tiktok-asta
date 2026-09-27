import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/auction/config";
import { assessCard, confirmCard, MIN_TIMER_SEC, verifyOffer } from "../src/auction/decide";
import type { AuctionConfig } from "../src/shared/types";
import { cardOf, loadOcrFixture, withText } from "./helpers/ocr-fixtures";

/** Limiti che permetterebbero l'offerta: ogni skip deve venire da una guardia. */
const OPEN: AuctionConfig = {
  ...DEFAULT_CONFIG,
  maxBidEur: 100,
  maxOffersPerAuction: 1,
};
const CTX = { estop: false, offersSpent: 0 };

const card = (name: string) => cardOf(loadOcrFixture(name));

describe("assessCard — guardie fail-closed sulla card letta via OCR", () => {
  it("asta in corso con limiti aperti → ok", () => {
    expect(assessCard(card("running"), OPEN, CTX)).toEqual({
      ok: true,
      reason: "condizioni soddisfatte",
    });
  });

  it("ultimi secondi (7 s) → ok", () => {
    expect(assessCard(card("final"), OPEN, CTX).ok).toBe(true);
  });

  it("offerta iniziale: pulsante = prezzo è coerente", () => {
    expect(assessCard(card("running-offerta-iniziale"), OPEN, CTX).ok).toBe(true);
  });

  it("config di default (max 0 €) blocca sempre", () => {
    expect(assessCard(card("running"), DEFAULT_CONFIG, CTX).reason).toMatch(/sopra il massimo/);
  });

  it("arresto di emergenza prima di tutto", () => {
    expect(assessCard(card("running"), OPEN, { ...CTX, estop: true }).reason).toMatch(/EMERGENZA/);
  });

  it("nessuna card → skip", () => {
    expect(assessCard(null, OPEN, CTX).reason).toMatch(/non visibile/);
  });

  it.each([
    ["closing-0s", /0s/],
    ["sold", /aggiudicata/],
    ["waiting", /prossimo articolo/],
    ["coming", /in arrivo/],
    ["timer-assente", /non leggibile/],
    ["final-timer-ambiguo", /non leggibile/],
  ])("fase %s → skip", (name, reason) => {
    const r = assessCard(card(name), OPEN, CTX);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(reason);
  });

  it(`timer sotto ${MIN_TIMER_SEC} s → skip`, () => {
    const c = cardOf(withText(loadOcrFixture("final"), "7s", "1s"));
    expect(assessCard(c, OPEN, CTX).reason).toMatch(/timer sotto/);
  });

  it("timer letto con confidenza bassa (martelletto) → skip", () => {
    expect(assessCard(card("final-martelletto"), OPEN, CTX).reason).toMatch(
      /timer, prezzo o articolo poco affidabile/,
    );
  });

  it("pulsante non più alto del prezzo con offerte in corso → letture sfasate", () => {
    const c = cardOf(withText(loadOcrFixture("running"), "Offri 14 €", "Offri 13 €"));
    expect(assessCard(c, OPEN, CTX).reason).toMatch(/incoerenti/);
  });

  it("titolo dell'articolo letto con confidenza bassa → skip", () => {
    const fx = loadOcrFixture("running");
    const lowTitle = {
      ...fx,
      lines: fx.lines.map((l) => (l.text.startsWith("Prolungata") ? { ...l, conf: 0.5 } : l)),
    };
    expect(assessCard(cardOf(lowTitle), OPEN, CTX).reason).toMatch(/articolo poco affidabile/);
  });

  it("articolo non identificabile → skip (il limite per asta non sarebbe applicabile)", () => {
    const fx = loadOcrFixture("running");
    const c = cardOf({ ...fx, lines: fx.lines.filter((l) => !l.text.startsWith("Prolungata")) });
    expect(assessCard(c, OPEN, CTX).reason).toMatch(/articolo non identificabile/);
  });

  it("prossima offerta sopra il massimo → skip", () => {
    expect(assessCard(card("running"), { ...OPEN, maxBidEur: 13 }, CTX).reason).toMatch(
      /14€ sopra il massimo consentito 13€/,
    );
  });

  it("limite di offerte per articolo raggiunto → skip", () => {
    expect(assessCard(card("running"), OPEN, { ...CTX, offersSpent: 1 }).reason).toMatch(
      /massimo di offerte/,
    );
  });
});

describe("confirmCard — seconda lettura prima di agire", () => {
  it("stesso articolo e stesso importo → ok", () => {
    expect(confirmCard(card("running"), card("running"), OPEN, CTX).ok).toBe(true);
  });

  it("pulsante cambiato fra le due letture → skip", () => {
    const second = cardOf(withText(loadOcrFixture("running"), "Offri 14 €", "Offri 16 €"));
    expect(confirmCard(card("running"), second, OPEN, CTX).reason).toMatch(/14 € → 16 €/);
  });

  it("titolo con un carattere letto diverso fra le due letture → stesso articolo", () => {
    const glitch = cardOf(
      withText(
        loadOcrFixture("running"),
        "Prolungata • #2 21- PORTAFOGLIO SECRET...",
        "Prolungata • #2 21- PORTAFOGLIO SECRFT...",
      ),
    );
    expect(confirmCard(card("running"), glitch, OPEN, CTX).ok).toBe(true);
  });

  it("articolo cambiato → skip", () => {
    expect(confirmCard(card("running"), card("final"), OPEN, CTX).reason).toMatch(/articolo/);
  });

  it("seconda lettura in chiusura → skip con la guardia della seconda lettura", () => {
    expect(confirmCard(card("running"), card("closing-0s"), OPEN, CTX).reason).toMatch(/0s/);
  });
});

describe("verifyOffer — esito letto sul prezzo, non su «UI cambiata»", () => {
  it("prezzo = importo offerto → registrata", () => {
    const after = cardOf(withText(loadOcrFixture("running"), "13€", "14€"));
    expect(verifyOffer(14, after)).toEqual({
      outcome: "offerta a 14 € registrata come più alta",
      changed: true,
    });
  });

  it("prezzo oltre l'importo → superata", () => {
    const after = cardOf(withText(loadOcrFixture("running"), "13€", "16€"));
    expect(verifyOffer(14, after).outcome).toMatch(/superata/);
  });

  it("prezzo invariato → nessun effetto visibile", () => {
    expect(verifyOffer(14, card("running"))).toEqual({
      outcome: "nessun effetto visibile (prezzo 13 €)",
      changed: false,
    });
  });

  it("card non leggibile → non verificabile", () => {
    expect(verifyOffer(14, null)).toEqual({ outcome: "verifica non disponibile", changed: null });
  });
});
