import { expect, test, type Page } from '@playwright/test';
import { anmelden } from './hilfe';
import { berlinTag, berlinZeitpunkt, tagPlus, tagKurz } from '../../src/lib/zeit';

/**
 * Plantafel im Browser (Vorschau mit Seed-Daten). Planer ist das Büro (Recht „Plantafel bearbeiten“, ohne Pflicht
 * zur Zwei-Faktor-Anmeldung). Die Tests legen einen eigenen Auftrag mit Einsätzen in einer Woche in drei Wochen an
 * und löschen ihn am Ende wieder (als Anfrage löschbar, Einsätze fallen mit) – die Seed-Daten bleiben unberührt.
 */
const BUERO = 'buero@bauwelt.test';
const MONTEUR = 'monteur@bauwelt.test';
const MONTEUR_NAME = 'Murat Öztürk';

/**
 * API-Aufruf aus der angemeldeten Seite heraus (fetch im Browser – das Sitzungs-Cookie ist „Secure“ und wird vom
 * Playwright-Anfrage-Client über http://127.0.0.1 nicht mitgeschickt). Erwartet 2xx und liefert den JSON-Körper.
 */
async function api(page: Page, methode: string, url: string, koerper?: unknown) {
	const r = await page.evaluate(
		async ({ methode, url, koerper }) => {
			const antwort = await fetch(url, {
				method: methode,
				headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
				body: koerper === undefined ? undefined : JSON.stringify(koerper)
			});
			const text = await antwort.text();
			return { status: antwort.status, text };
		},
		{ methode, url, koerper }
	);
	expect(r.status, `${methode} ${url} → ${r.status} ${r.text}`).toBeLessThan(300);
	return r.text ? JSON.parse(r.text) : null;
}

/** Legt einen Test-Auftrag an und liefert ihn samt Monteur-ID und Testwoche (Montag in drei Wochen). */
async function testAuftrag(page: Page, titel: string) {
	const heute = await api(page, 'GET', '/api/plantafel');
	const montag = tagPlus(heute.tage[0], 21);
	const woche = await api(page, 'GET', `/api/plantafel?ansicht=team&tag=${montag}`);
	const monteur = woche.mitarbeiter.find((m: { name: string }) => m.name === MONTEUR_NAME);
	expect(monteur, 'Monteur aus dem Seed').toBeTruthy();
	const [kunde] = await api(page, 'GET', '/api/kunden');
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel, kundeId: kunde.id });
	return { auftrag, monteurId: monteur.id as string, montag };
}

async function einsatz(page: Page, auftragId: string, benutzerId: string, tag: string, von: number, bis: number) {
	return api(page, 'POST', '/api/einsaetze', {
		auftragId,
		benutzerId,
		beginn: berlinZeitpunkt(tag, von).toISOString(),
		ende: berlinZeitpunkt(tag, bis).toISOString()
	});
}

/** Zieht ein Element mit der Maus (Pointer Events) auf ein anderes. */
async function ziehe(page: Page, von: ReturnType<Page['locator']>, nach: ReturnType<Page['locator']>) {
	// Bei vielen Mitarbeitern liegt die Zeile evtl. unterhalb des Fensters – erst hinscrollen (gleiche Zeile)
	await nach.scrollIntoViewIfNeeded();
	await von.scrollIntoViewIfNeeded();
	const a = (await von.boundingBox())!;
	const b = (await nach.boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 5, { steps: 3 });
	await page.mouse.move(b.x + b.width / 2, b.y + b.height - 12, { steps: 12 });
	await page.mouse.up();
}

