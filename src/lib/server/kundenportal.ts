import { createHash, randomBytes } from 'node:crypto';
import { mitBetrieb, type Kontext } from './db';
import { ApiFehler } from './fehler';
import { holeAuftrag, sichtVon, type Sicht } from './auftraege';
import { UUID } from './kunden';
import { hatRecht, pruefeRecht } from './rechte';
import { darf } from './tarif';
import { istTag, tagesGrenzen } from '../zeit';

/**
 * Kundenportal – Verwaltung im CRM (Wunsch Jamil msgs 2770–2774 Punkt 4, Änderungen msg 2778; Migration 082).
 * Rechte: Modul `kundenportal` + „Aufträge bearbeiten“ für Links und Freigaben je Auftrag; Einstellungen (AGB-Link,
 * Auftragsbestätigung automatisch) mit „Einstellungen“. Tokens: 32 Zufallsbytes (base64url, 43 Zeichen); gespeichert
 * wird nur der SHA-256 – den Link sieht man nur direkt nach dem Erzeugen.
 */

/**
 * Zugriff auf die Portal-Verwaltung: Kontext, die echte Auftrags-Sicht des Nutzers (wer nur eigene Aufträge sieht,
 * verwaltet nur deren Portal) und ob er Angebote (Preise) freigeben darf („Angebote bearbeiten“ + „Preise sehen“).
 */
export type PortalZugriff = { k: Kontext; sicht: Sicht; preise: boolean };

export async function portalZugriff(locals: { nutzer: Nutzer | null }): Promise<PortalZugriff> {
	await darf(locals, 'kundenportal', 'auftraege.bearbeiten');
	const n = locals.nutzer!;
	return {
		k: { betriebId: n.betriebId!, benutzerId: n.id },
		sicht: sichtVon(n),
		preise: hatRecht(n, 'preise.sehen') && hatRecht(n, 'angebote.bearbeiten')
	};
}

export async function portalEinstellungsZugriff(locals: { nutzer: Nutzer | null }): Promise<Kontext> {
	pruefeRecht(locals, 'einstellungen');
	await darf(locals, 'angebote', 'einstellungen');
	const n = locals.nutzer!;
	return { betriebId: n.betriebId!, benutzerId: n.id };
}

export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43}$/;
export const tokenHash = (token: string) => createHash('sha256').update(token).digest();

