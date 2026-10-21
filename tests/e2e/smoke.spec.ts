import { expect, test } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen, hauptnavigation } from './hilfe';
import { nurLesenAntwort } from '../../src/lib/server/sperren';

const BUERO = 'buero@bauwelt.test';
const MONTEUR = 'monteur@bauwelt.test';

test('Gäste werden zur Anmeldung umgeleitet', async ({ page }) => {
	for (const pfad of ['/', '/kunden', '/mehr']) {
		await page.goto(pfad);
		await expect(page, `Gast auf ${pfad}`).toHaveURL(/\/anmelden$/);
	}
	await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
});

test('Büro: anmelden, Kunde „Müller“ anlegen, mit „müller“ finden', async ({ page }) => {
	const kennung = `E2E-${Date.now()}`;
	await anmelden(page, BUERO);
	await expect(page).toHaveURL(/\/$/);
	await expect(hauptnavigation(page)).toBeVisible();

	await hauptnavigation(page).getByRole('link', { name: 'Kunden' }).click();
	await expect(page).toHaveURL(/\/kunden$/);
	await page.getByRole('link', { name: '+ Kunde' }).click();
	await page.getByLabel('Vorname').fill(kennung);
	await page.getByLabel('Nachname').fill('Müller');
	await page.getByRole('button', { name: 'Kunde anlegen' }).click();
	await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}$/);
	const detail = page.url();

	await page.goto('/kunden');
	await page.getByRole('searchbox', { name: 'Kunden suchen' }).fill('müller');
	await page.getByRole('searchbox', { name: 'Kunden suchen' }).press('Enter');
	await expect(page).toHaveURL(/suche=m%C3%BCller/);
	await expect(page.getByRole('link', { name: new RegExp(kennung) })).toBeVisible();

	// Aufräumen: Testkunden wieder löschen, damit die Entwicklungsdaten nicht anwachsen
	await page.goto(detail);
	await page.getByRole('button', { name: 'Kunde löschen' }).click();
	await page.getByRole('button', { name: 'Endgültig löschen' }).click();
	await expect(page).toHaveURL(/\/kunden$/);
});

test('360 px: kein horizontales Scrollen auf Start, Kundenliste und Kundenformular', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await anmelden(page, BUERO);
	for (const pfad of ['/', '/kunden', '/kunden/neu', '/mehr']) {
		await page.goto(pfad);
		await erwarteKeinQuerScrollen(page, 360);
	}
	// auch eine Detailseite (erster Beispielkunde)
	await page.goto('/kunden');
	await page.getByRole('main').getByRole('list').getByRole('link').first().click();
	await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}$/);
	await erwarteKeinQuerScrollen(page, 360);
});

test('Manifest: 200, display standalone, Symbole erreichbar', async ({ request }) => {
	const antwort = await request.get('/manifest.webmanifest');
	expect(antwort.status()).toBe(200);
	const manifest = await antwort.json();
	expect(manifest).toMatchObject({ name: 'CRM System', display: 'standalone', start_url: '/' });
	expect(manifest.theme_color.toLowerCase()).toBe('#05346b');
	for (const groesse of ['192x192', '512x512']) {
		const icon = manifest.icons.find((i: { sizes: string }) => i.sizes === groesse);
		expect(icon, `Symbol ${groesse}`).toBeTruthy();
		const bild = await request.get(icon.src);
		expect(bild.status()).toBe(200);
		expect(bild.headers()['content-type']).toContain('image/png');
	}
});

