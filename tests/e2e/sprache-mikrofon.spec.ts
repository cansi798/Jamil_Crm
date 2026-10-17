import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { anmelden } from './hilfe';

/**
 * Sprachbefehl über das Mikrofon mit Fake-Audiodatei (Chromium: Fake-Gerät + Datei als Mikrofon, Freigabe ohne
 * Rückfrage). Die Datei (espeak-ng, 16 kHz mono) sagt „Neuer Kunde Eva Schulz aus Hamburg.“ –
 * sie läuft durch den echten STT-Dienst (crm-stt) und die FakeKi; geprüft wird, dass Aufnahme, Pegel/Countdown und
 * danach die Bestätigungskarte erscheinen. Gespeichert wird nichts (Abbrechen).
 */
const WAV = resolve('tests/e2e/daten/befehl-kunde.wav');
const FOTOS = process.env.FOTO_ORDNER;

test.use({
	launchOptions: {
		args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`]
	},
	permissions: ['microphone']
});

test('Mikrofon: antippen → „Ich höre zu …“ mit Countdown → Fertig → Bestätigungskarte', async ({ page }, info) => {
	test.setTimeout(120_000);
	await anmelden(page, 'buero@bauwelt.test');
	await page.getByRole('button', { name: 'Sprachbefehl' }).click();
	const dialog = page.getByRole('dialog', { name: 'Sprachbefehl' });
	await expect(dialog.getByRole('heading', { name: 'Ich höre zu …' })).toBeVisible();
	await expect(dialog.getByText(/Noch 0:5\d|Noch 1:00/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sprachbefehl' })).toHaveAttribute('aria-pressed', 'true');
	await page.waitForTimeout(3000);
	if (FOTOS) await page.screenshot({ path: `${FOTOS}/1d-aufnahme-${info.project.name}.png` });
	await page.waitForTimeout(1500);
	await dialog.getByRole('button', { name: 'Fertig' }).click();
	const karte = dialog.getByRole('region', { name: 'Bestätigung' });
	await expect(karte).toBeVisible({ timeout: 90_000 });
	await expect(karte).toContainText('Verstanden: „');
	await expect(karte.getByRole('heading', { name: 'Kunde anlegen' })).toBeVisible();
	if (FOTOS) await page.screenshot({ path: `${FOTOS}/1d-karte-aus-sprache-${info.project.name}.png` });
	console.log(`[${info.project.name}] erkannt: ${await karte.locator('.bk-gehoert').textContent()} → ${await karte.getByRole('heading').textContent()}`);
	await karte.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(dialog).toBeHidden();
});
