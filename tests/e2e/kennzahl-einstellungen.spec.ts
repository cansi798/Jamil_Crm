import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/**
 * Kennzahlen einstellen (Jamil msg 2946): Abschlussquote ausschalten, Termintreue „Erfassen ab“ setzen → Cockpit zeigt
 * 6 Karten und „erfasst seit …“; danach alles zurück. Nur in der Vorschau mit Testmodus.
 */
test('Chef: Kennzahl aus- und einschalten, „Erfassen ab“ wirkt im Cockpit', async ({ browser }, info) => {
	const viewport = info.project.name === 'mobil' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
	const ctx = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
	const page = await ctx.newPage();
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur in der Vorschau mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);
	const zeile = (id: string) => page.locator(`tr[data-kennzahl="${id}"]`);
	const speichern = async () => {
		await page.getByRole('button', { name: 'Speichern' }).click();
		await expect(page.getByRole('status')).toContainText('Gespeichert');
	};
	try {
		await page.goto('/einstellungen/kennzahlen');
		await expect(page.getByRole('heading', { level: 1, name: 'Kennzahlen einstellen' })).toBeVisible();
		await erwarteKeinQuerScrollen(page, viewport.width);
		await zeile('abschlussquote').locator('input[name="aktiv_abschlussquote"]').uncheck({ force: true });
		await zeile('termintreue').locator('input[name="ab_termintreue"]').fill('2026-01-01');
		await speichern();
		await page.goto('/auswertung/kennzahlen?zeitraum=alle');
		const karten = page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem');
		await expect(karten).toHaveCount(6);
		await expect(karten.filter({ hasText: 'Angebots-Abschlussquote' })).toHaveCount(0);
		await expect(karten.filter({ hasText: 'Termintreue' })).toContainText('erfasst seit 01.01.2026');
	} finally {
		await page.goto('/einstellungen/kennzahlen');
		await zeile('abschlussquote').locator('input[name="aktiv_abschlussquote"]').check({ force: true });
		await zeile('termintreue').locator('input[name="ab_termintreue"]').fill('');
		await speichern();
		await page.goto('/auswertung/kennzahlen');
		await expect(page.getByRole('list', { name: 'Kennzahlen' }).getByRole('listitem')).toHaveCount(7);
		await ctx.close();
	}
});
