import { describe, expect, it } from "vitest";
import {
  buildUiDumpCommand,
  decodeXmlEntities,
  dumpUiHierarchy,
  extractUiDumpXml,
  findCandidateAuctionNodes,
  looksLikeAuctionNode,
  parseUiHierarchy,
  pickOfferButton,
  uiSignature,
} from "../src/adb/auction";
import type { UiNode } from "../src/shared/types";

/**
 * Fixture REALISTICA del formato `uiautomator dump`.
 * NB: resource-id GENERICI — nessun selettore TikTok inventato: i selettori
 * reali verranno decisi solo dopo il dump dal Samsung fisico (hardware gate).
 */
const FIXTURE = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" bounds="[0,0][1080,2400]">
    <node index="0" text="Live auction" resource-id="com.example:id/title" class="android.widget.TextView" content-desc="" clickable="false" enabled="true" bounds="[54,180][600,260]"/>
    <node index="1" text="" resource-id="com.example:id/bid_button" class="android.widget.Button" package="com.example" content-desc="Offri" checkable="false" clickable="true" enabled="true" bounds="[340,2100][740,2280]"/>
    <node index="2" text="Offri ora" resource-id="" class="android.widget.Button" content-desc="" clickable="true" enabled="true" bounds="[100,1800][1000,1900]"/>
    <node index="3" text="1.234 €" resource-id="com.example:id/current_price" class="android.widget.TextView" content-desc="" clickable="false" enabled="true" bounds="[200,400][880,500]"/>
    <node index="4" text="prezzo di partenza" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" enabled="true" bounds="[200,520][880,580]"/>
    <node index="5" text="Home" resource-id="com.example:id/home" class="android.widget.TextView" content-desc="" clickable="true" enabled="true" bounds="[0,2300][200,2400]"/>
    <node index="6" text="Offer &amp; richiesta" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" enabled="false" bounds="[0,600][400,660]"/>
  </node>
