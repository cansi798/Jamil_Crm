-- Online-Terminbuchung (Wunsch Jamil, Sprachnachrichten 2684/2686): Der Chef legt „Dienste“ an (z. B. „Vor-Ort-Termin“,
-- „Besichtigung“) mit Dauer, Puffern, Vorlauf, Buchungshorizont, Tagesgrenze, Ort und Farbe und ordnet ihnen Mitarbeiter
-- zu – fest einen oder „beliebiger freier Mitarbeiter“ (abwechselnd). Je Dienst (und optional je Dienst + Mitarbeiter)
-- gibt es einen Buchungslink /buchen/<Token>. Wer darüber bucht, bekommt nur die Mitarbeiter dieses Links.
-- Freie Zeiten ergeben sich aus den Arbeitszeiten je Mitarbeiter (optional je Dienst) mit Ausnahmen, abzüglich
-- Einsätzen der Plantafel, Abwesenheiten und anderer Buchungen.
--
-- * app.buchung_dienste, app.buchung_dienst_mitarbeiter, app.buchung_links: Einstellungen (Recht buchung.verwalten).
-- * app.buchung_zeiten, app.buchung_ausnahmen: Verfügbarkeit je Mitarbeiter.
-- * app.buchungen: gebuchte Termine mit Kontaktangaben und Antworten auf die Fragen (Schema-Kopie zum Zeitpunkt der
--   Buchung). Doppelbuchung ist in der Datenbank ausgeschlossen (Ausschluss-Bedingung je Mitarbeiter und Zeitraum);
--   der Server prüft zusätzlich unter einer Sperre gegen Einsätze und Puffer.
-- * app.buchung_einstellungen: Datenschutz-Link und Domains, auf denen die Buchungsseite eingebettet werden darf.
-- * Ohne Anmeldung: Nur zwei SECURITY-DEFINER-Funktionen (für crm_auth) lösen ein Token in Betrieb und Link bzw.
--   Buchung auf. Alles Weitere läuft als crm_app im Betriebskontext (RLS), ohne Benutzer (Protokoll: Quelle
--   „online-buchung“).
--
-- Mandantentrennung wie überall: betrieb_id not null, RLS aktiv und erzwungen, Fremdschlüssel mit (id, betrieb_id).

create extension if not exists btree_gist with schema public;

-- Domains für das Einbetten (CSP frame-ancestors): nur https-Ursprünge, optional mit *. vorne, ohne Pfad
create function app.einbetten_domains_gueltig(p text[])
returns boolean
language sql
immutable
set search_path = app, pg_temp
as $$
	select coalesce(bool_and(d ~ '^https://(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]{1,5})?$' and char_length(d) <= 200), true)
	from unnest(p) as d;
$$;

create table app.buchung_einstellungen (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	id uuid not null unique default gen_random_uuid(),
	datenschutz_url text check (datenschutz_url ~ '^https?://[^\s<>"]+$' and char_length(datenschutz_url) <= 500),
	einbetten_domains text[] not null default '{}'
		check (cardinality(einbetten_domains) <= 20 and app.einbetten_domains_gueltig(einbetten_domains)),
	geaendert timestamptz not null default now()
);

-- Farbe des Betriebs (Buchungsseite; Briefkopf)
alter table app.betrieb_profil add column farbe text check (farbe ~ '^#[0-9a-f]{6}$');
grant insert (farbe) on app.betrieb_profil to crm_app;
grant update (farbe) on app.betrieb_profil to crm_app;

create table app.buchung_dienste (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 100),
	beschreibung text check (char_length(beschreibung) <= 2000),
	dauer_min integer not null default 60 check (dauer_min between 5 and 720),
	puffer_vor_min integer not null default 0 check (puffer_vor_min between 0 and 240),
	puffer_nach_min integer not null default 0 check (puffer_nach_min between 0 and 240),
	-- Mindestvorlauf in Minuten (z. B. 1440 = frühestens morgen um dieselbe Zeit)
	vorlauf_min integer not null default 1440 check (vorlauf_min between 0 and 43200),
	-- Buchungshorizont: höchstens so viele Tage im Voraus
	horizont_tage integer not null default 60 check (horizont_tage between 1 and 365),
	-- höchstens so viele Buchungen dieses Dienstes je Mitarbeiter und Tag (leer = ohne Grenze)
	max_pro_tag integer check (max_pro_tag between 1 and 50),
	ort_art text not null default 'kunde' check (ort_art in ('kunde', 'buero', 'video', 'telefon')),
	farbe text not null default '#0f6cbd' check (farbe ~ '^#[0-9a-f]{6}$'),
	aktiv boolean not null default true,
	modus text not null default 'beliebig' check (modus in ('fest', 'beliebig')),
	einsatz_art text not null default 'besichtigung' check (einsatz_art in ('besichtigung', 'montage', 'wartung')),
	-- Adresse beim Buchen abfragen: Pflicht, freiwillig oder gar nicht
	adresse text not null default 'pflicht' check (adresse in ('pflicht', 'optional', 'aus')),
	-- eigene Fragen (Aufbau wie Protokoll-Vorlagen, src/lib/protokoll-formular.ts)
	fragen jsonb not null default '{"seiten": []}'
		check (jsonb_typeof(fragen) = 'object' and pg_column_size(fragen) <= 262144),
	-- Auftragsquelle für Buchungen über den Standard-Link (Links können eine eigene haben)
	quelle_id uuid,
	sortierung integer not null default 0,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (quelle_id, betrieb_id) references app.auftrag_quellen (id, betrieb_id) on delete set null (quelle_id)
);
create unique index buchung_dienste_name_idx on app.buchung_dienste (betrieb_id, lower(btrim(name)));

