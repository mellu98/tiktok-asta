import { useEffect, useRef } from "react";
import type { LogEntry } from "../../../src/shared/types";

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString("it-IT", { hour12: false });
}

export function LogPanel({ logs }: { logs: LogEntry[] }) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Auto-scroll verso il log più recente
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <section className="panel">
      <h2>ADB LOG</h2>
      <div className="log-box" ref={boxRef}>
        {logs.length === 0 ? (
          <div className="log-line dim">In attesa di eventi…</div>
        ) : (
          logs.map((l) => (
            <div key={l.id} className={`log-line ${l.level}`}>
              <span className="log-ts">{time(l.ts)}</span>
              <span className="log-src">[{l.source}]</span>
              <span className="log-msg">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
