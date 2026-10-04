import { z } from 'zod';

const consumption = z.number().finite().min(0).max(150_000);
const energyPrice = z.number().finite().min(0).max(5);
const powerPrice = z.number().finite().min(0).max(5);
export const ratesSchema = z.object({
  p1: energyPrice, p2: energyPrice, p3: energyPrice,
  powerP1: powerPrice, powerP2: powerPrice,
  monthlyFee: z.number().finite().min(0).max(1000),
}).strict();
export const analysisInputSchema = z.object({
  annualKwh: z.object({ p1: consumption, p2: consumption, p3: consumption }).strict()
    .refine(v => v.p1 + v.p2 + v.p3 > 0 && v.p1 + v.p2 + v.p3 <= 150_000, 'Introduce un consumo total entre 0 y 150.000 kWh.'),
  power: z.object({ p1: z.number().finite().gt(0).max(15), p2: z.number().finite().gt(0).max(15) }).strict(),
  currentRates: ratesSchema,
}).strict();
export type AnalysisInput = z.infer<typeof analysisInputSchema>;
export type Rates = z.infer<typeof ratesSchema>;
export const tariffSchema = z.object({
  id: z.string().uuid(), provider: z.string().min(1).max(120), name: z.string().min(1).max(120),
  rates: ratesSchema, commitmentMonths: z.number().int().min(0).max(60),
  renewable: z.boolean(), conditions: z.string().max(4000),
  sourceUrl: z.string().url().refine(v => v.startsWith('https://')).nullable(),
  verifiedAt: z.string().datetime().nullable(), isDemo: z.boolean(),
}).strict();
export type Tariff = z.infer<typeof tariffSchema>;
export type Breakdown = { energy: number; power: number; fees: number; total: number };
export type Recommendation = { tariff: Tariff; breakdown: Breakdown; savings: number; savingsPercent: number };
export type Analysis = { current: Breakdown; recommendations: Recommendation[]; annualKwh: number; calculatedAt: string };

// Prices must contain all recurring, mandatory charges, before taxes and meter rental.
// No intermediate rounding: rounded only at the presentation boundary.
export function cost(input: AnalysisInput, rates: Rates): Breakdown {
  const energy = input.annualKwh.p1 * rates.p1 + input.annualKwh.p2 * rates.p2 + input.annualKwh.p3 * rates.p3;
  const power = 365 * (input.power.p1 * rates.powerP1 + input.power.p2 * rates.powerP2);
  const fees = 12 * rates.monthlyFee;
  return { energy, power, fees, total: energy + power + fees };
}
export function analyze(raw: unknown, tariffs: Tariff[], now = new Date()): Analysis {
  const input = analysisInputSchema.parse(raw);
  const current = cost(input, input.currentRates);
  const recommendations = tariffs.map(rawTariff => {
    const tariff = tariffSchema.parse(rawTariff);
    const breakdown = cost(input, tariff.rates);
    const savings = current.total - breakdown.total;
    return { tariff, breakdown, savings, savingsPercent: current.total > 0 ? savings / current.total * 100 : 0 };
  }).sort((a, b) => a.breakdown.total - b.breakdown.total || a.tariff.id.localeCompare(b.tariff.id));
  return { current, recommendations, annualKwh: Object.values(input.annualKwh).reduce((a, b) => a + b, 0), calculatedAt: now.toISOString() };
}
