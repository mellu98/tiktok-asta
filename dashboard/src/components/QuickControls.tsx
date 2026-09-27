import { useEffect, useRef, useState } from "react";
import {
  TAP_COUNT_MAX,
  TAP_COUNT_MIN,
  TAP_INTERVAL_MAX_MS,
  TAP_INTERVAL_MIN_MS,
  parseTapSequence,
  runTapSequence,
} from "../../../src/shared/tap-sequence";
import type { AndroidDevice } from "../../../src/shared/types";

interface Props {
  device: AndroidDevice;
  authorized: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onError: (message: string) => void;
  onOpenApps: () => void;
}

/** Controlli manuali: tap/swipe/testo, tasti hardware, apertura app. */
export function QuickControls({
  device,
  authorized,
  run,
  onError,
  onOpenApps,
}: Props) {
  const [x, setX] = useState("500");
  const [y, setY] = useState("1000");
  const [swipeVals, setSwipeVals] = useState({
    x1: "500",
    y1: "1500",
    x2: "500",
    y2: "500",
    durationMs: "300",
  });
  const [text, setText] = useState("");
  const [tapCount, setTapCount] = useState("1");
  const [tapIntervalMs, setTapIntervalMs] = useState("1000");
  const [tapProgress, setTapProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const cancelTapsRef = useRef(false);
  const wakeWaitRef = useRef<(() => void) | null>(null);
  const tapLockRef = useRef(false);

  const serial = device.serial;
  const tapsRunning = tapProgress !== null;

  /** Ferma la sequenza: nessun altro tap parte, l'attesa in corso si chiude subito. */
  const stopTaps = () => {
    cancelTapsRef.current = true;
    wakeWaitRef.current?.();
  };

  // Cambio dispositivo o pannello smontato: la sequenza in corso si ferma
  useEffect(() => stopTaps, [serial]);

  const waitOrStop = (ms: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        window.clearTimeout(timer);
        wakeWaitRef.current = null;
        resolve();
      };
      const timer = window.setTimeout(finish, ms);
      wakeWaitRef.current = finish;
    });

  const executeTaps = async () => {
    const parsed = parseTapSequence(tapCount, tapIntervalMs);
    if (!parsed.ok) {
      onError(parsed.error);
      return;
    }
    const { plan } = parsed;
    const tapX = Number(x);
    const tapY = Number(y);
    const { Api } = await import("../api");
    const tapOnce = async () => {
      await Api.tap(serial, tapX, tapY);
    };

    if (plan.count === 1) {
      await tapOnce();
      return;
    }
    if (
      !window.confirm(
        `Eseguire ${plan.count} tap in (${tapX}, ${tapY}), uno ogni ${plan.intervalMs} ms?`,
      )
    ) {
      return;
    }

    cancelTapsRef.current = false;
    setTapProgress({ done: 0, total: plan.count });
    try {
      await runTapSequence(plan, {
        tap: tapOnce,
        wait: waitOrStop,
        isCancelled: () => cancelTapsRef.current,
        onProgress: (done, total) => setTapProgress({ done, total }),
      });
    } finally {
      setTapProgress(null);
    }
  };

  // Blocco sincrono (ref, non state: lo state arriva al pulsante solo al render
  // successivo): un doppio clic su Invia non deve avviare due tap o due sequenze
  const sendTap = () =>
    run(async () => {
      if (tapLockRef.current) return;
      tapLockRef.current = true;
      try {
        await executeTaps();
      } finally {
        tapLockRef.current = false;
      }
    });

  const sendSwipe = () =>
    run(async () => {
      const { Api } = await import("../api");
      await Api.swipe(serial, {
        x1: Number(swipeVals.x1),
        y1: Number(swipeVals.y1),
        x2: Number(swipeVals.x2),
        y2: Number(swipeVals.y2),
        durationMs: Number(swipeVals.durationMs) || 300,
      });
    });

  const sendText = () =>
    run(async () => {
      if (!text.trim()) {
        onError("Scrivi del testo da inviare");
        return;
      }
      const { Api } = await import("../api");
      await Api.text(serial, text);
      setText("");
    });

  const sendKey = (key: "HOME" | "BACK" | "ENTER") =>
    run(async () => {
      const { Api } = await import("../api");
      await Api.key(serial, key);
    });

  return (
    <section className="panel">
      <h2>QUICK CONTROLS</h2>
      <div className="qc-row">
        <button
          className="btn key"
          onClick={() => void sendKey("HOME")}
          disabled={!authorized}
        >
          ⌂ HOME
        </button>
        <button
          className="btn key"
          onClick={() => void sendKey("BACK")}
          disabled={!authorized}
        >
          ↩ BACK
        </button>
        <button
          className="btn key"
          onClick={() => void sendKey("ENTER")}
          disabled={!authorized}
        >
          ⏎ ENTER
        </button>
        <button className="btn" onClick={onOpenApps} disabled={!authorized}>
          ▷ Apri app…
        </button>
      </div>

      <div className="qc-grid">
        <div className="qc-box">
          <h3>Tap</h3>
          <div className="field-row wrap">
            <label>
              X{" "}
              <input
                type="number"
                value={x}
                disabled={tapsRunning}
                onChange={(e) => setX(e.target.value)}
              />
            </label>
            <label>
              Y{" "}
              <input
                type="number"
                value={y}
                disabled={tapsRunning}
                onChange={(e) => setY(e.target.value)}
              />
            </label>
            <label>
              Numero tap{" "}
              <input
                type="number"
                min={TAP_COUNT_MIN}
                max={TAP_COUNT_MAX}
                step={1}
                value={tapCount}
                disabled={tapsRunning}
                onChange={(e) => setTapCount(e.target.value)}
              />
            </label>
            <label>
              Attesa ms{" "}
              <input
                type="number"
                min={TAP_INTERVAL_MIN_MS}
                max={TAP_INTERVAL_MAX_MS}
                step={100}
                value={tapIntervalMs}
                disabled={tapsRunning || tapCount.trim() === "1"}
                onChange={(e) => setTapIntervalMs(e.target.value)}
              />
            </label>
            {tapsRunning ? (
              <button className="btn warn" onClick={stopTaps}>
                ■ Stop ({tapProgress.done}/{tapProgress.total})
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => void sendTap()}
                disabled={!authorized}
              >
                Invia
              </button>
            )}
          </div>
          <p className="note">
            Più tap sullo stesso punto: da {TAP_COUNT_MIN} a {TAP_COUNT_MAX},
            con conferma prima di partire. L'attesa parte quando il tap
            precedente è stato eseguito. Stop blocca subito i tap successivi.
          </p>
        </div>

        <div className="qc-box">
          <h3>Swipe</h3>
          <div className="field-row wrap">
            {(["x1", "y1", "x2", "y2", "durationMs"] as const).map((k) => (
              <label key={k}>
                {k}{" "}
                <input
                  type="number"
                  value={swipeVals[k]}
                  onChange={(e) =>
                    setSwipeVals((v) => ({ ...v, [k]: e.target.value }))
                  }
                />
              </label>
            ))}
            <button
              className="btn"
              onClick={() => void sendSwipe()}
              disabled={!authorized}
            >
              Invia
            </button>
          </div>
        </div>

        <div className="qc-box">
          <h3>Testo</h3>
          <div className="field-row">
            <input
              className="grow"
              type="text"
              placeholder="Testo da digitare sul telefono…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendText();
              }}
            />
            <button
              className="btn"
              onClick={() => void sendText()}
              disabled={!authorized}
            >
              Invia
            </button>
          </div>
          <p className="note">
            Lettere, numeri e punteggiatura base. Gli spazi vengono inviati
            correttamente.
          </p>
        </div>
      </div>
    </section>
  );
}
