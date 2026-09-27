import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSameItem, normalizeItemKey, parseAuctionCard, parseTimerText } from "../src/auction/card";
import { parseOcrOutput } from "../src/vision/ocr";
import type { OcrLine } from "../src/shared/types";

/**
 * Fixture REALI: righe OCR (Vision) della card asta su Samsung SM-A057G,
 * LIVE TikTok del 27/09/2026 — una per ogni fase osservata.
 */
interface Fixture {
  w: number;
  h: number;
  lines: { text: string; conf: number; x1: number; y1: number; x2: number; y2: number }[];
}

function load(name: string): Fixture {
  const file = fileURLToPath(new URL(`./fixtures/ocr/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, "utf8")) as Fixture;
}

function linesOf(fx: Fixture): OcrLine[] {
  return parseOcrOutput(JSON.stringify({ w: fx.w, h: fx.h, ms: 0, lines: fx.lines })).lines;
}

function card(name: string) {
  const fx = load(name);
  return parseAuctionCard(linesOf(fx), fx.w, fx.h);
}

describe("parseTimerText — badge del timer letto dall'OCR", () => {
  it("formato MM:SS (sopra i 10 s)", () => {
    expect(parseTimerText("00:59")).toBe(59);
    expect(parseTimerText("01:00")).toBe(60);
    expect(parseTimerText("00:59*")).toBe(59);
  });

  it("formato Ns (ultimi 10 s), con icona martelletto letta come «>»", () => {
    expect(parseTimerText("10s")).toBe(10);
    expect(parseTimerText("7s")).toBe(7);
    expect(parseTimerText(">8s")).toBe(8);
    expect(parseTimerText("> Os")).toBe(0);
    expect(parseTimerText("Os")).toBe(0);
  });

  it("letture ambigue → null (fail-closed)", () => {
    expect(parseTimerText(">85")).toBeNull(); // era 8s
    expect(parseTimerText("6s+4s")).toBeNull(); // animazione sovrapposta
    expect(parseTimerText("10s+Os")).toBeNull();
    expect(parseTimerText("00:75")).toBeNull();
    expect(parseTimerText("ASTA")).toBeNull();
  });
});

describe("normalizeItemKey — identità dell'articolo", () => {
  it("ignora il contatore #N, i puntini finali e gli spazi", () => {
    expect(normalizeItemKey("#1 26- BORSA SAINT TROPE B....")).toBe("26- BORSA SAINT TROPE B");
    expect(normalizeItemKey("#2 21- PORTAFOGLIO SECRET...")).toBe(
      normalizeItemKey("#1 21- PORTAFOGLIO SECRET…"),
    );
    expect(normalizeItemKey("ASTA PRODOTTO  BORSA MOS...")).toBe("ASTA PRODOTTO BORSA MOS");
  });

  it("titolo vuoto → null", () => {
    expect(normalizeItemKey(" ... ")).toBeNull();
  });
});

describe("isSameItem — un errore OCR nel titolo non crea un articolo «nuovo»", () => {
  it("stesso titolo o con 1-3 caratteri letti male → stesso articolo", () => {
    expect(isSameItem("21- PORTAFOGLIO SECRET", "21- PORTAFOGLIO SECRET")).toBe(true);
    expect(isSameItem("21- PORTAFOGLIO SECRET", "21- PORTAFOGLIO SECRFT")).toBe(true);
    expect(isSameItem("46- SWEATER HELLEN BATT", "46- SWEATER HELLEN BAT")).toBe(true);
  });

  it("articoli diversi → diversi", () => {
    expect(isSameItem("26- BORSA SAINT TROPE B", "27- BORSA BUBY CLOTH CL")).toBe(false);
    expect(isSameItem("ASTA PRODOTTO BORSA MOS", "21- PORTAFOGLIO SECRET")).toBe(false);
  });
});

describe("parseAuctionCard — fasi reali dell'asta", () => {
  it("in corso: timer, prezzo, pulsante e articolo", () => {
    const c = card("running");
    expect(c?.phase).toBe("running");
    expect(c?.timerSec).toBe(40);
    expect(c?.currentPriceEur).toBe(13);
    expect(c?.hasBids).toBe(true);
    expect(c?.startingPrice).toBe(false);
    expect(c?.offer?.label).toBe("Offri 14 €");
    expect(c?.offer?.amountEur).toBe(14);
    expect(c?.offer?.center).toEqual({ x: 857, y: 2043 });
    expect(c?.itemTitle).toBe("#2 21- PORTAFOGLIO SECRET...");
    expect(c?.itemKey).toBe("21- PORTAFOGLIO SECRET");
    expect(c?.itemTitleConf).toBe(100);
  });

  it("in corso con offerta iniziale: prezzo = importo del pulsante, nessuna offerta ancora", () => {
    const c = card("running-offerta-iniziale");
    expect(c?.phase).toBe("running");
    expect(c?.timerSec).toBe(59);
    expect(c?.currentPriceEur).toBe(1);
    expect(c?.startingPrice).toBe(true);
    expect(c?.hasBids).toBe(false);
    expect(c?.offer?.amountEur).toBe(1);
  });

  it("avviso «Le offerte ripristinano l'asta» sulla stessa riga del prezzo", () => {
    const c = card("running-avviso-ripristino");
    expect(c?.phase).toBe("running");
    expect(c?.timerSec).toBe(12);
    expect(c?.resetNotice).toBe(true);
    expect(c?.currentPriceEur).toBe(42);
    expect(c?.offer?.amountEur).toBe(46);
    expect(c?.itemKey).toBe("26- BORSA SAINT TROPE B");
  });

  it("ultimi 10 s: formato Ns, rumore della miniatura ignorato", () => {
    const c = card("final");
    expect(c?.phase).toBe("final");
    expect(c?.timerSec).toBe(7);
    expect(c?.currentPriceEur).toBe(46);
    expect(c?.offer?.amountEur).toBe(49);
    expect(c?.itemKey).toBe("ASTA PRODOTTO BORSA MOS");
  });

  it("martelletto letto come «>»: timer valido ma con confidenza bassa", () => {
    const c = card("final-martelletto");
    expect(c?.phase).toBe("final");
    expect(c?.timerSec).toBe(8);
    expect(c?.timerConf).toBe(50);
  });

  it.each(["final-timer-ambiguo", "final-timer-sovrapposto", "timer-doppio", "timer-assente"])(
    "%s: timer non affidabile → fase unknown",
    (name) => {
      const c = card(name);
      expect(c?.phase).toBe("unknown");
      expect(c?.timerSec).toBeNull();
      expect(c?.offer).not.toBeNull();
    },
  );

  it("0s con il pulsante ancora visibile → closing, MAI in corso", () => {
    const c = card("closing-0s");
    expect(c?.phase).toBe("closing");
    expect(c?.timerSec).toBe(0);
    expect(c?.offer?.amountEur).toBe(14);
  });

  it("aggiudicata: «Offerta finale 49 €»", () => {
    const c = card("sold");
    expect(c?.phase).toBe("sold");
    expect(c?.finalPriceEur).toBe(49);
    expect(c?.offer).toBeNull();
  });

  it("in attesa del prossimo articolo", () => {
    const c = card("waiting");
    expect(c?.phase).toBe("waiting");
    expect(c?.offer).toBeNull();
    expect(c?.currentPriceEur).toBe(49);
  });

  it("in arrivo: offerta iniziale visibile, nessun pulsante", () => {
    const c = card("coming");
    expect(c?.phase).toBe("coming");
    expect(c?.currentPriceEur).toBe(29);
    expect(c?.startingPrice).toBe(true);
    expect(c?.offer).toBeNull();
  });

  it("nessuna card (altra schermata) → null", () => {
    expect(card("nessuna-card")).toBeNull();
  });
});

describe("parseAuctionCard — difese", () => {
  it("un commento «Offri 5 €» sopra la card non viene scambiato per il pulsante", () => {
    const fx = load("running");
    const withComment: Fixture = {
      ...fx,
      lines: [
        { text: "Offri 5 €", conf: 1, x1: 130, y1: 1500, x2: 330, y2: 1540 },
        ...fx.lines,
      ],
    };
    const c = parseAuctionCard(linesOf(withComment), fx.w, fx.h);
    expect(c?.offer?.amountEur).toBe(14);
  });

  it("«Offri» senza «Personalizzato» sulla stessa riga non è il pulsante", () => {
    const fx = load("running");
    const lines = fx.lines.filter((l) => l.text !== "Personalizzato");
    const c = parseAuctionCard(linesOf({ ...fx, lines }), fx.w, fx.h);
    expect(c?.offer).toBeNull();
    expect(c?.phase).toBe("unknown");
  });

  it("risoluzione diversa (720×1600): stesso risultato, coordinate scalate", () => {
    const fx = load("running");
    const k = 720 / 1080;
    const scaled: Fixture = {
      w: 720,
      h: 1600,
      lines: fx.lines.map((l) => ({
        ...l,
        x1: Math.round(l.x1 * k),
        y1: Math.round(l.y1 * k),
        x2: Math.round(l.x2 * k),
        y2: Math.round(l.y2 * k),
      })),
    };
    const c = parseAuctionCard(linesOf(scaled), scaled.w, scaled.h);
    expect(c?.phase).toBe("running");
    expect(c?.offer?.amountEur).toBe(14);
    expect(c?.offer?.center.x).toBeCloseTo(571, -1);
  });
});
