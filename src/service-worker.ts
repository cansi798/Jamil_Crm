/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, prerendered, version } from '$service-worker';

/**
 * Service Worker der PWA: Er hält nur die App-Hülle bereit – die gebauten JS/CSS-Dateien (`build`), die statischen
 * Dateien (`files`: Manifest, Symbole) und die vorab gerenderte Seite `/offline` (`prerendered`, ohne persönliche
 * Daten). Seiten mit Daten und die API werden NIE zwischengespeichert: Sie kommen immer frisch vom Server.
 *
 * Ohne Netz: Scheitert das Laden einer Seite (Navigation), antwortet er mit `/offline`. Diese Seite zeigt die
 * Einsätze von heute aus der Kopie im `localStorage` des Geräts (src/lib/heute-kopie.ts) – der Service Worker selbst
 * sieht und speichert diese Daten nie.
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `crm-huelle-${version}`;
const OFFLINE = '/offline';
// Versteckte Dateien (z. B. .gitkeep) liefert der Server nicht aus – sie würden die Installation scheitern lassen.
const DATEIEN = [...build, ...files, ...prerendered].filter(
	(pfad) => !pfad.split('/').some((teil) => teil.startsWith('.'))
);
const ERLAUBT = new Set(DATEIEN);

/**
 * Installation (Prüfbericht 21.11.2026): nicht mehr die GANZE App vorladen (mobiles Datenvolumen), sondern nur die
 * Hülle für „offline“: die Offline-Seite, Manifest/Symbole und genau die JS/CSS-Dateien, die die Offline-Seite selbst
 * lädt (aus ihrem HTML gelesen). Alle anderen Hüllen-Dateien landen erst im Zwischenspeicher, wenn die App sie ohnehin
 * lädt (siehe „fetch“).
 */
async function huelleVorladen(): Promise<void> {
	const cache = await caches.open(CACHE);
	const klein = DATEIEN.filter((p) => !build.includes(p));
	await cache.addAll(klein);
	const seite = await cache.match(OFFLINE);
	if (!seite) return;
	const html = await seite.clone().text();
	const noetig = [...new Set([...html.matchAll(/["'(](\/_app\/[^"'()\s]+)/g)].map((m) => m[1]))].filter((p) => ERLAUBT.has(p));
	await cache.addAll(noetig);
}

sw.addEventListener('install', (ereignis) => {
	ereignis.waitUntil(huelleVorladen().then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (ereignis) => {
	ereignis.waitUntil(
		caches
			.keys()
			.then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (ereignis) => {
	const anfrage = ereignis.request;
	if (anfrage.method !== 'GET') return;
	const url = new URL(anfrage.url);
	if (url.origin !== sw.location.origin) return;

	// Seitenaufruf: immer vom Netz; nur wenn das scheitert (offline), die zwischengespeicherte Offline-Seite.
	if (anfrage.mode === 'navigate') {
		ereignis.respondWith(
			fetch(anfrage).catch(async () => {
				const cache = await caches.open(CACHE);
				return (await cache.match(OFFLINE)) ?? Response.error();
			})
		);
		return;
	}

	// Nur eigene, bekannte Hüllen-Dateien; alles andere (/api, Daten der Seiten) geht unverändert ans Netz.
	if (!ERLAUBT.has(url.pathname)) return;
	ereignis.respondWith(
		caches.open(CACHE).then(async (cache) => {
			const da = await cache.match(url.pathname);
			if (da) return da;
			const antwort = await fetch(anfrage);
			// beim ersten Gebrauch merken (unveränderliche Build-Dateien und statische Dateien der Hülle)
			if (antwort.ok && antwort.type === 'basic') void cache.put(url.pathname, antwort.clone()).catch(() => undefined);
			return antwort;
		})
	);
});

// ——— Erinnerungen per Web-Push (Wunsch Jamil msg 2679) ———
// Der Server schickt nur Titel, kurzen Text und einen Link innerhalb der App (verschlüsselt über den Push-Dienst).
sw.addEventListener('push', (ereignis) => {
	let n: { titel?: string; text?: string; link?: string } = {};
	try {
		n = ereignis.data?.json() ?? {};
	} catch {
		n = { titel: ereignis.data?.text() };
	}
	const link = typeof n.link === 'string' && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/';
	ereignis.waitUntil(
		sw.registration.showNotification(n.titel || 'Erinnerung', {
			body: n.text || '',
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			tag: link,
			data: { link }
		})
	);
});

sw.addEventListener('notificationclick', (ereignis) => {
	ereignis.notification.close();
	const ziel = new URL((ereignis.notification.data?.link as string) || '/', sw.location.origin).href;
	ereignis.waitUntil(
		sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (fenster) => {
			for (const f of fenster) {
				if (new URL(f.url).origin === sw.location.origin) {
					await (f as WindowClient).focus();
					return (f as WindowClient).navigate(ziel);
				}
			}
			return sw.clients.openWindow(ziel);
		})
	);
});
