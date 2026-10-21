import { expect, test, type Page } from '@playwright/test';

/**
 * Ruhe beim Durchklicken (Jamil msgs 2919–2922): Auf allen Hauptseiten stehen Titel und Filterleiste an derselben
 * Stelle, und jeder Umschalter ist gleich hoch – am Desktop (1440) und am Handy (390). Abweichung höchstens 1 px.
 * Läuft mit dem Testzugang „jamil.chef“ (Testmodus der Vorschau).
 */
const SEITEN = [
	'/', '/kunden', '/auftraege', '/todos', '/plantafel', '/karte', '/ausgangsbelege/angebote', '/ausgangsbelege/auftragsbestaetigungen', '/ausgangsbelege/rechnungen', '/katalog', '/kalkulation', '/zeiten',
	'/einstellungen/benutzer', '/einstellungen/rollen', '/einstellungen/briefkopf', '/auftrag-vorlagen', '/angebot-vorlagen', '/plantafel/abwesenheiten'
];

type Mass = { pfad: string; h1: number | null; titelVersteckt: boolean; filter: number | null; umschalter: number[] };

async function messen(page: Page, pfad: string): Promise<Mass> {
	await page.goto(pfad);
	await page.waitForLoadState('networkidle').catch(() => {});
	return page.evaluate((pfad) => {
		const oben = (el: Element | null) => (el ? Math.round((el.getBoundingClientRect().top + window.scrollY) * 10) / 10 : null);
		const main = document.querySelector('main');
		const h1 = main?.querySelector('h1') ?? null;
		// Bereichs-Startseiten am Desktop: h1 nur für Screenreader, Titel steht in der Kopfleiste (Jamil msg 3060)
		const titelVersteckt = !!h1 && h1.getBoundingClientRect().height <= 1;
		const filter = main?.querySelector('.filter-leiste') ?? null;
		const umschalter = [...(main?.querySelectorAll('.ui-umschalter, .seg') ?? [])]
			.filter((e) => (e as HTMLElement).offsetParent !== null)
			.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10);
		return { pfad, h1: titelVersteckt ? null : oben(h1), titelVersteckt, filter: oben(filter), umschalter };
	}, pfad);
}

for (const [art, viewport] of [
	['Desktop 1440', { width: 1440, height: 900 }],
	['Handy 390', { width: 390, height: 844 }]
] as const) {
	test(`Gleiche Positionen auf allen Hauptseiten – ${art}`, async ({ browser }, info) => {
		test.skip(info.project.name !== 'desktop', 'einmal je Größe reicht');
		const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
		const page = await ctx.newPage();
		await page.goto('/anmelden');
		test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
		await page.getByLabel('Benutzername').fill('jamil.chef');
		await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
		await expect(page).not.toHaveURL(/anmelden/);

		const masse: Mass[] = [];
		for (const pfad of SEITEN) masse.push(await messen(page, pfad));
		console.log(art, JSON.stringify(masse));

		const h1 = masse.filter((m) => m.h1 !== null).map((m) => m.h1!);
		expect(h1.length + masse.filter((m) => m.titelVersteckt).length, 'Seiten mit Titel').toBeGreaterThanOrEqual(SEITEN.length - 1);
		for (const m of masse) if (m.h1 !== null) expect(Math.abs(m.h1 - h1[0]), `Titel auf ${m.pfad}`).toBeLessThanOrEqual(1);
		// Am Handy gibt es keine Kopfleiste: Titel bleibt überall sichtbar
		if (viewport.width < 900) expect(masse.filter((m) => m.titelVersteckt).map((m) => m.pfad), 'versteckte Titel am Handy').toEqual([]);

		// Filterleiste: gleiche Höhe innerhalb der Seiten mit sichtbarem bzw. verstecktem Titel
		for (const versteckt of [false, true]) {
			const filter = masse.filter((m) => m.filter !== null && m.titelVersteckt === versteckt);
			for (const m of filter) expect(Math.abs(m.filter! - filter[0].filter!), `Filterleiste auf ${m.pfad}`).toBeLessThanOrEqual(1);
		}
		expect(masse.filter((m) => m.filter !== null).length, 'Seiten mit Filterleiste').toBeGreaterThanOrEqual(5);

		const hoehen = masse.flatMap((m) => m.umschalter.map((h) => ({ pfad: m.pfad, h })));
		expect(hoehen.length, 'Umschalter gefunden').toBeGreaterThan(0);
		for (const x of hoehen) expect(Math.abs(x.h - hoehen[0].h), `Umschalter auf ${x.pfad}`).toBeLessThanOrEqual(1);
		await ctx.close();
	});
}
