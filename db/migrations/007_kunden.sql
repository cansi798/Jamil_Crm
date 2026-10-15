-- Kunden und Objekte (Baustellen/Einsatzorte) – Task 11.
--
-- Fachtabellen mit betrieb_id not null und strikter Mandantentrennung: Row Level Security ist aktiv UND erzwungen,
-- die Richtlinie vergleicht betrieb_id mit der Sitzungsvariable app.betrieb_id (leer/fehlend => keine Zeile sichtbar,
-- kein Schreiben) – in USING und WITH CHECK. Das ist auch die Voraussetzung dafür, dass der Protokoll-Trigger
-- (Migration 006) im leeren Kontext nichts Fremdes sieht.
--
-- Ein Objekt zeigt über den zusammengesetzten Fremdschlüssel (kunde_id, betrieb_id) auf den Kunden: Fremdschlüssel-
-- prüfungen umgehen RLS, deshalb ist nur so ausgeschlossen, dass ein Objekt auf den Kunden eines anderen Betriebs zeigt.
--
-- crm_app darf lesen, anlegen, ändern (nicht id/betrieb_id/kunde_id: Spaltenrechte) und löschen; crm_admin und crm_auth
-- haben keinen Zugriff. Längengrenzen und Pflichtfelder stehen zusätzlich als Check-Constraints in der Datenbank.

-- unaccent: Sortierschlüssel für Namen, unabhängig von der Sortierung (Collation) der Datenbank – Ä/Ö/Ü sortieren
-- bei A/O/U ein statt hinter Z. Gesucht wird weiterhin mit Umlauten (lower() der Datenbank, siehe kunden.ts).
create extension if not exists unaccent with schema public;

create table app.kunden (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	art text not null check (art in ('privat', 'firma')),
	firma text,
	anrede text,
	vorname text,
	nachname text,
	email public.citext,
	telefon text,
	strasse text,
	-- PLZ ist Freitext (keine Länderannahme: "CH-8001", "A-1010", "12345")
	plz text,
	ort text,
	notiz text,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	-- Ziel des zusammengesetzten Fremdschlüssels aus objekte: Objekt und Kunde müssen im selben Betrieb liegen.
	unique (id, betrieb_id),
	-- Pflichtfelder je Art: Privatkunde braucht Nachnamen, Firmenkunde den Firmennamen.
	constraint kunden_pflicht check (
		(art = 'privat' and nullif(btrim(nachname), '') is not null)
		or (art = 'firma' and nullif(btrim(firma), '') is not null)
	),
	constraint kunden_laengen check (
		char_length(firma) <= 200 and char_length(anrede) <= 50 and char_length(vorname) <= 200
		and char_length(nachname) <= 200 and char_length(email::text) <= 200 and char_length(telefon) <= 50
		and char_length(strasse) <= 200 and char_length(plz) <= 20 and char_length(ort) <= 200
		and char_length(notiz) <= 2000
	)
);
create index kunden_betrieb_idx on app.kunden (betrieb_id);

create table app.objekte (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	kunde_id uuid not null,
	bezeichnung text not null check (nullif(btrim(bezeichnung), '') is not null),
	strasse text,
	plz text,
	ort text,
	notiz text,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id) on delete cascade,
	constraint objekte_laengen check (
		char_length(bezeichnung) <= 200 and char_length(strasse) <= 200 and char_length(plz) <= 20
		and char_length(ort) <= 200 and char_length(notiz) <= 2000
	)
);
create index objekte_kunde_idx on app.objekte (kunde_id, betrieb_id);
create index objekte_betrieb_idx on app.objekte (betrieb_id);

-- geaendert immer fortschreiben, egal wer/wie aktualisiert (läuft mit den Rechten des Aufrufers, braucht keine).
create function app.setze_geaendert()
returns trigger
language plpgsql
as $$
begin
	new.geaendert := now();
	return new;
end;
$$;

create trigger kunden_geaendert before update on app.kunden
	for each row execute function app.setze_geaendert();
create trigger objekte_geaendert before update on app.objekte
	for each row execute function app.setze_geaendert();

-- Rechte
revoke all on app.kunden, app.objekte from public, crm_app, crm_admin, crm_auth;
grant select, insert, delete on app.kunden, app.objekte to crm_app;
-- Update spaltenweise: id, betrieb_id (und bei Objekten kunde_id) ändern sich nie; geaendert pflegt der Trigger.
grant update (art, firma, anrede, vorname, nachname, email, telefon, strasse, plz, ort, notiz) on app.kunden to crm_app;
grant update (bezeichnung, strasse, plz, ort, notiz) on app.objekte to crm_app;

-- Row Level Security (strikt, Ruling aus Task 10)
alter table app.kunden enable row level security;
alter table app.kunden force row level security;
alter table app.objekte enable row level security;
alter table app.objekte force row level security;

create policy kunden_mandant on app.kunden
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create policy objekte_mandant on app.objekte
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll (Migration 006). Keine Geheimnisse in diesen Tabellen; nur "geaendert" bleibt draußen, weil es
-- sich bei jeder Änderung ohnehin mitändert (reines Rauschen im Vorher/Nachher).
create trigger kunden_protokoll
	after insert or update or delete on app.kunden
	for each row execute function app.protokolliere('geaendert');
create trigger objekte_protokoll
	after insert or update or delete on app.objekte
	for each row execute function app.protokolliere('geaendert');
