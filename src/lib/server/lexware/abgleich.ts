import { ApiFehler } from '../fehler';
import { mitBetrieb, type Kontext } from '../db';
import { berlinTag } from '../../zeit';
import { LexwareFehler } from './client';
import { stelleEin, type Handler } from './warteschlange';

/**
 * Rückmeldungen einrichten (Event-Subscriptions) und Belege aus Lexware spiegeln (Plan Task T3).
 * Doku https://developers.lexware.io/docs/: POST /v1/event-subscriptions {eventType, callbackUrl} (doppelt → 409,
 * Callback-URL muss per HEAD erreichbar sein, sonst 406); GET /v1/voucherlist (voucherType/voucherStatus Pflicht,
 * size ≤ 250, updatedDateFrom yyyy-MM-dd). Beträge kommen als Dezimalzahl → im CRM in Cent.
 */

export const ABO_TYPEN = [
	'contact.changed',
	'contact.deleted',
	'quotation.changed',
	'quotation.status.changed',
	'order-confirmation.status.changed',
	'invoice.changed',
	'invoice.status.changed',
	'invoice.deleted',
	'credit-note.status.changed',
	'down-payment-invoice.status.changed',
	'dunning.created',
	'dunning.changed',
	'payment.changed',
	'token.revoked'
] as const;

export const BELEG_TYPEN = 'quotation,orderconfirmation,invoice,downpaymentinvoice,creditnote';

/** Öffentliche Adresse für die Rückmeldungen (Lexware braucht HTTPS von außen). */
export function webhookUrl(origin = process.env.ORIGIN): string | null {
	const o = origin?.trim().replace(/\/$/, '');
	if (!o || !/^https:\/\/[^/\s]+$/.test(o)) return null;
	return `${o}/api/lexware/ereignis`;
}

export const abosEinrichten: Handler = {
	async ausfuehren(c, n, k) {
		const url = typeof n.callbackUrl === 'string' ? n.callbackUrl : null;
		if (!url) throw new ApiFehler(400, 'Keine Webhook-Adresse.');
		const vorhanden = await c.get<{ content: { subscriptionId: string; eventType: string; callbackUrl: string }[] }>('/v1/event-subscriptions');
		const unsere = await mitBetrieb(k, (tx) => tx`select event_type, lexware_id, callback_url from app.lexware_abos where betrieb_id = ${k.betriebId}`);
		// eigene alte Abos mit anderer Adresse abbestellen (fremde nie anfassen)
		for (const u of unsere)
			if (u.callback_url !== url && u.lexware_id) await c.del(`/v1/event-subscriptions/${u.lexware_id}`).catch((e) => { if (!(e instanceof LexwareFehler && e.art === 'nicht_gefunden')) throw e; });
		let neu = 0;
		for (const typ of ABO_TYPEN) {
			let id = vorhanden.content.find((x) => x.eventType === typ && x.callbackUrl === url)?.subscriptionId ?? null;
			if (!id) {
				try {
					id = (await c.post<{ id: string }>('/v1/event-subscriptions', { eventType: typ, callbackUrl: url })).id;
					neu++;
				} catch (e) {
					if (!(e instanceof LexwareFehler && e.art === 'konflikt')) throw e;
				}
			}
			await mitBetrieb(k, (tx) => tx`
				insert into app.lexware_abos (betrieb_id, event_type, lexware_id, callback_url) values (${k.betriebId}, ${typ}, ${id}, ${url})
				on conflict (betrieb_id, event_type) do update set lexware_id = excluded.lexware_id, callback_url = excluded.callback_url, angelegt = now()`);
		}
		return { ergebnis: { neu, gesamt: ABO_TYPEN.length } };
	}
};