test.describe('Plantafel: Filter, Kolonnen, mehrtägig (Jamil msgs 2508, 2510, 2513)', () => {
	test('Kolonne anlegen, filtern (URL), mehrtägig einplanen, Balken verlängern, alles wieder löschen', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'Raster mit Ziehen ab 700 px');
		await anmelden(page, BUERO);
		const { auftrag, montag } = await testAuftrag(page, `E2E Kolonne ${Date.now()}`);
		const name = `E2E-Kolonne ${Date.now()}`;
		try {
			await page.goto('/plantafel/kolonnen');
			await page.getByRole('button', { name: 'Kolonne hinzufügen' }).click();
			const f = page.locator('form[action="?/speichern"]').filter({ hasNot: page.locator('input[name="id"]') });
			await f.locator('input[name="name"]').fill(name);
			await f.getByRole('checkbox', { name: MONTEUR_NAME }).check();
			await f.getByRole('button', { name: 'Kolonne anlegen' }).click();
			await expect(page.getByRole('list', { name: 'Kolonnen' })).toContainText(name);

			// Filter: nur diese Kolonne (bleibt in der Adresse)
			await page.goto(`/plantafel?ansicht=team&tag=${montag}`);
			await page.locator('.pt-filter > summary').click();
			await page.getByRole('checkbox', { name }).check();
			await expect(page).toHaveURL(/[?&]ko=/);
			await page.reload();
			await expect(page.locator('.pt-filter > summary')).toContainText('Filter (1)');
			await expect(page.locator('table.pt-raster tbody th.pt-name').first()).toContainText(name);

			// Kolonne Mo–Mi einplanen
			await page.getByRole('button', { name: `${name} am ${tagKurz(montag)} einplanen` }).click();
			const dlg = page.locator('dialog.pt-dialog');
			await dlg.getByPlaceholder('Nummer, Titel oder Kunde').fill(auftrag.nummer);
			await dlg.locator('select[required]').first().selectOption(auftrag.id);
			await dlg.getByLabel('Letzter Tag (mehrtägig)').fill(tagPlus(montag, 2));
			await dlg.getByRole('button', { name: 'Einsatz anlegen' }).click();
			const lane = (tag: string) => page.locator(`table.pt-raster td[data-tag="${tag}"][data-benutzer^="ko:"]`);
			for (const t of [0, 1, 2]) await expect(lane(tagPlus(montag, t))).toContainText(auftrag.nummer);
			await expect(lane(tagPlus(montag, 3))).not.toContainText(auftrag.nummer);
			await expect(lane(tagPlus(montag, 1)).locator('.pt-zeit')).toContainText('↳');

			// Ende auf Donnerstag ziehen → verlängert
			await ziehe(page, lane(tagPlus(montag, 2)).locator('.pt-griff'), lane(tagPlus(montag, 3)));
			await expect(lane(tagPlus(montag, 3))).toContainText(auftrag.nummer);

			// ganzen Termin löschen
			await lane(montag).locator('.pt-karte').first().click();
			await dlg.getByRole('button', { name: 'Ganzen Termin löschen' }).click();
			await expect(lane(montag)).not.toContainText(auftrag.nummer);
		} finally {
			await page.goto('/plantafel/kolonnen');
			const li = page.getByRole('list', { name: 'Kolonnen' }).locator('li', { hasText: name });
			if (await li.count()) {
				await li.locator('summary').click();
				await li.getByRole('button', { name: 'Kolonne löschen' }).click();
				await expect(li).toHaveCount(0);
			}
			await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`).catch(() => null);
		}
	});
});

test.describe('Plantafel', () => {
	test('Büro zieht ein Kärtchen von Mo auf Di (bleibt nach Neuladen), auf belegten Tag → Warnung', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'Ziehen und Ablegen im Raster ab 700 px (PC, 1280×800)');
		await anmelden(page, BUERO);
		const { auftrag, monteurId, montag } = await testAuftrag(page, `E2E Plantafel ${Date.now()}`);
		try {
			const dienstag = tagPlus(montag, 1);
			const mittwoch = tagPlus(montag, 2);
			const e1 = await einsatz(page, auftrag.id, monteurId, montag, 7, 9);
			const zelle = (tag: string) =>
				page.locator(`table.pt-raster td[data-tag="${tag}"][data-benutzer="${monteurId}"]`);
			const karte = (tag: string) => zelle(tag).locator(`[data-einsatz="${e1.id}"]`);

			await page.goto(`/plantafel?ansicht=team&tag=${montag}`);
			await expect(karte(montag)).toBeVisible();
			await ziehe(page, karte(montag), zelle(dienstag));
			await expect(page.getByRole('status').filter({ hasText: 'Verschoben' })).toBeVisible();
			await page.reload();
			await expect(karte(dienstag)).toBeVisible();
			await expect(karte(montag)).toHaveCount(0);
			// Uhrzeit bleibt 07:00–09:00
			await expect(karte(dienstag)).toContainText('07:00–09:00');

			// Am Mittwoch hat der Monteur schon einen Einsatz → Ziehen dorthin speichert, warnt aber
			await einsatz(page, auftrag.id, monteurId, mittwoch, 8, 10);
			await page.reload();
			await ziehe(page, karte(dienstag), zelle(mittwoch));
			const warnung = page.getByRole('alert').filter({ hasText: 'Achtung' });
			await expect(warnung).toContainText(`Achtung: Doppelbelegung bei ${MONTEUR_NAME} am ${tagKurz(mittwoch)}`);
			await page.reload();
			await expect(karte(mittwoch)).toHaveClass(/warn/);
			await expect(karte(mittwoch)).toHaveAttribute('aria-label', /Achtung: Doppelbelegung/);
		} finally {
			await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		}
	});

	test('Büro legt per Klick auf eine leere Zelle einen Einsatz an (Dialog)', async ({ page }, info) => {
		test.skip(info.project.name !== 'desktop', 'Raster am PC');
		await anmelden(page, BUERO);
		const titel = `E2E Dialog ${Date.now()}`;
		const { auftrag, monteurId, montag } = await testAuftrag(page, titel);
		try {
			const donnerstag = tagPlus(montag, 3);
			await page.goto(`/plantafel?ansicht=team&tag=${montag}`);
			await page.getByRole('button', { name: `Einsatz für ${MONTEUR_NAME} am ${tagKurz(donnerstag)} anlegen` }).click();
			const dialog = page.getByRole('dialog', { name: 'Einsatz anlegen' });
			await expect(dialog).toBeVisible();
			await dialog.getByLabel('Auftrag suchen').fill(titel);
			await dialog.getByLabel('Auftrag *').selectOption({ label: `${auftrag.nummer} · ${titel} · ${auftrag.kundeName}` });
			await dialog.getByLabel('Von').fill('10:00');
			await dialog.getByLabel('Bis').fill('12:30');
			await dialog.getByRole('button', { name: 'Einsatz anlegen' }).click();
			await expect(page.getByRole('status').filter({ hasText: 'Einsatz angelegt' })).toBeVisible();
			const zelle = page.locator(`table.pt-raster td[data-tag="${donnerstag}"][data-benutzer="${monteurId}"]`);
			await expect(zelle).toContainText('10:00–12:30');
			await expect(zelle).toContainText(auftrag.nummer);
		} finally {
			await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
		}
	});

	test('Monteur: /plantafel → 403, keine Plantafel in der Navigation', async ({ page }) => {
		await anmelden(page, MONTEUR);
		await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Plantafel' })).toHaveCount(0);
		const antwort = await page.goto('/plantafel');
		expect(antwort?.status()).toBe(403);
		await expect(page.getByText('403')).toBeVisible();
		const status = await page.evaluate(async () => (await fetch('/api/plantafel')).status);
		expect(status).toBe(403);
	});

	test('Monteur: Kachel „Heute“ auf Start, ohne Netz zeigt die Offline-Seite denselben Einsatz', async ({
		page,
		browser
	}, info) => {
		test.skip(info.project.name !== 'mobil', 'Monteur am Handy');
		// Büro plant in einem eigenen Browser-Kontext einen Einsatz für heute
		const bueroKontext = await browser.newContext({ baseURL: info.project.use.baseURL });
		const buero = await bueroKontext.newPage();
		await anmelden(buero, BUERO);
		const titel = `E2E Heute ${Date.now()}`;
		const { auftrag, monteurId } = await testAuftrag(buero, titel);
		try {
			await einsatz(buero, auftrag.id, monteurId, berlinTag(new Date()), 5, 6);

			await anmelden(page, MONTEUR);
			await page.goto('/');
			// Kachel „Heute“ (Tagesplan, msg 2647): Termine mit Uhrzeit
			const heute = page.getByRole('region', { name: /^Heute/ });
			await expect(heute).toContainText(titel);
			await expect(heute).toContainText('05:00–06:00');
			// Service Worker muss die Seite kontrollieren, bevor das Netz wegfällt
			await page.evaluate(async () => {
				await navigator.serviceWorker.ready;
			});
			if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
			await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

			// Netz weg – auch für den Service Worker (setOffline allein erreicht ihn in Chromium nicht; dazu
			// PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS in playwright.config.ts)
			await page.context().setOffline(true);
			await page.context().route('**/*', (r) => r.abort('internetdisconnected'));
			await page.goto('/');
			await expect(page.getByRole('heading', { name: /^Offline – Stand \d{2}:\d{2}$/ })).toBeVisible();
			await expect(page.getByText(titel)).toBeVisible();
			await page.context().unrouteAll();
			await page.context().setOffline(false);

			// Abmelden löscht die Kopie auf dem Gerät
			await page.goto('/mehr');
			await page.getByRole('button', { name: 'Abmelden' }).click();
			await expect(page).toHaveURL(/\/anmelden$/);
			expect(await page.evaluate(() => localStorage.getItem('crm-heute-v1'))).toBeNull();
		} finally {
			await page.context().unrouteAll();
			await page.context().setOffline(false);
			await api(buero, 'DELETE', `/api/auftraege/${auftrag.id}`);
			await bueroKontext.close();
		}
	});
});
