import { useState } from "react";
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

  const serial = device.serial;

  const sendTap = () =>
    run(async () => {
      const { Api } = await import("../api");
      await Api.tap(serial, Number(x), Number(y));
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
          <div className="field-row">
            <label>
              X{" "}
              <input
                type="number"
                value={x}
                onChange={(e) => setX(e.target.value)}
              />
            </label>
            <label>
              Y{" "}
              <input
                type="number"
                value={y}
                onChange={(e) => setY(e.target.value)}
              />
            </label>
            <button
              className="btn"
              onClick={() => void sendTap()}
              disabled={!authorized}
            >
              Invia
            </button>
          </div>
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
