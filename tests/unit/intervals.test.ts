import {
  DEFAULT_INTERVAL_PLAN,
  describePlan,
  intervalPosition,
  isValidPlan,
  normalizePlan,
  planTotalSeconds,
  stepPhaseSeconds,
  stepRepeats,
} from '@/features/tracking/intervals';

const plan = { runSeconds: 60, walkSeconds: 120, repeats: 3 };

describe('run/walk intervals', () => {
  it('starts with a run and alternates on the active clock', () => {
    expect(intervalPosition(plan, 0)).toMatchObject({ kind: 'run', round: 1, rounds: 3, remainingSeconds: 60, phaseFraction: 0 });
    expect(intervalPosition(plan, 59.999)).toMatchObject({ kind: 'run', round: 1 });
    expect(intervalPosition(plan, 60)).toMatchObject({ kind: 'walk', round: 1, remainingSeconds: 120, phaseSeconds: 120 });
    expect(intervalPosition(plan, 180)).toMatchObject({ kind: 'run', round: 2 });
    expect(intervalPosition(plan, 500)).toMatchObject({ kind: 'walk', round: 3, remainingSeconds: 40 });
    expect(intervalPosition(plan, 540)).toMatchObject({ kind: 'done', round: 3, remainingSeconds: 0, totalRemainingSeconds: 0, phaseFraction: 1 });
    expect(intervalPosition(plan, 10_000).kind).toBe('done');
  });

  it('reports how far into the phase and the whole plan the clock is', () => {
    expect(intervalPosition(plan, 90)).toMatchObject({ kind: 'walk', phaseFraction: 0.25, remainingSeconds: 90 });
    expect(intervalPosition(plan, 100).totalRemainingSeconds).toBe(440);
    expect(planTotalSeconds(plan)).toBe(540);
  });

  it('steps durations by 15 s up to 2 min, 30 s up to 5 min, then by the minute, within limits', () => {
    expect(stepPhaseSeconds(60, 1)).toBe(75);
    expect(stepPhaseSeconds(120, 1)).toBe(150);
    expect(stepPhaseSeconds(120, -1)).toBe(105);
    expect(stepPhaseSeconds(300, 1)).toBe(360);
    expect(stepPhaseSeconds(300, -1)).toBe(270);
    expect(stepPhaseSeconds(360, -1)).toBe(300);
    expect(stepPhaseSeconds(15, -1)).toBe(15);
    expect(stepPhaseSeconds(1800, 1)).toBe(1800);
    expect(stepRepeats(1, -1)).toBe(1);
    expect(stepRepeats(30, 1)).toBe(30);
    expect(stepRepeats(8, 1)).toBe(9);
  });

  it('validates plans and repairs stored values', () => {
    expect(isValidPlan(plan)).toBe(true);
    expect(isValidPlan({ runSeconds: 0, walkSeconds: 60, repeats: 2 })).toBe(false);
    expect(isValidPlan({ runSeconds: 60, walkSeconds: 60, repeats: 1.5 })).toBe(false);
    expect(isValidPlan(null)).toBe(false);
    expect(normalizePlan(null)).toEqual(DEFAULT_INTERVAL_PLAN);
    expect(normalizePlan({ runSeconds: 5, walkSeconds: 'x', repeats: 99 })).toEqual({
      runSeconds: 15,
      walkSeconds: DEFAULT_INTERVAL_PLAN.walkSeconds,
      repeats: 30,
    });
  });

  it('describes a plan in one line', () => {
    expect(describePlan(plan)).toBe('Run 1:00 · walk 2:00 · 3 rounds');
    expect(describePlan({ runSeconds: 90, walkSeconds: 30, repeats: 1 })).toBe('Run 1:30 · walk 0:30 · 1 round');
  });
});
