import { describe, expect, it } from 'vitest';
import { entfernungKm, googleRouteLink, MAX_STOPPS, naechsterNachbar, STATUS_FARBEN } from '../../src/lib/route';

const koeln = { lat: 50.9375, lng: 6.9603 };
const bonn = { lat: 50.7374, lng: 7.0982 };
const duesseldorf = { lat: 51.2277, lng: 6.7735 };

describe('Route', () => {
	it('Entfernung (Luftlinie) Köln–Bonn ≈ 24 km', () => {
		expect(Math.round(entfernungKm(koeln, bonn))).toBe(24);
	});

	it('Nächster Nachbar ab Start; Stopps ohne Koordinaten ans Ende', () => {
		const stopps = [
			{ id: 'b', ...bonn },
			{ id: 'x', lat: null, lng: null },
			{ id: 'd', ...duesseldorf },
			{ id: 'k', ...koeln }
		];
		expect(naechsterNachbar(koeln, stopps).map((s) => s.id)).toEqual(['k', 'b', 'd', 'x']);
		expect(naechsterNachbar(duesseldorf, stopps).map((s) => s.id)).toEqual(['d', 'k', 'b', 'x']);
		expect(naechsterNachbar(null, stopps).map((s) => s.id)).toEqual(['b', 'k', 'd', 'x']); // ab dem ersten Stopp
	});

	it('Google-Maps-Link: Start, Zwischenziele, Ziel; höchstens 10 Stopps', () => {
		expect(googleRouteLink('Domstraße 3, 50668 Köln', ['A-Straße 1, Bonn', 'B-Weg 2, Düsseldorf'])).toBe(
			'https://www.google.com/maps/dir/?api=1&origin=Domstra%C3%9Fe%203%2C%2050668%20K%C3%B6ln&destination=B-Weg%202%2C%20D%C3%BCsseldorf&waypoints=A-Stra%C3%9Fe%201%2C%20Bonn&travelmode=driving'
		);
		expect(googleRouteLink(null, ['Ziel 1'])).toBe('https://www.google.com/maps/dir/?api=1&destination=Ziel%201&travelmode=driving');
		const viele = Array.from({ length: 14 }, (_, i) => `Stopp ${i + 1}`);
		const url = new URL(googleRouteLink('Start', viele)!);
		expect(url.searchParams.get('waypoints')!.split('|')).toHaveLength(MAX_STOPPS - 1);
		expect(url.searchParams.get('destination')).toBe(`Stopp ${MAX_STOPPS}`);
		expect(googleRouteLink('Start', [])).toBeNull();
	});

	it('Farben für alle Status', () => {
		expect(Object.keys(STATUS_FARBEN)).toEqual(['anfrage', 'angebot', 'beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet']);
	});
});
