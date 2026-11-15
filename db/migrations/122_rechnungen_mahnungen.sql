-- Lexware Phase 3 (Plan docs/superpowers/plans/2026-11-15-lexware-phase3.md, Tasks T7–T9; Jamil #6086/#6093):
-- Rechnungen entstehen in Lexware, das CRM ist die Oberfläche und spiegelt Nummer, PDF und Zahlungsstand.
--
-- 1. app.rechnungen: jede Rechnung, die das CRM kennt – im CRM angestoßen (Dialog am Auftrag) oder beim Abgleich in
--    Lexware gefunden (z. B. Abschlags-/Schlussrechnung, die nur in Lexware angelegt werden kann). Die Lexware-Daten
--    (Nummer, Status, Fälligkeit, Beträge) stehen im Spiegel app.lexware_belege (über lexware_id); hier nur Bezug,
--    Dialog-Snapshot und Phase. Nie Lexware-Daten von Hand ändern (GoBD) – korrigiert wird in Lexware.
-- 2. app.lexware_belege: Zahlungen aus GET /v1/payments/{id} (Teilzahlungen, bezahlt am).
-- 3. Mahnstufen: app.nachfass_stufen (Art „rechnung“) + Gebühr, Pauschale (§ 288 Abs. 5 BGB, nur Firmen),
--    Zinshinweis, Freigabe; app.mahn_konfig (Basiszins, Zahlungsziel). Läufe je Rechnung und Stufe genau einmal.
-- 4. Mail-Zwecke „rechnung“ und „mahnung“, Warteschlangen-Arten, neue Rechte.

-- 1 ——— Rechnungen
create table app.rechnungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	-- rechnung = Gesamt, teil = Teilrechnung (Positionen weggelassen/weniger), abschlag/schluss = nur in Lexware anlegbar
	art text not null check (art in ('rechnung', 'teil', 'abschlag', 'schluss')),
	quelle text not null default 'crm' check (quelle in ('crm', 'lexware')),
	-- vorbereitet = Abschlag/Schluss wartet auf „In Lexware fertigstellen“; wartet = in der Warteschlange
	phase text not null default 'wartet' check (phase in ('vorbereitet', 'wartet', 'angelegt', 'fehler')),
	auftrag_id uuid,
	angebot_id uuid,
	kunde_id uuid,
	lexware_id uuid,
	lexware_typ text check (lexware_typ in ('invoice', 'downpaymentinvoice')),
	vorgaenger_id uuid,
	positionen jsonb not null default '[]' check (jsonb_typeof(positionen) = 'array' and jsonb_array_length(positionen) <= 300),
	netto_cent bigint check (netto_cent between -100000000000 and 100000000000),
	brutto_cent bigint check (brutto_cent between -100000000000 and 100000000000),
	leistung_von date,
	leistung_bis date,
	zahlungsziel_tage smallint check (zahlungsziel_tage between 0 and 120),
	festschreiben boolean not null default false,
	hinweis text check (char_length(hinweis) <= 2000),
	lexware_fehler text check (char_length(lexware_fehler) <= 1000),
	-- Mahnen: Pause bis (inkl.) bzw. ganz aus
	mahnen_pausiert_bis date,
	gesendet_am timestamptz,
	von_benutzer uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	unique (betrieb_id, lexware_id),
	constraint rechnungen_zeitraum check (leistung_bis is null or leistung_von is null or leistung_bis >= leistung_von),
	constraint rechnungen_lexware check (phase <> 'angelegt' or lexware_id is not null),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete set null (auftrag_id),
	foreign key (angebot_id, betrieb_id) references app.angebote (id, betrieb_id) on delete set null (angebot_id),
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id) on delete set null (kunde_id)
);
create index rechnungen_auftrag_idx on app.rechnungen (betrieb_id, auftrag_id);
create index rechnungen_kunde_idx on app.rechnungen (betrieb_id, kunde_id);
-- Doppelklick im Dialog: je Auftrag höchstens eine Rechnung gleichzeitig in der Warteschlange
create unique index rechnungen_eine_wartend on app.rechnungen (betrieb_id, auftrag_id) where phase = 'wartet' and auftrag_id is not null;
create trigger rechnungen_geaendert before update on app.rechnungen for each row execute function app.setze_geaendert();
create trigger rechnungen_protokoll after insert or update or delete on app.rechnungen for each row execute function app.protokolliere('geaendert');

revoke all on app.rechnungen from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.rechnungen to crm_app;
grant insert (betrieb_id, art, quelle, phase, auftrag_id, angebot_id, kunde_id, lexware_id, lexware_typ, vorgaenger_id, positionen,
	netto_cent, brutto_cent, leistung_von, leistung_bis, zahlungsziel_tage, festschreiben, hinweis, von_benutzer) on app.rechnungen to crm_app;
grant update (phase, auftrag_id, kunde_id, lexware_id, lexware_typ, lexware_fehler, mahnen_pausiert_bis, gesendet_am) on app.rechnungen to crm_app;
alter table app.rechnungen enable row level security;
alter table app.rechnungen force row level security;
create policy rechnungen_mandant on app.rechnungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- 2 ——— Zahlungen im Spiegel (GET /v1/payments/{id}: paidDate, paymentItems)
alter table app.lexware_belege
	add column bezahlt_am date,
	add column zahlungen jsonb not null default '[]' check (jsonb_typeof(zahlungen) = 'array' and jsonb_array_length(zahlungen) <= 200),
	add column zahlung_stand timestamptz;
