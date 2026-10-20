import { createHash, randomBytes } from 'node:crypto';
import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { holeAuftrag, listeAuftraege, sichtVon, type Sicht } from './auftraege';
import { UUID } from './kunden';
import { hatRecht, pruefeRecht } from './rechte';
import { darf } from './tarif';
import { istTag, tagesGrenzen } from '../zeit';

/**
 * Kundenportal – Verwaltung im CRM (Jamil msgs 2770–2774 Punkt 4, 2778, 2793; Migrationen 082 + 085).
 * Das Portal gehört dem KUNDEN: ein Link je Kunde (Kundenseite), das Portal zeigt alle freigegebenen Aufträge des
 * Kunden. Welche: Regel des Betriebs („alle aktiven“ oder „nur markierte“), je Auftrag überschreibbar.
 * Rechte: Modul `kundenportal` + `kundenportal.verwalten`; Aufträge nur in der eigenen Sicht (sichtVon), Angebote nur
 * mit „Angebote bearbeiten“ + „Preise sehen“. Einstellungen mit „Einstellungen“. Tokens: 32 Zufallsbytes
 * (base64url, 43 Zeichen), gespeichert nur als SHA-256 – den Link sieht man nur direkt nach dem Erzeugen.
 */

export type PortalZugriff = { k: Kontext; sicht: Sicht; preise: boolean };

