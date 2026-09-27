import { useCallback, useEffect, useState } from "react";
import type { RoundResult } from "../../../src/shared/types";
import type { AuctionConfig } from "../../../src/shared/types";
import type { JournalEntry } from "../../../src/shared/types";
import { Api } from "../api";

interface Props {
  serial: string;
  onError: (message: string) => void;
}

/**
 * Pannello automazione offerte: limiti economici, arresto di emergenza,
 * round (valutazione / dry / live) e journal delle decisioni.
 *
 * TUTTE le guardie (estop, dry-run, punteggio, prezzo, max offerte) sono
 * applicate dal backend: anche un UI bug non può forzare un tap.
 */
export function AutomationPanel({ serial, onError }: Props) {
  const [config, setConfig] = useState<AuctionConfig | null>(null);
  const [estop, setEstop] = useState(false);
  const [auctions, setAuctions] = useState<
    { auctionId: string; offersSpent: number }[]
  >([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [lastRound, setLastRound] = useState<RoundResult | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await Api.auctionState();
      setConfig(state.config);
      setEstop(state.safety.estopEngaged);
      setAuctions(state.auctions);
      setJournal(await Api.journal(8));
    } catch {
      // il server interno può non essere ancora pronto: retry al prossimo tick
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const guard = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateConfig = (patch: Partial<AuctionConfig>): void => {
    if (config) setConfig({ ...config, ...patch });
  };

  const save = async (): Promise<void> => {
    if (!config) return;
    await Api.saveAuctionConfig(config);
  };

  const totalSpent = auctions.reduce((sum, a) => sum + a.offersSpent, 0);

  return (
    <section className="panel">
      <h2>AUTOMAZIONE ASTA</h2>

      <div className={`estop-bar ${estop ? "estop-on" : ""}`}>
        {estop ? (
          <>
            <span className="estop-label">
              ⛔ ARRESTO DI EMERGENZA ATTIVO — tap reali bloccati
            </span>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void guard(() => Api.setEstop(false).then(() => {}))
              }
            >
              Rearma
            </button>
          </>
        ) : (
          <>
            <span className="estop-label">
              Tap reali abilitati (limiti attivi)
            </span>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                void guard(() => Api.setEstop(true).then(() => {}))
              }
            >
              ⛔ STOP EMERGENZA
            </button>
          </>
        )}
      </div>

      {config && (
        <div className="auto-grid">
          <label>
            Max offerta (€)
            <input
              type="number"
              min={0}
              value={config.maxBidEur}
              onChange={(e) =>
                updateConfig({ maxBidEur: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Max offerte/asta
            <input
              type="number"
              min={0}
              value={config.maxOffersPerAuction}
              onChange={(e) =>
                updateConfig({ maxOffersPerAuction: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Soglia pulsante
            <input
              type="number"
              min={0}
              max={100}
              value={config.confidenceThreshold}
              onChange={(e) =>
                updateConfig({ confidenceThreshold: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Soglia prezzo
            <input
              type="number"
              min={0}
              max={100}
              value={config.priceConfidenceThreshold}
              onChange={(e) =>
                updateConfig({
                  priceConfidenceThreshold: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="auto-checkbox">
            <input
              type="checkbox"
              checked={config.dryRun}
              onChange={(e) => updateConfig({ dryRun: e.target.checked })}
            />
            Dry-run (nessun tap reale)
          </label>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void guard(save)}
          >
            💾 Salva limiti
          </button>
        </div>
      )}

      <div className="auto-grid">
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            void guard(() =>
              Api.round(serial, "evaluate").then((r) => setLastRound(r)),
            )
          }
        >
          🔍 Valuta round
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            void guard(() =>
              Api.round(serial, "dry").then((r) => setLastRound(r)),
            )
          }
        >
          🧪 Dry run round
        </button>
        <button
          className="btn danger"
          disabled={busy || config?.dryRun !== false || estop}
          title={
            config?.dryRun
              ? "Disattiva il dry-run in configurazione per abilitare il tap reale"
              : undefined
          }
          onClick={() => {
            if (
              window.confirm("Eseguire UN SOLO tap reale sul pulsante Offri?")
            ) {
              void guard(() =>
                Api.round(serial, "live").then((r) => setLastRound(r)),
              );
            }
          }}
        >
          ⚡ Round LIVE
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            void guard(() => Api.resetAuction(null).then(() => {}))
          }
        >
          ♻ Nuova asta
        </button>
      </div>

      <p className="note">
        Offerte spese su questa asta: <strong>{totalSpent}</strong>
        {lastRound && (
          <>
            {" · "}ultimo round: {lastRound.mode} → {lastRound.decision} (
            {lastRound.reason})
          </>
        )}
      </p>

      {journal.length > 0 && (
        <details className="clickable-details">
          <summary>Journal decisioni ({journal.length})</summary>
          <div className="journal-list">
            {journal.map((j, i) => (
              <div key={`${j.ts}-${i}`} className="journal-row">
                <span className="log-ts">
                  {new Date(j.ts).toLocaleTimeString("it-IT", {
                    hour12: false,
                  })}
                </span>
                <span className={`journal-kind ${j.decision}`}>
                  {j.kind}/{j.decision}
                </span>
                <span>
                  {j.priceEur !== null ? `${j.priceEur}€` : "prezzo n/d"} —{" "}
                  {j.reason}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
