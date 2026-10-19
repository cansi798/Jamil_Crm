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

sw.addEventListener('install', (ereignis) => {
	ereignis.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(DATEIEN))
			.then(() => sw.skipWaiting())
	);
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
		caches.open(CACHE).then(async (cache) => (await cache.match(url.pathname)) ?? fetch(anfrage))
	);
});
