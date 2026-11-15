import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

/**
 * Nachgebauter Lexware-Server für Tests (KEIN echter Zugang zu Lexware). Antwortformate nach der offiziellen Doku
 * https://developers.lexware.io/docs/ (gelesen 15.11.2026):
 * - Profil GET /v1/profile: organizationId, companyName, created{…}, connectionId, features, businessFeatures,
 *   subscriptionStatus, taxType, smallBusiness
 * - Kontakte GET/POST/PUT /v1/contacts: POST/PUT-Antwort {id, resourceUri, createdDate, updatedDate, version};
 *   Liste paginiert {content, first, last, totalPages, totalElements, numberOfElements, size, number, sort};
 *   Filter email/name (≥ 3 Zeichen, enthält, ohne Groß/Klein), number, customer, vendor; PUT mit veralteter version → 409
 * - Belegliste GET /v1/voucherlist?voucherType=…&voucherStatus=…: Einträge {id, voucherType, voucherStatus, voucherNumber,
 *   voucherDate, createdDate, updatedDate, dueDate, contactId, contactName, totalAmount, openAmount, currency, archived},
 *   size höchstens 250
 * - Event-Subscriptions POST/GET/DELETE /v1/event-subscriptions: POST {eventType, callbackUrl} → 201
 *   {id, resourceUri, createdDate, updatedDate, version}; doppelt → 409; Liste {content: [{subscriptionId,
 *   organizationId, createdDate, eventType, callbackUrl}]}; DELETE → 204
 * - Angebote POST /v1/quotations[?finalize=true] (Pflicht voucherDate, expirationDate, address, lineItems, totalPrice,
 *   taxConditions; Antwort {id, resourceUri, createdDate, updatedDate, version}), GET /v1/quotations/{id} (mit voucherNumber,
 *   voucherStatus draft|open|accepted|rejected), GET /v1/quotations/{id}/file (nur PDF: Accept *\/* oder application/pdf,
 *   sonst 406; Entwurf → 409; Content-Disposition mit Dateinamen). Kein PUT, kein DELETE, Status per API nicht änderbar.
 * - Auftragsbestätigungen POST /v1/order-confirmations[?precedingSalesVoucherId={id}][&finalize=true] (zusätzlich Pflicht
 *   shippingConditions; ungültiges Weiterführen → 406, z. B. Angebot als Entwurf/abgelehnt oder mit Alternativ-/
 *   Bedarfspositionen), GET /v1/order-confirmations/{id}, …/file (Entwurf → 409). Ob Lexware das Angebot beim
 *   Weiterführen auf „accepted“ setzt, ist in der Doku offen (Plan T0) – Schalter `abSetztAngenommen` (Standard aus).
 * - Rechnungen POST /v1/invoices[?precedingSalesVoucherId={id}][&finalize=true] (Pflicht wie AB inkl. shippingConditions;
 *   paymentConditions.paymentTermDuration → dueDate), GET /v1/invoices/{id} (voucherStatus draft|open|paid|paidoff|voided,
 *   dueDate), …/file (Entwurf → 409). In der Belegliste mit openAmount = Brutto.
 * - Zahlungen GET /v1/payments/{belegId}: {openAmount, currency, paymentStatus balanced|openRevenue, voucherType,
 *   voucherStatus, paidDate, paymentItems: [{paymentItemType, postingDate, amount, currency}]}
 * - Mahnungen POST /v1/dunnings?precedingSalesVoucherId={Rechnung} (Rechnung muss offen/überfällig sein, sonst 406;
 *   bleibt immer Entwurf, erscheint NICHT in der Belegliste), GET /v1/dunnings/{id}, …/file (PDF auch im Entwurf –
 *   laut Plan T0 noch zu bestätigen; Schalter `mahnungPdf`).
 * - Fehler: „regular format“ {timestamp, status, error, path, traceId, message}; Kontakte „legacy“ {IssueList: […]}
 * - Ratenlimit: 429; Retry-After optional
 *
 * Störungen (`stoerung(...)`) gelten für die nächsten Anfragen der Reihe nach: Status mit Fehlertext, Verzögerung
 * (für Zeitüberschreitung) und optional „trotzdem ausführen“ (Anfrage kommt an, Antwort geht verloren).
 */

