import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Status-Menü am Auftrags-Board (Jamil msg 3112): schwebt über der Karte (Karte bleibt gleich hoch), zeigt alle Status
 * untereinander mit Haken beim aktuellen; erlaubt ist ein Schritt (Server-Regel), die anderen ausgegraut mit Grund.
 * Ändert den Status einer Karte und setzt ihn danach zurück. Testzugang „can.chef“ (Testmodus).
 */
test('Status-Menü: Overlay, alle Status, Wechsel klappt', async ({ page }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await expect(page).not.toHaveURL(/anmelden/);
	await page.goto('/auftraege?ansicht=board&alle=1');
	// erste Spalte mit einer Karte (nicht die letzte: dann gibt es einen nächsten Schritt)
	const STATI = ['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen'];
	const NAMEN: Record<string, string> = { anfrage: 'Anfrage', angebot: 'Angebot', beauftragt: 'Beauftragt', in_arbeit: 'In Arbeit', abgenommen: 'Abgenommen', abgerechnet: 'Abgerechnet' };
	const ALLE = [...STATI, 'abgerechnet'];
	let von = '';
	for (const st of STATI) if ((await page.locator(`section[data-spalte="${st}"] .ab-karte .sm-knopf`).count()) > 0) { von = st; break; }
	test.skip(!von, 'keine Karte auf dem Board');
	const nach = ALLE[ALLE.indexOf(von) + 1];
	const sprung = ALLE[ALLE.indexOf(von) + 2];
	if (info.project.name === 'mobil') await page.locator('.ab-reiter-knopf', { hasText: NAMEN[von] }).click();
	const karte = page.locator(`section[data-spalte="${von}"] .ab-karte`).filter({ has: page.locator('.sm-knopf') }).first();
	const id = await karte.getAttribute('data-karte');
	const hoehe = (await karte.boundingBox())!.height;
	await karte.getByRole('button', { name: /^Status von/ }).click();
	const menue = page.getByRole('menu', { name: /^Status von/ });
	await expect(menue).toBeVisible();
	expect(await menue.evaluate((m) => m.matches(':popover-open'))).toBe(true);
	// Karte verzieht sich nicht
	expect(Math.abs((await karte.boundingBox())!.height - hoehe)).toBeLessThan(1);
	// alle Status untereinander, aktueller mit Haken; Sprünge ausgegraut mit Grund
	const eintraege = menue.getByRole('menuitemradio');
	await expect(eintraege).toHaveText([/Anfrage/, /Angebot/, /Beauftragt/, /In Arbeit/, /Abgenommen/, /Abgerechnet/]);
	await expect(menue.getByRole('menuitemradio', { name: new RegExp(`^${NAMEN[von]}`) })).toHaveAttribute('aria-checked', 'true');
	await expect(menue.getByRole('menuitemradio', { name: new RegExp(`^${NAMEN[sprung]}`) })).toHaveAttribute('aria-disabled', 'true');
	await expect(menue.getByRole('menuitemradio', { name: new RegExp(`^${NAMEN[sprung]}`) })).toHaveAttribute('title', /Schritte davor/);
	const b = (await menue.boundingBox())!;
	const vp = page.viewportSize()!;
	expect(b.y).toBeGreaterThanOrEqual(0);
	expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
	expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
	await erwarteKeinQuerScrollen(page, vp.width);
	// Esc schließt
	await page.keyboard.press('Escape');
	await expect(menue).toHaveCount(0);
	// Wechsel einen Schritt weiter und wieder zurück
	await karte.getByRole('button', { name: /^Status von/ }).click();
	await page.getByRole('menuitemradio', { name: new RegExp(`^${NAMEN[nach]}`) }).click();
	await expect(page.locator('.ab-meldung')).toContainText(`ist jetzt „${NAMEN[nach]}“`);
	const neu = page.locator(`section[data-spalte="${nach}"] .ab-karte[data-karte="${id}"]`);
	await expect(neu).toHaveCount(1);
	if (info.project.name === 'mobil') await page.locator('.ab-reiter-knopf', { hasText: NAMEN[nach] }).click();
	await neu.getByRole('button', { name: /^Status von/ }).click();
	await page.getByRole('menuitemradio', { name: new RegExp(`^${NAMEN[von]}`) }).click();
	await expect(page.locator('.ab-meldung')).toContainText(`ist jetzt „${NAMEN[von]}“`);
	await expect(page.locator(`section[data-spalte="${von}"] .ab-karte[data-karte="${id}"]`)).toHaveCount(1);
});
