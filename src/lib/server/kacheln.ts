import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiFehler } from './fehler';

/**
 * Kartenkacheln über den eigenen Server (Wunsch Jamil msg 2689): Der Browser lädt Kacheln nur noch von uns
 * (`/karte/kacheln/{z}/{x}/{y}.png`); wir holen sie beim Kachel-Dienst (`KARTE_KACHEL_URL`, Standard OpenStreetMap)
 * mit eigenem User-Agent samt Kontakt, legen sie in einen Zwischenspeicher auf der Platte und begrenzen die Anfragen.
 * So gelten die Nutzungsregeln von OSM (Kennung, Zwischenspeichern, keine Massenabrufe), und keine Adresse des
 * Nutzers geht an Dritte. Für viele Nutzer: eigenen Kachel-Server oder einen Anbieter mit Schlüssel eintragen.
 */

export const STANDARD_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAX_ZOOM = 19;
/** Kacheln gelten 7 Tage (OSM verlangt mindestens 7 Tage Zwischenspeicher). */
export const HALTBAR_MS = 7 * 24 * 3600_000;
const MAX_DATEIEN = 20_000;
const MAX_BYTES_KACHEL = 1_000_000;

export function kachelUrl(vorlage: string, z: number, x: number, y: number): string {
	return vorlage.replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y)).replaceAll('{s}', 'a');
}

/** Pfad-Teile prüfen: ganze Zahlen, Zoom 0–19, x/y innerhalb 0 … 2^z − 1. Sonst null. */
export function pruefeKachel(z: unknown, x: unknown, y: unknown): { z: number; x: number; y: number } | null {
	const zahl = (w: unknown) => (typeof w === 'string' && /^\d{1,7}$/.test(w) ? Number(w) : NaN);
	const [zz, xx, yy] = [zahl(z), zahl(x), zahl(y)];
	if (!Number.isInteger(zz) || zz < 0 || zz > MAX_ZOOM) return null;
	const max = 2 ** zz;
	if (!Number.isInteger(xx) || !Number.isInteger(yy) || xx >= max || yy >= max) return null;
	return { z: zz, x: xx, y: yy };
}

/** Kachel-Vorlage aus der Einstellung: nur https mit {z},{x},{y}; sonst Standard. */
export function kachelVorlage(w = process.env.KARTE_KACHEL_URL): string {
	const v = w?.trim();
	if (!v) return STANDARD_URL;
	if (!/^https:\/\/[^\s/]+\/\S*$/.test(v) || !v.includes('{z}') || !v.includes('{x}') || !v.includes('{y}')) {
		console.error('KARTE_KACHEL_URL ungültig (https mit {z}, {x}, {y} nötig) – nutze OpenStreetMap.');
		return STANDARD_URL;
	}
	return v;
}

/** Quellenangabe für einen anderen Kachel-Dienst (nur Text) – null = OpenStreetMap-Hinweis mit Link. */
export const kachelHinweis = (): string | null => process.env.KARTE_ATTRIBUTION?.trim().slice(0, 300) || null;

/** Kennung gegenüber Kachel- und Adressdienst (Pflicht bei OSM): App + Adresse der Installation + Kontakt. */
export function userAgent(): string {
	const kontakt = process.env.KARTE_KONTAKT?.trim() || process.env.CRM_VAPID_KONTAKT?.replace(/^mailto:/, '').trim() || '';
	const herkunft = process.env.ORIGIN?.trim() || '';
	return `waybuild-CRM/1.0 (${[herkunft, kontakt ? `Kontakt: ${kontakt}` : ''].filter(Boolean).join('; ') || 'Selbst betrieben'})`;
}

// ——— Begrenzung ———

/** Je Nutzer höchstens so viele Kacheln pro Minute (Karte bewegen braucht ~20–60). */
export const JE_NUTZER_MINUTE = 600;
const nutzerZaehler = new Map<string, { start: number; n: number }>();
export function pruefeNutzerLimit(benutzerId: string, jetzt = Date.now()): void {
	const z = nutzerZaehler.get(benutzerId);
	if (!z || jetzt - z.start >= 60_000) {
		nutzerZaehler.set(benutzerId, { start: jetzt, n: 1 });
		if (nutzerZaehler.size > 5000) nutzerZaehler.clear();
		return;
	}
	if (++z.n > JE_NUTZER_MINUTE) throw new ApiFehler(429, 'Zu viele Kartenanfragen – bitte kurz warten.');
}

