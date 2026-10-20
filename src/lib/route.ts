import type { AuftragStatus } from './auftrag-status';

/**
 * Auftragskarte und Route (Wunsch Jamil msg 2602) – reine Funktionen: Luftlinie, Reihenfolge nach „nächster
 * Nachbar“ und der Link für Google Maps (Start = Betriebsadresse, höchstens 10 Stopps).
 */

export const MAX_STOPPS = 10;

export const STATUS_FARBEN: Record<AuftragStatus, string> = {
	anfrage: '#8a8886',
	angebot: '#d18b00',
	beauftragt: '#0f6cbd',
	in_arbeit: '#6b4fbb',
	abgenommen: '#107c10',
	abgerechnet: '#3b3a39'
};

export type Punkt = { lat: number; lng: number };

/** Entfernung in km (Haversine, Luftlinie). */
export function entfernungKm(a: Punkt, b: Punkt): number {
	const r = 6371;
	const rad = (g: number) => (g * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Reihenfolge „immer zum nächsten“ ab `start` (ohne Start: ab dem ersten Stopp mit Koordinaten). Stopps ohne
 * Koordinaten kommen in ihrer Reihenfolge ans Ende.
 */
export function naechsterNachbar<T extends { lat: number | null; lng: number | null }>(start: Punkt | null, stopps: readonly T[]): T[] {
	const mit = stopps.filter((s): s is T & Punkt => s.lat !== null && s.lng !== null);
	const ohne = stopps.filter((s) => s.lat === null || s.lng === null);
	const offen = [...mit];
	const aus: T[] = [];
	let hier: Punkt | null = start;
	while (offen.length > 0) {
		let i = 0;
		if (hier) {
			let best = Infinity;
			offen.forEach((s, j) => {
				const d = entfernungKm(hier!, s);
				if (d < best) {
					best = d;
					i = j;
				}
			});
		}
		const [naechster] = offen.splice(i, 1);
		aus.push(naechster);
		hier = naechster;
	}
	return [...aus, ...ohne];
}

/** Google-Maps-Route (Auto): Start → Zwischenziele → letztes Ziel; mehr als 10 Stopps werden abgeschnitten. */
export function googleRouteLink(start: string | null, ziele: readonly string[]): string | null {
	const z = ziele.filter((x) => x.trim() !== '').slice(0, MAX_STOPPS);
	if (z.length === 0) return null;
	const p = new URLSearchParams({ api: '1' });
	if (start) p.set('origin', start);
	p.set('destination', z.at(-1)!);
	if (z.length > 1) p.set('waypoints', z.slice(0, -1).join('|'));
	p.set('travelmode', 'driving');
	return `https://www.google.com/maps/dir/?${p.toString().replace(/\+/g, '%20').replace(/%7C/g, '|')}`;
}
