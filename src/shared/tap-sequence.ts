/**
 * Sequenza di tap ripetuti (Quick Controls → Tap): N tap sullo stesso punto,
 * con un'attesa fissa tra uno e l'altro. Logica pura, senza DOM né adb, così
 * è testabile e riusabile; ogni tap passa comunque dall'endpoint /input/tap
 * esistente (coordinate validate lato server, un tap = una riga di log).
 *
 * L'attesa si conta da quando il tap precedente è stato eseguito: il tempo
 * reale tra due tap è attesa + durata del comando `input tap` sul telefono.
 */

export const TAP_COUNT_MIN = 1;
export const TAP_COUNT_MAX = 50;
export const TAP_INTERVAL_MIN_MS = 100;
export const TAP_INTERVAL_MAX_MS = 60000;

export interface TapSequencePlan {
  count: number;
  intervalMs: number;
}

export type TapSequenceParse =
  | { ok: true; plan: TapSequencePlan }
  | { ok: false; error: string };

export interface TapSequenceDeps {
  tap: () => Promise<void>;
  /** Attesa tra due tap; può risolversi prima se l'utente preme Stop. */
  wait: (ms: number) => Promise<void>;
  isCancelled: () => boolean;
  onProgress: (done: number, total: number) => void;
}

export interface TapSequenceResult {
  done: number;
  cancelled: boolean;
}

function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Valida i due campi del form. Con un solo tap l'attesa è ignorata. */
export function parseTapSequence(
  countRaw: string,
  intervalRaw: string,
): TapSequenceParse {
  const count = parseInteger(countRaw);
  if (count === null || count < TAP_COUNT_MIN || count > TAP_COUNT_MAX) {
    return {
      ok: false,
      error: `Numero di tap: intero da ${TAP_COUNT_MIN} a ${TAP_COUNT_MAX}`,
    };
  }
  if (count === 1) {
    return { ok: true, plan: { count, intervalMs: 0 } };
  }

  const intervalMs = parseInteger(intervalRaw);
  if (
    intervalMs === null ||
    intervalMs < TAP_INTERVAL_MIN_MS ||
    intervalMs > TAP_INTERVAL_MAX_MS
  ) {
    return {
      ok: false,
      error: `Attesa tra i tap: da ${TAP_INTERVAL_MIN_MS} a ${TAP_INTERVAL_MAX_MS} ms`,
    };
  }
  return { ok: true, plan: { count, intervalMs } };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Esegue la sequenza. Stop viene controllato prima di ogni tap: dopo Stop
 * non parte più nessun tap. Al primo errore si ferma e dice a che punto era.
 */
export async function runTapSequence(
  plan: TapSequencePlan,
  deps: TapSequenceDeps,
): Promise<TapSequenceResult> {
  let done = 0;
  for (let i = 0; i < plan.count; i++) {
    if (deps.isCancelled()) return { done, cancelled: true };
    try {
      await deps.tap();
    } catch (err) {
      throw new Error(
        `Sequenza interrotta al tap ${i + 1}/${plan.count}: ${errorMessage(err)}`,
      );
    }
    done += 1;
    deps.onProgress(done, plan.count);
    if (i < plan.count - 1) await deps.wait(plan.intervalMs);
  }
  return { done, cancelled: false };
}
