import { expect, test } from '@playwright/test';
import { erwarteKeinQuerScrollen, portalOeffnen } from './hilfe';

/**
 * Comic-Figuren statt Anfangsbuchstaben im Kundenportal (Jamil msg 3113): „Ihr persönlicher Projektbegleiter“ (msg 3120) als Büro-Figur,
 * „Ihr Team“ je nach Rolle (Monteur/Büro) und Anrede. Nur lesend – läuft nur mit PORTAL_TOKEN (vorübergehender
 * Portal-Link, nie über „Link erzeugen“).
 */
test('Figuren bei Projektbegleiter und Team', async ({ page }, info) => {
	const token = process.env.PORTAL_TOKEN;
	test.skip(!token, 'nur mit vorübergehendem Portal-Link (PORTAL_TOKEN)');
	await portalOeffnen(page, token!);
	const karte = page.locator('.pt-ansprech').first();
	test.skip((await karte.locator('.pf').count()) === 0, 'Portal zeigt keine Namen');
	await karte.scrollIntoViewIfNeeded();
	// Figur mit Alt-Text „<Name>, Projektbegleiter(in)“, kein Initialen-Kreis mehr
	const figur = karte.locator('.pf');
	await expect(figur).toHaveAttribute('role', 'img');
	await expect(figur).toHaveAttribute('aria-label', /, Projektbegleiter(in)?$/);
	await expect(figur).toHaveAttribute('data-figur', /^projektbegleiter(in)?$/);
	expect(await page.locator('.avatar').count()).toBe(0);
	// Überschrift passt zur Figur (msg 3120)
	const weiblich = (await figur.getAttribute('data-figur')) === 'projektbegleiterin';
	await expect(karte.getByRole('heading')).toHaveText(weiblich ? 'Ihre persönliche Projektbegleiterin' : 'Ihr persönlicher Projektbegleiter');
	const groesse = (await figur.boundingBox())!;
	expect(Math.round(groesse.width)).toBe(60);
	// Name bleibt als Text daneben
	const name = (await figur.getAttribute('aria-label'))!.split(',')[0];
	await expect(karte.locator('.pt-person strong')).toHaveText(name);
	const team = page.locator('.pt-team li .pf');
	for (const f of await team.all()) await expect(f).toHaveAttribute('aria-label', /, (Monteur|Monteurin|Projektbegleiter|Projektbegleiterin)$/);
	await erwarteKeinQuerScrollen(page, page.viewportSize()!.width);
	await page.locator('.pt-seite').first().screenshot({ path: `test-results/portal-figuren-${info.project.name}.png` });
	await page.screenshot({ path: `test-results/portal-figuren-seite-${info.project.name}.png`, fullPage: true });
});
