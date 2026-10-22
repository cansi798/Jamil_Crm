import { createHmac, randomBytes } from 'node:crypto';
import { alsOeffentlich, mitBetrieb, OEFFENTLICH, systemAbfrage, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { erzeugeBegrenzung } from './auth/ratelimit';
import { ladePdfDaten } from './angebote';
import { holeLogo, holeProfil, type LogoVariante } from './betriebsprofil';
import { portalLogo, type PortalLogo } from '../portal-kopf';
import { portalStatusName } from '../portal-status';
import { angebotPdf } from './pdf/angebot-pdf';
import { sendePush } from './erinnerungen';
import { zustaendig } from './auftragsbestaetigung';
import { melde } from './ereignisse';
import { agbFassung, holeAgbPdf, IM_PORTAL_SQL, TOKEN_MUSTER, tokenHash } from './kundenportal';
import { UUID } from './kunden';
import { nurVorname } from '../buchung';
import type { AuftragStatus } from '../auftrag-status';
import { summen, istMwstSatz } from '../geld';
import { berlinTag, berlinUhrzeit, tagKurz } from '../zeit';
import { anzeigeDateiname } from '../dateiname';
import { figurFuer, istAnrede, teamRolle, type Figur } from '../portal-figur';

/**
 * Kundenportal ohne Anmeldung (/portal/<Token>; Jamil msgs 2770–2774 Punkt 4 und 2778).
 *
 * Sicherheit: Das Token (32 Zufallsbytes) löst nur die SECURITY-DEFINER-Funktion `app.portal_link_aufloesen` (über
 * crm_auth) als SHA-256 auf; danach läuft alles als crm_app mit RLS im Kontext genau dieses Betriebs und nur für den
 * Auftrag (bzw. die freigegebenen Aufträge des Kunden) des Links. Nach außen gehen nur, was der Chef freigegeben hat:
 * Status, Termine mit Zeitfenster, Vornamen der Mitarbeiter, freigegebene Angebote/Dateien, Auftragsbestätigungen –
 * keine anderen Kunden, keine Preise anderer Angebote, keine internen Notizen. Begrenzung je IP (im Speicher).
 * Annahme ohne Unterschrift (msg 2778): Bestätigungsschritt + Häkchen „AGB gelesen“; Nachweis mit Zeit, Hash des
 * Tokens und Hash der IP (HMAC mit Server-Geheimnis, nie die IP selbst).
 */

export const portalAbruf = erzeugeBegrenzung({ max: 120, fensterMs: 10 * 60_000 });
export const portalAktion = erzeugeBegrenzung({ max: 10, fensterMs: 60 * 60_000 });
export const portalFehlversuch = erzeugeBegrenzung({ max: 20, fensterMs: 60 * 60_000 });

let pfeffer: string | null = null;
export function ipHash(ip: string): Buffer {
	const g = process.env.CRM_VORSCHLAG_GEHEIMNIS;
	pfeffer ??= g && g.length >= 32 ? `portal-ip:${g}` : randomBytes(32).toString('hex');
	return createHmac('sha256', pfeffer).update(ip).digest();
}

type PortalKontext = { linkId: string; betriebId: string; auftragId: string | null; kundeId: string | null; hash: Buffer };

const nichtGefunden = () => new ApiFehler(404, 'Dieser Link ist nicht (mehr) gültig.');

function begrenze(ip: string, art: 'abruf' | 'aktion'): void {
	if (!portalFehlversuch.pruefeVersuch(`sperre:${ip}`, Date.now()).erlaubt) {
		// zählt nicht doppelt: der Eintrag wird nur bei Fehlversuchen gefüllt (siehe loeseAuf)
	}
	const g = art === 'abruf' ? portalAbruf : portalAktion;
	if (!g.pruefeVersuch(`ip:${ip}`).erlaubt) throw new ApiFehler(429, 'Zu viele Anfragen – bitte später erneut versuchen.');
}

/** Token → Link (oder null). Zu viele falsche Tokens von einer IP → 429 (Durchprobieren). */
export async function loeseAuf(token: unknown, ip: string): Promise<PortalKontext | null> {
	const gesperrt = () => new ApiFehler(429, 'Zu viele ungültige Links – bitte später erneut versuchen.');
	if (typeof token !== 'string' || !TOKEN_MUSTER.test(token)) {
		if (!portalFehlversuch.pruefeVersuch(`ip:${ip}`).erlaubt) throw gesperrt();
		return null;
	}
	const hash = tokenHash(token);
	const [z] = await systemAbfrage((sql) => sql`select * from app.portal_link_aufloesen(${hash})`);
	if (!z) {
		if (!portalFehlversuch.pruefeVersuch(`ip:${ip}`).erlaubt) throw gesperrt();
		return null;
	}
	return { linkId: z.link_id, betriebId: z.betrieb_id, auftragId: z.auftrag_id, kundeId: z.kunde_id, hash };
}

/** Person im Portal: Name nach Einstellung, Comic-Figur nach Rolle und Anrede (msg 3113). */
export type PortalPerson = { name: string; figur: Figur };
export type PortalTermin = { tag: string; von: string; bis: string; art: string; mitarbeiter: string[] };
/** Arbeitsschritt fürs Portal: Aufgabe des Auftrags mit Lautstärke/Schmutz (1 gering … 3 hoch) – ohne Beschreibung. */
export type PortalSchritt = { titel: string; erledigt: boolean; tag: string | null; vonTag: string | null; laerm: number | null; schmutz: number | null };
export type PortalAngebot = { id: string; nummer: string; datum: string; gueltigBis: string; status: string; bruttoCent: number; annehmbar: boolean; entscheidung: { art: string; name: string; zeit: string } | null };
export type PortalAuftrag = {
	id: string;
	nummer: string;
	titel: string;
	status: { schluessel: AuftragStatus; name: string } | null;
	termine: PortalTermin[] | null;
	angebote: PortalAngebot[];
	/** freigegebene Dateien; `art`: Foto (Bild), Protokoll (PDF eines Protokolls) oder Dokument */
	dateien: { id: string; name: string; typ: string; datum: string; art: 'foto' | 'protokoll' | 'dokument' }[];
	auftragsbestaetigungen: { id: string; nummer: string; datum: string }[];
	/** Ausdrücklich freigegebene Notizen (msg 3070) – nie andere. */
	notizen: { id: string; text: string; datum: string; von: string | null }[];
	/** Links, die ausdrücklich fürs Portal freigegeben sind (Jamil msg 2850; Standard aus) – ohne interne Notiz. */
	links: { titel: string; url: string }[];
	/** Arbeitsschritte ab „beauftragt“ (msg 2848) – nur mit freigegebenem Status; sonst null. */
	schritte: PortalSchritt[] | null;
	/** Ansprechpartner (msg 2851) – Name nach Einstellung „Namen im Portal“; null bei „keine Namen“. Figur: msg 3113. */
	ansprechpartner: PortalPerson | null;
	/** Mitarbeiter am Auftrag (Zuständige + kommende Termine) – leer bei „keine Namen“ oder Schalter aus. */
	team: PortalPerson[];
};
/** Erscheinungsbild des Portals je Betrieb (Migration 096, msg 2953) – leer = Standard */
export type PortalMarke = { dunkel: string | null; hintergrund: string | null; titelSchrift: 'montserrat' | 'inter'; textSchrift: 'inter' | 'opensans'; titelGross: boolean };
export type PortalSeite = {
	betrieb: { name: string; telefon: string | null; email: string | null; web: string | null; /** Logo im Kopf je nach Kopffarbe (msgs 3088, 3126) */ logo: PortalLogo | null; farbe: string | null; marke: PortalMarke };
	agbUrl: string | null;
	/** Bestandskunde (Jamil msg 3142): mind. ein Auftrag des Kunden ist abgeschlossen („Projekt erfolgreich beendet“) */
	bestandskunde: boolean;
	/** AGB als PDF (msg 3030): Stand der hinterlegten Fassung; abrufbar unter /portal/<token>/agb */
	agbPdf: { stand: string } | null;
	widerrufUrl: string | null;
	auftraege: PortalAuftrag[];
};

async function auftraegeImBereich(tx: TransactionSql, p: PortalKontext): Promise<string[]> {
	if (p.auftragId) return [p.auftragId];
	// Alle Aufträge des Kunden, die im Portal stehen (Regel des Betriebs, je Auftrag überschreibbar – msg 2793)
	const z = await tx`
		select a.id from app.auftraege a left join app.portal_auftrag pa on pa.auftrag_id = a.id and pa.betrieb_id = a.betrieb_id
		where a.betrieb_id = ${p.betriebId} and a.kunde_id = ${p.kundeId} and ${tx.unsafe(IM_PORTAL_SQL)}
		order by a.angelegt desc limit 20`;
	return z.map((r) => r.id as string);
}

/**
 * Hat der Kunde dieses Links schon einen abgeschlossenen Auftrag (Status `abgerechnet`)? Auch wenn das Portal nur
 * aktive Aufträge zeigt – nach außen geht nur ja/nein (Karte „Auch nach Projektabschluss für Sie da“, msg 3142).
 */
async function istBestandskunde(tx: TransactionSql, p: PortalKontext): Promise<boolean> {
	const [z] = await tx`
		select exists (
			select 1 from app.auftraege a
			where a.betrieb_id = ${p.betriebId} and a.status = 'abgerechnet'
				and a.kunde_id = coalesce(${p.kundeId}::uuid, (select x.kunde_id from app.auftraege x where x.id = ${p.auftragId}::uuid and x.betrieb_id = ${p.betriebId}))
		) as ja`;
	return z.ja === true;
}

const ART: Record<string, string> = { montage: 'Arbeiten vor Ort', besichtigung: 'Besichtigung', wartung: 'Wartung' };

/** Ab diesem Status zeigt das Portal die Arbeitsschritte (vorher gibt es noch nichts abzuhaken). */
const MIT_SCHRITTEN = new Set(['beauftragt', 'in_arbeit', 'abgenommen', 'abgerechnet']);

type TeamNamen = 'vorname' | 'voll' | 'aus';
/** Name so, wie der Betrieb es fürs Portal eingestellt hat (msg 2851); „(Test) – Monteur“-Zusätze der Testzugänge bleiben. */
const nameFuer = (art: TeamNamen, name: string): string | null => (art === 'aus' ? null : art === 'voll' ? name.trim() : nurVorname(name));

async function baueSeite(tx: TransactionSql, p: PortalKontext, jetzt: Date): Promise<PortalSeite> {
	const [b] = await tx`
		select coalesce(pr.firmenname, be.name) as name, pr.telefon, pr.email, pr.web, pr.logo is not null as hat_logo, pr.logo_dunkel is not null as hat_logo_dunkel, pr.farbe,
			pr.dunkel_farbe, pr.hintergrund_farbe, pr.titel_schrift, pr.text_schrift, coalesce(pr.titel_gross, false) as titel_gross,
			e.agb_url, e.widerruf_url, coalesce(e.team_namen, 'vorname') as team_namen, e.agb_pdf_hochgeladen
		from app.betriebe be
		left join app.betrieb_profil pr on pr.betrieb_id = be.id
		left join app.portal_einstellungen e on e.betrieb_id = be.id
		where be.id = ${p.betriebId}`;
	const heute = berlinTag(jetzt);
	const namen: TeamNamen = b.team_namen === 'voll' || b.team_namen === 'aus' ? b.team_namen : 'vorname';
	const auftraege: PortalAuftrag[] = [];
	for (const id of await auftraegeImBereich(tx, p)) {
		const [a] = await tx`
			select a.id, a.nummer, a.titel, a.status, coalesce(pa.status, true) as f_status, coalesce(pa.termine, true) as f_termine,
				coalesce(pa.mitarbeiter, true) as f_mitarbeiter, coalesce(pa.annahme, true) as f_annahme
			from app.auftraege a left join app.portal_auftrag pa on pa.auftrag_id = a.id and pa.betrieb_id = a.betrieb_id
			where a.id = ${id} and a.betrieb_id = ${p.betriebId}`;
		if (!a) continue;
		let termine: PortalTermin[] | null = null;
		if (a.f_termine) {
			const t = await tx`
				select e.beginn, e.ende, e.art, b.name from app.einsaetze e
				join app.benutzer b on b.id = e.benutzer_id and b.betrieb_id = e.betrieb_id
				where e.auftrag_id = ${id} and e.betrieb_id = ${p.betriebId} and e.ende >= ${jetzt}
				order by e.beginn limit 30`;
			const je = new Map<string, PortalTermin>();
			for (const r of t) {
				const b0 = new Date(r.beginn);
				const e0 = new Date(r.ende);
				const key = `${b0.toISOString()}|${e0.toISOString()}|${r.art}`;
				const x = je.get(key) ?? { tag: berlinTag(b0), von: berlinUhrzeit(b0), bis: berlinUhrzeit(e0), art: ART[r.art] ?? 'Termin', mitarbeiter: [] };
				const n = a.f_mitarbeiter ? nameFuer(namen, r.name) : null;
				if (n && !x.mitarbeiter.includes(n)) x.mitarbeiter.push(n);
				je.set(key, x);
			}
			termine = [...je.values()].slice(0, 10);
		}
		const geteilt = await tx`select art, ref_id from app.portal_dokumente where auftrag_id = ${id} and betrieb_id = ${p.betriebId}`;
		const angebotIds = geteilt.filter((g) => g.art === 'angebot').map((g) => g.ref_id as string);
		const ang = angebotIds.length
			? await tx`
				select an.id, an.nummer, to_char(an.datum, 'YYYY-MM-DD') as datum, to_char(an.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
					an.status, an.mwst_satz,
					(select coalesce(json_agg(json_build_object('menge', p.menge, 'einzelpreisCent', p.einzelpreis_cent)), '[]') from app.angebot_positionen p
						where p.angebot_id = an.id and p.betrieb_id = an.betrieb_id) as positionen,
					(select json_build_object('art', d.entscheidung, 'name', d.name, 'zeit', d.zeit) from app.angebot_entscheidungen d
						where d.angebot_id = an.id and d.betrieb_id = an.betrieb_id order by d.zeit desc limit 1) as entscheidung
				from app.angebote an
				where an.betrieb_id = ${p.betriebId} and an.auftrag_id = ${id} and an.id = any(${angebotIds}::uuid[]) and an.status <> 'entwurf'
				order by an.angelegt`
			: [];
		const dateiIds = geteilt.filter((g) => g.art === 'datei').map((g) => g.ref_id as string);
		const dateien = dateiIds.length
			? await tx`
				select d.id, d.name, d.typ, d.angelegt,
					exists (select 1 from app.protokolle pr where pr.betrieb_id = d.betrieb_id and pr.pdf_datei_id = d.id) as protokoll
				from app.dateien d where d.betrieb_id = ${p.betriebId} and d.auftrag_id = ${id} and d.id = any(${dateiIds}::uuid[]) order by d.angelegt`
			: [];
		const abs = await tx`select id, nummer, angelegt from app.auftragsbestaetigungen where betrieb_id = ${p.betriebId} and auftrag_id = ${id} order by angelegt`;
		// Notizen nur mit ausdrücklicher Freigabe (portal_dokumente, Art „notiz“; msg 3070)
		const notizIds = geteilt.filter((g) => g.art === 'notiz').map((g) => g.ref_id as string);
		const notizen = notizIds.length
			? await tx`
				select n.id, n.text, n.angelegt, b.name as von from app.notizen n
				left join app.benutzer b on b.id = n.von_benutzer_id and b.betrieb_id = n.betrieb_id
				where n.betrieb_id = ${p.betriebId} and n.auftrag_id = ${id} and n.id = any(${notizIds}::uuid[]) order by n.angelegt desc`
			: [];
		const links = await tx`select titel, url from app.auftrag_links where betrieb_id = ${p.betriebId} and auftrag_id = ${id} and im_portal order by sortierung, angelegt, id`;
		// Arbeitsschritte (msg 2848): nur Aufgaben mit Lautstärke oder Schmutz – das sind die Schritte, die der Betrieb
		// für den Kunden einstuft; interne Aufgaben (Nachfassen, Material bestellen …) bleiben so unsichtbar.
		const schritte = a.f_status && MIT_SCHRITTEN.has(a.status)
			? await tx`
				select t.titel, t.erledigt_am is not null as erledigt, to_char(t.faellig, 'YYYY-MM-DD') as tag, to_char(t.von_tag, 'YYYY-MM-DD') as von_tag, t.lautstaerke, t.schmutz
				from app.todos t
				where t.betrieb_id = ${p.betriebId} and t.auftrag_id = ${id} and (t.lautstaerke is not null or t.schmutz is not null)
				order by coalesce(t.von_tag, t.faellig) nulls last, t.faellig nulls last, t.angelegt, t.id limit 40`
			: null;
		// Ansprechpartner: Zuständige des Auftrags (sonst das Büro) – Team: Zuständige + Mitarbeiter kommender Termine
		// Figuren (msg 3113): Projektbegleiter (msg 3120) immer als Büro-Figur, im Team nach Rolle (Monteur/Büro) – je nach Anrede.
		let ansprechpartner: PortalPerson | null = null;
		let team: PortalPerson[] = [];
		if (namen !== 'aus') {
			const wer = await zustaendig(tx, { betriebId: p.betriebId, benutzerId: OEFFENTLICH }, null, id);
			if (wer) {
				const [ap] = await tx`select name, anrede from app.benutzer where id = ${wer} and betrieb_id = ${p.betriebId}`;
				const n = ap ? nameFuer(namen, ap.name) : null;
				ansprechpartner = n ? { name: n, figur: figurFuer('projektbegleiter', istAnrede(ap.anrede) ? ap.anrede : null) } : null;
			}
			if (a.f_mitarbeiter) {
				const leute = await tx`
					select b.name, b.anrede, r.rechte from app.benutzer b
					left join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
					where b.betrieb_id = ${p.betriebId} and b.aktiv and (
						exists (select 1 from app.auftrag_zustaendige z where z.betrieb_id = b.betrieb_id and z.auftrag_id = ${id} and z.benutzer_id = b.id)
						or exists (select 1 from app.einsaetze e where e.betrieb_id = b.betrieb_id and e.auftrag_id = ${id} and e.benutzer_id = b.id and e.ende >= ${jetzt}))
					order by b.name, b.id limit 12`;
				const gesehen = new Set<string>();
				for (const r of leute) {
					const n = nameFuer(namen, r.name);
					if (!n || gesehen.has(n)) continue;
					gesehen.add(n);
					team.push({ name: n, figur: figurFuer(teamRolle(r.rechte), istAnrede(r.anrede) ? r.anrede : null) });
				}
			}
		}
		auftraege.push({
			id: a.id,
			nummer: a.nummer,
			titel: a.titel,
			status: a.f_status ? { schluessel: a.status, name: portalStatusName(a.status as AuftragStatus) } : null,
			termine,
			angebote: ang.map((x) => {
				const pos = (typeof x.positionen === 'string' ? JSON.parse(x.positionen) : x.positionen) as { menge: string | number; einzelpreisCent: string | number }[];
				const mwst = istMwstSatz(x.mwst_satz) ? x.mwst_satz : 19;
				const s = summen(pos.map((q) => ({ menge: Number(q.menge), einzelpreisCent: Number(q.einzelpreisCent) })), mwst);
				const ent = typeof x.entscheidung === 'string' ? JSON.parse(x.entscheidung) : x.entscheidung;
				return {
					id: x.id,
					nummer: x.nummer,
					datum: x.datum,
					gueltigBis: x.gueltig_bis,
					status: x.status,
					bruttoCent: s.bruttoCent,
					annehmbar: x.status === 'versendet' && a.f_annahme && x.gueltig_bis >= heute,
					entscheidung: ent ? { art: ent.art, name: ent.name, zeit: new Date(ent.zeit).toISOString() } : null
				};
			}),
			dateien: dateien.map((d) => ({
				id: d.id,
				// UUID-Namen (Fotos aus der App) lesbar machen (msg 3133); Download behält den echten Namen
				name: anzeigeDateiname(d.name, d.typ, d.angelegt),
				typ: d.typ,
				datum: new Date(d.angelegt).toISOString(),
				art: d.protokoll ? ('protokoll' as const) : String(d.typ).startsWith('image/') ? ('foto' as const) : ('dokument' as const)
			})),
			auftragsbestaetigungen: abs.map((x) => ({ id: x.id, nummer: x.nummer, datum: new Date(x.angelegt).toISOString() })),
			// Wer: nach Einstellung „Namen im Portal“ (Vorname, voll oder keine)
			notizen: notizen.map((n) => ({ id: n.id, text: n.text, datum: new Date(n.angelegt).toISOString(), von: n.von ? nameFuer(namen, n.von) : null })),
			links: links.map((l) => ({ titel: l.titel, url: l.url })),
			schritte: schritte
				? schritte.map((t) => ({ titel: t.titel, erledigt: t.erledigt, tag: t.tag, vonTag: t.von_tag ?? null, laerm: t.lautstaerke ?? null, schmutz: t.schmutz ?? null }))
				: null,
			ansprechpartner,
			team
		});
	}
	return {
		betrieb: {
			name: b.name,
			telefon: b.telefon,
			email: b.email,
			web: b.web,
			logo: portalLogo(b.dunkel_farbe, { briefkopf: b.hat_logo === true, dunkel: b.hat_logo_dunkel === true }),
			farbe: b.farbe,
			marke: {
				dunkel: b.dunkel_farbe ?? null,
				hintergrund: b.hintergrund_farbe ?? null,
				titelSchrift: b.titel_schrift === 'inter' ? 'inter' : 'montserrat',
				textSchrift: b.text_schrift === 'opensans' ? 'opensans' : 'inter',
				titelGross: b.titel_gross === true
			}
		},
		agbUrl: b.agb_url,
		agbPdf: b.agb_pdf_hochgeladen ? { stand: new Date(b.agb_pdf_hochgeladen).toISOString() } : null,
		widerrufUrl: b.widerruf_url,
		bestandskunde: await istBestandskunde(tx, p),
		auftraege
	};
}

/** Portal-Seite laden; protokolliert den Aufruf (höchstens einmal je 30 Minuten und Link). `null` = ungültiger Link. */
export async function ladePortal(token: unknown, ip: string, jetzt = new Date()): Promise<PortalSeite | null> {
	begrenze(ip, 'abruf');
	const p = await loeseAuf(token, ip);
	if (!p) return null;
	return alsOeffentlich(p.betriebId, 'kundenportal', () =>
		mitBetrieb({ betriebId: p.betriebId, benutzerId: OEFFENTLICH }, async (tx) => {
			const [l] = await tx`
				update app.portal_links set zugriffe = zugriffe + 1, letzter_zugriff = now()
				where id = ${p.linkId} and betrieb_id = ${p.betriebId}
				returning (select max(e.zeit) from app.portal_ereignisse e where e.link_id = ${p.linkId} and e.betrieb_id = ${p.betriebId} and e.art = 'aufruf') as zuletzt`;
			const seite = await baueSeite(tx, p, jetzt);
			if (!l?.zuletzt || jetzt.getTime() - new Date(l.zuletzt).getTime() > 30 * 60_000) {
				for (const a of seite.auftraege) {
					await tx`insert into app.portal_ereignisse (betrieb_id, link_id, auftrag_id, art, text, ip_hash)
						values (${p.betriebId}, ${p.linkId}, ${a.id}, 'aufruf', 'Kundenportal geöffnet', ${ipHash(ip)})`;
				}
			}
			return seite;
		})
	);
}

/** Logo des Betriebs für den Portal-Kopf: die gewünschte Variante (siehe `portalLogo`), sonst die andere. */
export async function portalLogoDatei(token: unknown, ip: string, variante: LogoVariante = 'briefkopf'): Promise<{ bytes: Uint8Array; typ: string } | null> {
	begrenze(ip, 'abruf');
	const p = await loeseAuf(token, ip);
	if (!p) return null;
	const k = { betriebId: p.betriebId, benutzerId: OEFFENTLICH };
	const andere: LogoVariante = variante === 'dunkel' ? 'briefkopf' : 'dunkel';
	return alsOeffentlich(p.betriebId, 'kundenportal', async () => (await holeLogo(k, variante)) ?? holeLogo(k, andere));
}

export type PortalDatei = { name: string; typ: string; bytes: Uint8Array };

/** AGB des Betriebs als PDF (msg 3030) – nur mit gültigem Portal-Link. */
export async function portalAgb(token: unknown, ip: string): Promise<PortalDatei> {
	begrenze(ip, 'abruf');
	const p = await loeseAuf(token, ip);
	if (!p) throw nichtGefunden();
	const pdf = await alsOeffentlich(p.betriebId, 'kundenportal', () => holeAgbPdf({ betriebId: p.betriebId, benutzerId: OEFFENTLICH }));
	if (!pdf) throw new ApiFehler(404, 'Keine AGB hinterlegt.');
	return { name: 'AGB.pdf', typ: 'application/pdf', bytes: pdf };
}

/** Freigegebenes Dokument: Angebot (PDF), Datei des Auftrags oder Auftragsbestätigung – nur im Bereich des Links. */
export async function portalDokument(token: unknown, art: unknown, id: unknown, ip: string): Promise<PortalDatei> {
	begrenze(ip, 'abruf');
	const p = await loeseAuf(token, ip);
	if (!p) throw nichtGefunden();
	if (typeof id !== 'string' || !UUID.test(id) || (art !== 'angebot' && art !== 'datei' && art !== 'ab')) throw new ApiFehler(404, 'Dokument nicht gefunden.');
	const k: Kontext = { betriebId: p.betriebId, benutzerId: OEFFENTLICH };
	return alsOeffentlich(p.betriebId, 'kundenportal', async () => {
		const bereich = await mitBetrieb(k, (tx) => auftraegeImBereich(tx, p));
		const [treffer] = await mitBetrieb(k, (tx) =>
			art === 'ab'
				? tx`select auftrag_id, nummer as name from app.auftragsbestaetigungen where id = ${id} and betrieb_id = ${p.betriebId} and auftrag_id = any(${bereich}::uuid[])`
				: tx`select d.auftrag_id from app.portal_dokumente d where d.betrieb_id = ${p.betriebId} and d.art = ${art} and d.ref_id = ${id} and d.auftrag_id = any(${bereich}::uuid[])`
		);
		if (!treffer) throw new ApiFehler(404, 'Dokument nicht gefunden.');
		let datei: PortalDatei;
		if (art === 'ab') {
			const [z] = await mitBetrieb(k, (tx) => tx`select nummer, pdf from app.auftragsbestaetigungen where id = ${id} and betrieb_id = ${p.betriebId}`);
			datei = { name: `Auftragsbestaetigung_${z.nummer}.pdf`, typ: 'application/pdf', bytes: new Uint8Array(z.pdf) };
		} else if (art === 'angebot') {
			const [daten, profil, logo] = await Promise.all([ladePdfDaten(k, id), holeProfil(k), holeLogo(k)]);
			if (daten.angebot.auftragId !== treffer.auftrag_id || daten.angebot.status === 'entwurf') throw new ApiFehler(404, 'Dokument nicht gefunden.');
			datei = { name: `Angebot_${daten.angebot.nummer}.pdf`, typ: 'application/pdf', bytes: await angebotPdf({ profil, logo, angebot: daten.angebot, kunde: daten.kunde, objekt: daten.objekt }) };
		} else {
			const [z] = await mitBetrieb(k, (tx) => tx`select name, typ, inhalt from app.dateien where id = ${id} and auftrag_id = ${treffer.auftrag_id} and betrieb_id = ${p.betriebId}`);
			if (!z) throw new ApiFehler(404, 'Dokument nicht gefunden.');
			datei = { name: z.name, typ: z.typ, bytes: new Uint8Array(z.inhalt) };
		}
		await mitBetrieb(k, (tx) => tx`
			insert into app.portal_ereignisse (betrieb_id, link_id, auftrag_id, art, text, ip_hash)
			values (${p.betriebId}, ${p.linkId}, ${treffer.auftrag_id}, 'dokument', ${`Kunde hat „${datei.name}“ geöffnet`.slice(0, 300)}, ${ipHash(ip)})`);
		return datei;
	});
}

export type Entscheidung = { entscheidung: unknown; name?: unknown; agb: unknown; grund?: unknown };

/**
 * Angebot annehmen oder ablehnen (Kunde, ohne Anmeldung). Annehmen: Name + Häkchen „AGB gelesen“ (Pflicht) nach einem
 * Bestätigungsschritt in der Oberfläche; Ablehnen mit optionalem Grund. Danach: Angebot „angenommen“/„abgelehnt“,
 * Auftrag ggf. „beauftragt“, Nachweis, Verlauf, Glocke; bei Annahme meldet der Dienst `angebotAngenommen`
 * (Auftragsbestätigung, später Lexware). Das Nachfassen stoppt, weil das Angebot nicht mehr „versendet“ ist.
 */
export async function entscheide(token: unknown, angebotId: unknown, e: Entscheidung, ip: string): Promise<{ status: 'angenommen' | 'abgelehnt'; hinweise: string[] }> {
	begrenze(ip, 'aktion');
	const p = await loeseAuf(token, ip);
	if (!p) throw nichtGefunden();
	if (typeof angebotId !== 'string' || !UUID.test(angebotId)) throw new ApiFehler(404, 'Angebot nicht gefunden.');
	if (e.entscheidung !== 'angenommen' && e.entscheidung !== 'abgelehnt') throw new ApiFehler(400, 'Bitte annehmen oder ablehnen.');
	// Kein Namensfeld mehr (msg 3032): Der Kunde ist über seinen Portal-Link bekannt – der Nachweis nimmt den Namen
	// aus dem CRM (Kunde des Auftrags), dazu Zeit, Link, IP-Hash und die AGB-Fassung. `e.name` wird ignoriert.
	const agb = e.agb === true || e.agb === 'ja' || e.agb === 'on';
	if (e.entscheidung === 'angenommen' && !agb) throw new ApiFehler(400, 'Bitte bestätigen Sie, dass Sie die AGB gelesen haben.');
	const grund = typeof e.grund === 'string' && e.grund.trim() !== '' ? e.grund.replaceAll('\u0000', '').trim().slice(0, 1000) : null;
	const nach: 'angenommen' | 'abgelehnt' = e.entscheidung;
	const k: Kontext = { betriebId: p.betriebId, benutzerId: OEFFENTLICH };
	const push: { benutzerId: string; titel: string; text: string; link: string }[] = [];
	const ergebnis = await alsOeffentlich(p.betriebId, 'kundenportal', async () => {
		const vorgang = await mitBetrieb(k, async (tx) => {
			const bereich = await auftraegeImBereich(tx, p);
			const [an] = await tx`
				select an.id, an.nummer, an.status, an.auftrag_id, an.gueltig_bis, a.status as auftrag_status,
					coalesce(pa.annahme, true) as annahme, e.agb_url, e.agb_pdf_hash, e.agb_pdf_hochgeladen,
					left(coalesce(
						case when kd.art = 'firma' then kd.firma || coalesce(' – ' || nullif(btrim(concat_ws(' ', kd.vorname, kd.nachname)), ''), '')
							else nullif(btrim(concat_ws(' ', kd.vorname, kd.nachname)), '') end,
						nullif(btrim(a.einmal_name), ''), 'Kunde (Kundenportal)'), 200) as kunde_name
				from app.angebote an
				join app.auftraege a on a.id = an.auftrag_id and a.betrieb_id = an.betrieb_id
				left join app.kunden kd on kd.id = a.kunde_id and kd.betrieb_id = a.betrieb_id
				join app.portal_dokumente d on d.ref_id = an.id and d.art = 'angebot' and d.auftrag_id = an.auftrag_id and d.betrieb_id = an.betrieb_id
				left join app.portal_auftrag pa on pa.auftrag_id = a.id and pa.betrieb_id = a.betrieb_id
				left join app.portal_einstellungen e on e.betrieb_id = an.betrieb_id
				where an.id = ${angebotId} and an.betrieb_id = ${p.betriebId} and an.auftrag_id = any(${bereich}::uuid[])
				for update of an`;
			if (!an) throw new ApiFehler(404, 'Angebot nicht gefunden.');
			const name: string = an.kunde_name;
			if (an.status !== 'versendet') throw new ApiFehler(409, 'Über dieses Angebot wurde schon entschieden.');
			if (!an.annahme) throw new ApiFehler(403, 'Die Online-Annahme ist für diesen Auftrag nicht freigeschaltet – bitte melden Sie sich bei uns.');
			if (nach === 'angenommen' && berlinTag(new Date()) > new Date(an.gueltig_bis).toISOString().slice(0, 10)) {
				throw new ApiFehler(409, 'Das Angebot ist abgelaufen – bitte melden Sie sich bei uns.');
			}
			await tx`update app.angebote set status = ${nach} where id = ${an.id} and betrieb_id = ${p.betriebId}`;
			if (nach === 'angenommen' && an.auftrag_status === 'angebot') {
				await tx`update app.auftraege set status = 'beauftragt' where id = ${an.auftrag_id} and betrieb_id = ${p.betriebId} and status = 'angebot'`;
			}
			await tx`
				insert into app.angebot_entscheidungen (betrieb_id, angebot_id, link_id, entscheidung, name, grund, agb_bestaetigt, agb_url, token_hash, ip_hash, agb_pdf_hash, agb_pdf_stand)
				values (${p.betriebId}, ${an.id}, ${p.linkId}, ${nach}, ${name}, ${grund}, ${agb}, ${an.agb_url}, ${p.hash}, ${ipHash(ip)},
					${nach === 'angenommen' ? an.agb_pdf_hash : null}, ${nach === 'angenommen' ? an.agb_pdf_hochgeladen : null})`;
			// Nachweis im Verlauf: welche AGB-Fassung bestätigt wurde (msg 3030)
			const agbText = an.agb_pdf_hash ? `AGB bestätigt, ${agbFassung(an.agb_pdf_hash, an.agb_pdf_hochgeladen)}` : 'AGB bestätigt';
			const text = nach === 'angenommen' ? `Angebot ${an.nummer} von ${name} online angenommen (${agbText})` : `Angebot ${an.nummer} von ${name} online abgelehnt${grund ? `: ${grund}` : ''}`;
			await tx`insert into app.portal_ereignisse (betrieb_id, link_id, auftrag_id, art, text, ip_hash)
				values (${p.betriebId}, ${p.linkId}, ${an.auftrag_id}, ${nach}, ${text.slice(0, 300)}, ${ipHash(ip)})`;
			return { an, text };
		});
		const hinweise = nach === 'angenommen'
			? await melde('angebotAngenommen', { betriebId: p.betriebId, benutzerId: null, angebotId: vorgang.an.id, auftragId: vorgang.an.auftrag_id, quelle: 'kundenportal' })
			: [];
		// Glocke + Aufgabe, wenn nicht schon die Auftragsbestätigung eines angelegt hat (Ablehnung immer)
		if (!hinweise.some((h) => h.startsWith('Auftragsbestätigung'))) {
			await mitBetrieb(k, async (tx) => {
				const wer = await zustaendig(tx, k, null, vorgang.an.auftrag_id);
				const [t] = await tx`
					insert into app.todos (betrieb_id, auftrag_id, titel, beschreibung, zustaendig_id, faellig)
					values (${p.betriebId}, ${vorgang.an.auftrag_id}, ${(nach === 'angenommen' ? `Angebot ${vorgang.an.nummer} wurde online angenommen` : `Angebot ${vorgang.an.nummer} wurde online abgelehnt`).slice(0, 200)}, ${vorgang.text.slice(0, 2000)}, ${wer}, ${berlinTag(new Date())})
					returning id`;
				if (wer) {
					const link = `/auftraege/${vorgang.an.auftrag_id}`;
					const [er] = await tx`
						insert into app.erinnerungen (betrieb_id, benutzer_id, todo_id, zeitpunkt, titel, text, link)
						values (${p.betriebId}, ${wer}, ${t.id}, now(), ${nach === 'angenommen' ? 'Angebot angenommen' : 'Angebot abgelehnt'}, ${vorgang.text.slice(0, 500)}, ${link})
						returning id`;
					await tx`update app.erinnerungen set gesendet_am = now(), ergebnis = 'gesendet' where id = ${er.id} and betrieb_id = ${p.betriebId}`;
					push.push({ benutzerId: wer, titel: nach === 'angenommen' ? 'Angebot angenommen' : 'Angebot abgelehnt', text: vorgang.text, link });
				}
			});
		}
		return { status: nach, hinweise };
	});
	for (const x of push) void sendePush({ betriebId: p.betriebId, benutzerId: x.benutzerId }, { titel: x.titel, text: x.text, link: x.link }).catch(() => {});
	return ergebnis;
}

export const terminText = (t: PortalTermin) => `${tagKurz(t.tag)} zwischen ${t.von} und ${t.bis} Uhr`;
