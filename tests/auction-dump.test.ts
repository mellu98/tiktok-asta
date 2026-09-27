import { describe, expect, it } from "vitest";
import {
  buildDumpCommand,
  extractFreshXml,
  generateDumpNonce,
} from "../src/adb/auction";

const VALID_XML =
  '<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout"/></hierarchy>';

describe("buildDumpCommand — path univoci per tentativo", () => {
  it("nonce diversi → path remoti diversi (nessun riutilizzo fra tentativi)", () => {
    const a = buildDumpCommand("nonce1");
    const b = buildDumpCommand("nonce2");
    expect(a.remotePath).not.toBe(b.remotePath);
    expect(a.command).toContain("poc_ui_nonce1.xml");
    expect(b.command).toContain("poc_ui_nonce2.xml");
  });

  it("il comando NON contiene /sdcard/window.xml (vecchio path condiviso)", () => {
    const { command } = buildDumpCommand(generateDumpNonce());
    expect(command).not.toContain("window.xml");
  });

  it("struttura: rm → dump && cat → rm (cleanup best-effort)", () => {
    const { command, remotePath } = buildDumpCommand("n9");
    const parts = command.split("; ").map((p) => p.trim());
    expect(parts[0]).toBe(`rm -f '${remotePath}'`);
    expect(parts[1]).toBe(`uiautomator dump '${remotePath}' && cat '${remotePath}'`);
    expect(parts[2]).toBe(`rm -f '${remotePath}'`);
  });

  it("generateDumpNonce produce nonce diversi a chiamate successive", () => {
    const seen = new Set(Array.from({ length: 20 }, () => generateDumpNonce()));
    expect(seen.size).toBe(20);
  });
});

describe("extractFreshXml — fail-closed su XML stale (bug P0)", () => {
  const OLD_XML_STALE =
    '<?xml version="1.0"?><hierarchy><node text="VECCHIO"/></hierarchy>';

  it("ERROR + XML vecchio presente nell'output → DEVE fallire", () => {
    // Questo è il bug P0: su TikTok LIVE uiautomator stampa ERROR e il file
    // precedente resta: il codice vecchio accettava l'XML stale.
    const out = `ERROR: could not get idle state.\n${OLD_XML_STALE}`;
    expect(() => extractFreshXml(out, "/sdcard/poc_ui_x.xml")).toThrow(
      /uiautomator ERROR/,
    );
  });

  it("dump senza conferma del file nuovo → DEVE fallire", () => {
    const out = "nessun output utile";
    expect(() => extractFreshXml(out, "/sdcard/poc_ui_x.xml")).toThrow(
      /dump non confermato/,
    );
  });

  it("XML valido appena generato → PASS", () => {
    const out = `UI hierchary dumped to: /sdcard/poc_ui_x.xml\n${VALID_XML}`;
    const xml = extractFreshXml(out, "/sdcard/poc_ui_x.xml");
    expect(xml).toContain("<node");
    expect(xml).toContain("</hierarchy>");
  });

  it("risposta troncata (manca </hierarchy>) → FAIL", () => {
    const out = `UI hierchary dumped to: /sdcard/poc_ui_x.xml\n${VALID_XML.slice(
      0,
      VALID_XML.length - 20,
    )}`;
    expect(() => extractFreshXml(out, "/sdcard/poc_ui_x.xml")).toThrow(
      /troncato/,
    );
  });

  it("XML senza nodi → FAIL", () => {
    const out = `UI hierchary dumped to: /sdcard/poc_ui_x.xml\n<?xml version="1.0"?><hierarchy></hierarchy>`;
    expect(() => extractFreshXml(out, "/sdcard/poc_ui_x.xml")).toThrow(
      /senza nodi/,
    );
  });

  it("ERROR su una riga intermedia (non solo a inizio output) → FAIL", () => {
    const out = `some noise\nERROR: could not get idle state.\n${OLD_XML_STALE}`;
    expect(() => extractFreshXml(out, "/sdcard/poc_ui_y.xml")).toThrow(
      /uiautomator ERROR/,
    );
  });
});
