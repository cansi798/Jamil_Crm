import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';

const BUERO = 'buero@bauwelt.test';

// Aufträge als Board (Wunsch Jamil, 19.10.2026): Kacheln je Status, verschiebbar per Ziehen (Desktop) oder Menü
// (Tastatur/Handy), optimistisch mit Rücknahme bei Fehlern; Umschalter „Board / Liste“.
// Legt einen Auftrag (Einmal-Kunde) in der Entwicklungsdatenbank an und löscht ihn am Ende wieder.

async function neuerAuftrag(page: Page, titel: string): Promise<string> {
	const r = await page.request.post('/api/auftraege', {
		data: { titel, kundeArt: 'einmal', einmalName: 'E2E Board Kunde', einmalOrt: 'Hamburg', einmalPlz: '20095', einmalStrasse: 'Teststraße 5' }
	});
	expect(r.status()).toBe(201);
	return (await r.json()).id;
}

async function statusVon(page: Page, id: string): Promise<string> {
	return (await (await page.request.get(`/api/auftraege/${id}`)).json()).status;
}

async function aufraeumen(page: Page, id: string) {
	// Zurück auf „Anfrage“ (nur Anfragen lassen sich löschen)
	for (let i = 0; i < 6 && (await statusVon(page, id)) !== 'anfrage'; i++) {
		const jetzt = await statusVon(page, id);
		const kette = ['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet'];
		await page.request.post(`/api/auftraege/${id}/status`, { data: { status: kette[kette.indexOf(jetzt) - 1] } });
	}
	expect((await page.request.delete(`/api/auftraege/${id}`)).status()).toBe(204);
}

const spalte = (page: Page, status: string) => page.locator(`.ab-spalte[data-spalte="${status}"]`);

async function ziehe(page: Page, quelle: ReturnType<Page['locator']>, ziel: ReturnType<Page['locator']>) {
	await quelle.scrollIntoViewIfNeeded();
	const q = (await quelle.boundingBox())!;
	const z = (await ziel.boundingBox())!;
	// Am Nummernfeld anfassen (nicht am Menü)
	await page.mouse.move(q.x + 20, q.y + 12);
	await page.mouse.down();
	await page.mouse.move(q.x + 40, q.y + 30, { steps: 4 });
	await page.mouse.move(z.x + z.width / 2, z.y + 60, { steps: 12 });
	await page.mouse.up();
}

test('Desktop: Kachel ziehen ändert den Status, Sprünge und Serverfehler werden zurückgenommen, Menü und Liste', async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'Ziehen nur ab 700 px');
	await anmelden(page, BUERO);
	const titel = `E2E-Board ${Date.now()}`;
	const id = await neuerAuftrag(page, titel);
	try {
		await page.goto('/auftraege');
		await expect(page.getByRole('link', { name: 'Board', exact: true })).toHaveAttribute('aria-current', 'page');
		const karte = page.locator('.ab-karte', { hasText: titel });
		await expect(spalte(page, 'anfrage').locator('.ab-karte', { hasText: titel })).toBeVisible();
		await expect(karte).toContainText('E2E Board Kunde (Einmal-Kunde)');
		await expect(karte).toContainText('Teststraße 5, Hamburg');

		// Ziehen: Anfrage → Angebot
		await ziehe(page, karte, spalte(page, 'angebot'));
		await expect(spalte(page, 'angebot').locator('.ab-karte', { hasText: titel })).toBeVisible();
		await expect(page.locator('.ab-meldung')).toContainText('ist jetzt „Angebot“');
		await expect.poll(() => statusVon(page, id)).toBe('angebot');

		// Sprung über zwei Spalten (Angebot → In Arbeit) ist nicht erlaubt: Kachel bleibt, Hinweis
		await ziehe(page, karte, spalte(page, 'in_arbeit'));
		await expect(page.locator('.ab-meldung')).toContainText('Nur ein Schritt');
		await expect(spalte(page, 'angebot').locator('.ab-karte', { hasText: titel })).toBeVisible();
		expect(await statusVon(page, id)).toBe('angebot');

		// Serverfehler: sofort verschoben, dann zurückgenommen
		await page.route(`**/api/auftraege/${id}/status`, (r) =>
			r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ fehler: 'Statuswechsel nicht erlaubt' }) })
		);
		await ziehe(page, karte, spalte(page, 'beauftragt'));
		await expect(page.getByRole('alert')).toContainText('Statuswechsel nicht erlaubt');
		await expect(spalte(page, 'angebot').locator('.ab-karte', { hasText: titel })).toBeVisible();
		await page.unroute(`**/api/auftraege/${id}/status`);
		expect(await statusVon(page, id)).toBe('angebot');

		// Menü (auch per Tastatur): zurück auf Anfrage
		await karte.locator('.sm-knopf').focus();
		await page.keyboard.press('Enter');
		await page.getByRole('menuitemradio', { name: /^Anfrage/ }).click();
		await expect(spalte(page, 'anfrage').locator('.ab-karte', { hasText: titel })).toBeVisible();
		await expect.poll(() => statusVon(page, id)).toBe('anfrage');

		// Klick auf den Titel öffnet den Auftrag
		await karte.getByRole('link', { name: titel }).click();
		await expect(page).toHaveURL(new RegExp(`/auftraege/${id}$`));

		// Liste mit Status-Reitern
		await page.goto('/auftraege');
		await page.getByRole('link', { name: 'Liste', exact: true }).click();
		await expect(page).toHaveURL(/ansicht=liste/);
		await expect(page.locator('.kd-liste')).toContainText(titel);
		await expect(page.getByRole('navigation', { name: 'Status' })).toBeVisible();
	} finally {
		await aufraeumen(page, id);
	}
});