export type Stoerung = { status?: number; retryAfter?: number; verzoegerungMs?: number; trotzdemAusfuehren?: boolean; nurPfad?: RegExp; nurMethode?: string };
export type Anfrage = { methode: string; pfad: string; query: URLSearchParams; body: any; auth: string | null };
export type Kontakt = Record<string, any> & { id: string; version: number };
export type Beleg = {
	id: string;
	voucherType: string;
	voucherStatus: string;
	voucherNumber: string | null;
	voucherDate: string;
	createdDate: string;
	updatedDate: string;
	dueDate: string | null;
	contactId: string | null;
	contactName: string;
	totalAmount: number;
	openAmount: number;
	currency: string;
	archived: boolean;
};

export type Attrappe = {
	url: string;
	schluessel: string;
	organisationId: string;
	anfragen: Anfrage[];
	kontakte: Map<string, Kontakt>;
	belege: Beleg[];
	abos: { subscriptionId: string; organizationId: string; createdDate: string; eventType: string; callbackUrl: string }[];
	profil: Record<string, unknown>;
	/** Verkaufsbelege (Angebote, Auftragsbestätigungen) mit allen Feldern */
	verkaufsbelege: Map<string, Record<string, any>>;
	/** Setzt Lexware beim Weiterführen zur AB das Angebot auf „accepted“? (Doku offen, Plan T0) */
	abSetztAngenommen: boolean;
	/** Liefert /v1/dunnings/{id}/file im Entwurf ein PDF? (Plan T0) */
	mahnungPdf: boolean;
	/** Rechnung in Lexware festschreiben (wie von Hand in der Lexware-Oberfläche) */
	festschreiben: (id: string) => void;
	/** Zahlung buchen (Bankabgleich in Lexware); Betrag in Euro */
	bezahle: (id: string, euro: number, datum?: string) => void;
	stoerung: (...s: Stoerung[]) => void;
	/** Alle noch offenen Störungen verwerfen */
	ruhe: () => void;
	zuruecksetzen: () => void;
	stop: () => Promise<void>;
};

const jetzt = () => new Date().toISOString().replace('Z', '+00:00');

function fehler(res: ServerResponse, status: number, pfad: string, nachricht: string, retryAfter?: number) {
	const k: Record<string, string> = { 'content-type': 'application/json' };
	if (retryAfter !== undefined) k['retry-after'] = String(retryAfter);
	res.writeHead(status, k);
	res.end(JSON.stringify({ timestamp: jetzt(), status, error: nachricht, path: pfad, traceId: randomUUID().slice(0, 16), message: nachricht }));
}
function json(res: ServerResponse, status: number, daten: unknown) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(daten));
}
function seite<T>(alle: T[], q: URLSearchParams) {
	const size = Math.min(Number(q.get('size') ?? 25), 250);
	const number = Number(q.get('page') ?? 0);
	const content = alle.slice(number * size, number * size + size);
	const totalPages = Math.max(1, Math.ceil(alle.length / size));
	return { content, first: number === 0, last: number >= totalPages - 1, totalPages, totalElements: alle.length, numberOfElements: content.length, size, number, sort: [] };
}
const lies = (req: IncomingMessage) =>
	new Promise<string>((ok) => {
		let s = '';
		req.on('data', (d) => (s += d));
		req.on('end', () => ok(s));
	});

