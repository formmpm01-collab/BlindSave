import { expect, test } from '@playwright/test';
import path from 'node:path';

test('example, comparison, conditions, filter and reset work without transmitting consumption', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5174')) externalRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByText('Estás en modo demostración.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Probar con un ejemplo' }).click();
  await page.getByRole('button', { name: 'Calcular mi ahorro' }).click();
  await expect(page.getByText('Tu ahorro potencial', { exact: true })).toBeVisible();
  await expect(page.locator('.tariff-card')).toHaveCount(3);
  await page.locator('.tariff-card').first().getByText('Desglose y condiciones').click();
  await expect(page.locator('.tariff-card').first().getByText('Total / año', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Sin permanencia' }).check();
  await expect(page.locator('.tariff-card')).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(externalRequests).toEqual([]);
  await page.getByRole('button', { name: 'Borrar datos', exact: true }).click();
  await expect(page.getByText('Tus mejores opciones, aquí.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('CSV stays local and an invalid file is rejected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Probar con un ejemplo' }).click();
  await page.getByRole('button', { name: 'Importar CSV' }).click();
  const fileInput = page.getByLabel('Archivo de consumo CSV');
  await fileInput.setInputFiles(path.resolve('public/plantilla-consumo.csv'));
  await expect(page.getByText('744 lecturas validadas')).toBeVisible();
  await page.getByRole('button', { name: 'Calcular mi ahorro' }).click();
  await expect(page.getByText('Consumo horario medio', { exact: false })).toBeVisible();
  await fileInput.setInputFiles({ name: 'private.csv', mimeType: 'text/csv', buffer: Buffer.from('fecha;hora;kwh;CUPS\n2025-01-01;0;1;ES0123456789') });
  await expect(page.getByRole('alert')).toContainText('Por privacidad');
  await expect(page.getByRole('button', { name: 'Calcular mi ahorro' })).toBeDisabled();
  await expect(page.getByText('Datos editados · vuelve a calcular')).toBeVisible();
});

test('privacy and methodology views explain scope', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Tu privacidad', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Menos datos. Más control.' })).toBeVisible();
  await page.getByRole('button', { name: 'Cómo calculamos' }).click();
  await expect(page.getByText('Energía + potencia + cuotas = coste anual')).toBeVisible();
});
