import type { IntervalPlan } from '@/modules/android-location';

import { formatDuration } from '@/utils/format';

export type { IntervalPlan };

/**
 * Run/walk intervals: run for `runSeconds`, walk for `walkSeconds`, `repeats` times, timed on the
 * active clock (so they wait while paused or auto-paused). The native service owns the timing and
 * the cues; this mirrors its arithmetic (TrackingSession.kt, IntervalPlan) for the screen.
 */

export const DEFAULT_INTERVAL_PLAN: IntervalPlan = { runSeconds: 60, walkSeconds: 120, repeats: 8 };

export const INTERVAL_LIMITS = {
  minPhaseSeconds: 15,
  maxPhaseSeconds: 30 * 60,
  minRepeats: 1,
  maxRepeats: 30,
} as const;

export function isValidPlan(plan: IntervalPlan | null | undefined): plan is IntervalPlan {
  return (
    plan !== null &&
    plan !== undefined &&
    Number.isInteger(plan.runSeconds) &&
    Number.isInteger(plan.walkSeconds) &&
    Number.isInteger(plan.repeats) &&
    plan.runSeconds >= INTERVAL_LIMITS.minPhaseSeconds &&
    plan.runSeconds <= INTERVAL_LIMITS.maxPhaseSeconds &&
    plan.walkSeconds >= INTERVAL_LIMITS.minPhaseSeconds &&
    plan.walkSeconds <= INTERVAL_LIMITS.maxPhaseSeconds &&
    plan.repeats >= INTERVAL_LIMITS.minRepeats &&
    plan.repeats <= INTERVAL_LIMITS.maxRepeats
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A usable plan from stored values; anything missing or out of range falls back to the default. */
export function normalizePlan(value: Partial<Record<keyof IntervalPlan, unknown>> | null | undefined): IntervalPlan {
  const pick = (key: keyof IntervalPlan, min: number, max: number) => {
    const raw = value?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? clamp(Math.round(raw), min, max) : DEFAULT_INTERVAL_PLAN[key];
  };
  return {
    runSeconds: pick('runSeconds', INTERVAL_LIMITS.minPhaseSeconds, INTERVAL_LIMITS.maxPhaseSeconds),
    walkSeconds: pick('walkSeconds', INTERVAL_LIMITS.minPhaseSeconds, INTERVAL_LIMITS.maxPhaseSeconds),
    repeats: pick('repeats', INTERVAL_LIMITS.minRepeats, INTERVAL_LIMITS.maxRepeats),
  };
}

/** Next value of a run or walk duration stepper: 15 s steps up to 2 min, 30 s to 5 min, then 1 min. */
export function stepPhaseSeconds(seconds: number, direction: 1 | -1): number {
  let step: number;
  if (direction > 0) step = seconds < 120 ? 15 : seconds < 300 ? 30 : 60;
  else step = seconds <= 120 ? 15 : seconds <= 300 ? 30 : 60;
  return clamp(seconds + direction * step, INTERVAL_LIMITS.minPhaseSeconds, INTERVAL_LIMITS.maxPhaseSeconds);
}

export function stepRepeats(repeats: number, direction: 1 | -1): number {
  return clamp(repeats + direction, INTERVAL_LIMITS.minRepeats, INTERVAL_LIMITS.maxRepeats);
}

export function planTotalSeconds(plan: IntervalPlan): number {
  return (plan.runSeconds + plan.walkSeconds) * plan.repeats;
}

/** "Run 1:00 · walk 2:00 · 8 rounds" */
export function describePlan(plan: IntervalPlan): string {
  const rounds = plan.repeats === 1 ? '1 round' : `${plan.repeats} rounds`;
  return `Run ${formatDuration(plan.runSeconds)} · walk ${formatDuration(plan.walkSeconds)} · ${rounds}`;
}

export type IntervalPosition = {
  kind: 'run' | 'walk' | 'done';
  /** 1-based round (the last round once done). */
  round: number;
  rounds: number;
  /** Seconds left in the current phase; 0 once done. */
  remainingSeconds: number;
  /** Length of the current phase; 0 once done. */
  phaseSeconds: number;
  /** How much of the current phase has passed, 0–1 (1 once done). */
  phaseFraction: number;
  /** Seconds left in the whole plan. */
  totalRemainingSeconds: number;
};

/** Where `activeSeconds` falls in the plan. Uses whole milliseconds, like the native timer. */
export function intervalPosition(plan: IntervalPlan, activeSeconds: number): IntervalPosition {
  const runMs = plan.runSeconds * 1000;
  const walkMs = plan.walkSeconds * 1000;
  const cycleMs = runMs + walkMs;
  const totalMs = cycleMs * plan.repeats;
  const activeMs = Math.max(0, Math.floor(activeSeconds * 1000));
  if (activeMs >= totalMs || cycleMs <= 0) {
    return { kind: 'done', round: plan.repeats, rounds: plan.repeats, remainingSeconds: 0, phaseSeconds: 0, phaseFraction: 1, totalRemainingSeconds: 0 };
  }
  const roundIndex = Math.floor(activeMs / cycleMs);
  const within = activeMs - roundIndex * cycleMs;
  const running = within < runMs;
  const phaseMs = running ? runMs : walkMs;
  const intoPhase = running ? within : within - runMs;
  return {
    kind: running ? 'run' : 'walk',
    round: roundIndex + 1,
    rounds: plan.repeats,
    remainingSeconds: (phaseMs - intoPhase) / 1000,
    phaseSeconds: phaseMs / 1000,
    phaseFraction: intoPhase / phaseMs,
    totalRemainingSeconds: (totalMs - activeMs) / 1000,
  };
}
