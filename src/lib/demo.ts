import type { AnalysisInput, Tariff } from '../../supabase/functions/_shared/engine';
export const exampleInput: AnalysisInput = {
  annualKwh: { p1: 980, p2: 870, p3: 1650 }, power: { p1: 4.6, p2: 4.6 },
  currentRates: { p1: 0.23, p2: 0.17, p3: 0.12, powerP1: 0.095, powerP2: 0.025, monthlyFee: 4.5 },
};
export const demoTariffs: Tariff[] = [
  { id: '00000000-0000-4000-8000-000000000001', provider: 'Compañía de ejemplo A', name: 'Equilibrio 24h', rates: { p1: 0.124, p2: 0.124, p3: 0.124, powerP1: 0.082, powerP2: 0.018, monthlyFee: 0 }, commitmentMonths: 0, renewable: true, conditions: 'Ejemplo ficticio de precio fijo las 24 horas. Sin servicios adicionales. Los precios permanecen constantes durante los 365 días simulados. No es una oferta contratable.', sourceUrl: null, verifiedAt: null, isDemo: true },
  { id: '00000000-0000-4000-8000-000000000002', provider: 'Compañía de ejemplo B', name: 'A tu ritmo', rates: { p1: 0.19, p2: 0.115, p3: 0.078, powerP1: 0.087, powerP2: 0.02, monthlyFee: 1.5 }, commitmentMonths: 0, renewable: true, conditions: 'Ejemplo ficticio de tres periodos 2.0TD. Incluye una cuota obligatoria de 1,50 € al mes, incorporada al cálculo. No es una oferta contratable.', sourceUrl: null, verifiedAt: null, isDemo: true },
  { id: '00000000-0000-4000-8000-000000000003', provider: 'Compañía de ejemplo C', name: 'Esencial fija', rates: { p1: 0.132, p2: 0.132, p3: 0.132, powerP1: 0.08, powerP2: 0.02, monthlyFee: 2 }, commitmentMonths: 12, renewable: false, conditions: 'Ejemplo ficticio con compromiso de 12 meses y cuota obligatoria de 2 € al mes. Una eventual penalización de salida de tu contrato actual no está incluida. No es una oferta contratable.', sourceUrl: null, verifiedAt: null, isDemo: true },
];