test('Handy: Status-Reiter statt Spalten, Verschieben über das Menü', async ({ page }, info) => {
	test.skip(info.project.name !== 'mobil', 'nur schmal');
	await anmelden(page, BUERO);
	const titel = `E2E-Board-mobil ${Date.now()}`;
	const id = await neuerAuftrag(page, titel);
	try {
		await page.goto('/auftraege');
		const reiter = page.locator('.ab-reiter');
		await expect(reiter).toBeVisible();
		await reiter.getByRole('button', { name: /^Anfrage/ }).click();
		await expect(spalte(page, 'anfrage')).toBeVisible();
		await expect(spalte(page, 'angebot')).toBeHidden();
		const karte = page.locator('.ab-karte', { hasText: titel });
		await karte.locator('.sm-knopf').click();
		await page.getByRole('menuitemradio', { name: /^Angebot/ }).click();
		await expect.poll(() => statusVon(page, id)).toBe('angebot');
		await reiter.getByRole('button', { name: /^Angebot/ }).click();
		await expect(spalte(page, 'angebot').locator('.ab-karte', { hasText: titel })).toBeVisible();
		// Keine waagerechte Scrollleiste der Seite
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	} finally {
		await aufraeumen(page, id);
	}
});

// Aufgaben: gleiches Board wie die Aufträge (Wunsch Jamil msg 2595) – Offen / In Arbeit / Erledigt, Ziehen und Menü,
// Umschalter „Board / Liste“, Filter bleiben erhalten.
test('Aufgaben: Board mit Ziehen und Menü, Rücknahme bei Fehler, Liste', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const titel = `E2E-Todo-Board ${info.project.name} ${Date.now()}`;
	const r = await page.request.post('/api/todos', { data: { titel } });
	expect(r.status()).toBe(201);
	const id: string = (await r.json()).id;
	const todo = async () => (await (await page.request.get(`/api/todos/${id}`)).json()) as { erledigt: boolean; faellig: string | null };
	try {
		await page.goto('/todos?person=alle');
		await expect(page.getByRole('link', { name: 'Board', exact: true })).toHaveAttribute('aria-current', 'page');
		const karte = page.locator('.ab-karte', { hasText: titel });
		if (info.project.name === 'desktop') {
			await expect(spalte(page, 'offen').locator('.ab-karte', { hasText: titel })).toBeVisible();
			// Ziehen: Offen → In Arbeit (fällig heute)
			await ziehe(page, karte, spalte(page, 'in-arbeit'));
			await expect(spalte(page, 'in-arbeit').locator('.ab-karte', { hasText: titel })).toBeVisible();
			await expect.poll(async () => (await todo()).faellig).not.toBeNull();
			// Serverfehler → zurück
			await page.route(`**/api/todos/${id}`, (rt) =>
				rt.request().method() === 'PATCH'
					? rt.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ fehler: 'Testfehler' }) })
					: rt.continue()
			);
			await ziehe(page, karte, spalte(page, 'erledigt'));
			await expect(page.getByRole('alert')).toContainText('Testfehler');
			await expect(spalte(page, 'in-arbeit').locator('.ab-karte', { hasText: titel })).toBeVisible();
			await page.unroute(`**/api/todos/${id}`);
			expect((await todo()).erledigt).toBe(false);
		} else {
			await page.locator('.ab-reiter').getByRole('button', { name: /^Offen/ }).click();
		}
		// Menü: nach „Erledigt“
		// gleiches Status-Menü wie bei den Aufträgen (Jamil msg 3568)
		await karte.getByRole('button', { name: /^Status von/ }).click();
		await page.getByRole('menu', { name: /^Status von/ }).getByRole('menuitemradio', { name: /Erledigt/ }).click();
		await expect.poll(async () => (await todo()).erledigt).toBe(true);
		if (info.project.name !== 'desktop') await page.locator('.ab-reiter').getByRole('button', { name: /^Erledigt/ }).click();
		await expect(spalte(page, 'erledigt').locator('.ab-karte', { hasText: titel })).toBeVisible();

		// Liste behält die Auswahl „Alle Personen“
		await page.getByRole('link', { name: 'Liste', exact: true }).click();
		await expect(page).toHaveURL(/ansicht=liste/);
		await expect(page).toHaveURL(/person=alle/);
		await expect(page.locator('.ab-board')).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	} finally {
		expect((await page.request.delete(`/api/todos/${id}`)).status()).toBe(204);
	}
});
