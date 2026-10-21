import type { RequestHandler } from './$types';

/**
 * Erkennung (RFC 6764): `/.well-known/caldav` zeigt auf den CalDAV-Einstieg. So genügt am Handy die Serveradresse.
 * Gilt für jede Methode (auch PROPFIND).
 */
const umleiten: RequestHandler = () => new Response(null, { status: 301, headers: { location: '/caldav/', 'cache-control': 'no-store' } });

export const GET = umleiten;
export const PUT = umleiten;
export const DELETE = umleiten;
export const OPTIONS = umleiten;
export const fallback = umleiten;
