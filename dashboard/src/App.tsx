import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AuctionAnalysis,
  AndroidDevice,
  LogEntry,
  RoundResult,
  WsServerMessage,
} from "../../src/shared/types";
import { Api, ensureSession, serverWs } from "./api";
import { DeviceCard } from "./components/DeviceCard";
import { QuickControls } from "./components/QuickControls";
import { LogPanel } from "./components/LogPanel";
import { ScreenshotModal } from "./components/ScreenshotModal";
import { AppsModal } from "./components/AppsModal";
import { OnboardingPanel } from "./components/OnboardingPanel";
import { AuctionModal } from "./components/AuctionModal";
import { AutomationPanel } from "./components/AutomationPanel";

export function App() {
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<{
    file: string;
    dataUrl: string;
  } | null>(null);
  const [appsState, setAppsState] = useState<{
    open: boolean;
    loading: boolean;
    items: string[];
  }>({ open: false, loading: false, items: [] });
  const [auction, setAuction] = useState<AuctionAnalysis | null>(null);
  const [round, setRound] = useState<RoundResult | null>(null);
  const [scrcpyRunning, setScrcpyRunning] = useState<Record<string, boolean>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const errorTimer = useRef<number | undefined>(undefined);

  const showError = useCallback((message: string) => {
    setError(message);
    window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 7000);
  }, []);

  /** Wrappa le azioni: qualunque errore finisce nel banner, mai in console silenzioso. */
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      }
    },
    [showError],
  );

  // Connessione WS + stato iniziale.
  // Nell'app Tauri il sidecar impiega ~1-2s ad avviarsi: la prima fetch REST
  // può fallire → retry periodico finché il server non risponde.
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let retryTimer: number | undefined;

    const handleMessage = (raw: MessageEvent) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(raw.data as string) as WsServerMessage;
      } catch {
        return;
      }
      if (msg.type === "devices") setDevices(msg.devices);
      else if (msg.type === "log")
        setLogs((prev) => [...prev.slice(-199), msg.entry]);
      else if (msg.type === "scrcpy")
        setScrcpyRunning((prev) => ({
          ...prev,
          [msg.serial]: msg.status === "running",
        }));
    };

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(serverWs());
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        if (!disposed) window.setTimeout(connect, 3000);
      };
    };

    const initialLoad = async () => {
      if (disposed) return;
      try {
        const [devs, logEntries] = await Promise.all([
          Api.devices(),
          Api.logs(),
        ]);
        setDevices(devs);
        setLogs(logEntries);
        setServerReady(true);
      } catch {
        // Sidecar non ancora pronto: riprova tra 2s
        retryTimer = window.setTimeout(() => void initialLoad(), 2000);
      }
    };

    const start = async () => {
      if (disposed) return;
      try {
        await ensureSession();
      } catch {
        // il sidecar interno si avvia qualche istante dopo l'app
        retryTimer = window.setTimeout(() => void start(), 1000);
        return;
      }
      connect();
      await initialLoad();
    };
    void start();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  // Auto-selezione del dispositivo (prima connessione o device scomparso)
  useEffect(() => {
    if (devices.length === 0) {
      setSelectedSerial(null);
      return;
    }
    if (!selectedSerial || !devices.some((d) => d.serial === selectedSerial)) {
      setSelectedSerial(devices[0]?.serial ?? null);
    }
  }, [devices, selectedSerial]);

  const device = devices.find((d) => d.serial === selectedSerial) ?? null;
  const authorized = device?.authorized === true;

  const actions = {
    startMirroring: () =>
      run(async () => {
        if (!device) return;
        await Api.scrcpyStart(device.serial);
      }),
    screenshot: () =>
      run(async () => {
        if (!device) return;
        setScreenshot(await Api.screenshot(device.serial));
      }),
    openApps: () =>
      run(async () => {
        if (!device) return;
        setAppsState((s) => ({ ...s, open: true, loading: true }));
        const { packages } = await Api.apps(device.serial);
        setAppsState({ open: true, loading: false, items: packages });
      }),
    restartAdb: () =>
      run(async () => {
        await Api.adbRestart();
      }),
    analyzeAuction: () =>
      run(async () => {
        if (!device) return;
        const analysis = await Api.auctionAnalyze(device.serial);
        setAuction(analysis);
      }),
    round: (mode: "dry" | "live") =>
      run(async () => {
        if (!device) return;
        setRound(await Api.round(device.serial, mode));
      }),
    launchApp: (pkg: string) =>
      run(async () => {
        if (!device) return;
        await Api.launchApp(device.serial, pkg);
        setAppsState((s) => ({ ...s, open: false }));
      }),
  };

  return (
    <div className="app">
      <header className="header">
        <h1>ANDROID DEVICE CONTROL</h1>
        <span className="subtitle">POC locale · ADB + scrcpy · macOS</span>
      </header>

      {!serverReady && (
        <div className="banner info" role="status">
          Avvio del server interno…
        </div>
      )}

      {error && (
        <div className="banner" role="alert">
          ⚠ {error}
        </div>
      )}

      <section className="devices">
        {devices.length === 0 ? (
          <OnboardingPanel serverReady={serverReady} />
        ) : (
          devices.map((d) => (
            <DeviceCard
              key={d.serial}
              device={d}
              selected={d.serial === selectedSerial}
              onSelect={() => setSelectedSerial(d.serial)}
            />
          ))
        )}
      </section>

      {device && (
        <>
          <section className="panel">
            <h2>DEVICE</h2>
            <div className="button-grid">
              <button
                className="btn primary"
                onClick={actions.startMirroring}
                disabled={!authorized}
              >
                ▶ Avvia mirroring
              </button>
              <button
                className="btn"
                onClick={actions.screenshot}
                disabled={!authorized}
              >
                📷 Screenshot
              </button>
              <button
                className="btn"
                onClick={actions.openApps}
                disabled={!authorized}
              >
                📱 Elenco app
              </button>
              <button
                className="btn"
                onClick={actions.analyzeAuction}
                disabled={!authorized}
              >
                🔎 Analizza schermata TikTok
              </button>
              <button className="btn warn" onClick={actions.restartAdb}>
                ⟳ Riavvia ADB
              </button>
            </div>
            {scrcpyRunning[device.serial] && (
              <p className="scrcpy-status">
                Mirroring scrcpy attivo — chiudi la finestra scrcpy per
                terminarlo.
              </p>
            )}
          </section>

          <QuickControls
            device={device}
            authorized={authorized}
            run={run}
            onError={showError}
            onOpenApps={actions.openApps}
          />

          <AutomationPanel serial={device.serial} onError={showError} />
        </>
      )}

      <LogPanel logs={logs} />

      {screenshot && (
        <ScreenshotModal
          shot={screenshot}
          onClose={() => setScreenshot(null)}
        />
      )}

      {appsState.open && (
        <AppsModal
          loading={appsState.loading}
          items={appsState.items}
          onLaunch={actions.launchApp}
          onClose={() => setAppsState((s) => ({ ...s, open: false }))}
        />
      )}

      {auction && (
        <AuctionModal
          analysis={auction}
          round={round}
          onDryRun={() => void actions.round("dry")}
          onLive={() => {
            if (
              window.confirm(
                "Eseguire UN SOLO tap reale sul pulsante Offri?",
              )
            ) {
              void actions.round("live");
            }
          }}
          onClose={() => {
            setAuction(null);
            setRound(null);
          }}
        />
      )}
    </div>
  );
}
