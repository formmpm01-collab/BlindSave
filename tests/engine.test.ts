import { describe, expect, it } from 'vitest';
import { analyze, analysisInputSchema, cost } from '../supabase/functions/_shared/engine';
import { demoTariffs, exampleInput } from '../src/lib/demo';

describe('deterministic comparison', () => {
  it('includes every period, both power terms and twelve fixed fees', () => {
    const result = cost(exampleInput, exampleInput.currentRates);
    expect(result.energy).toBeCloseTo(980 * .23 + 870 * .17 + 1650 * .12, 8);
    expect(result.power).toBeCloseTo(4.6 * (.095 + .025) * 365, 8);
    expect(result.fees).toBe(54);
    expect(result.total).toBeCloseTo(826.78, 8);
  });
  it('ranks by full annual cost, preserves a reproducible timestamp and savings', () => {
    const result = analyze(exampleInput, demoTariffs, new Date('2026-10-04T00:00:00Z'));
    expect(result.annualKwh).toBe(3500);
    expect(result.calculatedAt).toBe('2026-10-04T00:00:00.000Z');
    expect(result.recommendations.map(r => r.tariff.name)).toEqual(['Equilibrio 24h', 'A tu ritmo', 'Esencial fija']);
    const best = result.recommendations[0];
    expect(best.breakdown.total).toBeCloseTo(3500 * .124 + 4.6 * .1 * 365, 8);
    expect(result.recommendations[1].breakdown.total).toBeCloseTo(612.603, 8);
    expect(best.savings).toBeCloseTo(result.current.total - best.breakdown.total, 8);
  });
  it('does not turn a more expensive tariff into positive savings', () => {
    const input = { ...exampleInput, currentRates: { p1: .01, p2: .01, p3: .01, powerP1: 0, powerP2: 0, monthlyFee: 0 } };
    expect(analyze(input, demoTariffs).recommendations.every(r => r.savings < 0)).toBe(true);
  });
  it('does not divide by zero with a zero-cost reference', () => {
    const input = { ...exampleInput, currentRates: { p1: 0, p2: 0, p3: 0, powerP1: 0, powerP2: 0, monthlyFee: 0 } };
    expect(analyze(input, demoTariffs).recommendations[0].savingsPercent).toBe(0);
  });
  it.each([NaN, Infinity, -1, 150001])('rejects invalid consumption %s', value => {
    expect(analysisInputSchema.safeParse({ ...exampleInput, annualKwh: { p1: value, p2: 0, p3: 0 } }).success).toBe(false);
  });
  it('rejects identifiers and arbitrary nested fields', () => {
    expect(analysisInputSchema.safeParse({ ...exampleInput, email: 'person@example.org' }).success).toBe(false);
    expect(analysisInputSchema.safeParse({ ...exampleInput, power: { p1: 4.6, p2: 4.6, cups: 'ES00000' } }).success).toBe(false);
  });
  it('rejects totals above the limit and zero consumption', () => {
    for (const annualKwh of [{ p1: 100000, p2: 100000, p3: 1 }, { p1: 0, p2: 0, p3: 0 }]) {
      expect(analysisInputSchema.safeParse({ ...exampleInput, annualKwh }).success).toBe(false);
    }
  });
  it('rejects invalid tariffs rather than silently ranking them', () => {
    expect(() => analyze(exampleInput, [{ ...demoTariffs[0], rates: { ...demoTariffs[0].rates, p1: NaN } }])).toThrow();
  });
});
