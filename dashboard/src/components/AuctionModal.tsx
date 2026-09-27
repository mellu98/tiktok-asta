import type {
  AuctionAnalysis,
  RoundResult,
  UiNode,
} from "../../../src/shared/types";

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

export function AuctionModal({
  analysis,
  round,
  onDryRun,
  onLive,
  onClose,
}: Props) {
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
          {analysis.nodeCount} nodi · schermo ~{analysis.screenSize.width}×
          {analysis.screenSize.height} · {analysis.clickableNodes.length}{" "}
          clickabili · XML raw: <code>{analysis.xmlFile}</code>
        </p>

        <img
          className="shot small"
          src={analysis.screenshot.dataUrl}
          alt="Screenshot del dispositivo"
        />

        <div className="auction-section">
          <h3>
            Candidati asta ({analysis.matches.length}) — Offri / offerta / € /
            prezzo
          </h3>
          {analysis.matches.length === 0 ? (
            <p className="note">
              Nessun nodo con keyword asta trovato nell'albero. Vedi lista
              clickabili sotto e XML raw per il fallback a coordinate fissa.
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
                etichetta: «{round.buttonLabel}» · punteggio {round.buttonScore}
                /100 · centro ({round.buttonCenter?.x}, {round.buttonCenter?.y})
                · prezzo{" "}
                {round.priceEur !== null ? `${round.priceEur}€` : "n/d"} (
                confidenza {round.priceConfidence ?? "n/d"}%) · offerte spese:{" "}
                {round.offersSpent}
              </p>
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
                  Tap reale{" "}
                  {round.decision === "offer" ? "eseguito" : "NON eseguito"}{" "}
                  {round.buttonCenter
                    ? `a (${round.buttonCenter.x}, ${round.buttonCenter.y})`
                    : ""}
                </strong>
              </p>
              <p className="note">{round.reason}</p>
              {round.error && (
                <p className="note">Errore comando: {round.error}</p>
              )}
              {round.timings && (
                <p className="note">
                  Latenze — dump {round.timings.dumpMs}ms · parse{" "}
                  {round.timings.parseMs}ms · decisione {round.timings.decideMs}
                  ms
                  {round.timings.tapMs !== null
                    ? ` · tap ${round.timings.tapMs}ms`
                    : ""}
                  {round.timings.verifyMs !== null
                    ? ` · verifica ${round.timings.verifyMs}ms`
                    : ""}
                </p>
              )}
              {round.screenshotFile && (
                <p className="note">
                  Post-tap: <code>{round.screenshotFile}</code>
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