type Eintrag = {
	id: string; voucherType: string; voucherStatus: string; voucherNumber: string | null; voucherDate: string | null; updatedDate: string | null;
	dueDate: string | null; contactId: string | null; contactName: string | null; totalAmount: number | null; openAmount: number | null; currency: string | null; archived: boolean;
};
const cent = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) : null);
const datum = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
const UUIDX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const belegeAbgleichen: Handler = {
	async ausfuehren(c, n, k) {
		const seit = typeof n.seit === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.seit) ? n.seit : null;
		let gelesen = 0;
		for (let seite = 0; seite < 40; seite++) {
			const r = await c.get<{ content: Eintrag[]; last: boolean }>(
				`/v1/voucherlist?voucherType=${BELEG_TYPEN}&voucherStatus=any&size=250&page=${seite}${seit ? `&updatedDateFrom=${seit}` : ''}`
			);
			for (const b of r.content) {
				if (!UUIDX.test(b.id ?? '')) continue;
				gelesen++;
				const kontakt = b.contactId && UUIDX.test(b.contactId) ? b.contactId : null;
				await mitBetrieb(k, (tx) => tx`
					insert into app.lexware_belege (betrieb_id, lexware_id, typ, nummer, status, datum, faellig, brutto_cent, offen_cent, waehrung,
						kontakt_id, kontakt_name, kunde_id, archiviert, geaendert_lexware, veraltet, stand)
					values (${k.betriebId}, ${b.id}, ${String(b.voucherType).slice(0, 40)}, ${b.voucherNumber ? String(b.voucherNumber).slice(0, 100) : null},
						${String(b.voucherStatus).slice(0, 40)}, ${datum(b.voucherDate)}, ${datum(b.dueDate)}, ${cent(b.totalAmount)}, ${cent(b.openAmount)},
						${b.currency ? String(b.currency).slice(0, 3) : null}, ${kontakt}, ${b.contactName ? String(b.contactName).slice(0, 300) : null},
						(select id from app.kunden where betrieb_id = ${k.betriebId} and lexware_id = ${kontakt}), ${b.archived === true},
						${b.updatedDate ?? null}, false, now())
					on conflict (betrieb_id, lexware_id) do update set typ = excluded.typ, nummer = excluded.nummer, status = excluded.status,
						datum = excluded.datum, faellig = excluded.faellig, brutto_cent = excluded.brutto_cent, offen_cent = excluded.offen_cent,
						waehrung = excluded.waehrung, kontakt_id = excluded.kontakt_id, kontakt_name = excluded.kontakt_name, kunde_id = excluded.kunde_id,
						archiviert = excluded.archiviert, geaendert_lexware = excluded.geaendert_lexware, veraltet = false, stand = now()`);
			}
			if (r.last || r.content.length === 0) break;
		}
		await mitBetrieb(k, (tx) => tx`update app.lexware_konfig set letzter_abgleich = now() where betrieb_id = ${k.betriebId}`);
		return { ergebnis: { gelesen } };
	}
};

/** „Lexware-Abgleich starten“ (Knopf/Sprache): Belege + Kunden, höchstens einmal je Minute. */
export async function starteAbgleich(k: Kontext): Promise<{ belege: boolean; kunden: boolean }> {
	const m = new Date().toISOString().slice(0, 16);
	const b = await stelleEin(k, { art: 'belege_abgleichen', nutzlast: {}, idempotenz: `belege_abgleichen:manuell:${m}` });
	const kd = await stelleEin(k, { art: 'kontakte_abgleichen', idempotenz: `kontakte_abgleichen:${m}` });
	return { belege: b.neu, kunden: kd.neu };
}

/** „Rückmeldungen einrichten“: braucht eine öffentliche HTTPS-Adresse (ORIGIN). */
export async function starteAboEinrichtung(k: Kontext, origin = process.env.ORIGIN): Promise<{ id: string; neu: boolean; url: string }> {
	const url = webhookUrl(origin);
	if (!url) throw new ApiFehler(409, 'Rückmeldungen gehen nur, wenn das CRM öffentlich per HTTPS erreichbar ist (ORIGIN = https://…).');
	const r = await stelleEin(k, { art: 'abos_einrichten', nutzlast: { callbackUrl: url }, idempotenz: `abos_einrichten:${url}:${new Date().toISOString().slice(0, 16)}` });
	return { ...r, url };
}

/** Nächtlicher Abgleich ab 02:00 (Berlin), einmal je Tag; Protokoll älter als 90 Tage löschen. */
export async function naechtlicherAbgleich(k: Kontext, jetzt = new Date()): Promise<boolean> {
	const teil = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).formatToParts(jetzt).find((p) => p.type === 'hour');
	const stunde = Number(teil?.value);
	if (!Number.isFinite(stunde) || stunde < 2) return false;
	const tag = berlinTag(jetzt);
	const [z] = await mitBetrieb(k, (tx) => tx`
		update app.lexware_konfig set abgleich_tag = ${tag} where betrieb_id = ${k.betriebId} and (abgleich_tag is null or abgleich_tag < ${tag})
		returning (letzter_abgleich - interval '1 day')::date as seit`);
	if (!z) return false;
	await stelleEin(k, { art: 'belege_abgleichen', nutzlast: z.seit ? { seit: berlinTag(new Date(z.seit)) } : {}, idempotenz: `belege_abgleichen:nacht:${tag}` });
	await stelleEin(k, { art: 'kontakte_abgleichen', idempotenz: `kontakte_abgleichen:nacht:${tag}` });
	await mitBetrieb(k, (tx) => tx`delete from app.lexware_protokoll where betrieb_id = ${k.betriebId} and zeit < now() - interval '90 days'`);
	return true;
}
