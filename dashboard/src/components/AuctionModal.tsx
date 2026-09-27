import type {
  AuctionAnalysis,
  ClickOfferResult,
  UiNode,
} from "../../../src/shared/types";

interface Props {
  analysis: AuctionAnalysis
  offerResult: ClickOfferResult | null
  onDryRun: () => void
  onLive: () => void
  onClose: () => void
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
  offerResult,
  onDryRun,
  onLive,
  onClose,
}: Props) {
  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal auction"
        onClick={(e) => e.stopPropagation()}
      >
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
          {!offerResult && (
            <button className="btn primary" onClick={onDryRun}>
              🧪 Dry run: individua pulsante Offri
            </button>
          )}

          {offerResult?.status === "dry-run" && offerResult.node && (
            <div className="offer-panel ok">
              <p>
                <strong>Trovato (dry run — nessun tap eseguito)</strong>
              </p>
              <p className="note">
                text: «{offerResult.node.text}» · desc: «
                {offerResult.node.contentDesc}» · id:{" "}
                <code>{offerResult.node.resourceId || "—"}</code> · class:{" "}
                {offerResult.node.className} · centro ({offerResult.center?.x},{" "}
                {offerResult.center?.y})
              </p>
              <button className="btn warn" onClick={onLive}>
                ⚡ TAP REALE (uno solo)
              </button>
            </div>
          )}

          {offerResult?.status === "tapped" && (
            <div
              className={`offer-panel ${
                offerResult.before?.signature !==
                offerResult.after?.signature
                  ? "ok"
                  : "warnp"
              }`}
            >
              <p>
                <strong>Tap eseguito a ({offerResult.center?.x}, {offerResult.center?.y})</strong>
              </p>
              <p className="note">
                UI prima: {offerResult.before?.nodeCount} nodi · dopo:{" "}
                {offerResult.after?.nodeCount} nodi —{" "}
                {offerResult.before?.signature !==
                offerResult.after?.signature
                  ? "STATO CAMBIATO ✅"
                  : "STATO INVARIATO ⚠ (il tap forse non ha avuto effetto)"}
              </p>
              {offerResult.screenshotAfter && (
                <img
                  className="shot small"
                  src={offerResult.screenshotAfter.dataUrl}
                  alt="Schermata dopo il tap"
                />
              )}
            </div>
          )}

          {offerResult?.status === "not-found" && (
            <div className="offer-panel warnp">
              <p>
                <strong>
                  Pulsante «Offri» NON presente nell'albero UIAutomator.
                </strong>
              </p>
              <p className="note">
                Fallback previsto: coordinate fissa sul nostro Samsung. Candidati
                asta trovati: {offerResult.candidates?.length ?? 0}.
              </p>
            </div>
          )}
        </div>

        <details className="clickable-details">
          <summary>
            Nodi clickabili ({analysis.clickableNodes.length})
          </summary>
          <div className="table-wrap">
            <NodeTable nodes={analysis.clickableNodes} />
          </div>
        </details>
      </div>
    </div>
  );
}