create table app.buchung_dienst_mitarbeiter (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	dienst_id uuid not null,
	benutzer_id uuid not null,
	primary key (dienst_id, benutzer_id),
	foreign key (dienst_id, betrieb_id) references app.buchung_dienste (id, betrieb_id) on delete cascade,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index buchung_dienst_mitarbeiter_benutzer_idx on app.buchung_dienst_mitarbeiter (benutzer_id, betrieb_id);

create table app.buchung_links (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	dienst_id uuid not null,
	-- leer = alle Mitarbeiter des Dienstes; sonst nur dieser eine
	benutzer_id uuid,
	-- zufällig, nicht erratbar (24 Bytes, base64url)
	token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
	quelle_id uuid,
	aktiv boolean not null default true,
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	unique nulls not distinct (dienst_id, benutzer_id),
	foreign key (dienst_id, betrieb_id) references app.buchung_dienste (id, betrieb_id) on delete cascade,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade,
	foreign key (quelle_id, betrieb_id) references app.auftrag_quellen (id, betrieb_id) on delete set null (quelle_id)
);

-- Arbeitszeiten für Buchungen je Mitarbeiter und Wochentag (0 = Montag); dienst_id leer = für alle Dienste.
-- Gibt es Zeilen für (Mitarbeiter, Dienst), gelten nur diese für den Dienst.
create table app.buchung_zeiten (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	dienst_id uuid,
	wochentag smallint not null check (wochentag between 0 and 6),
	von time not null,
	bis time not null,
	unique (id, betrieb_id),
	check (bis > von),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade,
	foreign key (dienst_id, betrieb_id) references app.buchung_dienste (id, betrieb_id) on delete cascade
);
create index buchung_zeiten_benutzer_idx on app.buchung_zeiten (betrieb_id, benutzer_id);

-- Ausnahmen: „frei“ = an dem Tag (ganz oder von–bis) nicht buchbar; „zusaetzlich“ = zusätzlich buchbar von–bis
create table app.buchung_ausnahmen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	tag date not null,
	art text not null check (art in ('frei', 'zusaetzlich')),
	von time,
	bis time,
	notiz text check (char_length(notiz) <= 200),
	unique (id, betrieb_id),
	check ((von is null) = (bis is null)),
	check (bis > von),
	check (art = 'frei' or von is not null),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index buchung_ausnahmen_benutzer_idx on app.buchung_ausnahmen (betrieb_id, benutzer_id, tag);

create table app.buchungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	dienst_id uuid not null,
	link_id uuid,
	benutzer_id uuid not null,
	kunde_id uuid,
	objekt_id uuid,
	auftrag_id uuid,
	einsatz_id uuid,
	beginn timestamptz not null,
	ende timestamptz not null,
	status text not null default 'aktiv' check (status in ('aktiv', 'storniert')),
	vorname text check (char_length(vorname) <= 200),
	nachname text not null check (char_length(btrim(nachname)) between 1 and 200),
	email public.citext check (char_length(email::text) <= 200),
	telefon text check (char_length(telefon) <= 50),
	strasse text check (char_length(strasse) <= 200),
	plz text check (char_length(plz) <= 20),
	ort text check (char_length(ort) <= 200),
	-- Fragen des Dienstes zum Zeitpunkt der Buchung (bleiben lesbar, auch wenn der Dienst später geändert wird)
	fragen jsonb not null default '{"seiten": []}' check (jsonb_typeof(fragen) = 'object' and pg_column_size(fragen) <= 262144),
	antworten jsonb not null default '{}' check (jsonb_typeof(antworten) = 'object' and pg_column_size(antworten) <= 524288),
	-- SHA-256 des Verwaltungs-Tokens (Link „Termin absagen/verschieben“); das Token selbst wird nie gespeichert
	verwaltung_hash bytea not null unique check (octet_length(verwaltung_hash) = 32),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	storniert_am timestamptz,
	unique (id, betrieb_id),
	check (ende > beginn and ende - beginn <= interval '14 hours'),
	check ((status = 'storniert') = (storniert_am is not null)),
	foreign key (dienst_id, betrieb_id) references app.buchung_dienste (id, betrieb_id),
	foreign key (link_id, betrieb_id) references app.buchung_links (id, betrieb_id) on delete set null (link_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id),
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id) on delete set null (kunde_id),
	foreign key (objekt_id, betrieb_id) references app.objekte (id, betrieb_id) on delete set null (objekt_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete set null (auftrag_id),
	foreign key (einsatz_id, betrieb_id) references app.einsaetze (id, betrieb_id) on delete set null (einsatz_id),
	-- keine Doppelbuchung: aktive Buchungen eines Mitarbeiters überschneiden sich nie (halboffen, angrenzend erlaubt)
	constraint buchungen_keine_doppelbuchung exclude using gist (
		betrieb_id with =, benutzer_id with =, tstzrange(beginn, ende, '[)') with &&
	) where (status = 'aktiv')
);
create index buchungen_dienst_idx on app.buchungen (dienst_id, betrieb_id, beginn);
create index buchungen_auftrag_idx on app.buchungen (auftrag_id, betrieb_id);
create index buchungen_benutzer_idx on app.buchungen (betrieb_id, benutzer_id, beginn);

