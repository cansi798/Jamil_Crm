import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';

/**
 * Wünsche Jamil (msgs 2479, 2481, 2482): Neues Objekt mit der Adresse des Kunden vorbelegt; Aufträge zeigen ihr Objekt
 * (Kundenseite, Auftragsliste); die Auftragsakte zeigt Objekt und Objektadresse. Eigene Daten, am Ende gelöscht.
 */
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

test('Objekt mit Kundenadresse vorbelegt; Auftrag zeigt Objekt und Adresse überall', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const stempel = `${info.project.name} ${Date.now()}`;
	const kunde = await api(page, 'POST', '/api/kunden', {
		art: 'privat',
		nachname: `E2E-Objekt ${stempel}`,
		strasse: 'Teichweg 5',
		plz: '22846',
		ort: 'Norderstedt'
	});
	let auftragId: string | null = null;
	try {
		// 1. Neues Objekt: Adresse des Kunden vorbelegt, abweichende Baustelle änderbar
		await page.goto(`/kunden/${kunde.id}/objekte/neu`);
		await expect(page.locator('input[name="strasse"]')).toHaveValue('Teichweg 5');
		await expect(page.locator('input[name="plz"]')).toHaveValue('22846');
		await expect(page.locator('input[name="ort"]')).toHaveValue('Norderstedt');
		await page.locator('input[name="bezeichnung"]').fill('Ferienhaus');
		await page.locator('input[name="strasse"]').fill('Dünenweg 1');
		await page.locator('input[name="plz"]').fill('25980');
		await page.locator('input[name="ort"]').fill('Sylt');
		await page.getByRole('button', { name: 'Objekt anlegen' }).click();
		await page.waitForURL(new RegExp(`/kunden/${kunde.id}$`));

		// 2. Neuer Auftrag: das einzige Objekt ist vorausgewählt
		await page.goto(`/auftraege/neu?kunde=${kunde.id}`);
		await expect(page.locator('select[name="objektId"] option:checked')).toHaveText(/Ferienhaus/);
		await page.locator('input[name="titel"]').fill('E2E Dach');
		await page.getByRole('button', { name: 'Auftrag anlegen' }).click();
		await page.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/);
		auftragId = page.url().split('/').pop()!;

		// 3. Auftragsakte: Objekt und Objektadresse
		const objekt = page.locator('dd.af-objekt');
		await expect(objekt).toContainText('Ferienhaus');
		await expect(objekt).toContainText('Dünenweg 1, 25980 Sylt');
		// Monteur vor Ort: Route zur Objektadresse (Wunsch Jamil, msg 2549)
		await expect(page.getByRole('link', { name: 'Navigieren' }).first()).toHaveAttribute(
			'href',
			'https://www.google.com/maps/dir/?api=1&destination=D%C3%BCnenweg%201%2C%2025980%20Sylt'
		);

		// 4. Kundenseite und Auftragsliste zeigen das Objekt
		await page.goto(`/kunden/${kunde.id}`);
		await expect(page.getByText('Objekt: Ferienhaus · Dünenweg 1, 25980 Sylt').first()).toBeVisible();
		await page.goto(`/auftraege?ansicht=liste&suche=${encodeURIComponent(kunde.nachname ?? `E2E-Objekt ${stempel}`)}`);
		await expect(page.getByText('Objekt: Ferienhaus · Dünenweg 1, 25980 Sylt').first()).toBeVisible();
	} finally {
		if (auftragId) await api(page, 'DELETE', `/api/auftraege/${auftragId}`);
		await api(page, 'DELETE', `/api/kunden/${kunde.id}`);
	}
});
