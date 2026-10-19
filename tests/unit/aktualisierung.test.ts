import { describe, expect, it, vi } from 'vitest';
import { beobachteAktualisierung } from '../../src/lib/aktualisierung';

/** Kleine Attrappen für navigator.serviceWorker, document und location. */
function umgebung(mitController: boolean, sichtbar = true) {
	const swHoerer: Record<string, () => void> = {};
	const dokHoerer: Record<string, () => void> = {};
	const update = vi.fn(async () => {});
	const sw = {
		controller: mitController ? {} : null,
		addEventListener: (n: string, f: () => void) => (swHoerer[n] = f),
		removeEventListener: (n: string) => delete swHoerer[n],
		getRegistration: vi.fn(async () => ({ update }))
	};
	const dok = {
		visibilityState: sichtbar ? 'visible' : 'hidden',
		addEventListener: (n: string, f: () => void) => (dokHoerer[n] = f),
		removeEventListener: (n: string) => delete dokHoerer[n]
	};
	const neuLaden = vi.fn();
	const pruefeVersion = vi.fn(async () => false);
	return { sw, dok, neuLaden, pruefeVersion, update, swHoerer, dokHoerer };
}

describe('beobachteAktualisierung', () => {
	it('neuer Service Worker übernimmt, Seite verborgen → sofort neu laden', () => {
		const u = umgebung(true, false);
		const a = beobachteAktualisierung(u);
		u.swHoerer.controllerchange();
		expect(u.neuLaden).toHaveBeenCalledTimes(1);
		expect(a.veraltet()).toBe(true);
	});

	it('Seite sichtbar → nicht mitten in der Eingabe neu laden, sondern beim nächsten Seitenwechsel (veraltet)', () => {
		const u = umgebung(true, true);
		const a = beobachteAktualisierung(u);
		expect(a.veraltet()).toBe(false);
		u.swHoerer.controllerchange();
		expect(u.neuLaden).not.toHaveBeenCalled();
		expect(a.veraltet()).toBe(true);
	});

	it('erste Installation (vorher kein Service Worker) → kein Neuladen, nicht veraltet', () => {
		const u = umgebung(false, false);
		const a = beobachteAktualisierung(u);
		u.swHoerer.controllerchange();
		expect(u.neuLaden).not.toHaveBeenCalled();
		expect(a.veraltet()).toBe(false);
	});

	it('Rückkehr zur App (sichtbar) → nach neuem Service Worker und neuer Version fragen', async () => {
		const u = umgebung(true, false);
		beobachteAktualisierung(u);
		u.dok.visibilityState = 'visible';
		u.dokHoerer.visibilitychange();
		await vi.waitFor(() => expect(u.update).toHaveBeenCalled());
		expect(u.pruefeVersion).toHaveBeenCalled();
	});

	it('veraltet, dann wechselt der Nutzer weg (verborgen) → jetzt neu laden, nur einmal', () => {
		const u = umgebung(true, true);
		beobachteAktualisierung(u);
		u.swHoerer.controllerchange();
		expect(u.neuLaden).not.toHaveBeenCalled();
		u.dok.visibilityState = 'hidden';
		u.dokHoerer.visibilitychange();
		u.dokHoerer.visibilitychange();
		expect(u.neuLaden).toHaveBeenCalledTimes(1);
	});

	it('ohne Service-Worker-Unterstützung → nichts tun; abmelden entfernt die Hörer', () => {
		const ohne = beobachteAktualisierung({ ...umgebung(true), sw: undefined });
		expect(ohne.veraltet()).toBe(false);
		const u = umgebung(true);
		const a = beobachteAktualisierung(u);
		a.abmelden();
		expect(u.swHoerer.controllerchange).toBeUndefined();
		expect(u.dokHoerer.visibilitychange).toBeUndefined();
	});
});
