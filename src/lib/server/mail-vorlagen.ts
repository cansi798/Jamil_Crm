import { mitBetrieb, type Kontext, type TransactionSql } from './db';
import { ApiFehler } from './fehler';
import { textFeld, UUID } from './kunden';
import { pruefeRecht } from './rechte';
import { fertigeMail } from '../nachfassen';
import { briefAnrede, istMailZweck, MAIL_ZWECKE, STANDARD_MAIL_VORLAGEN, unbekanntePlatzhalter, type MailZweck } from '../mail-vorlagen';
import { euro, istMwstSatz, summen } from '../geld';
import { tagDeutsch } from '../zeit';

/**
 * E-Mail-Vorlagen-Bibliothek (Wunsch Jamil, Talk msg 2789). Bearbeiten nur mit `vorlagen.verwalten`; auswählen darf,
 * wer die jeweilige Mail vorbereiten darf. Je Zweck genau eine Standard-Vorlage – fehlt sie, legt
 * `stelleStandardsSicher` die eingebaute Startfassung an (bzw. macht die älteste Vorlage des Zwecks zum Standard).
 */

export type MailVorlage = {
	id: string;
	name: string;
	betreff: string;
	html: string;
	text: string | null;
	zweck: MailZweck;
	mitSignatur: boolean;
	istStandard: boolean;
};

export const VORLAGE_FELDER = ['name', 'betreff', 'html', 'text', 'zweck', 'mitSignatur'] as const;
export const MAX_VORLAGEN = 200;
const SPALTEN = 'id, name, betreff, html, text, zweck, mit_signatur, ist_standard';

const zuVorlage = (z: Record<string, any>): MailVorlage => ({
	id: z.id,
	name: z.name,
	betreff: z.betreff,
	html: z.html,
	text: z.text ?? null,
	zweck: z.zweck,
	mitSignatur: z.mit_signatur,
	istStandard: z.ist_standard
});
const nichtGefunden = () => new ApiFehler(404, 'Mail-Vorlage nicht gefunden.');
const pruefeId = (w: unknown) => {
	if (typeof w !== 'string' || !UUID.test(w.trim())) throw nichtGefunden();
	return w.trim().toLowerCase();
};
const bool = (w: unknown) => w === true || w === 'true' || w === 'on' || w === '1' || w === 'ja';

/** Seiten und Aktionen der Bibliothek: 401/403 ohne `vorlagen.verwalten`. */
export function vorlagenZugriff(locals: { nutzer: Nutzer | null }): Kontext {
	pruefeRecht(locals, 'vorlagen.verwalten');
	const n = locals.nutzer!;
	if (!n.betriebId) throw new ApiFehler(403, 'Keine Berechtigung');
	return { betriebId: n.betriebId, benutzerId: n.id };
}

/** Fehlende Standard-Vorlagen anlegen (idempotent, auch bei gleichzeitigen Aufrufen). */
export async function stelleStandardsSicher(tx: TransactionSql, k: Kontext, zwecke: readonly MailZweck[] = MAIL_ZWECKE): Promise<void> {
	const vorhanden = new Set(
		(await tx`select zweck from app.mail_vorlagen where betrieb_id = ${k.betriebId} and ist_standard and zweck = any(${zwecke as string[]})`).map((z) => z.zweck as string)
	);
	for (const zweck of zwecke) {
		if (vorhanden.has(zweck)) continue;
		const [aelteste] = await tx`select id from app.mail_vorlagen where betrieb_id = ${k.betriebId} and zweck = ${zweck} order by angelegt, id limit 1`;
		if (aelteste) {
			await tx`update app.mail_vorlagen set ist_standard = true where id = ${aelteste.id} and betrieb_id = ${k.betriebId}
				and not exists (select 1 from app.mail_vorlagen x where x.betrieb_id = ${k.betriebId} and x.zweck = ${zweck} and x.ist_standard)`;
			continue;
		}
		const s = STANDARD_MAIL_VORLAGEN[zweck];
		await tx`
			insert into app.mail_vorlagen (betrieb_id, name, betreff, html, zweck, ist_standard)
			values (${k.betriebId}, ${s.name}, ${s.betreff}, ${s.html}, ${zweck}, true)
			on conflict (betrieb_id, zweck) where ist_standard do nothing`;
	}
}

