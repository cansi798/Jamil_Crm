import postgres from 'postgres';
import { frischeTestDb, type TestDb } from './setup';
import { initDb, mitBetrieb } from '../../src/lib/server/db';
import { ALLE_RECHTE, VORLAGEN } from '../../src/lib/server/rechte';

/**
 * Gemeinsame Testumgebung der Stufe 1c (Katalog, Briefkopf, Angebote, Preisschutz): frische Datenbank, zwei Betriebe
 * mit Premium-Tarif, ein Betrieb ohne Katalog/Angebote, Benutzer mit typischen Rollen, je Betrieb Kunde + Auftrag.
 */

export type Ant = { status: number; koerper: any };

export function nutzerVon(id: string, betriebId: string | null, rechte: readonly string[], istAdmin = false): Nutzer {
	return { id, betriebId, istAdmin, rechte: [...rechte], betriebStatus: 'aktiv' };
}

export async function antwort(r: Response): Promise<Ant> {
	const text = await r.text();
	const typ = r.headers.get('content-type') ?? '';
	return { status: r.status, koerper: text && typ.includes('json') ? JSON.parse(text) : text || null };
}

export const jsonAnfrage = (methode: string, koerper?: unknown, typ: string | null = 'application/json') =>
	new Request('http://localhost/api/x', {
		method: methode,
		headers: typ ? { 'content-type': typ } : {},
		body: koerper === undefined ? undefined : typeof koerper === 'string' ? koerper : JSON.stringify(koerper)
	});

export const UNBEKANNT = '11111111-1111-4111-8111-111111111111';

/** Rechte „Büro ohne Preise“: alles außer `preise.sehen` (Plan 1c Task 7). */
export const OHNE_PREISE = ALLE_RECHTE.filter((r) => r !== 'preise.sehen');

export type Umgebung = {
	db: TestDb;
	root: postgres.Sql;
	betriebA: string;
	betriebB: string;
	betriebC: string;
	ids: Record<'chefA' | 'bueroA' | 'monteurA' | 'ohnePreiseA' | 'nurAngeboteA' | 'chefB' | 'chefC', string>;
	chefA: Nutzer;
	bueroA: Nutzer;
	monteurA: Nutzer;
	/** Alle Rechte außer `preise.sehen`. */
	ohnePreiseA: Nutzer;
	/** `angebote.bearbeiten` ohne `preise.sehen` und ohne `katalog.bearbeiten`. */
	nurAngeboteA: Nutzer;
	chefB: Nutzer;
	chefC: Nutzer;
	admin: Nutzer;
	kundeA: string;
	kundeB: string;
	objektA: string;
	auftragA: string;
	auftragB: string;
	alsApp: <T>(betrieb: string, benutzer: string, fn: (tx: postgres.TransactionSql) => Promise<T>) => Promise<T>;
	/** Neuer Auftrag in Betrieb A (Status wählbar), als crm_app angelegt (Nummer wie im Betrieb). */
	neuerAuftrag: (status?: string, titel?: string) => Promise<string>;
};

