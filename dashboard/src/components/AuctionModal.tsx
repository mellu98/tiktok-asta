import type {
  AuctionAnalysis,
  AuctionCard,
  RoundResult,
  UiNode,
} from "../../../src/shared/types";
import { euro, formatTimings, PHASE_LABEL } from "../auction-format";

interface Props {
  analysis: AuctionAnalysis;
  round: RoundResult | null;
  onDryRun: () => void;
  onLive: () => void;
  onClose: () => void;
}

function NodeTable({ nodes }: { nodes: UiNode[] }) {
  return (
    <table className="auction-table">
      <thead>
        <tr>
          <th>text</th>
          <th>content-desc</th>
          <th>resource-id</th>
          <th>class</th>
          <th>click</th>
          <th>en</th>
          <th>bounds</th>
          <th>centro</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((n) => (
          <tr key={n.order}>
            <td>{n.text || "—"}</td>
            <td>{n.contentDesc || "—"}</td>
            <td>
              <code>{n.resourceId || "—"}</code>
            </td>
            <td>{n.className.split(".").pop() || "—"}</td>
            <td>{n.clickable ? "✓" : ""}</td>
            <td>{n.enabled ? "✓" : ""}</td>
            <td>
              [{n.bounds.x1},{n.bounds.y1}][{n.bounds.x2},{n.bounds.y2}]
            </td>
            <td>
              ({n.center.x},{n.center.y})
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CardSummary({ card }: { card: AuctionCard | null }) {
  if (!card) {
    return <p className="note">Nessuna card asta riconosciuta sullo schermo.</p>;
  }
  return (
    <table className="auction-table">
      <tbody>
        <tr>
          <th>fase</th>
          <td>{PHASE_LABEL[card.phase]}</td>
        </tr>
        <tr>
          <th>timer</th>
          <td>
            {card.timerSec !== null ? `${card.timerSec}s` : "n/d"}
            {card.timerText ? ` («${card.timerText}», conf ${card.timerConf})` : ""}
          </td>
        </tr>
        <tr>
          <th>prezzo attuale</th>
          <td>
            {euro(card.currentPriceEur)}
            {card.startingPrice ? " · offerta iniziale" : ""}
            {card.hasBids ? " · ci sono offerte" : ""}
            {card.resetNotice ? " · «le offerte ripristinano l'asta»" : ""}
          </td>
        </tr>
        <tr>
          <th>pulsante</th>
          <td>
            {card.offer
              ? `«${card.offer.label}» → ${card.offer.amountEur}€ · centro (${card.offer.center.x}, ${card.offer.center.y}) · conf ${card.offer.conf}`
              : "n/d"}
          </td>
        </tr>
        <tr>
          <th>articolo</th>
          <td>{card.itemTitle ?? "n/d"}</td>
        </tr>
        {card.finalPriceEur !== null && (
          <tr>
            <th>offerta finale</th>
            <td>{euro(card.finalPriceEur)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function AuctionModal({ analysis, round, onDryRun, onLive, onClose }: Props) {
  const mode = round?.mode ?? null;
  const decision = round?.decision ?? null;

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal auction" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Analisi schermata TikTok</strong>
          <button className="btn small" onClick={onClose}>
            ✕ Chiudi
          </button>
        </div>

        <p className="note">
          schermo {analysis.screenSize.width}×{analysis.screenSize.height} ·{" "}
          {analysis.ocrLines.length} righe OCR: <code>{analysis.readingFile}</code>
          {" · "}
          {analysis.xmlFile ? (
            <>
              dump uiautomator {analysis.nodeCount} nodi: <code>{analysis.xmlFile}</code>
            </>
          ) : (
            <>dump uiautomator non disponibile</>
          )}
        </p>

        <img
          className="shot small"
          src={analysis.screenshot.dataUrl}
          alt="Screenshot del dispositivo"
        />

        <div className="auction-section">
          <h3>Card asta (OCR)</h3>
          <CardSummary card={analysis.card} />
        </div>

        <div className="auction-section">
          <h3>
            Nodi uiautomator con keyword asta ({analysis.matches.length})
          </h3>
          {analysis.uiDumpAvailable === false ? (
            <div className="offer-panel warnp">
              <p>
                <strong>
                  Gerarchia UI non disponibile su questa schermata
                </strong>
              </p>
              <p className="note">
                uiautomator non riesce a leggere la UI (tipico su TikTok LIVE:
                schermo in movimento). Nessun candidato derivato da XML
                vecchi. La card asta è letta via OCR nella sezione sopra.
              </p>
              {analysis.dumpError && (
                <p className="note">
                  <code>{analysis.dumpError}</code>
                </p>
              )}
            </div>
          ) : analysis.matches.length === 0 ? (
            <p className="note">
              Nessun nodo con keyword asta nell'albero uiautomator (sulle LIVE
              la card non è esposta): la decisione usa la lettura OCR sopra.
            </p>
          ) : (
            <div className="table-wrap">
              <NodeTable nodes={analysis.matches} />
            </div>
          )}
        </div>

        <div className="auction-section">
          <h3>Pulsante Offri</h3>
          {!round && (
            <button className="btn primary" onClick={onDryRun}>
              🧪 Dry run: individua pulsante Offri (nessun tap)
            </button>
          )}

          {round && mode !== "live" && decision === "offer" && (
            <div className="offer-panel ok">
              <p>
                <strong>
                  Condizioni soddisfatte (dry — nessun tap eseguito)
                </strong>
              </p>
              <p className="note">
                «{round.offerLabel}» → {euro(round.offerAmountEur)} · centro (
                {round.offerCenter?.x}, {round.offerCenter?.y}) · prezzo attuale{" "}
                {euro(round.currentPriceEur)} ·{" "}
                {round.phase ? PHASE_LABEL[round.phase] : "n/d"}
                {round.timerSec !== null ? ` ${round.timerSec}s` : ""} · conf OCR{" "}
                {round.ocrConfidence ?? "n/d"} · offerte spese: {round.offersSpent}
              </p>
              <p className="note">{formatTimings(round.timings)}</p>
              <button className="btn warn" onClick={onLive}>
                ⚡ TAP REALE (uno solo)
              </button>
            </div>
          )}

          {round && mode !== "live" && decision === "skip" && (
            <div className="offer-panel warnp">
              <p>
                <strong>NESSUN tap: {round.reason}</strong>
              </p>
              <p className="note">
                {round.phase ? PHASE_LABEL[round.phase] : "nessuna card"}
                {round.timerSec !== null ? ` ${round.timerSec}s` : ""} · prezzo{" "}
                {euro(round.currentPriceEur)} · pulsante{" "}
                {round.offerLabel ? `«${round.offerLabel}»` : "n/d"} ·{" "}
                {formatTimings(round.timings)}
              </p>
            </div>
          )}

          {round && mode === "live" && (
            <div
              className={`offer-panel ${
                round.uiChangedAfterTap === true ? "ok" : "warnp"
              }`}
            >
              <p>
                <strong>
                  Tap reale {round.decision === "offer" ? "eseguito" : "NON eseguito"}{" "}
                  {round.offerCenter
                    ? `a (${round.offerCenter.x}, ${round.offerCenter.y})`
                    : ""}
                </strong>
              </p>
              <p className="note">{round.reason}</p>
              {round.error && (
                <p className="note">Errore comando: {round.error}</p>
              )}
              <p className="note">Latenze — {formatTimings(round.timings)}</p>
              {round.verifyOutcome && (
                <p className="note">Verifica: {round.verifyOutcome}</p>
              )}
              {round.screenshotFile && (
                <p className="note">
                  Frame della decisione: <code>{round.screenshotFile}</code>
                </p>
              )}
            </div>
          )}
        </div>

        <details className="clickable-details">
          <summary>Nodi clickabili ({analysis.clickableNodes.length})</summary>
          <div className="table-wrap">
            <NodeTable nodes={analysis.clickableNodes} />
          </div>
        </details>
      </div>
    </div>
  );
}
