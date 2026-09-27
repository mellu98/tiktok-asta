/**
 * Sessione shell ADB persistente: un solo processo `adb -s SERIAL shell`
 * tenuto aperto per device. Elimina dal percorso critico l'avvio di un nuovo
 * processo client adb a ogni comando (tap/swipe/text/keyevent).
 *
 * Protocollo: ogni comando viene inviato come
 *   `<comando>; echo "__POC_EOC_<id>_$?"`
 * e la risposta letta fino alla riga marker, che include anche l'exit code
 * del comando sul device. I comandi sono serializzati per sessione.
 *
 * Fallback: se la sessione non è utilizzabile, il chiamante usa execAdbText
 * come prima (stessa semantica, solo più lento).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ADB_BIN } from "./client";

interface Pending {
  marker: string;
  resolve: (r: { output: string; exitCode: number | null }) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface Session {
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
  queue: Array<() => void>;
  draining: boolean;
  alive: boolean;
  pending: Pending | null;
}

const sessions = new Map<string, Session>();
const CMD_TIMEOUT_MS = 10000;

let cmdCounter = 0;

function isAlive(session: Session): boolean {
  return session.alive && session.proc.exitCode === null && !session.proc.killed;
}

function openSession(serial: string): Session {
  const proc = spawn(ADB_BIN, ["-s", serial, "shell"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const session: Session = {
    proc,
    buffer: "",
    queue: [],
    draining: false,
    alive: true,
    pending: null,
  };

  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  const append = (chunk: string) => {
    session.buffer += chunk;
    processPending(session);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);

  const killPending = (reason: string) => {
    session.alive = false;
    if (session.pending) {
      clearTimeout(session.pending.timer);
      session.pending.reject(new Error(reason));
      session.pending = null;
    }
    for (const thunk of session.queue) thunk();
    session.queue = [];
  };

  proc.on("exit", (code) => killPending(`sessione shell terminata (code ${code})`));
  proc.on("error", (err) => killPending(`errore sessione shell: ${err.message}`));

  return session;
}

function processPending(session: Session): void {
  const pending = session.pending;
  if (!pending) return;
  const idx = session.buffer.indexOf(pending.marker);
  if (idx === -1) return;
  const lineEnd = session.buffer.indexOf("\n", idx);
  if (lineEnd === -1) return; // attendi la fine della riga marker

  clearTimeout(pending.timer);
  session.pending = null;

  const markerLine = session.buffer.slice(idx, lineEnd);
  const output = session.buffer.slice(0, idx).replace(/\r/g, "");
  session.buffer = session.buffer.slice(lineEnd + 1);

  const ecMatch = /_(\d+)__\s*$/.exec(markerLine.trim());
  pending.resolve({ output, exitCode: ecMatch ? Number(ecMatch[1]) : null });
}

function drainQueue(session: Session): void {
  if (session.draining) return;
  session.draining = true;
  const next = session.queue.shift();
  if (!next) {
    session.draining = false;
    return;
  }
  // lascia respirare l'event loop fra comandi
  setImmediate(() => {
    try {
      next();
    } catch (err) {
      // il thunk gestisce già i propri errori
      void err;
    }
    session.draining = false;
    drainQueue(session);
  });
}

function getSession(serial: string): Session {
  const existing = sessions.get(serial);
  if (existing && isAlive(existing)) return existing;
  if (existing) sessions.delete(serial);
  const session = openSession(serial);
  sessions.set(serial, session);
  return session;
}

/** Esegue un comando nella sessione persistente del device. */
export async function runInShellSession(
  serial: string,
  command: string,
  timeoutMs = CMD_TIMEOUT_MS,
): Promise<{ output: string; exitCode: number | null }> {
  const session = getSession(serial);

  return new Promise((resolve, reject) => {
    const thunk = () => {
      if (!isAlive(session)) {
        reject(new Error("sessione shell non disponibile"));
        return;
      }
      const id = (++cmdCounter).toString(36);
      const marker = `__POC_EOC_${id}_`;
      const pending: Pending = {
        marker,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (session.pending === pending) session.pending = null;
          session.proc.kill();
          sessions.delete(serial);
          reject(new Error(`timeout comando (${timeoutMs}ms)`));
        }, timeoutMs),
      };
      session.pending = pending;
      session.proc.stdin.write(`${command}; echo "${marker}$?"\n`);
    };

    session.queue.push(thunk);
    drainQueue(session);
  });
}

/** Chiude la sessione di un device (usato su disconnect/shutdown). */
export function closeShellSession(serial: string): void {
  const s = sessions.get(serial);
  if (!s) return;
  s.alive = false;
  s.proc.kill();
  sessions.delete(serial);
}

export function closeAllShellSessions(): void {
  for (const serial of [...sessions.keys()]) closeShellSession(serial);
}

export function activeSessionCount(): number {
  return sessions.size;
}

/** Test-only: chiude tutte le sessioni e azzera lo stato interno. */
export function resetShellSessionsForTests(): void {
  closeAllShellSessions();
}
