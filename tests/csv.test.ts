import { describe, expect, it } from 'vitest';
import { parseConsumptionCsv, periodFor, readConsumptionFile } from '../src/lib/csv';

function makeCsv(start = '2025-01-01', days = 31, value = '1', delimiter = ';') {
  const lines = [['fecha', 'hora', 'kwh'].join(delimiter)];
  const first = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const date = new Date(first.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    for (let h = 0; h < 24; h++) {
      if (date === '2025-03-30' && h === 2) continue;
      lines.push([date, h, value].join(delimiter));
      if (date === '2025-10-26' && h === 2) lines.push([date, h, value].join(delimiter));
    }
  }
  return lines.join('\n');
}
describe('CSV privacy boundary and numerical integrity', () => {
  it('normalizes a complete month to 365 days without retaining dates', () => {
    const result = parseConsumptionCsv(makeCsv());
    expect(result.days).toBe(31); expect(result.rows).toBe(744); expect(result.totalKwh).toBe(744);
    expect(Object.values(result.annualKwh).reduce((a, b) => a + b)).toBeCloseTo(8760);
    expect(result.hourlyAverage).toEqual(Array(24).fill(1));
    expect(JSON.stringify(result)).not.toContain('2025-01-01');
  });
  it('accepts BOM, CRLF, comma decimals, reordered columns and quoted fields', () => {
    const csv = makeCsv('2025-01-01', 31, '0,5');
    const reordered = csv.split('\n').map(line => line.split(';').reverse().map(s => `"${s}"`).join(';')).join('\r\n');
    expect(parseConsumptionCsv('\uFEFF' + reordered).totalKwh).toBe(372);
  });
  it.each(['cups', 'dni', 'iban', 'nombre', 'email'])('rejects extra %s column before upload', header => {
    expect(() => parseConsumptionCsv(`fecha;hora;kwh;${header}\n2025-01-01;0;1;PRIVATE`)).toThrow('Por privacidad');
  });
  it('rejects personal data hidden in an allowed column without echoing it', () => {
    try { parseConsumptionCsv(makeCsv().replace('2025-01-01;0;1', '2025-01-01;0;private@example.com')); }
    catch (e) { expect((e as Error).message).not.toContain('private@example.com'); expect((e as Error).message).toContain('fila 2'); return; }
    throw new Error('Expected validation to reject the input');
  });
  it.each(['=1+1', '-2', 'Infinity', 'NaN', '1e3', '51', 'ES1234567'])('rejects unsafe or invalid consumption %s', value => {
    expect(() => parseConsumptionCsv(makeCsv('2025-01-01', 31, value))).toThrow();
  });
  it('rejects malformed dates, missing hours and duplicate readings', () => {
    const csv = makeCsv();
    expect(() => parseConsumptionCsv(csv.replace('2025-01-01', '2025-02-30'))).toThrow();
    expect(() => parseConsumptionCsv(csv.replace('2025-01-01;0;1\n', ''))).toThrow('Faltan lecturas');
    expect(() => parseConsumptionCsv(csv + '\n2025-01-01;0;1')).toThrow('duplicada');
  });
  it('rejects a gap between otherwise complete days', () => {
    const csv = makeCsv().split('\n').filter(line => !line.startsWith('2025-01-15')).join('\n');
    expect(() => parseConsumptionCsv(csv)).toThrow('sin días ausentes');
  });
  it('requires at least 28 days and at most 366', () => {
    expect(() => parseConsumptionCsv(makeCsv('2025-01-01', 27))).toThrow();
    expect(() => parseConsumptionCsv(makeCsv('2025-01-01', 367))).toThrow();
  });
  it('preserves both DST transitions and rejects missing autumn repeat', () => {
    expect(parseConsumptionCsv(makeCsv('2025-03-01', 31)).rows).toBe(743);
    const autumn = makeCsv('2025-10-01', 31);
    expect(parseConsumptionCsv(autumn).rows).toBe(745);
    expect(() => parseConsumptionCsv(autumn.replace('2025-10-26;2;1\n', ''))).toThrow('Faltan lecturas');
  });
  it('rejects zero-only and oversized files', () => {
    expect(() => parseConsumptionCsv(makeCsv('2025-01-01', 31, '0'))).toThrow('positivo');
    expect(() => parseConsumptionCsv('x'.repeat(2 * 1024 * 1024 + 1))).toThrow('2 MB');
  });
  it('rejects a PDF without attempting to read its contents', async () => {
    const file = { name: 'bill.pdf', size: 20, text: () => { throw new Error('MUST NOT READ'); } } as unknown as File;
    await expect(readConsumptionFile(file)).rejects.toThrow('No se admiten facturas');
  });
});
describe('2.0TD periods for Península and Baleares', () => {
  it.each([[0, 'p3'], [7, 'p3'], [8, 'p2'], [9, 'p2'], [10, 'p1'], [13, 'p1'], [14, 'p2'], [17, 'p2'], [18, 'p1'], [21, 'p1'], [22, 'p2'], [23, 'p2']])('classifies weekday hour %s as %s', (hour, expected) => {
    expect(periodFor('2025-01-07', Number(hour))).toBe(expected);
  });
  it('assigns weekends and fixed national holidays to valley', () => {
    for (const date of ['2025-01-04', '2025-01-05', '2025-01-06', '2025-05-01', '2025-12-25']) expect(periodFor(date, 11)).toBe('p3');
  });
  it('does not apply movable or local holidays', () => expect(periodFor('2025-04-18', 11)).toBe('p1'));
});
