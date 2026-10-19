/**
 * Neue Version nach einem Deploy automatisch übernehmen – ohne manuelles „Hart neu laden“.
 *
 * Problem: SvelteKit wechselt Seiten im Browser ohne Neuladen; ein offener Tab oder die installierte App (PWA) behält
 * so die alte JS/CSS-Hülle, auch wenn der Server längst die neue ausliefert. Der Service Worker (src/service-worker.ts)
 * hat je Build einen neuen Cache und übernimmt sofort (skipWaiting + clients.claim) – die Seite selbst lädt aber nicht
 * von allein neu.
 *
 * Lösung (hier, verdrahtet in src/routes/+layout.svelte):
 * - Übernimmt ein NEUER Service Worker (controllerchange, nicht die erste Installation), ist die Seite veraltet:
 *   ist sie gerade nicht sichtbar → sofort neu laden; sonst nicht mitten in einer Eingabe, sondern beim nächsten
 *   Seitenwechsel als vollständiger Seitenaufruf (`veraltet()`, ausgewertet in beforeNavigate).
 * - Kommt die App wieder in den Vordergrund (visibilitychange → sichtbar): beim Service Worker und bei SvelteKit
 *   (`updated.check()`, version.pollInterval in svelte.config.js) nach einer neuen Version fragen.
 */

type SwContainer = {
	controller: unknown;
	addEventListener(name: 'controllerchange', f: () => void): void;
	removeEventListener(name: 'controllerchange', f: () => void): void;
	getRegistration(): Promise<{ update(): Promise<unknown> } | undefined>;
};

type Dokument = {
	visibilityState: string;
	addEventListener(name: 'visibilitychange', f: () => void): void;
	removeEventListener(name: 'visibilitychange', f: () => void): void;
};

export type AktualisierungsUmgebung = {
	sw: SwContainer | undefined;
	dok: Dokument;
	neuLaden: () => void;
	/** SvelteKits `updated.check()` – fragt den Server nach einer neueren Version. */
	pruefeVersion: () => Promise<unknown>;
};

export function beobachteAktualisierung(u: AktualisierungsUmgebung): { veraltet: () => boolean; abmelden: () => void } {
	let veraltet = false;
	let neuGeladen = false;
	const sw = u.sw;
	if (!sw) return { veraltet: () => false, abmelden: () => {} };

	// Ohne bisherigen Controller ist controllerchange nur die erste Installation – die Seite ist dann aktuell.
	let hatteController = Boolean(sw.controller);

	const ladeNeu = () => {
		if (neuGeladen) return;
		neuGeladen = true;
		u.neuLaden();
	};

	const beiWechsel = () => {
		if (!hatteController) {
			hatteController = true;
			return;
		}
		veraltet = true;
		if (u.dok.visibilityState === 'hidden') ladeNeu();
	};

	const beiSichtbarkeit = () => {
		if (u.dok.visibilityState === 'hidden') {
			if (veraltet) ladeNeu();
			return;
		}
		sw.getRegistration()
			.then((r) => r?.update())
			.catch(() => {});
		u.pruefeVersion().catch(() => {});
	};

	sw.addEventListener('controllerchange', beiWechsel);
	u.dok.addEventListener('visibilitychange', beiSichtbarkeit);
	return {
		veraltet: () => veraltet,
		abmelden: () => {
			sw.removeEventListener('controllerchange', beiWechsel);
			u.dok.removeEventListener('visibilitychange', beiSichtbarkeit);
		}
	};
}