create trigger buchung_einstellungen_geaendert before update on app.buchung_einstellungen for each row execute function app.setze_geaendert();
create trigger buchung_dienste_geaendert before update on app.buchung_dienste for each row execute function app.setze_geaendert();
create trigger buchungen_geaendert before update on app.buchungen for each row execute function app.setze_geaendert();

-- Rechte: id, betrieb_id, angelegt, geaendert setzt nie die Anwendung
revoke all on app.buchung_einstellungen, app.buchung_dienste, app.buchung_dienst_mitarbeiter, app.buchung_links,
	app.buchung_zeiten, app.buchung_ausnahmen, app.buchungen from public, crm_app, crm_admin, crm_auth;

grant select on app.buchung_einstellungen to crm_app;
grant insert (betrieb_id, datenschutz_url, einbetten_domains) on app.buchung_einstellungen to crm_app;
grant update (datenschutz_url, einbetten_domains) on app.buchung_einstellungen to crm_app;

grant select, delete on app.buchung_dienste to crm_app;
grant insert (betrieb_id, name, beschreibung, dauer_min, puffer_vor_min, puffer_nach_min, vorlauf_min, horizont_tage, max_pro_tag,
	ort_art, farbe, aktiv, modus, einsatz_art, adresse, fragen, quelle_id, sortierung) on app.buchung_dienste to crm_app;
grant update (name, beschreibung, dauer_min, puffer_vor_min, puffer_nach_min, vorlauf_min, horizont_tage, max_pro_tag,
	ort_art, farbe, aktiv, modus, einsatz_art, adresse, fragen, quelle_id, sortierung) on app.buchung_dienste to crm_app;

grant select, delete on app.buchung_dienst_mitarbeiter to crm_app;
grant insert (betrieb_id, dienst_id, benutzer_id) on app.buchung_dienst_mitarbeiter to crm_app;

grant select, delete on app.buchung_links to crm_app;
grant insert (betrieb_id, dienst_id, benutzer_id, token, quelle_id, aktiv) on app.buchung_links to crm_app;
grant update (token, quelle_id, aktiv) on app.buchung_links to crm_app;

grant select, delete on app.buchung_zeiten to crm_app;
grant insert (betrieb_id, benutzer_id, dienst_id, wochentag, von, bis) on app.buchung_zeiten to crm_app;

grant select, delete on app.buchung_ausnahmen to crm_app;
grant insert (betrieb_id, benutzer_id, tag, art, von, bis, notiz) on app.buchung_ausnahmen to crm_app;

-- Buchungen löscht niemand (nur stornieren); das Verwaltungs-Token-Hash wird nur angelegt
grant select on app.buchungen to crm_app;
grant insert (betrieb_id, dienst_id, link_id, benutzer_id, kunde_id, objekt_id, auftrag_id, einsatz_id, beginn, ende, vorname,
	nachname, email, telefon, strasse, plz, ort, fragen, antworten, verwaltung_hash) on app.buchungen to crm_app;
