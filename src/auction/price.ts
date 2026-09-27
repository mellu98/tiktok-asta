/**
 * Parsing degli importi in euro letti sullo schermo ("19€", "Offri 21 €",
 * "2 € di spedizione", "1.234,50 €"). Null se il testo non contiene un
 * importo interpretabile: chi lo usa deve trattarlo come lettura mancante.
 */

/**
 * Importi riconosciuti: numero con separatori adiacente al simbolo €
 * (prima o dopo) oppure alla parola "eur".
 */
const AMOUNT_RE =
  /€\s*(\d[\d.,]*\d|\d)|(\d[\d.,]*\d|\d)\s*(?:€|\beur\b)/i;

function toNum(token: string): number | null {
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizzazione SEPARATORS, regola it-IT documentata:
 * - entrambi i separatori presenti → l'ULTIMO è il decimale, l'altro migliaia
 *   ("1.234,50" → 1234.50; "1,234.50" → 1234.50)
 * - solo virgola → SEMPRE decimale (it-IT rigoroso): "12,50" → 12.5;
 *   "1,234" → 1.234 (esplicito: si intende 1,234 € = un euro e 234 centesimi)
 * - solo punto → migliaia se tutti i gruppi dopo la prima cifra sono da 3
 *   ("1.234" → 1234; "12.345.678" → 12345678); altrimenti decimale
 *   ("12.50" → 12.5)
 */
function normalizeNumericToken(token: string): number | null {
  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      return toNum(token.replace(/\./g, "").replace(",", "."));
    }
    return toNum(token.replace(/,/g, ""));
  }
  if (lastComma !== -1) {
    return toNum(token.replace(/,/g, "."));
  }
  if (lastDot !== -1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(token)) {
      return toNum(token.replace(/\./g, ""));
    }
    return toNum(token);
  }
  return toNum(token);
}

/**
 * Parsing di un importo con € adiacente → euro. Ritorna null se non
 * interpretabile o se il numero non è adiacente a €/eur.
 */
export function parseAmountEur(raw: string): number | null {
  const m = AMOUNT_RE.exec(raw);
  if (!m) return null;
  const token = (m[1] ?? m[2] ?? "").trim();
  return normalizeNumericToken(token);
}