</hierarchy>`;

describe("decodeXmlEntities", () => {
  it("decodifica le entità standard e numeriche", () => {
    expect(decodeXmlEntities("Offer &amp; richiesta")).toBe("Offer & richiesta");
    expect(decodeXmlEntities("&lt;bid&gt; &#8364; &#x20AC;")).toBe(
      "<bid> € €",
    );
    expect(decodeXmlEntities("senza entità")).toBe("senza entità");
  });
});

describe("parseUiHierarchy", () => {
  it("estrae tutti i nodi con gli attributi richiesti dall'hardware gate", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    expect(nodes).toHaveLength(8);

    const bid = nodes[2] as UiNode; // content-desc="Offri", clickable
    expect(bid).toMatchObject({
      text: "",
      contentDesc: "Offri",
      resourceId: "com.example:id/bid_button",
      className: "android.widget.Button",
      clickable: true,
      enabled: true,
    });
    expect(bid.bounds).toEqual({ x1: 340, y1: 2100, x2: 740, y2: 2280 });
    expect(bid.center).toEqual({ x: 540, y: 2190 });
  });

  it("calcola il centro dai bounds (pronto per input tap)", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    const price = nodes[4] as UiNode; // "1.234 €"
    expect(price.center).toEqual({ x: 540, y: 450 });
  });

  it("gestisce enabled=false e nodi senza bounds validi", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    expect(nodes[7]?.enabled).toBe(false);
    // nodo senza bounds viene scartato senza rompere il parsing
    expect(parseUiHierarchy('<node text="x"/>')).toEqual([]);
  });

  it("ordina i nodi secondo l'ordine del documento", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    expect(nodes.map((n) => n.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("looksLikeAuctionNode / findCandidateAuctionNodes", () => {
  it("marca Offri, €, prezzo (case-insensitive) e importi simili a prezzo", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    const matches = findCandidateAuctionNodes(nodes);
    expect(matches.map((n) => n.order)).toEqual([2, 3, 4, 5]);
  });

  it("NON marca nodi generici", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    expect(looksLikeAuctionNode(nodes[6] as UiNode)).toBe(false); // "Home"
  });

  it("riconosce varianti di importo", () => {
    const base = {
      text: "",
      contentDesc: "",
      resourceId: "",
      className: "",
      clickable: false,
      enabled: true,
      bounds: { x1: 0, y1: 0, x2: 10, y2: 10 },
      center: { x: 5, y: 5 },
      order: 0,
    };
    expect(looksLikeAuctionNode({ ...base, text: "12,50 €" })).toBe(true);
    expect(looksLikeAuctionNode({ ...base, text: "€ 500" })).toBe(true);
    expect(looksLikeAuctionNode({ ...base, text: "999€" })).toBe(true);
    expect(looksLikeAuctionNode({ ...base, text: "ciao" })).toBe(false);
  });
});

describe("pickOfferButton", () => {
  it("sceglie il nodo con testo esatto «Offri» + clickable + enabled", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    const picked = pickOfferButton(nodes);
    expect(picked?.order).toBe(2); // content-desc "Offri" esatto, clickable
    expect(picked?.center).toEqual({ x: 540, y: 2190 });
  });

  it("preferisce clickable/enabled a un match parziale più grande", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    // rimuovi il nodo esatto: resta "Offri ora" (parziale ma clickable)
    const withoutExact = nodes.filter((n) => n.order !== 2);
    const picked = pickOfferButton(withoutExact);
    expect(picked?.order).toBe(3);
  });

  it("restituisce null se non c'è alcun nodo Offri (fallback previsto)", () => {
    const nodes = parseUiHierarchy(FIXTURE).filter(
      (n) => n.order !== 2 && n.order !== 3,
    );
    expect(pickOfferButton(nodes)).toBeNull();
  });

  it("tie-break deterministico: area più piccola, poi ordine documento", () => {
    const mk = (
      order: number,
      text: string,
      b: [number, number, number, number],
    ): UiNode => ({
      text,
      contentDesc: "",
      resourceId: "",
      className: "android.widget.Button",
      clickable: true,
      enabled: true,
      bounds: { x1: b[0], y1: b[1], x2: b[2], y2: b[3] },
      center: { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 },
      order,
    });
    const a = mk(0, "offri", [0, 0, 1000, 1000]); // area grande, ordine basso
    const b = mk(1, "offri", [400, 400, 600, 600]); // area piccola, ordine alto
    expect(pickOfferButton([a, b])).toBe(b);
    // stesso rank + stessa area → primo nell'ordine del documento
    const c = mk(2, "offri", [400, 400, 600, 600]);
    expect(pickOfferButton([b, c])).toBe(b);
  });
});

describe("uiSignature", () => {
  it("è stabile per lo stesso albero e cambia al variare dei testi", () => {
    const nodes = parseUiHierarchy(FIXTURE);
    expect(uiSignature(nodes)).toBe(uiSignature(parseUiHierarchy(FIXTURE)));
    const changed = nodes.map((n) =>
      n.order === 3 ? { ...n, text: "1.300 €" } : n,
    );
    expect(uiSignature(changed)).not.toBe(uiSignature(nodes));
  });
});

describe("dumpUiHierarchy (contratto)", () => {
  it("è una funzione async esportata per il layer server", () => {
    expect(typeof dumpUiHierarchy).toBe("function");
  });
});

describe("buildUiDumpCommand — niente XML riciclati da dump precedenti", () => {
  it("usa un file univoco per invocazione e lo rimuove prima e dopo", () => {
    const cmd = buildUiDumpCommand();
    expect(cmd).toContain("$$");
    expect(cmd).toMatch(/rm -f "\$f"; uiautomator dump "\$f" 2>&1;/);
    expect(cmd.trim().endsWith('rm -f "$f"')).toBe(true);
    expect(cmd).not.toContain("/sdcard/window.xml");
  });
});

describe("extractUiDumpXml — fail-closed sull'output di uiautomator", () => {
  it("restituisce l'XML di un dump riuscito", () => {
    const out = `UI hierchary dumped to: /sdcard/adc_ui_123.xml\n${FIXTURE}`;
    expect(extractUiDumpXml(out)).toBe(FIXTURE);
  });

  it("accetta XML senza intestazione <?xml", () => {
    const bare = FIXTURE.slice(FIXTURE.indexOf("<hierarchy"));
    expect(extractUiDumpXml(bare)).toBe(bare);
  });

  it("scenario reale Samsung su TikTok LIVE: ERROR idle + XML vecchio → errore, MAI l'XML", () => {
    // uiautomator esce con codice 0 anche quando fallisce: il cat successivo
    // stampava il window.xml di un dump precedente (altra schermata).
    const out = `ERROR: could not get idle state.\n${FIXTURE}`;
    expect(() => extractUiDumpXml(out)).toThrow(/idle/);
  });

  it("ERROR idle senza XML → errore che spiega la schermata in movimento", () => {
    expect(() => extractUiDumpXml("ERROR: could not get idle state.\n")).toThrow(
      /schermata non si ferma mai/,
    );
  });

  it("altri ERROR prima dell'XML → errore", () => {
    expect(() => extractUiDumpXml(`ERROR: null root node returned by UiTestAutomationBridge.\n${FIXTURE}`)).toThrow(
      /uiautomator dump fallito/,
    );
  });

  it("output vuoto o inatteso → errore", () => {
    expect(() => extractUiDumpXml("")).toThrow(/risposta inattesa/);
    expect(() => extractUiDumpXml("Killed")).toThrow(/risposta inattesa/);
  });

  it("XML troncato (senza </hierarchy>) → errore", () => {
    const truncated = FIXTURE.slice(0, FIXTURE.indexOf("</hierarchy>"));
    expect(() => extractUiDumpXml(truncated)).toThrow(/troncato/);
  });

  it("la parola ERROR DENTRO l'XML (testo di un nodo) non invalida il dump", () => {
    const withErrorText = FIXTURE.replace('text="Home"', 'text="ERROR 404"');
    expect(extractUiDumpXml(withErrorText)).toBe(withErrorText);
  });
});
