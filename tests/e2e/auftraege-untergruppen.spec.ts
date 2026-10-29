import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen } from './hilfe';

/** Untergruppen in „Anfrage“ bis „In Arbeit“ (Jamil msgs 3601, 3655, 3658–3660): Board mit Zwischenüberschriften, Liste mit Kennzeichen, Arbeitsstand im Auftrag. */
test('Board: Untergruppen in Anfrage, Angebot, Beauftragt und In Arbeit; Liste mit Kennzeichen', async ({ page }, info) => {
	const mobil = info.project.name === 'mobil';
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);

	await page.goto('/auftraege?ansicht=board');
	await expect(page.locator('[data-spalte="anfrage"]')).toBeVisible();
	// Je Spalte: Gruppen-Überschriften (Ebene 3) und Zahlen = Karten – nur wenn die Spalte Karten hat (sonst „Keine Aufträge“)
	const GRUPPEN: [string, string, string[]][] = [
		['anfrage', 'Anfrage', ['Termin vereinbaren', 'Termin vereinbart']],
		['angebot', 'Angebot', ['Angebot erstellen', 'Angebot erstellt']],
		['beauftragt', 'Beauftragt', ['Umsetzung planen', 'Umsetzung geplant']],
		['in_arbeit', 'In Arbeit', ['Arbeiten durchführen', 'Qualität prüfen', 'Endabnahme durchführen']]
	];
	let geprueft = 0;
	for (const [id, name, titel] of GRUPPEN) {
		const spalte = page.locator(`[data-spalte="${id}"]`);
		if (mobil) await page.locator('.ab-reiter').getByRole('button', { name: new RegExp(`^${name}`) }).click();
		const karten = await spalte.locator('.ab-karte').count();
		if (karten === 0) {
			await expect(spalte.locator('.ab-gruppe')).toHaveCount(0);
			continue;
		}
		geprueft++;
		for (const t of titel) await expect(spalte.getByRole('heading', { level: 3, name: new RegExp(`^${t}( |$)`) })).toBeVisible();
		await expect(spalte.locator('.ab-gruppe')).toHaveCount(titel.length);
		const zahlen = await spalte.locator('.ab-gruppe-zahl').allInnerTexts();
		expect(zahlen.map((z) => Number(z.replace(/\D/g, ''))).reduce((x, y) => x + y, 0)).toBe(karten);
	}
	expect(geprueft, 'Beispieldaten ohne Aufträge in den Spalten mit Untergruppen').toBeGreaterThan(0);
	// spätere Spalten ohne Gruppen
	await expect(page.locator('[data-spalte="abgenommen"] .ab-gruppe')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Was bewirkt diese Einstellung\? Untergruppen im Board/ })).toBeVisible();
	await erwarteKeinQuerScrollen(page, mobil ? 390 : 1280);

	// Liste: Kennzeichen neben dem Status
	for (const [id, , titel] of GRUPPEN) {
		await page.goto(`/auftraege?ansicht=liste&status=${id}`);
		if ((await page.locator('.kd-liste li a').count()) === 0) continue;
		await expect(page.locator('[data-untergruppe]').first()).toHaveText(new RegExp(`^(${titel.join('|')})$`));
	}
});

test('Auftrag „In Arbeit“: Arbeitsstand unter der Statusleiste setzen und zurücksetzen', async ({ page }, info) => {
	const mobil = info.project.name === 'mobil';
	await page.goto('/anmelden');
	test.skip(!(await page.getByText('Testmodus:').isVisible()), 'nur mit Testmodus');
	await page.getByLabel('Benutzername').fill('can.chef');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await expect(page).not.toHaveURL(/\/anmelden/);

	await page.goto('/auftraege?ansicht=liste&status=in_arbeit');
	const erster = page.locator('.kd-liste li a').first();
	test.skip((await erster.count()) === 0, 'kein Auftrag „In Arbeit“ in den Beispieldaten');
	await erster.click();
	await expect(page).toHaveURL(/\/auftraege\/[0-9a-f-]{36}$/);
	const stand = page.getByTestId('arbeitsstand');
	await expect(stand).toBeVisible();
	const setze = async (titel: string) => {
		if (mobil) await stand.getByRole('combobox', { name: 'Arbeitsstand' }).selectOption({ label: titel });
		else await stand.getByRole('button', { name: titel }).click();
	};
	const aktuell = () => (mobil ? stand.getByRole('combobox', { name: 'Arbeitsstand' }) : stand.locator('[aria-current="step"]'));
	await setze('Qualität prüfen');
	if (mobil) await expect(aktuell()).toHaveValue('qualitaet');
	else await expect(aktuell()).toHaveText('Qualität prüfen');
	await setze('Arbeiten durchführen');
	if (mobil) await expect(aktuell()).toHaveValue('arbeiten');
	else await expect(aktuell()).toHaveText('Arbeiten durchführen');
	await erwarteKeinQuerScrollen(page, mobil ? 390 : 1280);
});
