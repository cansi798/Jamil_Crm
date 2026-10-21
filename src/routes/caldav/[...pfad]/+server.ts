import type { RequestHandler } from './$types';
import { caldav } from '$lib/server/caldav/server';

/**
 * CalDAV für Aufgaben (Handy-Abgleich, siehe src/lib/server/caldav/server.ts). Alle Methoden – auch PROPFIND,
 * REPORT, PROPPATCH über `fallback` – gehen an denselben Handler. Sammlungen enden auf „/“: deshalb kein Umleiten
 * des Schrägstrichs.
 */
export const trailingSlash = 'ignore';

const weiter: RequestHandler = (event) => caldav(event);

export const GET = weiter;
export const PUT = weiter;
export const DELETE = weiter;
export const OPTIONS = weiter;
export const fallback = weiter;