export async function portalZugriff(locals: { nutzer: Nutzer | null }): Promise<PortalZugriff> {
	await darf(locals, 'kundenportal', 'kundenportal.verwalten');
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
export type PortalFreigabe = { sichtbar: boolean | null; status: boolean; termine: boolean; mitarbeiter: boolean; annahme: boolean };
export type PortalStand = {
	/** gilt die Regel „alle aktiven“ des Betriebs? */
	standard: 'alle_aktiven' | 'nur_markierte';
	/** wird der Auftrag im Portal gezeigt (Regel + Einstellung am Auftrag)? */
	imPortal: boolean;
	/** hat der Kunde einen gültigen Link? */
	kundeHatLink: boolean;
	kundeId: string | null;
	freigabe: PortalFreigabe;
	angebote: { id: string; nummer: string; status: string; geteilt: boolean }[];
	dateien: { id: string; name: string; typ: string; geteilt: boolean }[];
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const STANDARD_FREIGABE: PortalFreigabe = { sichtbar: null, status: true, termine: true, mitarbeiter: true, annahme: true };

async function auftragPruefen(z: { k: Kontext; sicht: Sicht }, auftragId: unknown) {
	if (typeof auftragId !== 'string' || !UUID.test(auftragId)) throw new ApiFehler(404, 'Auftrag nicht gefunden.');
	return holeAuftrag(z.k, z.sicht, auftragId);
}

/**
 * Portal-Link eines Kunden verwalten: nur mit voller Auftrags-Sicht („Alle Aufträge ansehen“) – der Link zeigt alle
 * freigegebenen Aufträge des Kunden, auch solche außerhalb einer eingeschränkten Sicht (sonst 403). Kunde muss im
 * Betrieb existieren (sonst 404).
 */
async function kundePruefen(z: PortalZugriff, kundeId: unknown): Promise<string> {
	if (!z.sicht.alle) throw new ApiFehler(403, 'Keine Berechtigung');
	if (typeof kundeId !== 'string' || !UUID.test(kundeId)) throw new ApiFehler(404, 'Kunde nicht gefunden.');
	const [kd] = await mitBetrieb(z.k, (tx) => tx`select id from app.kunden where id = ${kundeId} and betrieb_id = ${z.k.betriebId}`);
	if (!kd) throw new ApiFehler(404, 'Kunde nicht gefunden.');
	return kd.id;
}

/** SQL-Bedingung „Auftrag a ist im Portal“ (Regel des Betriebs, Einstellung am Auftrag). */
export const IM_PORTAL_SQL = `(coalesce(pa.sichtbar,
	coalesce((select e.standard from app.portal_einstellungen e where e.betrieb_id = a.betrieb_id), 'alle_aktiven') = 'alle_aktiven'
	and a.status <> 'abgerechnet'))`;

export async function portalStand(z: PortalZugriff, auftragId: string): Promise<PortalStand> {
	const { k } = z;
	const a = await auftragPruefen(z, auftragId);
	const id = a.id;
	return mitBetrieb(k, async (tx) => {
		const [f] = await tx`select sichtbar, status, termine, mitarbeiter, annahme from app.portal_auftrag where auftrag_id = ${id} and betrieb_id = ${k.betriebId}`;
		const [st] = await tx`
			select coalesce((select standard from app.portal_einstellungen where betrieb_id = ${k.betriebId}), 'alle_aktiven') as standard,
				${tx.unsafe(IM_PORTAL_SQL)} as im_portal
			from app.auftraege a left join app.portal_auftrag pa on pa.auftrag_id = a.id and pa.betrieb_id = a.betrieb_id
			where a.id = ${id} and a.betrieb_id = ${k.betriebId}`;
		const [l] = a.kundeId
			? await tx`select 1 from app.portal_links where kunde_id = ${a.kundeId} and betrieb_id = ${k.betriebId} and widerrufen_am is null and (laeuft_ab is null or laeuft_ab > now()) limit 1`
			: [];
		const geteilt = await tx`select art, ref_id from app.portal_dokumente where auftrag_id = ${id} and betrieb_id = ${k.betriebId}`;
		const ist = (art: string, ref: string) => geteilt.some((g) => g.art === art && g.ref_id === ref);
		// Angebote (Preise) nur, wer sie freigeben darf
		const angebote = z.preise ? await tx`select id, nummer, status from app.angebote where auftrag_id = ${id} and betrieb_id = ${k.betriebId} and status <> 'entwurf' order by angelegt` : [];
		const dateien = await tx`select id, name, typ from app.dateien where auftrag_id = ${id} and betrieb_id = ${k.betriebId} order by angelegt desc limit 200`;
		return {
			standard: st.standard,
			imPortal: st.im_portal === true,
			kundeHatLink: !!l,
			kundeId: a.kundeId,
			freigabe: f ? { sichtbar: f.sichtbar, status: f.status, termine: f.termine, mitarbeiter: f.mitarbeiter, annahme: f.annahme } : { ...STANDARD_FREIGABE },
			angebote: angebote.map((x) => ({ id: x.id, nummer: x.nummer, status: x.status, geteilt: ist('angebot', x.id) })),
			dateien: dateien.map((x) => ({ id: x.id, name: x.name, typ: x.typ, geteilt: ist('datei', x.id) }))
		};
	});
}

export type KundenPortal = { links: PortalLink[]; auftraege: { id: string; nummer: string; titel: string; imPortal: boolean }[] };

/** Portal eines Kunden (Kundenseite): Links und welche seiner Aufträge im Portal stehen. */
export async function kundenPortal(z: PortalZugriff, kundeId: unknown, jetzt = new Date()): Promise<KundenPortal> {
	const id = await kundePruefen(z, kundeId);
	const sichtbare = new Set((await listeAuftraege(z.k, z.sicht, { kundeId: id })).map((a) => a.id));
	return mitBetrieb(z.k, async (tx) => {
		const links = await tx`select * from app.portal_links where betrieb_id = ${z.k.betriebId} and kunde_id = ${id} order by angelegt desc limit 20`;
		const auftraege = await tx`
			select a.id, a.nummer, a.titel, ${tx.unsafe(IM_PORTAL_SQL)} as im_portal
			from app.auftraege a left join app.portal_auftrag pa on pa.auftrag_id = a.id and pa.betrieb_id = a.betrieb_id
			where a.betrieb_id = ${z.k.betriebId} and a.kunde_id = ${id} order by a.angelegt desc limit 50`;
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
			auftraege: auftraege.filter((a) => sichtbare.has(a.id)).map((a) => ({ id: a.id, nummer: a.nummer, titel: a.titel, imPortal: a.im_portal === true }))
		};
	});
}

/**
 * Portal-Link für einen Kunden erzeugen (ein gültiger Link je Kunde: ein älterer wird dabei widerrufen). `laeuftAb`
 * optional (Tag, gilt bis Tagesende Berlin). Das Token wird nur hier zurückgegeben. Versendete/angenommene Angebote der
 * Aufträge im Portal werden freigegeben, wenn der Nutzer Preise sehen und Angebote bearbeiten darf.
 */
export async function erzeugeLink(z: PortalZugriff, kundeId: unknown, laeuftAb?: unknown): Promise<{ token: string; id: string }> {
	const { k } = z;
	const id = await kundePruefen(z, kundeId);
	let ablauf: Date | null = null;
	if (laeuftAb !== undefined && laeuftAb !== null && laeuftAb !== '') {
		if (!istTag(laeuftAb)) throw new ApiFehler(400, 'Ungültiges Ablaufdatum.');
		ablauf = tagesGrenzen(laeuftAb).ende;
		if (ablauf <= new Date()) throw new ApiFehler(400, 'Das Ablaufdatum liegt in der Vergangenheit.');
	}
	const token = randomBytes(32).toString('base64url');
	const linkId = await mitBetrieb(k, async (tx) => {
		await tx`update app.portal_links set widerrufen_am = now() where kunde_id = ${id} and betrieb_id = ${k.betriebId} and widerrufen_am is null`;
		const [l] = await tx`
			insert into app.portal_links (betrieb_id, kunde_id, token_hash, laeuft_ab, angelegt_von)
			values (${k.betriebId}, ${id}, ${tokenHash(token)}, ${ablauf}, ${k.benutzerId}) returning id`;
		if (z.preise && z.sicht.alle) await teileAngeboteDesKunden(tx, k, id);
		return l.id as string;
	});
	return { token, id: linkId };
}

/**
 * Versendete/angenommene Angebote der Aufträge eines Kunden fürs Portal freigeben – nur Aufträge, die im Portal stehen
 * (Regel/„Im Portal zeigen“), und nur für Aufrufer mit voller Sicht und Preisrechten (geprüft in erzeugeLink).
 */
async function teileAngeboteDesKunden(tx: TransactionSql, k: Kontext, kundeId: string): Promise<void> {
	await tx`
		insert into app.portal_dokumente (betrieb_id, auftrag_id, art, ref_id)
		select ${k.betriebId}, an.auftrag_id, 'angebot', an.id from app.angebote an
		join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
		left join app.portal_auftrag pa on pa.auftrag_id = a.id and pa.betrieb_id = a.betrieb_id
		where a.kunde_id = ${kundeId} and an.betrieb_id = ${k.betriebId} and an.status in ('versendet', 'angenommen')
			and ${tx.unsafe(IM_PORTAL_SQL)}
		on conflict do nothing`;
}

export async function widerrufeLink(z: PortalZugriff, kundeId: unknown, linkId: unknown): Promise<void> {
	const { k } = z;
	const id = await kundePruefen(z, kundeId);
	if (typeof linkId !== 'string' || !UUID.test(linkId)) throw new ApiFehler(404, 'Link nicht gefunden.');
	const zeilen = await mitBetrieb(k, (tx) => tx`
		update app.portal_links set widerrufen_am = now()
		where id = ${linkId} and kunde_id = ${id} and betrieb_id = ${k.betriebId} and widerrufen_am is null returning id`);
	if (zeilen.length === 0) throw new ApiFehler(404, 'Link nicht gefunden oder schon widerrufen.');
}

/** Freigaben je Auftrag: im Portal sichtbar (leer = Regel), Status, Termine, Vornamen, Online-Annahme. */
export async function setzeFreigabe(z: PortalZugriff, auftragId: unknown, f: Partial<Record<keyof PortalFreigabe, unknown>>): Promise<void> {
	const { k } = z;
	const id = (await auftragPruefen(z, auftragId)).id;
	const b = (w: unknown) => w === true || w === 'ja' || w === 'on';
	const sichtbar = f.sichtbar === 'an' || f.sichtbar === true ? true : f.sichtbar === 'aus' || f.sichtbar === false ? false : null;
	await mitBetrieb(k, (tx) => tx`
		insert into app.portal_auftrag (auftrag_id, betrieb_id, sichtbar, status, termine, mitarbeiter, annahme)
		values (${id}, ${k.betriebId}, ${sichtbar}, ${b(f.status)}, ${b(f.termine)}, ${b(f.mitarbeiter)}, ${b(f.annahme)})
		on conflict (auftrag_id) do update set sichtbar = excluded.sichtbar, status = excluded.status, termine = excluded.termine,
			mitarbeiter = excluded.mitarbeiter, annahme = excluded.annahme`);
}

/** Dokument (Angebot oder Datei des Auftrags) fürs Portal freigeben bzw. zurücknehmen. */
export async function setzeDokument(z: PortalZugriff, auftragId: unknown, art: unknown, refId: unknown, geteilt: boolean): Promise<void> {
	const { k } = z;
	const id = (await auftragPruefen(z, auftragId)).id;
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

export type PortalEinstellungen = { agbUrl: string | null; widerrufUrl: string | null; abAutomatisch: boolean; standard: 'alle_aktiven' | 'nur_markierte' };

export async function ladePortalEinstellungen(k: Kontext): Promise<PortalEinstellungen> {
	const [e] = await mitBetrieb(k, (tx) => tx`select agb_url, widerruf_url, ab_automatisch, standard from app.portal_einstellungen where betrieb_id = ${k.betriebId}`);
	return { agbUrl: e?.agb_url ?? null, widerrufUrl: e?.widerruf_url ?? null, abAutomatisch: e?.ab_automatisch ?? true, standard: e?.standard ?? 'alle_aktiven' };
}

function url(w: unknown, name: string): string | null {
	if (w === undefined || w === null || w === '') return null;
	if (typeof w !== 'string' || !/^https?:\/\/[^\s<>"]+$/.test(w.trim()) || w.length > 500) throw new ApiFehler(400, `${name}: Bitte eine Adresse mit https:// eingeben.`);
	return w.trim();
}

export async function speicherePortalEinstellungen(k: Kontext, e: Record<string, unknown>): Promise<PortalEinstellungen> {
	const w: PortalEinstellungen = {
		agbUrl: url(e.agbUrl, 'AGB'),
		widerrufUrl: url(e.widerrufUrl, 'Widerrufsbelehrung'),
		abAutomatisch: e.abAutomatisch === true || e.abAutomatisch === 'ja' || e.abAutomatisch === 'on',
		standard: e.standard === 'nur_markierte' ? 'nur_markierte' : 'alle_aktiven'
	};
	await mitBetrieb(k, (tx) => tx`
		insert into app.portal_einstellungen (betrieb_id, agb_url, widerruf_url, ab_automatisch, standard)
		values (${k.betriebId}, ${w.agbUrl}, ${w.widerrufUrl}, ${w.abAutomatisch}, ${w.standard})
		on conflict (betrieb_id) do update set agb_url = excluded.agb_url, widerruf_url = excluded.widerruf_url,
			ab_automatisch = excluded.ab_automatisch, standard = excluded.standard`);
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