/** Alle Vorlagen (nach Zweck, Standard zuerst, dann Name); legt fehlende Standards an. */
export async function listeMailVorlagen(k: Kontext, zweck?: MailZweck): Promise<MailVorlage[]> {
	return mitBetrieb(k, async (tx) => {
		await stelleStandardsSicher(tx, k);
		const z = zweck
			? await tx`select ${tx.unsafe(SPALTEN)} from app.mail_vorlagen where betrieb_id = ${k.betriebId} and zweck = ${zweck} order by ist_standard desc, public.unaccent(lower(name)), id`
			: await tx`select ${tx.unsafe(SPALTEN)} from app.mail_vorlagen where betrieb_id = ${k.betriebId} order by array_position(${MAIL_ZWECKE as unknown as string[]}::text[], zweck), ist_standard desc, public.unaccent(lower(name)), id`;
		return z.map(zuVorlage);
	});
}

/** Vorlage für einen Zweck: die gewählte (wenn es sie im Betrieb gibt), sonst der Standard. */
export async function vorlageFuer(tx: TransactionSql, k: Kontext, zweck: MailZweck, wahl?: unknown): Promise<MailVorlage> {
	if (typeof wahl === 'string' && UUID.test(wahl)) {
		const [z] = await tx`select ${tx.unsafe(SPALTEN)} from app.mail_vorlagen where id = ${wahl} and betrieb_id = ${k.betriebId}`;
		if (z) return zuVorlage(z);
	}
	await stelleStandardsSicher(tx, k, [zweck]);
	const [z] = await tx`select ${tx.unsafe(SPALTEN)} from app.mail_vorlagen where betrieb_id = ${k.betriebId} and zweck = ${zweck} and ist_standard`;
	return zuVorlage(z);
}

/** Fertige Mail aus Vorlage und Werten; Signatur nur, wenn die Vorlage sie will. */
export function baueMail(v: MailVorlage, werte: Record<string, string>, signatur: string | null): { betreff: string; html: string; text: string } {
	return fertigeMail(v, werte, v.mitSignatur ? signatur : null);
}

export type VorlageWerte = { name: string; betreff: string; html: string; text: string | null; zweck: MailZweck; mitSignatur: boolean; unbekannt: string[] };

export function pruefeVorlage(e: Record<string, unknown>): VorlageWerte {
	const name = textFeld(e.name, 'Name', 200);
	const betreff = textFeld(e.betreff, 'Betreff', 300);
	if (!name) throw new ApiFehler(400, 'Name: Bitte einen Namen eingeben.');
	if (!betreff) throw new ApiFehler(400, 'Betreff: Bitte einen Betreff eingeben.');
	const html = textFeld(e.html, 'Text (HTML)', 50000);
	if (!html) throw new ApiFehler(400, 'Text: Bitte einen Mailtext eingeben.');
	const zweck = e.zweck === undefined || e.zweck === '' ? 'allgemein' : e.zweck;
	if (!istMailZweck(zweck)) throw new ApiFehler(400, 'Zweck: ungültige Auswahl.');
	const text = textFeld(e.text, 'Klartext', 50000);
	// mitSignatur: Häkchen fehlt im Formular = aus; fehlt das Feld ganz (API) = an
	const mitSignatur = e.mitSignatur === undefined ? true : bool(e.mitSignatur);
	return { name, betreff, html, text, zweck, mitSignatur, unbekannt: unbekanntePlatzhalter([betreff, html, text], zweck) };
}

