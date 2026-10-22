import { expect, test, type Browser } from '@playwright/test';
import { erwarteKeinQuerScrollen, bestaetigen } from './hilfe';

/**
 * Gespeicherte Ansichten (Jamil msgs 2830, 2921) auf Auftragskarte und Plantafel: Filter speichern, aus dem Menü
 * öffnen, als Standard beim nächsten Besuch, löschen. Nur in der Vorschau mit Testmodus; räumt selbst auf.
 */
async function anmelden(browser: Browser, mobil: boolean) {
	const viewport = mobil ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	page.on('dialog', (d) => d.accept());
	return { ctx, page, viewport };
}

for (const [seite, pfad, filter] of [
	['Auftragskarte', '/karte', 'status=beauftragt'],
	['Plantafel', '/plantafel', 'ansicht=tag'],
	['Aufträge', '/auftraege', 'ansicht=liste&status=beauftragt'],
	['Aufgaben', '/todos', 'status=offen']
] as const) {
	test(`${seite}: Ansicht speichern, öffnen, Standard, löschen`, async ({ browser }, info) => {
		const { ctx, page, viewport } = await anmelden(browser, info.project.name === 'mobil');
		const name = `E2E ${info.project.name} ${Date.now()}`;
		await page.goto(`${pfad}?${filter}`);
		const knopf = page.getByRole('button', { name: /Ansichten|★/ }).first();
		await knopf.click();
		const menue = page.getByRole('dialog', { name: 'Gespeicherte Ansichten' });
		await menue.getByRole('button', { name: '+ Aktuelle Filter speichern' }).click();
		await menue.getByLabel('Name der Ansicht').fill(name);
		await menue.getByLabel('Als Standard').check();
		await menue.getByRole('button', { name: 'Speichern' }).click();
		await expect(menue.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
		await erwarteKeinQuerScrollen(page, viewport.width);

		// ohne Filter öffnen, dann aus dem Menü wählen
		await page.goto(pfad);
		await page.getByRole('button', { name: /Ansichten|★/ }).first().click();
		await page.getByRole('dialog', { name: 'Gespeicherte Ansichten' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
		await expect(page).toHaveURL(new RegExp(`\\?${filter}`));

		// neuer Besuch (neue Sitzung): Standard greift von selbst
		const zwei = await ctx.browser()!.newContext({ viewport, storageState: await ctx.storageState() });
		const p2 = await zwei.newPage();
		await p2.goto(pfad);
		await expect(p2).toHaveURL(new RegExp(`\\?${filter}`));
		await zwei.close();
		// ausdrücklich „keine Filter“ (?alle=1, setzen die Filterleisten beim Abwählen): Standard springt nicht darüber
		const drei = await ctx.browser()!.newContext({ viewport, storageState: await ctx.storageState() });
		const p3 = await drei.newPage();
		await p3.goto(`${pfad}?alle=1`);
		await p3.waitForLoadState('networkidle');
		await expect(p3).toHaveURL(new RegExp(`${pfad}\\?alle=1$`));
		await drei.close();

		// löschen
		await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
		const m = page.getByRole('dialog', { name: 'Gespeicherte Ansichten' });
		// Papierkorb direkt an der Zeile (Jamil msg 3062), danach die Rückfrage (msg 3091)
		await m.getByRole('button', { name: `Ansicht „${name}“ löschen`, exact: true }).click();
		await bestaetigen(page);
		await expect(m.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveCount(0);
		await ctx.close();
	});
}
