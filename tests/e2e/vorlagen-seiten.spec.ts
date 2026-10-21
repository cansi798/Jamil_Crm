import { expect, test, type Page } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Alle Vorlagen-Seiten gleich (Jamil msgs 3084, 3086): Kopf mit „+ Neue Vorlage“ oben rechts, EINE Liste je Seite
 * (Zeilen mit Name, Kennzahl-Zeile, Aktionen als klare Knöpfe), Detailseite mit Zurück, Überzeile, Name und
 * „Vorlage löschen“ oben rechts mit Rückfrage (msgs 3043, 3091). Menü: auf den Aufmaß-Vorlagen ist NUR „Aufmaß-Vorlagen“
 * markiert (msg 3085). Legt eine eigene Wegwerf-Protokoll-Vorlage an und löscht sie wieder. Testmodus (can.chef).
 */
async function chef(page: Page) {
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
}

const SEITEN = [
	{ pfad: '/auftrag-vorlagen', titel: 'Auftrags-Vorlagen' },
	{ pfad: '/angebot-vorlagen', titel: 'Angebots-Vorlagen' },
	{ pfad: '/einstellungen/protokoll-vorlagen', titel: 'Protokoll-Vorlagen' },
	{ pfad: '/einstellungen/aufmass-vorlagen', titel: 'Aufmaß-Vorlagen' },
	{ pfad: '/einstellungen/mail-vorlagen', titel: 'E-Mail-Vorlagen' }
];

test('Vorlagen-Seiten: gleicher Kopf, gleiche Liste, Aktionen als klare Knöpfe', async ({ page }) => {
	await chef(page);
	const breite = page.viewportSize()!.width;
	for (const s of SEITEN) {
		await page.goto(s.pfad);
		await expect(page.getByRole('heading', { level: 1, name: s.titel }), s.pfad).toBeAttached();
		const neu = page.locator('.seiten-kopf .seiten-aktionen').getByTestId('vorlage-neu');
		await expect(neu, s.pfad).toHaveText('+ Neue Vorlage');
		await expect(page.locator('main .vl-liste').first(), s.pfad).toBeVisible();
		// Zeilen-Aktionen: umrandete Knöpfe (sekundär), nicht die blassen Pillen von früher
		const aktion = page.locator('main .vl-aktionen button').first();
		if (await aktion.count()) {
			await expect(aktion).toHaveClass(/kd-knopf hell/);
			expect(await aktion.evaluate((e) => getComputedStyle(e).borderTopWidth)).not.toBe('0px');
		}
		await erwarteKeinQuerScrollen(page, breite);
	}
	// Alte Adresse der Aufmaß-Vorlagen leitet weiter
	await page.goto('/einstellungen/protokoll-vorlagen?art=aufmass');
	await expect(page).toHaveURL(/\/einstellungen\/aufmass-vorlagen$/);
});

test('Menü: auf den Aufmaß-Vorlagen ist nur „Aufmaß-Vorlagen“ markiert (msg 3085)', async ({ page }, info) => {
	test.skip(info.project.name !== 'desktop', 'Seitenleiste nur am Desktop');
	await chef(page);
	await page.goto('/einstellungen/aufmass-vorlagen');
	const markiert = page.locator('.hauptnav a[aria-current="page"]');
	await expect(markiert).toHaveCount(1);
	await expect(markiert).toHaveText('Aufmaß-Vorlagen');
	await page.goto('/einstellungen/protokoll-vorlagen');
	await expect(markiert).toHaveCount(1);
	await expect(markiert).toHaveText('Protokoll-Vorlagen');
	// Partner jetzt in „Team & Partner“ (msg 3089)
	await expect(page.locator('.nav-gruppe', { hasText: 'Team & Partner' }).getByRole('link', { name: 'Partner' })).toBeAttached();
});

test('Protokoll-Vorlage: Detailseite wie alle Vorlagen, Löschen oben rechts erst nach Rückfrage', async ({ page }) => {
	await chef(page);
	await page.goto('/einstellungen/protokoll-vorlagen');
	await page.getByTestId('vorlage-neu').click();
	await page.waitForURL(/\/einstellungen\/protokoll-vorlagen\/[0-9a-f-]{36}$/);
	const url = page.url();
	await expect(page.locator('.seiten-kopf .ui-eyebrow')).toHaveText('Protokoll-Vorlage');
	await expect(page.getByRole('link', { name: '← Protokoll-Vorlagen' })).toBeVisible();
	const loeschen = page.locator('.seiten-kopf .seiten-aktionen').getByRole('button', { name: 'Vorlage löschen' });
	await expect(loeschen).toBeVisible();
	// Erst die Rückfrage – „Abbrechen“ lässt alles, wie es ist
	await loeschen.click();
	const rueckfrage = page.getByRole('region', { name: 'Vorlage löschen' });
	await expect(rueckfrage).toBeVisible();
	await rueckfrage.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(rueckfrage).toHaveCount(0);
	await expect(page).toHaveURL(url);
	await loeschen.click();
	await page.getByRole('button', { name: 'Endgültig löschen' }).click();
	await page.waitForURL(/\/einstellungen\/protokoll-vorlagen$/);
	await page.goto(url);
	await expect(page.getByText(/nicht gefunden/i).first()).toBeVisible();
});