/** Anlegen (vorlageId leer) oder ändern. Unbekannte Platzhalter sind kein Fehler, kommen aber als Hinweis zurück. */
export async function speichereMailVorlage(k: Kontext, vorlageId: unknown, e: Record<string, unknown>): Promise<MailVorlage & { unbekannt: string[] }> {
	const w = pruefeVorlage(e);
	return mitBetrieb(k, async (tx) => {
		if (vorlageId === null || vorlageId === undefined || vorlageId === '') {
			const [{ n }] = await tx`select count(*)::int as n from app.mail_vorlagen where betrieb_id = ${k.betriebId}`;
			if (n >= MAX_VORLAGEN) throw new ApiFehler(400, `Höchstens ${MAX_VORLAGEN} Mail-Vorlagen.`);
			const [z] = await tx`
				insert into app.mail_vorlagen (betrieb_id, name, betreff, html, text, zweck, mit_signatur)
				values (${k.betriebId}, ${w.name}, ${w.betreff}, ${w.html}, ${w.text}, ${w.zweck}, ${w.mitSignatur})
				returning ${tx.unsafe(SPALTEN)}`;
			await stelleStandardsSicher(tx, k, [w.zweck]);
			return { ...zuVorlage(z), unbekannt: w.unbekannt };
		}
		const vid = pruefeId(vorlageId);
		const [alt] = await tx`select zweck, ist_standard from app.mail_vorlagen where id = ${vid} and betrieb_id = ${k.betriebId} for update`;
		if (!alt) throw nichtGefunden();
		// Zweck wechseln: Standard bleibt beim alten Zweck nicht hängen
		const standard = alt.zweck === w.zweck ? alt.ist_standard : false;
		const [z] = await tx`
			update app.mail_vorlagen set name = ${w.name}, betreff = ${w.betreff}, html = ${w.html}, text = ${w.text}, zweck = ${w.zweck},
				mit_signatur = ${w.mitSignatur}, ist_standard = ${standard}
			where id = ${vid} and betrieb_id = ${k.betriebId} returning ${tx.unsafe(SPALTEN)}`;
		await stelleStandardsSicher(tx, k, [alt.zweck, w.zweck]);
		return { ...zuVorlage(z), unbekannt: w.unbekannt };
	});
}

/** Macht eine Vorlage zum Standard ihres Zwecks. */
export async function setzeStandard(k: Kontext, vorlageId: unknown): Promise<void> {
	const vid = pruefeId(vorlageId);
	await mitBetrieb(k, async (tx) => {
		const [v] = await tx`select zweck from app.mail_vorlagen where id = ${vid} and betrieb_id = ${k.betriebId} for update`;
		if (!v) throw nichtGefunden();
		await tx`update app.mail_vorlagen set ist_standard = false where betrieb_id = ${k.betriebId} and zweck = ${v.zweck} and ist_standard and id <> ${vid}`;
		await tx`update app.mail_vorlagen set ist_standard = true where id = ${vid} and betrieb_id = ${k.betriebId}`;
	});
}

/** Kopie einer Vorlage („… (Kopie)“), kein Standard. */
export async function kopiereMailVorlage(k: Kontext, vorlageId: unknown): Promise<MailVorlage> {
	const vid = pruefeId(vorlageId);
	return mitBetrieb(k, async (tx) => {
		const [{ n }] = await tx`select count(*)::int as n from app.mail_vorlagen where betrieb_id = ${k.betriebId}`;
		if (n >= MAX_VORLAGEN) throw new ApiFehler(400, `Höchstens ${MAX_VORLAGEN} Mail-Vorlagen.`);
		const [z] = await tx`
			insert into app.mail_vorlagen (betrieb_id, name, betreff, html, text, zweck, mit_signatur)
			select betrieb_id, left(name || ' (Kopie)', 200), betreff, html, text, zweck, mit_signatur from app.mail_vorlagen
			where id = ${vid} and betrieb_id = ${k.betriebId}
			returning ${tx.unsafe(SPALTEN)}`;
		if (!z) throw nichtGefunden();
		return zuVorlage(z);
	});
}

