import type { ClickOfferResult, UiNode } from "../shared/types";
import { tap } from "./commands";
import { execAdbText } from "./client";

/**
 * Diagnostica asta TikTok via uiautomator nativo Android.
 *
 * Nessun selettore TikTok hardcodato: l'albero UI viene estratto, parsato e
 * cercato per KEYWORD TESTUALI (Offri, offerta, €, prezzo…). I selettori
 * reali (resource-id ecc.) si decideranno SOLO dopo aver visto un dump reale
 * da un Samsung fisico.
 *
 * Tutti i comandi passano dal client ADB esistente (execFile, args array,
 * nessuna shell) → nessuna superficie di injection.
 */

const DUMP_TIMEOUT_MS = 20000; // uiautomator può metterci parecchi secondi
const DUMP_RETRY_DELAY_MS = 1500;
const TAP_SETTLE_MS = 2000;

/** uiautomator ha già atteso ~10 s la UI ferma: riprovare non serve. */
const IDLE_ERROR_RE = /could not get idle state/i;

/**
 * Comando lato device per UN dump: file univoco per invocazione ($$ = PID
 * della shell del device), rimosso prima e dopo. Un dump fallito non può più
 * restituire l'XML lasciato da un dump precedente (altra schermata).
 * uiautomator scrive gli errori su stderr, che adb (shell protocol v2) tiene
 * separato: 2>&1 li porta nello stdout che il client legge.
 */
export function buildUiDumpCommand(): string {
  return 'f=/sdcard/adc_ui_$$.xml; rm -f "$f"; uiautomator dump "$f" 2>&1; cat "$f" 2>/dev/null; rm -f "$f"';
}

/**
 * Estrae l'XML dall'output combinato dump + cat. FAIL-CLOSED: uiautomator
 * esce con codice 0 anche quando fallisce, quindi qualunque ERROR prima
 * dell'XML, XML assente o troncato → eccezione, mai un XML "di ripiego".
 */
export function extractUiDumpXml(output: string): string {
  const header = output.indexOf("<?xml");
  const xmlStart = header !== -1 ? header : output.indexOf("<hierarchy");
  const preamble = xmlStart === -1 ? output : output.slice(0, xmlStart);
  const detail = preamble.trim().slice(0, 200);

  if (/ERROR/i.test(preamble)) {
    if (IDLE_ERROR_RE.test(preamble)) {
      throw new Error(
        `uiautomator non riesce a leggere la UI: la schermata non si ferma mai (es. video LIVE), stato idle non raggiunto. Dettaglio: ${detail}`,
      );
    }
    throw new Error(`uiautomator dump fallito: ${detail}`);
  }
  if (xmlStart === -1) {
    throw new Error(`uiautomator dump: risposta inattesa: ${detail}`);
  }
  const xml = output.slice(xmlStart);
  if (!/<\/hierarchy>\s*$/.test(xml)) {
    throw new Error("uiautomator dump: XML incompleto o troncato");
  }
  return xml;
}

/**
 * Esegue `uiautomator dump` e legge l'XML in UN SOLO spawn adb
 * (dump + cat combinati nella stessa shell del device → meno round-trip).
 * Un solo retry per risposte inattese; nessun retry se la UI non è mai idle.
 */
export async function dumpUiHierarchy(serial: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(DUMP_RETRY_DELAY_MS);
    const out = await execAdbText(["-s", serial, "shell", buildUiDumpCommand()], {
      timeoutMs: DUMP_TIMEOUT_MS,
    });
    try {
      return extractUiDumpXml(out);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (IDLE_ERROR_RE.test(out)) break;
    }
  }
  throw lastError ?? new Error("uiautomator dump non riuscito");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Decodifica le entità XML presenti in text/content-desc. */
export function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const BOUNDS_RE = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;
const NODE_TAG_RE = /<node\b([^>]*)>/g;
const ATTR_RE = /([A-Za-z_][\w.-]*)="([^"]*)"/g;

/** Estrae i nodi dall'XML di uiautomator (attributi richiesti dal gate). */
export function parseUiHierarchy(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(NODE_TAG_RE)) {
    const attrs: Record<string, string> = {};
    for (const attr of (match[1] ?? "").matchAll(ATTR_RE)) {
      attrs[attr[1] as string] = attr[2] as string;
    }

    const boundsMatch = BOUNDS_RE.exec(attrs.bounds ?? "");
    if (!boundsMatch) continue;
    const x1 = Number(boundsMatch[1]);
    const y1 = Number(boundsMatch[2]);
    const x2 = Number(boundsMatch[3]);
    const y2 = Number(boundsMatch[4]);

    nodes.push({
      text: decodeXmlEntities(attrs.text ?? ""),
      contentDesc: decodeXmlEntities(attrs["content-desc"] ?? ""),
      resourceId: attrs["resource-id"] ?? "",
      className: attrs.class ?? "",
      clickable: attrs.clickable === "true",
      enabled: attrs.enabled !== "false",
      bounds: { x1, y1, x2, y2 },
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
      order: nodes.length,
    });
  }
  return nodes;
}