/** Höchstens 2 gleichzeitige Abrufe beim Kachel-Dienst (Nutzungsregel: keine Massenabrufe). */
let laufend = 0;
const warteschlange: (() => void)[] = [];
async function platz<T>(fn: () => Promise<T>): Promise<T> {
	if (laufend >= 2) await new Promise<void>((ok) => warteschlange.push(ok));
	laufend++;
	try {
		return await fn();
	} finally {
		laufend--;
		warteschlange.shift()?.();
	}
}

// ——— Zwischenspeicher (Platte; geht beim Neustart des Containers verloren – reiner Cache, keine Sicherung nötig) ———

const ordner = () => process.env.KARTE_KACHEL_CACHE?.trim() || join(tmpdir(), 'crm-kacheln');
const dateiFuer = (vorlage: string, z: number, x: number, y: number) =>
	join(ordner(), createHash('sha256').update(`${vorlage}|${z}/${x}/${y}`).digest('hex').slice(0, 40) + '.png');

const unterwegs = new Map<string, Promise<Buffer>>();
let geschrieben = 0;

async function aufraeumen(): Promise<void> {
	try {
		const namen = await readdir(ordner());
		if (namen.length <= MAX_DATEIEN) return;
		const mitZeit = await Promise.all(namen.map(async (n) => ({ n, t: (await stat(join(ordner(), n)).catch(() => null))?.mtimeMs ?? 0 })));
		mitZeit.sort((a, b) => a.t - b.t);
		for (const { n } of mitZeit.slice(0, namen.length - Math.floor(MAX_DATEIEN * 0.8))) await rm(join(ordner(), n), { force: true });
	} catch {
		/* Cache ist optional */
	}
}

type Abruf = (url: string) => Promise<Response>;
const echterAbruf: Abruf = (url) =>
	fetch(url, {
		headers: { 'user-agent': userAgent(), accept: 'image/png,image/*', ...(process.env.ORIGIN ? { referer: `${process.env.ORIGIN}/` } : {}) },
		redirect: 'manual',
		signal: AbortSignal.timeout(10_000)
	});
let abruf: Abruf = echterAbruf;
/** Nur Tests: anderer Abruf (ohne Netz). */
export const setzeKachelAbruf = (f: Abruf | null) => (abruf = f ?? echterAbruf);

/** Bildart aus den ersten Bytes (PNG, JPEG, WebP) – sonst null (keine Kachel). */
export function bildArt(d: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
	if (d.length >= 8 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return 'image/png';
	if (d.length >= 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return 'image/jpeg';
	if (d.length >= 12 && String.fromCharCode(...d.slice(0, 4)) === 'RIFF' && String.fromCharCode(...d.slice(8, 12)) === 'WEBP') return 'image/webp';
	return null;
}

/** Kachel aus dem Zwischenspeicher oder vom Kachel-Dienst (gleiche Kachel gleichzeitig nur einmal). */
export async function holeKachel(z: number, x: number, y: number): Promise<Buffer> {
	const vorlage = kachelVorlage();
	const datei = dateiFuer(vorlage, z, x, y);
	const s = await stat(datei).catch(() => null);
	if (s && Date.now() - s.mtimeMs < HALTBAR_MS) return readFile(datei);
	const schon = unterwegs.get(datei);
	if (schon) return schon;
	const p = platz(async () => {
		const r = await abruf(kachelUrl(vorlage, z, x, y));
		if (r.status !== 200) {
			await r.body?.cancel().catch(() => undefined);
			// alte Kachel ist besser als keine
			if (s) return readFile(datei);
			throw new ApiFehler(r.status === 404 ? 404 : 502, 'Kachel nicht verfügbar.');
		}
		const laenge = Number(r.headers.get('content-length') ?? 0);
		if (laenge > MAX_BYTES_KACHEL) throw new ApiFehler(502, 'Kachel zu groß.');
		const daten = Buffer.from(await r.arrayBuffer());
		if (daten.length > MAX_BYTES_KACHEL || !bildArt(daten)) throw new ApiFehler(502, 'Kachel ungültig.');
		await mkdir(ordner(), { recursive: true }).catch(() => undefined);
		await writeFile(datei, daten).catch(() => undefined);
		if (++geschrieben % 500 === 0) void aufraeumen();
		return daten;
	}).finally(() => unterwegs.delete(datei));
	unterwegs.set(datei, p);
	return p;
}
