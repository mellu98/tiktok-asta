import type { UiNode } from "../shared/types";
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

/**
 * Esegue il dump UI con path remoto univoco e legge l'XML SOLO se fresco.
 * FAIL-CLOSED: mai XML di tentativi precedenti; retry con nonce nuovo.
 */
export async function dumpUiHierarchy(
  serial: string,
  attempts = 2,
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // nonce fresco per OGNI tentativo → nessun riutilizzo del file precedente
    const { command, remotePath } = buildDumpCommand(generateDumpNonce());
    let out: string;
    try {
      out = await execAdbText(["-s", serial, "shell", command], {
        timeoutMs: DUMP_TIMEOUT_MS,
      });
    } catch (err) {
      lastError =
        err instanceof Error ? err : new Error("spawn adb fallito: " + String(err));
      if (attempt < attempts - 1) await sleep(1500);
      continue;
    }
    try {
      return extractFreshXml(out, remotePath);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < attempts - 1) await sleep(1500);
    }
  }
  throw lastError ?? new Error("uiautomator dump non riuscito");
}

/**
 * Nonce univoco per il path remoto del dump: OGNI tentativo usa un file
 * diverso, così un XML precedente non può mai essere confuso con uno fresco.
 */
export function generateDumpNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Comando combinato (un solo spawn adb):
 *   rm -f <p>            → il path NON può pre-esistere
 *   uiautomator dump <p> && cat <p>   → cat SOLO se dump è riuscito
 *   rm -f <p>            → cleanup best-effort
 */
export function buildDumpCommand(nonce: string): {
  command: string;
  remotePath: string;
} {
  const remotePath = `/sdcard/poc_ui_${nonce}.xml`;
  const command = [
    `rm -f '${remotePath}'`,
    `uiautomator dump '${remotePath}' && cat '${remotePath}'`,
    `rm -f '${remotePath}'`,
  ].join("; ");
  return { command, remotePath };
}

/**
 * Estrae l'XML SOLO se l'output dimostra un dump fresco e completo.
 * FAIL-CLOSED: qualunque dubbio → throw (mai XML di tentativi precedenti).
 */
export function extractFreshXml(output: string, remotePath: string): string {
  // 1. ERROR anywhere (es. "ERROR: could not get idle state") → fallimento,
  //    indipendentemente da qualunque XML presente nell'output.
  if (/^ERROR:/m.test(output)) {
    throw new Error(`uiautomator ERROR: ${output.trim().slice(0, 200)}`);
  }
  // 2. il comando deve confermare AVER PRODOTTO QUEL file
  if (!output.includes(`dumped to: ${remotePath}`)) {
    throw new Error(
      `dump non confermato per ${remotePath} (nessuna riga "dumped to")`,
    );
  }
  // 3. XML completo e plausibile
  const xmlStart = Math.min(
    ...[output.indexOf("<?xml"), output.indexOf("<hierarchy")].filter(
      (i) => i !== -1,
    ),
  );
  if (!Number.isFinite(xmlStart)) {
    throw new Error("output senza XML riconoscibile");
  }
  const endTag = "</hierarchy>";
  const end = output.indexOf(endTag, xmlStart);
  if (end === -1) {
    throw new Error("XML troncato (manca </hierarchy>) — scartato");
  }
  const xml = output.slice(xmlStart, end + endTag.length);
  if (!xml.includes("<node")) {
    throw new Error("XML senza nodi — scartato");
  }
  return xml;
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