grant update (benutzer_id, einsatz_id, beginn, ende, status, storniert_am) on app.buchungen to crm_app;

-- Row Level Security (strikt)
alter table app.buchung_einstellungen enable row level security;
alter table app.buchung_einstellungen force row level security;
alter table app.buchung_dienste enable row level security;
alter table app.buchung_dienste force row level security;
alter table app.buchung_dienst_mitarbeiter enable row level security;
alter table app.buchung_dienst_mitarbeiter force row level security;
alter table app.buchung_links enable row level security;
alter table app.buchung_links force row level security;
alter table app.buchung_zeiten enable row level security;
alter table app.buchung_zeiten force row level security;
alter table app.buchung_ausnahmen enable row level security;
alter table app.buchung_ausnahmen force row level security;
alter table app.buchungen enable row level security;
alter table app.buchungen force row level security;

create policy buchung_einstellungen_mandant on app.buchung_einstellungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy buchung_dienste_mandant on app.buchung_dienste for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy buchung_dienst_mitarbeiter_mandant on app.buchung_dienst_mitarbeiter for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy buchung_links_mandant on app.buchung_links for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy buchung_zeiten_mandant on app.buchung_zeiten for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy buchung_ausnahmen_mandant on app.buchung_ausnahmen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy buchungen_mandant on app.buchungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll (Token und Token-Hash nie)
create trigger buchung_einstellungen_protokoll after insert or update or delete on app.buchung_einstellungen
	for each row execute function app.protokolliere('geaendert');
create trigger buchung_dienste_protokoll after insert or update or delete on app.buchung_dienste
	for each row execute function app.protokolliere('geaendert');
create trigger buchung_links_protokoll after insert or update or delete on app.buchung_links
	for each row execute function app.protokolliere('token');
create trigger buchungen_protokoll after insert or update or delete on app.buchungen
	for each row execute function app.protokolliere('verwaltung_hash', 'geaendert', 'fragen');

-- Ohne Anmeldung: Token → Link und Betrieb. Nur aktive Links aktiver Dienste von Betrieben, die buchen dürfen (Abo
-- aktiv/Test, Tarif mit Aufträgen und Plantafel). Läuft als Eigentümer, nur für crm_auth (systemAbfrage).
create function app.buchung_link_aufloesen(p_token text)
returns table (link_id uuid, betrieb_id uuid)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select l.id, l.betrieb_id
	from app.buchung_links l
	join app.buchung_dienste d on d.id = l.dienst_id and d.betrieb_id = l.betrieb_id
	join app.betriebe b on b.id = l.betrieb_id
	join app.tarife t on t.id = b.tarif_id
	where p_token ~ '^[A-Za-z0-9_-]{32,64}$' and l.token = p_token and l.aktiv and d.aktiv
		and b.abo_status in ('test', 'aktiv') and t.module @> array['auftraege', 'plantafel']::text[]
$$;
revoke all on function app.buchung_link_aufloesen(text) from public, crm_app, crm_admin;
grant execute on function app.buchung_link_aufloesen(text) to crm_auth;

-- Ohne Anmeldung: Hash des Verwaltungs-Tokens → Buchung und Betrieb
create function app.buchung_verwaltung_aufloesen(p_hash bytea)
returns table (buchung_id uuid, betrieb_id uuid)
language sql
stable
security definer
set search_path = app, pg_temp
as $$
	select v.id, v.betrieb_id from app.buchungen v
	join app.betriebe b on b.id = v.betrieb_id
	where octet_length(p_hash) = 32 and v.verwaltung_hash = p_hash and b.abo_status in ('test', 'aktiv')
$$;
revoke all on function app.buchung_verwaltung_aufloesen(bytea) from public, crm_app, crm_admin;
grant execute on function app.buchung_verwaltung_aufloesen(bytea) to crm_auth;

-- Neues Recht „Online-Buchung verwalten“ für Chef-Rollen und Rollen mit „Einstellungen“
update app.rollen set rechte = array_append(rechte, 'buchung.verwalten')
where (vorlage = 'chef' or 'einstellungen' = any (rechte)) and not ('buchung.verwalten' = any (rechte));

-- Auftragsquelle „Online-Buchung“ für Betriebe, die ihre Quellen-Startliste schon haben (neue bekommen sie mit der Startliste)
insert into app.auftrag_quellen (betrieb_id, name, sortierung, farbe)
select b.id, 'Online-Buchung', coalesce((select max(q.sortierung) from app.auftrag_quellen q where q.betrieb_id = b.id), 0) + 1, '#c239b3'
from app.betriebe b
where exists (select 1 from app.auftrag_quellen q where q.betrieb_id = b.id)
on conflict do nothing;