export async function starteAttrappe(port = 0): Promise<Attrappe> {
	const a: Omit<Attrappe, 'url' | 'stop'> & { stoerungen: Stoerung[] } = {
		schluessel: 'gueltiger-testschluessel-0001',
		organisationId: randomUUID(),
		anfragen: [],
		kontakte: new Map(),
		belege: [],
		abos: [],
		profil: {},
		verkaufsbelege: new Map(),
		abSetztAngenommen: false,
		mahnungPdf: true,
		festschreiben: () => {},
		bezahle: () => {},
		stoerungen: [],
		stoerung: (...s) => void a.stoerungen.push(...s),
		ruhe: () => void (a.stoerungen.length = 0),
		zuruecksetzen: () => {
			a.anfragen.length = 0;
			a.kontakte.clear();
			a.belege.length = 0;
			a.abos.length = 0;
			a.verkaufsbelege.clear();
			a.stoerungen.length = 0;
		}
	};
	a.profil = {
		organizationId: a.organisationId,
		companyName: 'Bauwelt Testfirma GmbH',
		created: { userId: randomUUID(), userName: 'Jamil Test', userEmail: 'jamil@beispiel.test', date: '2024-01-01T10:00:00.000+01:00' },
		connectionId: randomUUID(),
		features: ['cashbox'],
		businessFeatures: ['INVOICING', 'INVOICING_PRO', 'BOOKKEEPING'],
		subscriptionStatus: 'active',
		taxType: 'net',
		smallBusiness: false
	};

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://attrappe');
		const roh = await lies(req);
		const body = roh ? JSON.parse(roh) : null;
		const pfad = url.pathname;
		a.anfragen.push({ methode: req.method ?? 'GET', pfad, query: url.searchParams, body, auth: (req.headers.authorization as string) ?? null });
		const i = a.stoerungen.findIndex((s) => (!s.nurPfad || s.nurPfad.test(pfad)) && (!s.nurMethode || s.nurMethode === req.method));
		const st = i >= 0 ? a.stoerungen.splice(i, 1)[0] : null;
		if (st?.verzoegerungMs && !st.trotzdemAusfuehren) await new Promise((r) => setTimeout(r, st.verzoegerungMs));
		if (st?.status) return fehler(res, st.status, pfad, st.status === 429 ? 'Too Many Requests' : 'Fehler aus der Attrappe', st.retryAfter);
		if (req.headers.authorization !== `Bearer ${a.schluessel}`) return fehler(res, 401, pfad, 'Unauthorized');
		const antworte = async (status: number, daten?: unknown) => {
			if (st?.verzoegerungMs) await new Promise((r) => setTimeout(r, st.verzoegerungMs));
			if (res.destroyed) return;
			if (daten === undefined) {
				res.writeHead(status);
				res.end();
			} else json(res, status, daten);
		};

		if (pfad === '/v1/profile' && req.method === 'GET') return antworte(200, a.profil);

		if (pfad === '/v1/contacts' && req.method === 'GET') {
			const q = url.searchParams;
			let liste = [...a.kontakte.values()];
			const enth = (w: string | undefined, s: string) => !!w && w.toLowerCase().includes(s.toLowerCase());
			const email = q.get('email');
			const name = q.get('name');
			if (email !== null) {
				if (email.length < 3) return fehler(res, 400, pfad, 'email: min 3');
				liste = liste.filter((k) => Object.values(k.emailAddresses ?? {}).flat().some((e) => enth(e as string, email)));
			}
			if (name !== null) {
				if (name.length < 3) return fehler(res, 400, pfad, 'name: min 3');
				liste = liste.filter((k) => enth(k.company?.name, name) || enth(`${k.person?.firstName ?? ''} ${k.person?.lastName ?? ''}`, name) || enth(k.person?.lastName, name));
			}
			if (q.get('customer') === 'true') liste = liste.filter((k) => !!k.roles?.customer);
			return antworte(200, seite(liste, q));
		}
		if (pfad === '/v1/contacts' && req.method === 'POST') {
			if (!body || !!body.person === !!body.company) return json(res, 400, { IssueList: [{ i18nKey: 'missing_entity', source: 'company.name', type: 'validation_failure', additionalData: null, args: null }] });
			const id = randomUUID();
			const t = jetzt();
			a.kontakte.set(id, { ...body, id, organizationId: a.organisationId, version: 1, archived: false });
			return antworte(200, { id, resourceUri: `https://api.lexware.io/v1/contacts/${id}`, createdDate: t, updatedDate: t, version: 1 });
		}
		const kontaktPfad = /^\/v1\/contacts\/([0-9a-f-]{36})$/.exec(pfad);
		if (kontaktPfad) {
			const k = a.kontakte.get(kontaktPfad[1]);
			if (!k) return fehler(res, 404, pfad, 'Not Found');
			if (req.method === 'GET') return antworte(200, k);
			if (req.method === 'PUT') {
				if (body?.version !== k.version) return fehler(res, 409, pfad, 'Conflict: version');
				const neu = { ...body, id: k.id, organizationId: a.organisationId, version: k.version + 1, archived: false };
				a.kontakte.set(k.id, neu);
				const t = jetzt();
				return antworte(200, { id: k.id, resourceUri: `https://api.lexware.io/v1/contacts/${k.id}`, createdDate: t, updatedDate: t, version: neu.version });
			}
		}

		if (pfad === '/v1/voucherlist' && req.method === 'GET') {
			const q = url.searchParams;
			const typen = q.get('voucherType');
			const status = q.get('voucherStatus');
			if (!typen || !status) return fehler(res, 400, pfad, 'voucherType and voucherStatus required');
			let liste = [...a.belege];
			if (typen !== 'any') liste = liste.filter((b) => typen.split(',').includes(b.voucherType));
			if (status !== 'any') liste = liste.filter((b) => status.split(',').includes(b.voucherStatus));
			const ab = q.get('updatedDateFrom');
			if (ab) liste = liste.filter((b) => b.updatedDate.slice(0, 10) >= ab);
			return antworte(200, seite(liste, q));
		}

		if (pfad === '/v1/event-subscriptions' && req.method === 'POST') {
			if (!body?.eventType || !body?.callbackUrl) return fehler(res, 406, pfad, 'Validation failed');
			if (a.abos.some((x) => x.eventType === body.eventType && x.callbackUrl === body.callbackUrl)) return fehler(res, 409, pfad, 'Conflict');
			const id = randomUUID();
			const t = jetzt();
			a.abos.push({ subscriptionId: id, organizationId: a.organisationId, createdDate: t, eventType: body.eventType, callbackUrl: body.callbackUrl });
			return antworte(201, { id, resourceUri: `https://api.lexware.io/v1/event-subscriptions/${id}`, createdDate: t, updatedDate: t, version: 0 });
		}
		if (pfad === '/v1/event-subscriptions' && req.method === 'GET') return antworte(200, { content: a.abos });
		const aboPfad = /^\/v1\/event-subscriptions\/([0-9a-f-]{36})$/.exec(pfad);
		if (aboPfad && req.method === 'DELETE') {
			const j = a.abos.findIndex((x) => x.subscriptionId === aboPfad[1]);
			if (j < 0) return fehler(res, 404, pfad, 'Not Found');
			a.abos.splice(j, 1);
			return antworte(204);
		}
		// ——— Verkaufsbelege: Angebote und Auftragsbestätigungen ———
		const ART: Record<string, { typ: string; praefix: string; pflicht: string[] }> = {
			quotations: { typ: 'quotation', praefix: 'AG', pflicht: ['voucherDate', 'expirationDate', 'address', 'lineItems', 'totalPrice', 'taxConditions'] },
			'order-confirmations': { typ: 'orderconfirmation', praefix: 'AB', pflicht: ['voucherDate', 'address', 'lineItems', 'totalPrice', 'taxConditions', 'shippingConditions'] },
			invoices: { typ: 'invoice', praefix: 'RE', pflicht: ['voucherDate', 'address', 'lineItems', 'totalPrice', 'taxConditions', 'shippingConditions'] },
			dunnings: { typ: 'dunning', praefix: 'MA', pflicht: ['voucherDate', 'address', 'lineItems', 'totalPrice', 'taxConditions'] }
		};
		const zahlPfad = /^\/v1\/payments\/([0-9a-f-]{36})$/.exec(pfad);
		if (zahlPfad && req.method === 'GET') {
			const b = a.verkaufsbelege.get(zahlPfad[1]);
			if (!b || b.voucherType === 'dunning') return fehler(res, 404, pfad, 'Not Found');
			return antworte(200, {
				openAmount: b.openAmount ?? 0,
				currency: 'EUR',
				paymentStatus: (b.openAmount ?? 0) > 0 ? 'openRevenue' : 'balanced',
				voucherType: b.voucherType,
				voucherStatus: b.voucherStatus,
				paidDate: b.paidDate ?? null,
				paymentItems: b.paymentItems ?? []
			});
		}
		const vk = /^\/v1\/(quotations|order-confirmations|invoices|dunnings)(?:\/([0-9a-f-]{36})(\/file)?)?$/.exec(pfad);
		if (vk) {
			const art = ART[vk[1]];
			if (!vk[2] && req.method === 'POST') {
				const fehlt = art.pflicht.filter((f) => body?.[f] === undefined || body?.[f] === null);
				if (fehlt.length > 0 || !Array.isArray(body.lineItems) || body.lineItems.length === 0 || body.lineItems.length > 300)
					return fehler(res, 406, pfad, `Validation failed: ${fehlt.join(', ') || 'lineItems'}`);
				const kontaktId = body.address?.contactId;
				if (kontaktId && !a.kontakte.has(kontaktId)) return fehler(res, 406, pfad, 'Validation failed: address.contactId');
				if (!kontaktId && (!body.address?.name || !body.address?.countryCode)) return fehler(res, 406, pfad, 'Validation failed: address.name');
				const vorId = url.searchParams.get('precedingSalesVoucherId');
				let vor: Record<string, any> | undefined;
				if (vorId) {
					vor = a.verkaufsbelege.get(vorId);
					if (!vor) return fehler(res, 404, pfad, 'Not Found: precedingSalesVoucherId');
					const alternativ = (vor.lineItems ?? []).some((p: any) => p.optional || p.alternative);
					if (vor.voucherStatus === 'draft' || vor.voucherStatus === 'rejected' || vor.voucherStatus === 'voided' || alternativ) return fehler(res, 406, pfad, 'Invalid pursue action');
					if (art.typ === 'dunning' && !(vor.voucherType === 'invoice' && ['open', 'overdue'].includes(vor.voucherStatus))) return fehler(res, 406, pfad, 'Invalid pursue action');
				} else if (art.typ === 'dunning') return fehler(res, 406, pfad, 'precedingSalesVoucherId required');
				const fertig = url.searchParams.get('finalize') === 'true' && art.typ !== 'dunning';
				const id = randomUUID();
				const t = jetzt();
				const nr = [...a.verkaufsbelege.values()].filter((x) => x.voucherType === art.typ && x.voucherNumber).length + 1;
				// Summen je Steuersatz: Zeilen auf Cent, Steuer je Satz auf die Summe
				let netto = 0;
				const jeSatz = new Map<number, number>();
				for (const p of body.lineItems) {
					if (p.type === 'text') continue;
					const n = Math.round(Number(p.quantity) * Number(p.unitPrice?.netAmount ?? 0) * 100);
					netto += n;
					const satz = Number(p.unitPrice?.taxRatePercentage ?? 0);
					jeSatz.set(satz, (jeSatz.get(satz) ?? 0) + n);
				}
				let steuer = 0;
				for (const [satz, n] of jeSatz) steuer += Math.round((n * satz) / 100);
				const beleg = {
					...body,
					id,
					organizationId: a.organisationId,
					createdDate: t,
					updatedDate: t,
					version: 1,
					voucherType: art.typ,
					voucherStatus: fertig ? 'open' : 'draft',
					voucherNumber: fertig ? `${art.praefix}${String(nr).padStart(4, '0')}` : null,
					totalPrice: { ...body.totalPrice, totalNetAmount: netto / 100, totalGrossAmount: (netto + steuer) / 100, totalTaxAmount: steuer / 100 },
					relatedVouchers: vor ? [{ id: vorId, voucherNumber: vor.voucherNumber, voucherType: vor.voucherType }] : []
				} as Record<string, any>;
				if (art.typ === 'invoice') {
					const tage = Number(body.paymentConditions?.paymentTermDuration ?? 0);
					beleg.dueDate = new Date(Date.parse(String(body.voucherDate).slice(0, 10)) + tage * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00.000+01:00';
					beleg.openAmount = (netto + steuer) / 100;
					beleg.paymentItems = [];
				}
				a.verkaufsbelege.set(id, beleg);
				if (art.typ !== 'dunning') a.belege.push(
					beleg_({ id, voucherType: art.typ, voucherStatus: beleg.voucherStatus, voucherNumber: beleg.voucherNumber, voucherDate: body.voucherDate, createdDate: t, updatedDate: t,
						dueDate: beleg.dueDate ?? null, contactId: kontaktId ?? null, contactName: body.address?.name ?? 'Kontakt', totalAmount: (netto + steuer) / 100, openAmount: beleg.openAmount ?? 0 })
				);
				if (vor && a.abSetztAngenommen && vor.voucherType === 'quotation') {
					vor.voucherStatus = 'accepted';
					const z = a.belege.find((x) => x.id === vorId);
					if (z) z.voucherStatus = 'accepted';
				}
				return antworte(201, { id, resourceUri: `https://api.lexware.io/v1/${vk[1]}/${id}`, createdDate: t, updatedDate: t, version: 1 });
			}
			if (vk[2] && req.method === 'GET') {
				const b = a.verkaufsbelege.get(vk[2]);
				if (!b || b.voucherType !== art.typ) return fehler(res, 404, pfad, 'Not Found');
				if (!vk[3]) return antworte(200, b);
				const acc = (req.headers.accept as string) ?? '*/*';
				if (!/(\*\/\*|application\/pdf)/.test(acc)) return fehler(res, 406, pfad, 'Not Acceptable');
				if (b.voucherStatus === 'draft' && !(b.voucherType === 'dunning' && a.mahnungPdf)) return fehler(res, 409, pfad, 'Conflict: draft has no document');
				const pdf = Buffer.from(`%PDF-1.4\n% Attrappe ${b.voucherType} ${b.voucherNumber}\n%%EOF\n`);
				res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${b.voucherType}_${b.voucherNumber}.pdf"` });
				return res.end(pdf);
			}
			return fehler(res, 405, pfad, 'Method Not Allowed');
		}
		return fehler(res, 404, pfad, 'Not Found');
	});
	a.festschreiben = (id) => {
		const b = a.verkaufsbelege.get(id);
		if (!b || b.voucherStatus !== 'draft') return;
		const nr = [...a.verkaufsbelege.values()].filter((x) => x.voucherType === b.voucherType && x.voucherNumber).length + 1;
		b.voucherStatus = 'open';
		b.voucherNumber = `RE${String(nr).padStart(4, '0')}`;
		b.updatedDate = jetzt();
		const z = a.belege.find((x) => x.id === id);
		if (z) Object.assign(z, { voucherStatus: 'open', voucherNumber: b.voucherNumber, updatedDate: b.updatedDate });
	};
	a.bezahle = (id, euro, datum = '2026-11-25') => {
		const b = a.verkaufsbelege.get(id);
		if (!b) return;
		b.paymentItems.push({ paymentItemType: 'manualPayment', postingDate: `${datum}T10:00:00.000+01:00`, amount: euro, currency: 'EUR' });
		b.openAmount = Math.round((b.openAmount - euro) * 100) / 100;
		if (b.openAmount <= 0) {
			b.openAmount = 0;
			b.voucherStatus = 'paid';
			b.paidDate = `${datum}T10:00:00.000+01:00`;
		}
		b.updatedDate = jetzt();
		const z = a.belege.find((x) => x.id === id);
		if (z) Object.assign(z, { voucherStatus: b.voucherStatus, openAmount: b.openAmount, updatedDate: b.updatedDate });
	};
	await new Promise<void>((ok) => server.listen(port, '127.0.0.1', ok));
	const echterPort = (server.address() as AddressInfo).port;
	return Object.assign(a, {
		url: `http://127.0.0.1:${echterPort}`,
		stop: () => new Promise<void>((ok) => (server.closeAllConnections(), server.close(() => ok())))
	}) as Attrappe;
}

const beleg_ = (t: Partial<Beleg>) => beleg(t);

/** Beleg für die Belegliste der Attrappe. */
export function beleg(teil: Partial<Beleg> = {}): Beleg {
	const t = '2026-11-14T10:00:00.000+01:00';
	return {
		id: randomUUID(),
		voucherType: 'invoice',
		voucherStatus: 'open',
		voucherNumber: 'RE1001',
		voucherDate: t,
		createdDate: t,
		updatedDate: t,
		dueDate: '2026-11-28T00:00:00.000+01:00',
		contactId: null,
		contactName: 'Musterfrau, Erika',
		totalAmount: 99.8,
		openAmount: 74.8,
		currency: 'EUR',
		archived: false,
		...teil
	};
}
