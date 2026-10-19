import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';

/** Auftrag „aufgeräumt“ (Jamil msgs 2579/2581): eingeklappte Formulare, schmale Statusleiste mit Sprung und Rückfrage. */
const BUERO = 'buero@bauwelt.test';

async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const a = await fetch(url, {
				method: methode,
				headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});
			return { status: a.status, text: await a.text() };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

test('Statusleiste: schmal, Sprung per Klick, zurück nur nach Rückfrage; Formulare eingeklappt', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const kunden = await api(page, 'GET', '/api/kunden');
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel: `E2E Kompakt ${info.project.name} ${Date.now()}`, kundeId: kunden[0].id });
	try {
		await page.goto(`/auftraege/${auftrag.id}`);
		// eingeklappt bis gebraucht
		await expect(page.locator('form.td-neu')).toHaveCount(0);
		await expect(page.locator('form[action="?/terminAnlegen"]')).toBeHidden();
		await expect(page.locator('details.af-zuweisen')).not.toHaveAttribute('open', '');

		const mobil = info.project.name === 'mobil';
		const aktuell = page.locator('ol[aria-label="Status"] [aria-current="step"]');
		if (!mobil) {
			const leiste = page.locator('.sk-leiste');
			expect((await leiste.boundingBox())!.height).toBeLessThanOrEqual(48);
			// Sprung nach vorn ohne Rückfrage
			await leiste.getByRole('button', { name: 'Beauftragt' }).click();
			await expect(aktuell).toHaveText('Beauftragt');
			// zurück: Rückfrage abbrechen → bleibt
			page.once('dialog', (d) => d.dismiss());
			await leiste.getByRole('button', { name: 'Anfrage' }).click();
			await expect(aktuell).toHaveText('Beauftragt');
			// zurück bestätigen
			page.once('dialog', (d) => d.accept());
			await leiste.getByRole('button', { name: 'Anfrage' }).click();
			await expect(aktuell).toHaveText('Anfrage');
			await leiste.getByRole('button', { name: 'Weiter →' }).click();
			await expect(aktuell).toHaveText('Angebot');
		} else {
			const chip = page.getByRole('combobox', { name: 'Status' });
			await expect(chip).toBeVisible();
			await page.getByRole('button', { name: 'Weiter → Angebot' }).click();
			await expect(chip).toHaveValue('angebot');
			page.once('dialog', (d) => d.accept());
			await chip.selectOption('anfrage');
			await expect(chip).toHaveValue('anfrage');
			await expect(aktuell).toHaveText('Anfrage');
		}
	} finally {
		// Löschen geht nur als Anfrage: ggf. einen Schritt zurück
		await api(page, 'POST', `/api/auftraege/${auftrag.id}/status`, { status: 'anfrage' }).catch(() => null);
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`).catch(() => null);
	}
});
