import { expect, test, type Page } from '@playwright/test';
import { bestaetigen } from './hilfe';

/**
 * Kennzahl-Kacheln (Jamil msgs 2799/2801/2803) und Start-Cockpit (msg 2813): Zeitraum umschalten, Klick auf eine
 * Kachel filtert die Liste; der Start lässt sich je Person frei zusammenstellen (msg 2942).
 * Läuft mit dem Testzugang „jamil.chef“ (Testmodus der Vorschau).
 */
async function alsChef(page: Page) {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('jamil.chef');
	await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await expect(page).not.toHaveURL(/anmelden/);
}

test('Kacheln: Zeitraum und Klick-Filter auf Angebote, Aufträge, Kunden', async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'einmal reicht');
	await alsChef(page);

	await page.goto('/ausgangsbelege/angebote');
	const angebote = page.getByRole('group', { name: 'Angebote: Kennzahlen' });
	await angebote.getByRole('link', { name: /Entwürfe/ }).click();
	await expect(page).toHaveURL(/status=entwurf/);
	await expect(angebote.getByRole('link', { name: /Entwürfe/ })).toHaveAttribute('aria-current', 'true');
	await page.getByRole('navigation', { name: 'Zeitraum' }).getByRole('link', { name: 'Jahr' }).click();
	await expect(page).toHaveURL(/zeitraum=jahr/);
	await expect(page).toHaveURL(/status=entwurf/);

	await page.goto('/auftraege?ansicht=liste');
	await page.getByRole('group', { name: 'Aufträge: Kennzahlen' }).getByRole('link', { name: /In Arbeit/ }).click();
	await expect(page).toHaveURL(/status=in_arbeit|status=in-arbeit/);

	await page.goto('/kunden');
	await page.getByRole('group', { name: 'Kunden: Kennzahlen' }).getByRole('link', { name: /Aktive Kunden/ }).click();
	await expect(page).toHaveURL(/gruppe=aktiv/);
	await expect(page.getByRole('link', { name: 'Filter aufheben' })).toBeVisible();
});

test('Start frei zusammenstellen: hinzufügen, verschieben, Größe, ziehen, speichern (geräteübergreifend), Standard', async ({ page, browser }, info) => {
	test.skip(info.project.name !== 'desktop', 'einmal reicht');
	await alsChef(page);
	await page.goto('/');
	const main = page.getByRole('main');
	const reihenfolge = () => page.locator('[data-kachel]').evaluateAll((l) => l.map((e) => (e as HTMLElement).dataset.kachel));

	// sauberer Ausgangspunkt: Standard der Rolle
	await main.getByRole('button', { name: 'Start anpassen' }).click();
	await main.getByRole('button', { name: 'Standard wiederherstellen' }).click();
	await expect(main.getByRole('button', { name: 'Start anpassen' })).toBeVisible();
	const vorher = await reihenfolge();
	expect(vorher).not.toContain('kennzahlen');
	await expect(main.getByRole('heading', { name: 'Handlungsbedarf' })).toBeVisible();

	// hinzufügen (landet hinten), nach oben, Größe M, zwei Zeilen
	await main.getByRole('button', { name: 'Start anpassen' }).click();
	await main.getByRole('button', { name: '+ Kachel hinzufügen' }).click();
	await main.getByRole('group', { name: 'Kachel hinzufügen' }).getByRole('button', { name: /Alle Kennzahlen/ }).click();
	expect((await reihenfolge()).at(-1)).toBe('kennzahlen');
	await main.getByRole('button', { name: 'Alle Kennzahlen nach oben' }).click();
	expect((await reihenfolge()).at(-2)).toBe('kennzahlen');
	const werkzeug = main.getByRole('group', { name: 'Kachel Alle Kennzahlen' });
	await werkzeug.getByRole('button', { name: 'Größe M' }).click();
	await expect(werkzeug.getByRole('button', { name: 'Größe M' })).toHaveAttribute('aria-pressed', 'true');
	await werkzeug.getByRole('button', { name: 'Zwei Zeilen hoch' }).click();

	// ziehen am Griff: erste Kachel auf die dritte
	const erste = vorher[0]!;
	const griff = page.locator(`[data-kachel="${erste}"] .st-griff`);
	const ziel = page.locator(`[data-kachel="${vorher[2]}"]`);
	await page.evaluate(() => window.scrollTo(0, 0));
	await griff.scrollIntoViewIfNeeded();
	const a = (await griff.boundingBox())!;
	const b = (await ziel.boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
	await page.mouse.up();
	expect((await reihenfolge()).indexOf(erste)).toBeGreaterThan(0);
	const entwurf = await reihenfolge();

	await main.getByRole('button', { name: 'Fertig' }).click();
	await expect(main.getByRole('button', { name: 'Start anpassen' })).toBeVisible();
	await page.reload();
	expect(await reihenfolge()).toEqual(entwurf);
	await expect(page.locator('[data-kachel="kennzahlen"]')).toHaveAttribute('data-groesse', 'm');
	await expect(main.getByRole('heading', { name: /^Kennzahlen/ })).toBeVisible();

	// anderes „Gerät“ (neuer Browser-Kontext, gleiche Anmeldung): gleiches Layout – liegt auf dem Server
	const zwei = await browser.newContext({ storageState: await page.context().storageState() });
	const p2 = await zwei.newPage();
	await p2.goto('/');
	expect(await p2.locator('[data-kachel]').evaluateAll((l) => l.map((e) => (e as HTMLElement).dataset.kachel))).toEqual(entwurf);
	await zwei.close();

	// Abbrechen verwirft, Standard wiederherstellen setzt zurück
	await main.getByRole('button', { name: 'Start anpassen' }).click();
	await main.getByRole('button', { name: 'Alle Kennzahlen entfernen' }).click();
	await bestaetigen(page, 'Entfernen');
	await main.getByRole('button', { name: 'Abbrechen' }).click();
	expect(await reihenfolge()).toEqual(entwurf);
	await main.getByRole('button', { name: 'Start anpassen' }).click();
	await main.getByRole('button', { name: 'Standard wiederherstellen' }).click();
	await expect(main.getByRole('button', { name: 'Start anpassen' })).toBeVisible();
	expect(await reihenfolge()).toEqual(vorher);
});