const KEYWORD_RE = /offri|offerta|prezzo|€|eur\b|bid/i;
/** Importi tipo "1.234 €", "€ 500", "12,50 €", "999€". */
const PRICE_LIKE_RE =
  /(?:\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|[.,]\d{2})\s*€|€\s*\d/i;

/** True se il nodo parla di asta/offerta (text, content-desc o resource-id). */
export function looksLikeAuctionNode(node: UiNode): boolean {
  const haystack = `${node.text} ${node.contentDesc} ${node.resourceId}`;
  return KEYWORD_RE.test(haystack) || PRICE_LIKE_RE.test(haystack);
}

/** Nodi rilevanti per l'asta, nell'ordine dell'albero. */
export function findCandidateAuctionNodes(nodes: UiNode[]): UiNode[] {
  return nodes.filter(looksLikeAuctionNode);
}

function offerRank(node: UiNode): number {
  const label = `${node.text} ${node.contentDesc}`.trim().toLowerCase();
  let rank = 0;
  if (/^offri$/.test(label)) rank = 4;
  else if (label.startsWith("offri")) rank = 3;
  else if (/offri/.test(label)) rank = 2;
  else return 0;
  if (node.clickable) rank += 1;
  if (node.enabled) rank += 1;
  return rank;
}

function area(node: UiNode): number {
  return (node.bounds.x2 - node.bounds.x1) * (node.bounds.y2 - node.bounds.y1);
}

/**
 * Scelta DETERMINISTICA del pulsante "Offri": rank più alto (testo esatto
 * "offri" > prefisso > contiene; bonus clickable/enabled), poi area più
 * piccola, poi ordine nel documento. Nessun resource-id presunto.
 */
export function pickOfferButton(nodes: UiNode[]): UiNode | null {
  const ranked = nodes
    .map((node) => ({ node, rank: offerRank(node) }))
    .filter((entry) => entry.rank > 0)
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        area(a.node) - area(b.node) ||
        a.node.order - b.node.order,
    );
  return ranked[0]?.node ?? null;
}

/** Firma deterministica dell'albero: per capire se la UI è cambiata dopo un tap. */
export function uiSignature(nodes: UiNode[]): string {
  const texts = nodes
    .map((n) => n.text || n.contentDesc)
    .filter((t) => t.length > 0)
    // comparatore esplicito sui codepoint: firma stabile a prescindere dal locale
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `${nodes.length}|${texts.join("|").slice(0, 400)}`;
}

export interface ClickOfferOptions {
  /** Default true: logga nodo+coordinate SENZA cliccare. */
  dryRun?: boolean;
}

/**
 * FASE 3 minimale: trova il pulsante Offri e — solo con dryRun esplicitamente
 * false — fa UN SOLO tap reale usando il layer di input esistente, poi
 * riverifica l'albero per vedere se lo stato è cambiato.
 */
export async function clickOffer(
  serial: string,
  opts: ClickOfferOptions = {},
): Promise<ClickOfferResult> {
  const dryRun = opts.dryRun !== false;
  const xml = await dumpUiHierarchy(serial);
  const nodes = parseUiHierarchy(xml);
  const node = pickOfferButton(nodes);

  if (!node) {
    return {
      status: "not-found",
      candidates: findCandidateAuctionNodes(nodes),
    };
  }

  if (dryRun) {
    return {
      status: "dry-run",
      node,
      center: node.center,
      candidates: findCandidateAuctionNodes(nodes),
    };
  }

  const before = { nodeCount: nodes.length, signature: uiSignature(nodes) };
  await tap(serial, node.center.x, node.center.y);
  await sleep(TAP_SETTLE_MS);

  const xmlAfter = await dumpUiHierarchy(serial);
  const afterNodes = parseUiHierarchy(xmlAfter);
  return {
    status: "tapped",
    node,
    center: node.center,
    candidates: findCandidateAuctionNodes(nodes),
    before,
    after: {
      nodeCount: afterNodes.length,
      signature: uiSignature(afterNodes),
    },
  };
}
