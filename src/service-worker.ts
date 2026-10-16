/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

/**
 * Service Worker der PWA: Er hält nur die App-Hülle bereit – die gebauten JS/CSS-Dateien (`build`) und die
 * statischen Dateien (`files`: Manifest, Symbole). Seiten (HTML) und die API werden NIE zwischengespeichert:
 * Sie enthalten personenbezogene Daten und kommen immer frisch vom Server. Ohne Netz zeigt der Browser dann
 * seine normale Offline-Meldung (eine Offline-Bearbeitung ist nicht vorgesehen).
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `crm-huelle-${version}`;
// Versteckte Dateien (z. B. .gitkeep) liefert der Server nicht aus – sie würden die Installation scheitern lassen.
const DATEIEN = [...build, ...files].filter((pfad) => !pfad.split('/').some((teil) => teil.startsWith('.')));
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
	// Nur eigene, bekannte Hüllen-Dateien; alles andere (Seiten, /api, fremde Server) geht unverändert ans Netz.
	if (url.origin !== sw.location.origin || !ERLAUBT.has(url.pathname)) return;
	ereignis.respondWith(
		caches.open(CACHE).then(async (cache) => (await cache.match(url.pathname)) ?? fetch(anfrage))
	);
});