export type PortalLink = { id: string; angelegt: string; laeuftAb: string | null; widerrufen: string | null; letzterZugriff: string | null; zugriffe: number; gueltig: boolean };
export type PortalFreigabe = { status: boolean; termine: boolean; mitarbeiter: boolean; annahme: boolean };
export type PortalStand = {
	links: PortalLink[];
	freigabe: PortalFreigabe;
	/** abAutomatisch des Auftrags: null = wie im Betrieb */
	abAutomatisch: boolean | null;
	abBetrieb: boolean;
	angebote: { id: string; nummer: string; status: string; geteilt: boolean }[];
	dateien: { id: string; name: string; typ: string; geteilt: boolean }[];
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const STANDARD_FREIGABE: PortalFreigabe = { status: true, termine: true, mitarbeiter: true, annahme: true };

async function auftragPruefen(z: { k: Kontext; sicht: Sicht }, auftragId: unknown): Promise<string> {
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	return (await holeAuftrag(z.k, z.sicht, auftragId)).id;
}

export async function portalStand(z: PortalZugriff, auftragId: string, jetzt = new Date()): Promise<PortalStand> {
	const { k } = z;
	const id = await auftragPruefen(z, auftragId);
	return mitBetrieb(k, async (tx) => {
		const links = await tx`select * from app.portal_links where betrieb_id = ${k.betriebId} and auftrag_id = ${id} order by angelegt desc`;
		const [f] = await tx`select status, termine, mitarbeiter, annahme from app.portal_auftrag where auftrag_id = ${id} and betrieb_id = ${k.betriebId}`;
		const [a] = await tx`select ab_automatisch from app.auftraege where id = ${id} and betrieb_id = ${k.betriebId}`;
		const [e] = await tx`select ab_automatisch from app.portal_einstellungen where betrieb_id = ${k.betriebId}`;
		const geteilt = await tx`select art, ref_id from app.portal_dokumente where auftrag_id = ${id} and betrieb_id = ${k.betriebId}`;
		const ist = (art: string, ref: string) => geteilt.some((g) => g.art === art && g.ref_id === ref);
		// Angebote (Preise) nur, wer sie freigeben darf
		const angebote = z.preise ? await tx`select id, nummer, status from app.angebote where auftrag_id = ${id} and betrieb_id = ${k.betriebId} and status <> 'entwurf' order by angelegt` : [];
		const dateien = await tx`select id, name, typ from app.dateien where auftrag_id = ${id} and betrieb_id = ${k.betriebId} order by angelegt desc limit 200`;
		return {
			links: links.map((l) => ({
				id: l.id,
				angelegt: iso(l.angelegt)!,
				laeuftAb: iso(l.laeuft_ab),
				widerrufen: iso(l.widerrufen_am),
				letzterZugriff: iso(l.letzter_zugriff),
				zugriffe: l.zugriffe,
				gueltig: !l.widerrufen_am && (!l.laeuft_ab || new Date(l.laeuft_ab) > jetzt)
			})),
			freigabe: f ? { status: f.status, termine: f.termine, mitarbeiter: f.mitarbeiter, annahme: f.annahme } : { ...STANDARD_FREIGABE },
			abAutomatisch: a?.ab_automatisch ?? null,
			abBetrieb: e?.ab_automatisch ?? true,
			angebote: angebote.map((x) => ({ id: x.id, nummer: x.nummer, status: x.status, geteilt: ist('angebot', x.id) })),
			dateien: dateien.map((x) => ({ id: x.id, name: x.name, typ: x.typ, geteilt: ist('datei', x.id) }))
		};
	});
}

/**
 * Neuen Portal-Link für einen Auftrag erzeugen. `laeuftAb` optional (Tag, gilt bis Tagesende Berlin). Das Token wird
 * nur hier zurückgegeben. Beim ersten Link wird die Standard-Freigabe angelegt; angenommene/versendete Angebote und das
 * Status/Termine-Paket sind dann direkt sichtbar (Chef kann alles abwählen).
 */
export async function erzeugeLink(z: PortalZugriff, auftragId: unknown, laeuftAb?: unknown): Promise<{ token: string; id: string }> {
	const { k } = z;
	const id = await auftragPruefen(z, auftragId);
	let ablauf: Date | null = null;
	if (laeuftAb !== undefined && laeuftAb !== null && laeuftAb !== '') {
		if (!istTag(laeuftAb)) throw new ApiFehler(400, 'Ungültiges Ablaufdatum.');
		ablauf = tagesGrenzen(laeuftAb).ende;
		if (ablauf <= new Date()) throw new ApiFehler(400, 'Das Ablaufdatum liegt in der Vergangenheit.');
	}
	const token = randomBytes(32).toString('base64url');
	const linkId = await mitBetrieb(k, async (tx) => {
		const [{ anzahl }] = await tx`select count(*)::int as anzahl from app.portal_links where auftrag_id = ${id} and betrieb_id = ${k.betriebId} and widerrufen_am is null`;
		if (anzahl >= 10) throw new ApiFehler(409, 'Höchstens 10 gültige Links je Auftrag – bitte alte widerrufen.');
		const [l] = await tx`
			insert into app.portal_links (betrieb_id, auftrag_id, token_hash, laeuft_ab, angelegt_von)
			values (${k.betriebId}, ${id}, ${tokenHash(token)}, ${ablauf}, ${k.benutzerId}) returning id`;
		await tx`insert into app.portal_auftrag (auftrag_id, betrieb_id) values (${id}, ${k.betriebId}) on conflict do nothing`;
		// Angebote (mit Preisen) nur freigeben, wenn der Nutzer selbst Preise sehen und Angebote bearbeiten darf
		if (z.preise) {
			await tx`
				insert into app.portal_dokumente (betrieb_id, auftrag_id, art, ref_id)
				select ${k.betriebId}, ${id}, 'angebot', an.id from app.angebote an
				where an.auftrag_id = ${id} and an.betrieb_id = ${k.betriebId} and an.status in ('versendet', 'angenommen')
				on conflict do nothing`;
		}
		return l.id as string;
	});
	return { token, id: linkId };
}

export async function widerrufeLink(z: PortalZugriff, auftragId: unknown, linkId: unknown): Promise<void> {
	const { k } = z;
	const id = await auftragPruefen(z, auftragId);
	if (typeof linkId !== 'string' || !UUID.test(linkId)) throw new ApiFehler(404, 'Link nicht gefunden.');
	const zeilen = await mitBetrieb(k, (tx) => tx`
		update app.portal_links set widerrufen_am = now()
		where id = ${linkId} and auftrag_id = ${id} and betrieb_id = ${k.betriebId} and widerrufen_am is null returning id`);
	if (zeilen.length === 0) throw new ApiFehler(404, 'Link nicht gefunden oder schon widerrufen.');
}

export async function setzeFreigabe(z: PortalZugriff, auftragId: unknown, f: Partial<Record<keyof PortalFreigabe, unknown>>): Promise<void> {
	const { k } = z;
	const id = await auftragPruefen(z, auftragId);
	const b = (w: unknown) => w === true || w === 'ja' || w === 'on';
	await mitBetrieb(k, (tx) => tx`
		insert into app.portal_auftrag (auftrag_id, betrieb_id, status, termine, mitarbeiter, annahme)
		values (${id}, ${k.betriebId}, ${b(f.status)}, ${b(f.termine)}, ${b(f.mitarbeiter)}, ${b(f.annahme)})
		on conflict (auftrag_id) do update set status = excluded.status, termine = excluded.termine,
			mitarbeiter = excluded.mitarbeiter, annahme = excluded.annahme`);
}

/** Dokument (Angebot oder Datei des Auftrags) fürs Portal freigeben bzw. zurücknehmen. */
export async function setzeDokument(z: PortalZugriff, auftragId: unknown, art: unknown, refId: unknown, geteilt: boolean): Promise<void> {
	const { k } = z;
	const id = await auftragPruefen(z, auftragId);
	if (art !== 'angebot' && art !== 'datei') throw new ApiFehler(400, 'Unbekannte Art.');
	if (art === 'angebot' && !z.preise) throw new ApiFehler(403, 'Keine Berechtigung');
	if (typeof refId !== 'string' || !UUID.test(refId)) throw new ApiFehler(404, 'Dokument nicht gefunden.');
	await mitBetrieb(k, async (tx) => {
		const [da] = art === 'angebot'
			? await tx`select 1 from app.angebote where id = ${refId} and auftrag_id = ${id} and betrieb_id = ${k.betriebId} and status <> 'entwurf'`
			: await tx`select 1 from app.dateien where id = ${refId} and auftrag_id = ${id} and betrieb_id = ${k.betriebId}`;
		if (!da) throw new ApiFehler(404, 'Dokument nicht gefunden.');
		if (geteilt) {
			await tx`insert into app.portal_dokumente (betrieb_id, auftrag_id, art, ref_id) values (${k.betriebId}, ${id}, ${art}, ${refId}) on conflict do nothing`;
		} else {
			await tx`delete from app.portal_dokumente where betrieb_id = ${k.betriebId} and auftrag_id = ${id} and art = ${art} and ref_id = ${refId}`;
		}
	});
}

/** Auftragsbestätigung automatisch je Auftrag: true/false oder null (= wie im Betrieb). */
export async function setzeAbAutomatisch(z: { k: Kontext; sicht: Sicht }, auftragId: unknown, wert: boolean | null): Promise<void> {
	const { k } = z;
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	await holeAuftrag(k, z.sicht, auftragId);
	await mitBetrieb(k, (tx) => tx`update app.auftraege set ab_automatisch = ${wert} where id = ${auftragId} and betrieb_id = ${k.betriebId}`);
}

export type PortalEinstellungen = { agbUrl: string | null; widerrufUrl: string | null; abAutomatisch: boolean };

export async function ladePortalEinstellungen(k: Kontext): Promise<PortalEinstellungen> {
	const [e] = await mitBetrieb(k, (tx) => tx`select agb_url, widerruf_url, ab_automatisch from app.portal_einstellungen where betrieb_id = ${k.betriebId}`);
	return { agbUrl: e?.agb_url ?? null, widerrufUrl: e?.widerruf_url ?? null, abAutomatisch: e?.ab_automatisch ?? true };
}

function url(w: unknown, name: string): string | null {
	if (w === undefined || w === null || w === '') return null;
	if (typeof w !== 'string' || !/^https?:\/\/[^\s<>"]+$/.test(w.trim()) || w.length > 500) throw new ApiFehler(400, `${name}: Bitte eine Adresse mit https:// eingeben.`);
	return w.trim();
}

export async function speicherePortalEinstellungen(k: Kontext, e: Record<string, unknown>): Promise<PortalEinstellungen> {
	const w = { agbUrl: url(e.agbUrl, 'AGB'), widerrufUrl: url(e.widerrufUrl, 'Widerrufsbelehrung'), abAutomatisch: e.abAutomatisch === true || e.abAutomatisch === 'ja' || e.abAutomatisch === 'on' };
	await mitBetrieb(k, (tx) => tx`
		insert into app.portal_einstellungen (betrieb_id, agb_url, widerruf_url, ab_automatisch)
		values (${k.betriebId}, ${w.agbUrl}, ${w.widerrufUrl}, ${w.abAutomatisch})
		on conflict (betrieb_id) do update set agb_url = excluded.agb_url, widerruf_url = excluded.widerruf_url, ab_automatisch = excluded.ab_automatisch`);
	return w;
}

const zeitFormat = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Verlauf des Auftrags: Kundenaktionen im Portal, Entscheidungen zum Angebot, Auftragsbestätigungen, Portal-Links. */
export async function portalVerlauf(k: Kontext, auftragId: string): Promise<{ iso: string; zeile: { id: string; zeit: string; wer: string; titel: string; aenderungen: { feld: string; alt: string; neu: string }[] } }[]> {
	return mitBetrieb(k, async (tx) => {
		const ereignisse = await tx`select id, art, text, zeit from app.portal_ereignisse where auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId} and art <> 'aufruf' order by zeit desc limit 50`;
		const [aufrufe] = await tx`select count(*)::int as n, max(zeit) as zuletzt from app.portal_ereignisse where auftrag_id = ${auftragId} and betrieb_id = ${k.betriebId} and art = 'aufruf'`;
		const abs = await tx`
			select a.id::text as id, a.zeit, a.aktion, a.vorher, a.nachher, a.quelle, b.name
			from app.aenderungen a left join app.benutzer b on b.id = a.benutzer_id
			where a.betrieb_id = ${k.betriebId} and a.tabelle in ('auftragsbestaetigungen', 'portal_links')
				and coalesce(a.nachher ->> 'auftrag_id', a.vorher ->> 'auftrag_id') = ${auftragId}
			order by a.id desc limit 50`;
		const aus = [];
		for (const e of ereignisse) {
			aus.push({ iso: new Date(e.zeit).toISOString(), zeile: { id: `pe${e.id}`, zeit: zeitFormat.format(new Date(e.zeit)), wer: 'Kunde (Kundenportal)', titel: e.text ?? e.art, aenderungen: [] } });
		}
		if (aufrufe?.n > 0) {
			aus.push({ iso: new Date(aufrufe.zuletzt).toISOString(), zeile: { id: 'pe-aufrufe', zeit: zeitFormat.format(new Date(aufrufe.zuletzt)), wer: 'Kunde (Kundenportal)', titel: `Kundenportal ${aufrufe.n}× geöffnet (zuletzt)`, aenderungen: [] } });
		}
		for (const a of abs) {
			let titel: string | null = null;
			const wer = a.name ?? (a.quelle === 'kundenportal' ? 'Kunde (Kundenportal)' : 'System');
			if (a.nachher?.nummer && a.aktion === 'angelegt') titel = `Auftragsbestätigung ${a.nachher.nummer} erstellt${a.nachher.versand_status === 'gesendet' ? ' und gesendet' : ' – bereit zum Versand'}`;
			else if (a.nachher?.nummer && a.vorher?.versand_status === 'bereit' && a.nachher.versand_status === 'gesendet') titel = `Auftragsbestätigung ${a.nachher.nummer} als gesendet markiert`;
			else if (a.aktion === 'angelegt' && a.nachher && !a.nachher.nummer) titel = `Kundenportal-Link erzeugt${a.nachher.laeuft_ab ? ` (gültig bis ${zeitFormat.format(new Date(a.nachher.laeuft_ab)).slice(0, 10)})` : ''}`;
			else if (a.vorher && !a.vorher.widerrufen_am && a.nachher?.widerrufen_am) titel = 'Kundenportal-Link widerrufen';
			if (titel) aus.push({ iso: new Date(a.zeit).toISOString(), zeile: { id: `pa${a.id}`, zeit: zeitFormat.format(new Date(a.zeit)), wer, titel, aenderungen: [] } });
		}
		return aus;
	});
}