test('Monteur sieht Kunden, aber keinen „+ Kunde“-Knopf', async ({ page }) => {
	await anmelden(page, MONTEUR);
	await hauptnavigation(page).getByRole('link', { name: 'Kunden' }).click();
	await expect(page.getByRole('heading', { name: 'Kunden' })).toBeVisible();
	await expect(page.getByRole('link', { name: '+ Kunde' })).toHaveCount(0);
	// Monteur hat kein Recht „benutzer.verwalten“ und ist kein Plattform-Admin
	await page.goto('/mehr');
	await expect(page.getByRole('link', { name: 'Benutzer' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Plattform-Verwaltung' })).toHaveCount(0);
});

test('Navigation: Einträge nach Recht (Aufträge, Plantafel), Tippziele ≥ 44 px', async ({ page }, info) => {
	await anmelden(page, BUERO);
	const nav = hauptnavigation(page);
	await expect(nav.getByRole('link', { name: 'Start' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Kunden' })).toBeVisible();
	await expect(nav.getByRole('link', { name: 'Aufträge' })).toBeVisible();
	// Plantafel ist seit Stufe 1b ein Link (nicht mehr „bald verfügbar“); auf dem Handy liegt sie unter „Mehr“
	// (unten nur die ersten 4 Hauptbereiche, msg 2815)
	if (info.project.name === 'mobil') await expect(nav.getByRole('link', { name: 'Plantafel' })).toBeHidden();
	else await expect(nav.getByRole('link', { name: 'Plantafel' })).toBeVisible();
	await expect(nav.getByText('bald verfügbar')).toHaveCount(0);
	// Büro hat weder „benutzer.verwalten“ noch „einstellungen“, ist kein Admin
	await expect(nav.getByRole('link', { name: 'Benutzer' })).toHaveCount(0);
	await expect(nav.getByRole('link', { name: 'Plattform-Verwaltung' })).toHaveCount(0);

	if (info.project.name === 'mobil') {
		// Leiste unten
		const box = await nav.boundingBox();
		expect(box!.y + box!.height).toBeGreaterThan(844 - 2);
		await expect(nav.getByRole('link', { name: 'Mehr' })).toBeVisible();
	} else {
		// Seitenleiste links
		const box = await nav.boundingBox();
		expect(box!.x).toBeLessThan(2);
		expect(box!.height).toBeGreaterThan(700);
		await expect(nav.getByRole('link', { name: 'Mehr' })).toBeHidden();
	}

	const ziele = nav.locator('a:visible, button:visible, [aria-disabled="true"]:visible');
	const anzahl = await ziele.count();
	expect(anzahl).toBeGreaterThanOrEqual(3);
	for (let i = 0; i < anzahl; i++) {
		const box = await ziele.nth(i).boundingBox();
		const name = (await ziele.nth(i).innerText()).replace(/\s+/g, ' ');
		expect(box!.height, `Höhe von „${name}“`).toBeGreaterThanOrEqual(44);
		expect(box!.width, `Breite von „${name}“`).toBeGreaterThanOrEqual(44);
	}
});

test('Abmelden ist erreichbar und beendet die Sitzung', async ({ page }, info) => {
	await anmelden(page, BUERO);
	if (info.project.name === 'mobil') {
		await hauptnavigation(page).getByRole('link', { name: 'Mehr' }).click();
		await expect(page).toHaveURL(/\/mehr$/);
		await page.getByRole('main').getByRole('button', { name: 'Abmelden' }).click();
	} else {
		await hauptnavigation(page).getByRole('button', { name: 'Abmelden' }).click();
	}
	await expect(page).toHaveURL(/\/anmelden$/);
	await page.goto('/kunden');
	await expect(page).toHaveURL(/\/anmelden$/);
});

test('Admin-Bereich gibt es für Betriebsnutzer nicht (404, auch für Formular-POST)', async ({ page, baseURL }) => {
	await anmelden(page, BUERO);
	const seite = await page.goto('/admin');
	expect(seite!.status()).toBe(404);
	const post = await page.request.post('/admin?/anlegen', {
		form: { name: 'X', tarif: 'test', chefEmail: 'x@example.org', chefName: 'X' },
		headers: { origin: baseURL! }
	});
	expect(post.status()).toBe(404);
});

test('Service Worker speichert nur die App-Hülle, nie Seiten oder API', async ({ page }) => {
	await anmelden(page, BUERO);
	await page.goto('/kunden');
	const inhalt = await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		const urls: string[] = [];
		for (const name of await caches.keys()) {
			const cache = await caches.open(name);
			for (const anfrage of await cache.keys()) urls.push(new URL(anfrage.url).pathname);
		}
		return urls;
	});
	expect(inhalt).toContain('/manifest.webmanifest');
	expect(inhalt.some((u) => u.startsWith('/_app/'))).toBe(true);
	expect(inhalt.filter((u) => u.startsWith('/api') || u === '/' || u.startsWith('/kunden'))).toEqual([]);
});

test('Nur-Lesezugriff: Formular mit use:enhance zeigt den Hinweis im Layout (Carry T8)', async ({ page }) => {
	// Den Betrieb hier wirklich auf „gekündigt“ zu setzen ginge nur über die Datenbank (aus diesem Container nicht
	// erreichbar). Deshalb liefert die Anfrage genau die Antwort, die hooks.server.ts dann schickt (sperren.ts).
	await anmelden(page, BUERO);
	await page.goto('/kunden/neu');
	let abgefangen = false;
	await page.route('**/kunden/neu?/anlegen', async (route) => {
		abgefangen = true;
		const antwort = nurLesenAntwort(
			new Request(route.request().url(), { method: 'POST', headers: route.request().headers() })
		);
		await route.fulfill({
			status: antwort.status,
			contentType: antwort.headers.get('content-type') ?? undefined,
			body: await antwort.text()
		});
	});
	await page.getByLabel('Nachname').fill('Nur-Lesen-Test');
	await page.getByRole('button', { name: 'Kunde anlegen' }).click();
	const hinweis = page.getByRole('alert').filter({ hasText: 'Ihr Abo ist abgelaufen' });
	await expect(hinweis).toBeVisible();
	await expect(hinweis).toContainText('Nur Lesezugriff');
	expect(abgefangen).toBe(true);
	await expect(page).toHaveURL(/\/kunden\/neu$/);
	await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
});