grant insert (bezahlt_am, zahlungen, zahlung_stand), update (bezahlt_am, zahlungen, zahlung_stand) on app.lexware_belege to crm_app;

-- 3 ——— Mahnstufen und Mahn-Einstellungen
alter table app.nachfass_stufen
	add column gebuehr_cent integer not null default 0 check (gebuehr_cent between 0 and 100000),
	add column pauschale_firma boolean not null default false,
	add column zinsen_hinweis boolean not null default false,
	add column freigabe boolean not null default false;
grant insert (gebuehr_cent, pauschale_firma, zinsen_hinweis, freigabe), update (gebuehr_cent, pauschale_firma, zinsen_hinweis, freigabe)
	on app.nachfass_stufen to crm_app;

create table app.mahn_konfig (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	-- Basiszinssatz in Hundertstel-Prozent (1,27 % = 127; kann negativ sein), Bundesbank, halbjährlich prüfen
	basiszins_hundertstel integer not null default 127 check (basiszins_hundertstel between -1000 and 2000),
	zahlungsziel_tage smallint not null default 14 check (zahlungsziel_tage between 0 and 120),
	geaendert timestamptz not null default now()
);
revoke all on app.mahn_konfig from public, crm_app, crm_admin, crm_auth;
grant select, insert (betrieb_id, basiszins_hundertstel, zahlungsziel_tage), update (basiszins_hundertstel, zahlungsziel_tage, geaendert) on app.mahn_konfig to crm_app;
alter table app.mahn_konfig enable row level security;
alter table app.mahn_konfig force row level security;
create policy mahn_konfig_mandant on app.mahn_konfig for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Läufe: Angebot ODER Rechnung (genau eins), je Rechnung und Stufe genau einmal
alter table app.nachfass_laeufe alter column angebot_id drop not null;
alter table app.nachfass_laeufe
	add column rechnung_id uuid,
	-- Mahnung in Lexware (bei Stufe 1–3), Status des Laufs
	add column mahnung_lexware_id uuid,
	add column status text not null default 'offen' check (status in ('offen', 'freigabe', 'wartet', 'bereit', 'gesendet', 'gestoppt', 'fehler')),
	add column zinsen_cent bigint check (zinsen_cent between 0 and 100000000000),
	add column gebuehr_cent bigint check (gebuehr_cent between 0 and 100000000000),
	add constraint nachfass_laeufe_bezug check ((angebot_id is null) <> (rechnung_id is null)),
	add constraint nachfass_laeufe_rechnung_fk foreign key (rechnung_id, betrieb_id) references app.rechnungen (id, betrieb_id) on delete cascade,
	add constraint nachfass_laeufe_rechnung_stufe unique (rechnung_id, stufe_id);
create index nachfass_laeufe_rechnung_idx on app.nachfass_laeufe (rechnung_id, betrieb_id, angelegt);
grant insert (rechnung_id, status, zinsen_cent, gebuehr_cent, mahnung_lexware_id) on app.nachfass_laeufe to crm_app;
grant update (status, mahnung_lexware_id, mail_betreff, mail_html, mail_text, mail_an) on app.nachfass_laeufe to crm_app;

-- 4 ——— Mail-Zwecke, Warteschlange, Rechte
alter table app.mail_vorlagen drop constraint mail_vorlagen_zweck_check;
alter table app.mail_vorlagen add constraint mail_vorlagen_zweck_check
	check (zweck in ('allgemein', 'angebot', 'nachfassen_angebot', 'zahlungserinnerung', 'rechnung', 'mahnung', 'auftragsbestaetigung', 'buchungsbestaetigung', 'portal_link', 'bewertung'));

alter table app.lexware_auftraege drop constraint lexware_auftraege_art_check;
alter table app.lexware_auftraege add constraint lexware_auftraege_art_check check (art in (
	'kontakt_anlegen', 'kontakt_aktualisieren', 'kontakte_abgleichen', 'belege_abgleichen', 'abos_einrichten',
	'angebot_festschreiben', 'angebot_versand', 'ab_anlegen', 'ab_versand',
	'rechnung_anlegen', 'rechnung_holen', 'zahlung_holen', 'mahnung_anlegen', 'mahnung_versand'));

alter table app.mail_ausgang drop constraint mail_ausgang_bezug_typ_check;
alter table app.mail_ausgang add constraint mail_ausgang_bezug_typ_check
	check (bezug_typ in ('angebot', 'auftrag', 'auftragsbestaetigung', 'kunde', 'buchung', 'protokoll', 'lexware_beleg', 'rechnung'));

-- Rechnungen sehen/erstellen: wer Angebote bearbeitet und Preise sieht (Chef, Büro); Mahnungen: Chef/Einstellungen und Büro
update app.rollen set rechte = array_append(rechte, 'rechnungen.sehen')
where (vorlage in ('chef', 'buero') or ('angebote.bearbeiten' = any (rechte) and 'preise.sehen' = any (rechte))) and not ('rechnungen.sehen' = any (rechte));
update app.rollen set rechte = array_append(rechte, 'rechnungen.erstellen')
where (vorlage in ('chef', 'buero') or ('angebote.bearbeiten' = any (rechte) and 'preise.sehen' = any (rechte))) and not ('rechnungen.erstellen' = any (rechte));
update app.rollen set rechte = array_append(rechte, 'mahnungen.verwalten')
where (vorlage in ('chef', 'buero') or 'einstellungen' = any (rechte)) and not ('mahnungen.verwalten' = any (rechte));
