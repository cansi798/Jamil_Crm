import { expect, test, type Page, type Response } from '@playwright/test';
import { anmelden, hauptnavigation } from './hilfe';

/** Kopfzeilen, die `hooks.server.ts` jeder Antwort mitgibt. */
function erwarteGrundschutz(kopf: Record<string, string>, wo: string, referrer = 'same-origin') {
	expect(kopf['x-content-type-options'], wo).toBe('nosniff');
	expect(kopf['referrer-policy'], wo).toBe(referrer);
	expect(kopf['x-frame-options'], wo).toBe('DENY');
	expect(kopf['permissions-policy'], wo).toMatch(/camera=\(\)/);
	expect(kopf['permissions-policy'], wo).toMatch(/geolocation=\(\)/);
}

/** Content-Security-Policy der Seiten (kit.csp): kein Einbetten, nur eigene Quellen, Skripte nur mit Nonce. */
function erwarteCsp(kopf: Record<string, string>, wo: string) {
	const csp = kopf['content-security-policy'];
	expect(csp, wo).toBeTruthy();
	const direktiven = new Map(
		csp.split(';').map((d) => {
			const [name, ...werte] = d.trim().split(/\s+/);
			return [name, werte] as const;
		})
	);
	expect(direktiven.get('frame-ancestors'), wo).toEqual(["'none'"]);
	expect(direktiven.get('default-src'), wo).toEqual(["'self'"]);
	const skript = direktiven.get('script-src')!;
	expect(skript, wo).toContain("'self'");
	expect(skript.some((w) => w.startsWith("'nonce-")), wo).toBe(true);
	expect(skript, wo).not.toContain("'unsafe-inline'");
	expect(skript, wo).not.toContain("'unsafe-eval'");
	// Stylesheets nur vom eigenen Server; inline erlaubt sind allein Stil-Attribute (SvelteKits Ansager, app.html)
	expect(direktiven.get('style-src'), wo).toEqual(["'self'"]);
	expect(direktiven.get('style-src-attr'), wo).toEqual(["'unsafe-inline'"]);
	expect(direktiven.get('object-src'), wo).toEqual(["'none'"]);
	expect(direktiven.get('base-uri'), wo).toEqual(["'self'"]);
	expect(direktiven.get('form-action'), wo).toEqual(["'self'"]);
	// QR-Code der Zwei-Faktor-Einrichtung ist ein data:-Bild
	expect(direktiven.get('img-src'), wo).toEqual(["'self'", 'data:']);
	// Kartenkacheln kommen über den eigenen Server (/karte/kacheln, msg 2689) – nie direkt von OpenStreetMap
	expect(direktiven.get('img-src')!.some((w) => w.includes('openstreetmap')), wo).toBe(false);
}

const kopfzeilen = (antwort: Response | null) => {
	expect(antwort).not.toBeNull();
	return antwort!.headers();
};

/** Sammelt CSP-Verstöße der Seite (ab dem ersten Laden, auch nach Navigationen im Client). */
async function sammleCspVerstoesse(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as { __csp: string[] };
		w.__csp = [];
		document.addEventListener('securitypolicyviolation', (e) => {
			w.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
		});
	});
	return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('Sicherheits-Kopfzeilen auf / (Gast und angemeldet) und /anmelden', async ({ page, request }) => {
	// Gast auf „/“: Weiterleitung – auch sie trägt den Grundschutz
	const umleitung = await request.get('/', { maxRedirects: 0 });
	expect(umleitung.status()).toBe(303);
	erwarteGrundschutz(umleitung.headers(), 'GET / (Gast)');

	const anmeldeSeite = await request.get('/anmelden');
	expect(anmeldeSeite.status()).toBe(200);
	erwarteGrundschutz(anmeldeSeite.headers(), 'GET /anmelden');
	erwarteCsp(anmeldeSeite.headers(), 'GET /anmelden');

	await anmelden(page, 'buero@bauwelt.test');
	const start = await page.goto('/');
	expect(start?.status()).toBe(200);
	erwarteGrundschutz(kopfzeilen(start), 'GET / (angemeldet)');
	erwarteCsp(kopfzeilen(start), 'GET / (angemeldet)');
});

test('API und Einladung: Grundschutz; Einladung behält die strengere Referrer-Regel', async ({ request }) => {
	const api = await request.get('/api/gesundheit');
	expect(api.status()).toBe(200);
	erwarteGrundschutz(api.headers(), 'GET /api/gesundheit');

	const einladung = await request.get(`/einladung/${'x'.repeat(43)}`);
	erwarteGrundschutz(einladung.headers(), 'GET /einladung/…', 'no-referrer');
});

test('CSP bricht nichts: Anmeldung, Navigation im Client, Service Worker – ohne Verstöße', async ({ page }) => {
	const verstoesse = await sammleCspVerstoesse(page);
	await anmelden(page, 'buero@bauwelt.test');
	await expect(hauptnavigation(page)).toBeVisible();
	// Navigation im Client (SvelteKit-Router, Ankündigung des Seitenwechsels)
	await hauptnavigation(page).getByRole('link', { name: 'Kunden' }).click();
	await expect(page).toHaveURL(/\/kunden$/);
	await page.getByRole('main').getByRole('list').getByRole('link').first().click();
	await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}$/);
	// Der Ansager für Seitenwechsel bleibt unsichtbar (Inline-Stil des Routers greift)
	const ansager = page.locator('#svelte-announcer');
	await expect(ansager).toHaveCount(1);
	const box = await ansager.boundingBox();
	expect(box?.width ?? 0).toBeLessThanOrEqual(1);
	// Service Worker wird unter der CSP registriert und aktiv
	const aktiv = await page.evaluate(async () => {
		const reg = await navigator.serviceWorker.ready;
		return reg.active !== null;
	});
	expect(aktiv).toBe(true);
	// Interaktivität (hydratisiertes Svelte): Suche abschicken führt zur Ergebnis-URL
	await page.goto('/kunden');
	await page.getByRole('searchbox', { name: 'Kunden suchen' }).fill('größer');
	await page.getByRole('searchbox', { name: 'Kunden suchen' }).press('Enter');
	await expect(page).toHaveURL(/suche=/);
	expect(await verstoesse()).toEqual([]);
});
