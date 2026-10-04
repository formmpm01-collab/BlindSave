import Papa from 'papaparse';

export type Period = 'p1' | 'p2' | 'p3';
export type ConsumptionSummary = {
  annualKwh: Record<Period, number>;
  hourlyAverage: number[];
  days: number;
  rows: number;
  totalKwh: number;
  annualized: boolean;
};
const fixedHolidays = new Set(['01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25']);
const MAX_BYTES = 2 * 1024 * 1024;
const dayMs = 86_400_000;

export function periodFor(date: string, hour: number): Period {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (day === 0 || day === 6 || fixedHolidays.has(date.slice(5)) || hour < 8) return 'p3';
  if ((hour >= 10 && hour < 14) || (hour >= 18 && hour < 22)) return 'p1';
  return 'p2';
}
function dstDay(date: string, month: number) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.getUTCMonth() === month - 1 && d.getUTCDay() === 0 && d.getUTCDate() + 7 > new Date(Date.UTC(d.getUTCFullYear(), month, 0)).getUTCDate();
}
export function parseConsumptionCsv(text: string): ConsumptionSummary {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('El archivo supera el límite de 2 MB.');
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t'] });
  if (parsed.errors.length) throw new Error('El CSV no tiene una estructura válida. Utiliza la plantilla.');
  const [rawHeaders, ...rows] = parsed.data;
  const headers = rawHeaders?.map(h => h.trim().toLowerCase());
  if (!headers || headers.length !== 3 || new Set(headers).size !== 3 || !['fecha', 'hora', 'kwh'].every(h => headers.includes(h))) {
    throw new Error('Por privacidad solo se admiten las columnas fecha, hora y kwh. Elimina CUPS, nombres y cualquier otra columna antes de importar.');
  }
  if (!rows.length || rows.length > 8785) throw new Error('Incluye entre 28 y 366 días de lecturas horarias completas.');
  const index = { date: headers.indexOf('fecha'), hour: headers.indexOf('hora'), kwh: headers.indexOf('kwh') };
  const daily = new Map<string, Map<number, number>>();
  const totals = { p1: 0, p2: 0, p3: 0 };
  const hourlyTotals = Array<number>(24).fill(0);
  const hourlyCounts = Array<number>(24).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fail = () => new Error(`La fila ${i + 2} no contiene una lectura válida. Revisa el formato de la plantilla.`);
    if (row.length !== 3) throw fail();
    const date = row[index.date].trim();
    const rawHour = row[index.hour].trim();
    const rawKwh = row[index.kwh].trim();
    // Strict field allowlist; never include values or the filename in errors or requests.
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}$/.test(rawHour) || !/^\d{1,3}([.,]\d{1,6})?$/.test(rawKwh)) throw fail();
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date || date < '2021-06-01') throw fail();
    const hour = Number(rawHour);
    const kwh = Number(rawKwh.replace(',', '.'));
    if (hour > 23 || kwh > 50) throw fail();
    const hours = daily.get(date) ?? new Map<number, number>();
    const count = (hours.get(hour) ?? 0) + 1;
    if (count > (dstDay(date, 10) && hour === 2 ? 2 : 1) || (dstDay(date, 3) && hour === 2)) throw new Error(`Lectura duplicada o incompatible con el cambio de hora en la fila ${i + 2}.`);
    hours.set(hour, count);
    daily.set(date, hours);
    totals[periodFor(date, hour)] += kwh;
    hourlyTotals[hour] += kwh;
    hourlyCounts[hour]++;
  }
  const dates = [...daily.keys()].sort();
  const days = (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / dayMs + 1;
  if (days < 28 || days > 366 || daily.size !== days) throw new Error('Necesitamos entre 28 y 366 días consecutivos, sin días ausentes.');
  for (const [date, hours] of daily) {
    const count = [...hours.values()].reduce((a, b) => a + b, 0);
    const expected = dstDay(date, 3) ? 23 : dstDay(date, 10) ? 25 : 24;
    if (count !== expected) throw new Error('Faltan lecturas horarias. Usa días completos y conserva las dos lecturas de las 02:00 en el cambio de hora de octubre.');
  }
  const totalKwh = totals.p1 + totals.p2 + totals.p3;
  if (totalKwh <= 0 || totalKwh * 365 / days > 150_000) throw new Error('El consumo debe ser positivo y no superar 150.000 kWh anuales.');
  return {
    annualKwh: { p1: totals.p1 * 365 / days, p2: totals.p2 * 365 / days, p3: totals.p3 * 365 / days },
    hourlyAverage: hourlyTotals.map((total, h) => hourlyCounts[h] ? total / hourlyCounts[h] : 0),
    days, rows: rows.length, totalKwh, annualized: days !== 365,
  };
}
export async function readConsumptionFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Selecciona un CSV. No se admiten facturas ni documentos PDF.');
  if (file.size > MAX_BYTES) throw new Error('El archivo supera el límite de 2 MB.');
  return parseConsumptionCsv(await file.text());
}
