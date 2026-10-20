import { expect, test, type Page } from '@playwright/test';
import { anmelden, erwarteKeinQuerScrollen } from './hilfe';
import { berlinTag, berlinZeitpunkt, tagPlus } from '../../src/lib/zeit';
import { monatName } from '../../src/lib/kalender';

/**
 * Plantafel als Kalender (Jamil msg 2676): Monat (Standard) / Woche / Tag / Team, Filter-Chips in der Adresse, Tag
 * antippen → Liste, „+“, am PC Balken auf einen anderen Tag ziehen. Eigener Test-Auftrag, am Ende gelöscht.
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

test('Kalender: Monat mit Balken, Tag antippen, Filter-Chips, Ansichten; am PC verschieben', async ({ page }, info) => {
	test.setTimeout(120_000);
	await anmelden(page, BUERO);
	// Testtermin: Mittwoch in zwei Wochen (bleibt im Monat oder im 6-Wochen-Raster des Monats, in dem er liegt)
	const woche = await api(page, 'GET', '/api/plantafel');
	const tag = tagPlus(woche.tage[0], info.project.name === 'mobil' ? 25 : 23);
	const monteur = woche.mitarbeiter.find((m: { name: string }) => m.name === 'Murat Öztürk');
	const [kunde] = await api(page, 'GET', '/api/kunden');
	const titel = `E2E Kalender ${info.project.name} ${Date.now()}`;
	const auftrag = await api(page, 'POST', '/api/auftraege', { titel, kundeId: kunde.id });
	try {
		const e = await api(page, 'POST', '/api/einsaetze', {
			auftragId: auftrag.id,
			benutzerId: monteur.id,
			beginn: berlinZeitpunkt(tag, 8).toISOString(),
			ende: berlinZeitpunkt(tag, 12).toISOString()
		});

		await page.goto(`/plantafel?tag=${tag}`);
		await expect(page.locator('.pt-titel')).toHaveText(monatName(tag.slice(0, 7)));
		await expect(page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Monat' })).toHaveAttribute('aria-current', 'page');
		const balken = page.locator(`.kal-balken[title*="${titel}"]`).first();
		await expect(balken).toBeVisible();

		// Tag antippen → Liste mit dem Termin; Termin öffnet den Auftrag
		await page.locator(`.kal-tag[data-tag="${tag}"] .kal-zahl`).click();
		const liste = page.getByRole('region', { name: /^Termine / });
		await expect(liste.getByRole('link', { name: new RegExp(titel) })).toHaveAttribute('href', `/auftraege/${auftrag.id}`);

		// Filter-Chip Murat → nur seine Termine, Adresse merkt es; „Alle“ hebt auf
		await page.getByRole('group', { name: 'Filter Mitarbeiter und Kolonnen' }).getByRole('button', { name: 'Murat Öztürk' }).click();
		await expect(page).toHaveURL(new RegExp(`ma=${monteur.id}`));
		await expect(page.locator(`.kal-balken[title*="${titel}"]`)).toBeVisible();
		await page.getByRole('button', { name: 'Alle', exact: true }).click();
		await expect(page).not.toHaveURL(/ma=/);

		// „+“ öffnet den Dialog für den gewählten Tag
		await page.getByRole('button', { name: /^Neuer Termin am / }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');

		// Ansichten
		await page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Woche' }).click();
		await expect(page).toHaveURL(/ansicht=woche/);
		await expect(page.locator(`.kal-balken[title*="${titel}"]`)).toBeVisible();
		await page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Tag' }).click();
		await expect(page).toHaveURL(/ansicht=tag/);
		await page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Team' }).click();
		await expect(page).toHaveURL(/ansicht=team/);
		if (info.project.name === 'mobil') {
			await page.goto(`/plantafel?tag=${tag}`);
			await erwarteKeinQuerScrollen(page, 390);
			return;
		}

		// Am PC: Balken einen Tag weiter ziehen
		await page.goto(`/plantafel?tag=${tag}`);
		const b = page.locator(`.kal-balken[title*="${titel}"]`).first();
		const ziel = page.locator(`.kal-tag[data-tag="${tagPlus(tag, 1)}"]`);
		const a = (await b.boundingBox())!;
		const z = (await ziel.boundingBox())!;
		await page.mouse.move(a.x + 10, a.y + a.height / 2);
		await page.mouse.down();
		await page.mouse.move(a.x + 30, a.y + a.height / 2, { steps: 3 });
		await page.mouse.move(z.x + z.width / 2, z.y + z.height - 8, { steps: 10 });
		await page.mouse.up();
		await expect(page.locator('.pt-meldung')).toContainText(/Verschoben/);
		const neu = await api(page, 'GET', `/api/einsaetze/${e.id}`);
		expect(berlinTag(new Date(neu.beginn))).toBe(tagPlus(tag, 1));
	} finally {
		await api(page, 'DELETE', `/api/auftraege/${auftrag.id}`);
	}
});
