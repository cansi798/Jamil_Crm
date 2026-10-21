import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Einsatz ohne Erinnerung anlegen (Jamil msgs 3065/3067). Ursache des Fehlers: Die Auswahl-Liste lag im Fluss des
 * Dialogs und verlängerte ihn; beim Klick auf „Einsatz anlegen“ schloss sie sich (mousedown), der Dialog sprang
 * zurück und der Klick ging ins Leere. Jetzt liegt die Liste als Overlay obenauf: Dialoghöhe bleibt gleich, Liste ist
 * ganz sichtbar, und „Einsatz anlegen“ klappt auch mit offener Liste. Der Test löscht seinen Einsatz wieder.
 */
test('Einsatz ohne Erinnerung anlegen', async ({ page }, info) => {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await expect(page).not.toHaveURL(/anmelden/);
	const angelegt: string[] = [];
	page.on('response', async (r) => {
		if (r.request().method() === 'POST' && r.url().endsWith('/api/einsaetze') && r.status() === 201) angelegt.push((await r.json()).id);
	});
	try {
		await page.goto('/plantafel');
		await page.getByRole('button', { name: /^Neuer Termin am/ }).first().click();
		const dlg = page.locator('dialog[open]');
		await expect(dlg.getByRole('heading', { name: 'Einsatz anlegen' })).toBeVisible();
		await dlg.getByLabel('Auftrag *').selectOption({ index: 1 });
		await dlg.locator('input[type="time"]').nth(0).fill('07:00');
		await dlg.locator('input[type="time"]').nth(1).fill('16:00');
		const knopf = dlg.getByRole('button', { name: 'Einsatz anlegen' });

		if (info.project.name === 'desktop') {
			// zweite Erinnerung öffnen: Dialog bleibt gleich hoch, Liste ganz sichtbar (oberste Ebene)
			const vorher = await dlg.evaluate((d) => ({ h: d.getBoundingClientRect().height, s: d.scrollHeight }));
			await dlg.locator('select[aria-label="und"]').click();
			const liste = page.locator('.aw-liste');
			await expect(liste).toBeVisible();
			expect(await liste.evaluate((l) => l.matches(':popover-open'))).toBe(true);
			const nachher = await dlg.evaluate((d) => ({ h: d.getBoundingClientRect().height, s: d.scrollHeight }));
			expect(nachher).toEqual(vorher);
			const b = (await liste.boundingBox())!;
			const vp = page.viewportSize()!;
			expect(b.y).toBeGreaterThanOrEqual(0);
			expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
			expect(await liste.evaluate((l) => l.scrollHeight <= l.clientHeight + 1 || getComputedStyle(l).overflowY === 'auto')).toBe(true);
			await expect(liste.getByRole('option', { name: 'keine' })).toBeVisible();
			// mit offener Liste direkt auf „Einsatz anlegen“ (echter Mausklick an die Stelle des Knopfs)
			const k = (await knopf.boundingBox())!;
			await page.mouse.click(k.x + k.width / 2, k.y + k.height / 2);
		} else {
			await knopf.click();
		}
		// beide Erinnerungen „keine“ → angelegt, Dialog zu
		await expect(page.locator('dialog[open]')).toHaveCount(0);
		await expect.poll(() => angelegt.length).toBe(1);
		await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
	} finally {
		for (const id of angelegt) await page.evaluate((i) => fetch(`/api/einsaetze/${i}`, { method: 'DELETE' }), id);
	}
});

test('Auswahl-Liste öffnet sich nach oben, wenn unten kein Platz ist', async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'Maus-Liste nur am Computer (am Handy die Auswahl des Geräts)');
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await expect(page).not.toHaveURL(/anmelden/);
	await page.setViewportSize({ width: 1280, height: 560 });
	await page.goto('/plantafel');
	await page.getByRole('button', { name: /^Neuer Termin am/ }).first().click();
	const dlg = page.locator('dialog[open]');
	const feld = dlg.locator('select[aria-label="und"]');
	await feld.scrollIntoViewIfNeeded();
	await feld.click();
	const liste = page.locator('.aw-liste');
	await expect(liste).toBeVisible();
	const f = (await feld.boundingBox())!;
	const l = (await liste.boundingBox())!;
	// unten zu wenig Platz → über dem Feld, ganz im Bild
	if (560 - (f.y + f.height) < 200) expect(l.y + l.height).toBeLessThanOrEqual(f.y + 1);
	expect(l.y).toBeGreaterThanOrEqual(0);
	expect(l.y + l.height).toBeLessThanOrEqual(560);
	await page.keyboard.press('Escape');
	await expect(liste).toHaveCount(0);
});