export async function baueUmgebung(): Promise<Umgebung> {
	const db = await frischeTestDb();
	initDb({ urlApp: db.urlApp, urlAdmin: db.urlAdmin, urlAuth: db.urlAuth });
	const root = postgres(db.urlSuper, { max: 6, onnotice: () => {} });
	const [premium] = await root`select id from app.tarife where schluessel = 'premium'`;
	const [ohne] = await root`
		insert into app.tarife (schluessel, name, module, grenzen)
		values ('ohne-angebote', 'Ohne Angebote', ${['kunden', 'auftraege']}, '{}') returning id`;
	const betrieb = async (name: string, tarif: string) =>
		(await root`insert into app.betriebe (name, tarif_id, abo_status) values (${name}, ${tarif}, 'aktiv') returning id`)[0]
			.id as string;
	const betriebA = await betrieb('Betrieb A', premium.id);
	const betriebB = await betrieb('Betrieb B', premium.id);
	const betriebC = await betrieb('Betrieb C', ohne.id);
	const rolle = async (b: string, name: string, rechte: readonly string[]) =>
		(await root`insert into app.rollen (betrieb_id, name, rechte) values (${b}, ${name}, ${rechte as string[]}) returning id`)[0]
			.id as string;
	const benutzer = async (b: string, rolleId: string, email: string, name: string) =>
		(await root`
			insert into app.benutzer (betrieb_id, email, name, passwort_hash, rolle_id)
			values (${b}, ${email}, ${name}, 'x', ${rolleId}) returning id`)[0].id as string;
	const NUR_ANGEBOTE = ['kunden.lesen', 'auftraege.alle_lesen', 'angebote.bearbeiten'];
	const ids = {
		chefA: await benutzer(betriebA, await rolle(betriebA, 'Chef', VORLAGEN.chef), 'chef-a@beispiel.test', 'Chef A'),
		bueroA: await benutzer(betriebA, await rolle(betriebA, 'Büro', VORLAGEN.buero), 'buero-a@beispiel.test', 'Büro A'),
		monteurA: await benutzer(betriebA, await rolle(betriebA, 'Monteur', VORLAGEN.monteur), 'monteur-a@beispiel.test', 'Ali Monteur'),
		ohnePreiseA: await benutzer(betriebA, await rolle(betriebA, 'Büro ohne Preise', OHNE_PREISE), 'ohne@beispiel.test', 'Ohne Preise'),
		nurAngeboteA: await benutzer(betriebA, await rolle(betriebA, 'Nur Angebote', NUR_ANGEBOTE), 'nur@beispiel.test', 'Nur Angebote'),
		chefB: await benutzer(betriebB, await rolle(betriebB, 'Chef', VORLAGEN.chef), 'chef-b@beispiel.test', 'Chef B'),
		chefC: await benutzer(betriebC, await rolle(betriebC, 'Chef', VORLAGEN.chef), 'chef-c@beispiel.test', 'Chef C')
	};
	const alsApp = <T>(b: string, u: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
		mitBetrieb({ betriebId: b, benutzerId: u }, fn);
	const kunde = async (b: string, nachname: string) =>
		(await root`
			insert into app.kunden (betrieb_id, art, vorname, nachname, strasse, plz, ort)
			values (${b}, 'privat', 'Hans', ${nachname}, 'Lindenweg 3', '22846', 'Norderstedt') returning id`)[0].id as string;
	const kundeA = await kunde(betriebA, 'Müller');
	const kundeB = await kunde(betriebB, 'Fremd');
	const objektA = (await root`
		insert into app.objekte (betrieb_id, kunde_id, bezeichnung, strasse, plz, ort)
		values (${betriebA}, ${kundeA}, 'Haus Müller', 'Lindenweg 3', '22846', 'Norderstedt') returning id`)[0].id as string;
	const auftragIn = async (b: string, u: string, k: string, status = 'anfrage', titel = 'Badsanierung', objekt: string | null = null) => {
		const [z] = await alsApp(b, u, (tx) => tx`
			insert into app.auftraege (betrieb_id, titel, kunde_id, objekt_id) values (${b}, ${titel}, ${k}, ${objekt}) returning id`);
		if (status !== 'anfrage') await root`update app.auftraege set status = ${status} where id = ${z.id}`;
		return z.id as string;
	};
	const auftragA = await auftragIn(betriebA, ids.chefA, kundeA, 'anfrage', 'Badsanierung', objektA);
	const auftragB = await auftragIn(betriebB, ids.chefB, kundeB);
	return {
		db,
		root,
		betriebA,
		betriebB,
		betriebC,
		ids,
		chefA: nutzerVon(ids.chefA, betriebA, VORLAGEN.chef),
		bueroA: nutzerVon(ids.bueroA, betriebA, VORLAGEN.buero),
		monteurA: nutzerVon(ids.monteurA, betriebA, VORLAGEN.monteur),
		ohnePreiseA: nutzerVon(ids.ohnePreiseA, betriebA, OHNE_PREISE),
		nurAngeboteA: nutzerVon(ids.nurAngeboteA, betriebA, NUR_ANGEBOTE),
		chefB: nutzerVon(ids.chefB, betriebB, VORLAGEN.chef),
		chefC: nutzerVon(ids.chefC, betriebC, VORLAGEN.chef),
		admin: nutzerVon('22222222-2222-4222-8222-222222222222', null, [], true),
		kundeA,
		kundeB,
		objektA,
		auftragA,
		auftragB,
		alsApp,
		neuerAuftrag: (status = 'anfrage', titel = 'Fliesen Küche') => auftragIn(betriebA, ids.chefA, kundeA, status, titel)
	};
}

/**
 * Löscht alle Angebote (auch versendete – der Schutz-Trigger greift sonst) samt Positionen; nur für Tests.
 * `session_replication_role = replica` schaltet Trigger ab, deshalb Positionen ausdrücklich zuerst.
 */
export async function leereAngebote(root: postgres.Sql): Promise<void> {
	await root.begin(async (tx) => {
		await tx`set local session_replication_role = replica`;
		await tx`delete from app.angebot_positionen`;
		await tx`delete from app.angebote`;
	});
}

/** Kleines, echtes PNG (Breite × Höhe, ein Graustufen-Bild, unkomprimiert genug für Tests). */
export function testPng(breite = 4, hoehe = 2): Uint8Array {
	const crcTabelle = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (b: Uint8Array) => {
		let c = 0xffffffff;
		for (const x of b) c = crcTabelle[(c ^ x) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
	const chunk = (typ: string, daten: number[]) => {
		const t = [...typ].map((c) => c.charCodeAt(0));
		return [...u32(daten.length), ...t, ...daten, ...u32(crc(new Uint8Array([...t, ...daten])))];
	};
	// Bilddaten: je Zeile Filterbyte 0 + Graustufen-Pixel; zlib „stored“ (unkomprimiert)
	const roh: number[] = [];
	for (let y = 0; y < hoehe; y++) roh.push(0, ...Array.from({ length: breite }, (_, x) => ((x + y) % 2) * 255));
	const adler = (() => {
		let a = 1,
			b = 0;
		for (const x of roh) {
			a = (a + x) % 65521;
			b = (b + a) % 65521;
		}
		return ((b << 16) | a) >>> 0;
	})();
	const bloecke: number[] = [];
	for (let i = 0; i < roh.length || i === 0; i += 65535) {
		const teil = roh.slice(i, i + 65535);
		const letzt = i + 65535 >= roh.length ? 1 : 0;
		bloecke.push(letzt, teil.length & 255, teil.length >> 8, ~teil.length & 255, (~teil.length >> 8) & 255, ...teil);
		if (letzt) break;
	}
	const zlib = [0x78, 0x01, ...bloecke, ...u32(adler)];
	const ihdr = [...u32(breite), ...u32(hoehe), 8, 0, 0, 0, 0];
	return new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		...chunk('IHDR', ihdr),
		...chunk('IDAT', zlib),
		...chunk('IEND', [])
	]);
}
