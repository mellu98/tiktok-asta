/**
 * Parsing degli importi in euro letti sullo schermo ("19€", "Offri 21 €",
 * "1.234,56 €", "€ 500", "12,50 €"). Null se il testo non contiene un
 * importo interpretabile: chi lo usa deve trattarlo come lettura mancante.
 */

const AMOUNT_RE = /(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?\s*(?:€|eur\b)|€\s*(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?/gi;

/** Parsing di un importo italiano → euro. Ritorna null se non interpretabile. */
export function parseAmountEur(raw: string): number | null {
  const m = AMOUNT_RE.exec(raw);
  AMOUNT_RE.lastIndex = 0;
  if (!m) return null;
  let token = (m[0] ?? "").replace(/[€\s]|eur/gi, "");

  // Separatori it-IT vs en-US: l'ultimo separatore è il decimale; i gruppi
  // da 3 cifre finali indicano migliaia.
  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      token = token.replace(/\./g, "").replace(",", ".");
    } else {
      token = token.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    token = /,\d{1,2}$/.test(token)
      ? token.replace(",", ".")
      : token.replace(/,/g, "");
  } else if (lastDot !== -1) {
    token = /(\.\d{3})+$/.test(token) ? token.replace(/\./g, "") : token;
  }

  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}