/** Löschen – nicht, solange eine Nachfass-Stufe sie benutzt; der Standard wird durch eine andere (oder die Startfassung) ersetzt. */
export async function loescheMailVorlage(k: Kontext, vorlageId: unknown): Promise<void> {
	const vid = pruefeId(vorlageId);
	await mitBetrieb(k, async (tx) => {
		const [inUse] = await tx`select 1 from app.nachfass_stufen where mail_vorlage_id = ${vid} and betrieb_id = ${k.betriebId} and mail limit 1`;
		if (inUse) throw new ApiFehler(409, 'Die Vorlage wird in einer Nachfass-Stufe verwendet – bitte dort zuerst eine andere wählen.');
		const [z] = await tx`delete from app.mail_vorlagen where id = ${vid} and betrieb_id = ${k.betriebId} returning zweck`;
		if (!z) throw nichtGefunden();
		await stelleStandardsSicher(tx, k, [z.zweck]);
	});
}

export async function holeSignatur(k: Kontext, tx?: TransactionSql): Promise<string | null> {
	const lies = async (t: TransactionSql) => {
		const [z] = await t`select signatur_html from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
		return (z?.signatur_html as string | null) ?? null;
	};
	return tx ? lies(tx) : mitBetrieb(k, lies);
}

export async function speichereSignatur(k: Kontext, html: unknown): Promise<void> {
	const s = textFeld(html, 'Signatur', 20000);
	await mitBetrieb(k, async (tx) => {
		await tx`
			insert into app.betrieb_profil (betrieb_id, signatur_html) values (${k.betriebId}, ${s})
			on conflict (betrieb_id) do update set signatur_html = excluded.signatur_html`;
	});
}

/** Für Auswahllisten (ohne Text): id, Name, Zweck, Standard. */
export type VorlagenWahl = { id: string; name: string; zweck: MailZweck; istStandard: boolean };
export const alsWahl = (l: readonly MailVorlage[]): VorlagenWahl[] => l.map((v) => ({ id: v.id, name: v.name, zweck: v.zweck, istStandard: v.istStandard }));

// ——— Werte für die Platzhalter ———

/** Betrieb: Name, Telefon, E-Mail, Website (`link`). */
export async function firmenWerte(tx: TransactionSql, k: Kontext): Promise<Record<string, string>> {
	const [p] = await tx`select firmenname, telefon, email, web from app.betrieb_profil where betrieb_id = ${k.betriebId}`;
	const web = p?.web ? (/^https?:\/\//i.test(p.web) ? p.web : `https://${p.web}`) : '';
	return { 'firma.name': p?.firmenname ?? '', 'firma.telefon': p?.telefon ?? '', 'firma.email': p?.email ?? '', link: web, 'bewertung.link': web };
}

export type MailBezug = { kundeId?: string | null; auftragId?: string | null; angebotId?: string | null };

/**
 * Platzhalter-Werte zu Kunde, Auftrag und/oder Angebot (je, was angegeben ist; Auftrag/Kunde werden aus dem Angebot
 * ergänzt). Der Aufrufer hat die Sichtbarkeit schon geprüft. `betrag` nur mit `preise`.
 */
export async function mailWerte(tx: TransactionSql, k: Kontext, b: MailBezug, opt: { preise: boolean }): Promise<{ an: string | null; werte: Record<string, string> }> {
	const werte: Record<string, string> = { ...(await firmenWerte(tx, k)) };
	let auftragId = b.auftragId ?? null;
	let kundeId = b.kundeId ?? null;
	if (b.angebotId) {
		const [an] = await tx`select nummer, to_char(datum, 'YYYY-MM-DD') as datum, to_char(gueltig_bis, 'YYYY-MM-DD') as gueltig_bis, mwst_satz, auftrag_id, kunde_id
			from app.angebote where id = ${b.angebotId} and betrieb_id = ${k.betriebId}`;
		if (an) {
			werte['angebot.nummer'] = an.nummer;
			werte['angebot.datum'] = tagDeutsch(an.datum);
			werte['angebot.gueltig_bis'] = tagDeutsch(an.gueltig_bis);
			werte.faellig_am = tagDeutsch(an.gueltig_bis);
			if (opt.preise) {
				const pos = await tx`select menge, einzelpreis_cent from app.angebot_positionen where angebot_id = ${b.angebotId} and betrieb_id = ${k.betriebId}`;
				const mwst = istMwstSatz(an.mwst_satz) ? an.mwst_satz : 19;
				werte.betrag = euro(summen(pos.map((p) => ({ menge: Number(p.menge), einzelpreisCent: Number(p.einzelpreis_cent) })), mwst).bruttoCent);
			}
			auftragId ??= an.auftrag_id;
			kundeId ??= an.kunde_id;
		}
	}
	let einmal: { name: string | null; email: string | null } = { name: null, email: null };
	if (auftragId) {
		const [a] = await tx`select titel, nummer, kunde_id, einmal_name, einmal_email from app.auftraege where id = ${auftragId} and betrieb_id = ${k.betriebId}`;
		if (a) {
			werte['auftrag.titel'] = a.titel;
			werte['auftrag.nummer'] = a.nummer;
			kundeId ??= a.kunde_id;
			einmal = { name: a.einmal_name, email: a.einmal_email };
		}
	}
	let an: string | null = einmal.email;
	if (kundeId) {
		const [kd] = await tx`select art, firma, anrede, vorname, nachname, email from app.kunden where id = ${kundeId} and betrieb_id = ${k.betriebId}`;
		if (kd) {
			werte['kunde.name'] = kd.art === 'firma' ? (kd.firma ?? '') : [kd.vorname, kd.nachname].filter(Boolean).join(' ');
			werte['kunde.anrede'] = briefAnrede(kd);
			werte['kunde.email'] = kd.email ?? '';
			an = kd.email ?? null;
		}
	} else if (einmal.name) {
		werte['kunde.name'] = einmal.name;
		werte['kunde.anrede'] = briefAnrede({ einmalName: einmal.name });
		werte['kunde.email'] = einmal.email ?? '';
	}
	werte['kunde.anrede'] ??= 'Guten Tag';
	return { an, werte };
}

/** Alles für „Mail an Kunden“ im Browser: Vorlagen (mit Text), Werte, Empfänger, Signatur. */
export type MailVorbereitung = {
	an: string | null;
	werte: Record<string, string>;
	signatur: string | null;
	vorlagen: Pick<MailVorlage, 'id' | 'name' | 'betreff' | 'html' | 'text' | 'zweck' | 'mitSignatur' | 'istStandard'>[];
};

/**
 * Vorbereitung einer Mail an den Kunden (Kunde, Auftrag oder Angebot) mit den Vorlagen der genannten Zwecke (der erste
 * Zweck liefert die vorausgewählte Standard-Vorlage). Der Aufrufer prüft vorher Sicht und Recht.
 */
export async function mailVorbereitung(k: Kontext, bezug: MailBezug, zwecke: readonly MailZweck[], opt: { preise: boolean }): Promise<MailVorbereitung> {
	return mitBetrieb(k, async (tx) => {
		await stelleStandardsSicher(tx, k, zwecke);
		const { an, werte } = await mailWerte(tx, k, bezug, opt);
		const z = await tx`select ${tx.unsafe(SPALTEN)} from app.mail_vorlagen where betrieb_id = ${k.betriebId} and zweck = any(${zwecke as string[]})
			order by array_position(${zwecke as string[]}::text[], zweck), ist_standard desc, public.unaccent(lower(name)), id`;
		return { an, werte, signatur: await holeSignatur(k, tx), vorlagen: z.map(zuVorlage) };
	});
}
