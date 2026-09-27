import { describe, expect, it, vi } from "vitest";
import {
  TAP_COUNT_MAX,
  TAP_INTERVAL_MIN_MS,
  parseTapSequence,
  runTapSequence,
} from "../src/shared/tap-sequence";

describe("parseTapSequence", () => {
  it("accetta numero di tap e attesa validi", () => {
    expect(parseTapSequence("5", "1000")).toEqual({
      ok: true,
      plan: { count: 5, intervalMs: 1000 },
    });
  });

  it("rifiuta numeri di tap fuori intervallo o non interi", () => {
    for (const raw of ["0", "-1", "2.5", "", "abc", String(TAP_COUNT_MAX + 1)]) {
      const result = parseTapSequence(raw, "1000");
      expect(result.ok, `count=${raw}`).toBe(false);
    }
  });

  it("rifiuta un'attesa troppo breve o non numerica", () => {
    for (const raw of [String(TAP_INTERVAL_MIN_MS - 1), "", "x", "-5"]) {
      const result = parseTapSequence("3", raw);
      expect(result.ok, `interval=${raw}`).toBe(false);
    }
  });

  it("con un solo tap l'attesa non conta (può restare vuota)", () => {
    expect(parseTapSequence("1", "")).toEqual({
      ok: true,
      plan: { count: 1, intervalMs: 0 },
    });
  });
});

describe("runTapSequence", () => {
  function deps(overrides: Partial<Parameters<typeof runTapSequence>[1]> = {}) {
    return {
      tap: vi.fn(async () => {}),
      wait: vi.fn(async () => {}),
      isCancelled: () => false,
      onProgress: vi.fn(),
      ...overrides,
    };
  }

  it("esegue N tap con N-1 attese in mezzo e segnala l'avanzamento", async () => {
    const onProgress = vi.fn();
    const d = deps({ onProgress });

    const result = await runTapSequence({ count: 3, intervalMs: 800 }, d);

    expect(result).toEqual({ done: 3, cancelled: false });
    expect(d.tap).toHaveBeenCalledTimes(3);
    expect(d.wait).toHaveBeenCalledTimes(2);
    expect(d.wait).toHaveBeenCalledWith(800);
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("con Stop non esegue altri tap, nemmeno quello già in attesa", async () => {
    let cancelled = false;
    const d = deps({
      isCancelled: () => cancelled,
      wait: vi.fn(async () => {
        cancelled = true; // Stop premuto durante la prima attesa
      }),
    });

    const result = await runTapSequence({ count: 10, intervalMs: 500 }, d);

    expect(result).toEqual({ done: 1, cancelled: true });
    expect(d.tap).toHaveBeenCalledTimes(1);
  });

  it("se un tap fallisce si ferma e dice a che punto era", async () => {
    let calls = 0;
    const d = deps({
      tap: vi.fn(async () => {
        calls += 1;
        if (calls === 2) throw new Error("device offline");
      }),
    });

    await expect(
      runTapSequence({ count: 4, intervalMs: 200 }, d),
    ).rejects.toThrow("Sequenza interrotta al tap 2/4: device offline");
    expect(d.tap).toHaveBeenCalledTimes(2);
  });
});
