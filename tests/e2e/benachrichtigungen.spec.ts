import { expect, test, type Browser, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';
import { nurAufTestserver } from './ziel';

/**
 * Benachrichtigungen (Jamil msg 3734) mit zwei Benutzern: Chef weist dem Monteur eine Aufgabe zu → der Monteur sieht sie
 * in der Glocke, der Chef nicht. Dazu die persönlichen Einstellungen „Worüber benachrichtigen?“. Räumt die Aufgabe weg.
 */
nurAufTestserver(test);

async function anmeldenAls(browser: Browser, viewport: { width: number; height: number }, wer: string): Promise<Page> {
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill(wer);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	return page;
}
const glockeOeffnen = async (page: Page) => {
	await page.locator('.gl-knopf:visible').first().click();
	const panel = page.getByRole('region', { name: 'Benachrichtigungen' });
	await expect(panel.getByText('Lädt …')).toHaveCount(0);
	return panel;
};

test('Chef weist Monteur eine Aufgabe zu → Glocke beim Monteur, nicht beim Chef', async ({ browser }, info) => {
	const mobil = info.project.name === 'mobil';
	const viewport = mobil ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const chef = await anmeldenAls(browser, viewport, 'can.chef');
	const titel = `E2E Benachrichtigung ${info.project.name} ${Date.now() % 100000}`;
	let todoId: string | null = null;
	try {
		const monteurId = await chef.evaluate(async () => {
			const liste = (await (await fetch('/api/benutzer')).json()) as { id: string; name: string }[];
			return liste.find((b) => /^Can \(Test\) – Monteur$/.test(b.name))?.id ?? null;
		});
		test.skip(!monteurId, 'Testzugang „can.monteur“ fehlt');
		const neu = await chef.evaluate(
			async ({ titel, monteurId }) => {
				const r = await fetch('/api/todos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ titel, zustaendigId: monteurId }) });
				return { status: r.status, json: await r.json() };
			},
			{ titel, monteurId }
		);
		expect(neu.status).toBe(201);
		todoId = neu.json.id;

		// Monteur: Nachricht in der Glocke, Klick öffnet die Aufgaben
		const monteur = await anmeldenAls(browser, viewport, 'can.monteur');
		const panel = await glockeOeffnen(monteur);
		const eintrag = panel.getByRole('button', { name: new RegExp(`Neue Aufgabe für dich: ${titel}`) });
		await expect(eintrag).toBeVisible();
		await expect(eintrag).toContainText('von Can (Test) – Chef');
		await erwarteKeinQuerScrollen(monteur, viewport.width);
		await eintrag.click();
		await expect(monteur).toHaveURL(/\/todos/);

		// Chef: nichts (eigene Änderung)
		await chef.reload();
		const chefPanel = await glockeOeffnen(chef);
		await expect(chefPanel.getByText(`Neue Aufgabe für dich: ${titel}`)).toHaveCount(0);

		// Einstellungen: „Termine – Push“ aus, speichern, bleibt nach dem Neuladen; wieder an
		await monteur.goto('/konto/benachrichtigungen');
		const termine = monteur.locator('li[data-kategorie="termin"]');
		await expect(termine.getByRole('checkbox', { name: 'Push' })).toBeChecked();
		await termine.getByRole('checkbox', { name: 'Push' }).uncheck();
		await monteur.getByTestId('bn-wahl-speichern').click();
		await expect(monteur.getByText('Gespeichert.')).toBeVisible();
		await monteur.reload();
		await expect(monteur.locator('li[data-kategorie="termin"]').getByRole('checkbox', { name: 'Push' })).not.toBeChecked();
		await monteur.locator('li[data-kategorie="termin"]').getByRole('checkbox', { name: 'Push' }).check();
		await monteur.getByTestId('bn-wahl-speichern').click();
		await expect(monteur.getByText('Gespeichert.')).toBeVisible();
		await erwarteKeinQuerScrollen(monteur, viewport.width);
	} finally {
		if (todoId) await chef.evaluate(async (id) => fetch(`/api/todos/${id}`, { method: 'DELETE' }).then((r) => r.status), todoId);
	}
});
