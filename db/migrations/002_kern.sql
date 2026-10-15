-- Kernschema: Tarife, Betriebe, Rollen, Benutzer, Plattform-Admins, Sitzungen.
-- Mandantentrennung per Row Level Security: Der Betriebskontext steht in der Sitzungsvariable
-- app.betrieb_id (gesetzt per set_config(..., true) innerhalb einer Transaktion). Fehlt sie oder ist sie
-- leer, ergibt der Ausdruck NULL und keine Zeile passt.

create extension if not exists citext with schema public;

create table app.tarife (
	id uuid primary key default gen_random_uuid(),
	schluessel text not null unique,
	name text not null,
	module text[] not null default '{}',
	grenzen jsonb not null default '{}'
);

create table app.betriebe (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	tarif_id uuid not null references app.tarife (id),
	abo_status text not null default 'test'
		check (abo_status in ('test', 'aktiv', 'ueberfaellig', 'gekuendigt', 'gesperrt')),
	abo_ende date,
	angelegt timestamptz not null default now()
);

create table app.rollen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null,
	rechte text[] not null default '{}',
	vorlage text
);
create index rollen_betrieb_idx on app.rollen (betrieb_id);

-- betrieb_id ist nur für Plattform-Admins NULL (Ruling R4); RLS gilt trotzdem, crm_app sieht solche Zeilen nie.
create table app.benutzer (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid references app.betriebe (id) on delete cascade,
	email public.citext not null unique,
	name text not null,
	passwort_hash text not null,
	rolle_id uuid references app.rollen (id),
	aktiv boolean not null default true,
	totp_geheim text,
	totp_aktiv boolean not null default false,
	letzte_aktivitaet timestamptz
);
create index benutzer_betrieb_idx on app.benutzer (betrieb_id);

create table app.plattform_admins (
	benutzer_id uuid primary key references app.benutzer (id) on delete cascade
);

create table app.sitzungen (
	token_hash bytea primary key,
	benutzer_id uuid not null references app.benutzer (id) on delete cascade,
	laeuft_ab timestamptz not null,
	angelegt timestamptz not null default now()
);
create index sitzungen_benutzer_idx on app.sitzungen (benutzer_id);

-- Rechte: crm_app bekommt nur, was fachlich nötig ist. crm_admin bekommt hier nichts
-- (Admin-Zugriff später über SECURITY-DEFINER-Funktionen). sitzungen und plattform_admins: kein Direktzugriff.
revoke all on app.tarife, app.betriebe, app.rollen, app.benutzer, app.plattform_admins, app.sitzungen
	from public, crm_app, crm_admin;

grant select on app.tarife to crm_app;
grant select on app.betriebe to crm_app;
grant select, insert, update, delete on app.rollen to crm_app;
grant select, insert, update, delete on app.benutzer to crm_app;

-- Row Level Security: aktiv und auch für den Tabelleneigentümer erzwungen.
alter table app.betriebe enable row level security;
alter table app.betriebe force row level security;
alter table app.rollen enable row level security;
alter table app.rollen force row level security;
alter table app.benutzer enable row level security;
alter table app.benutzer force row level security;

-- betriebe: nur die eigene Zeile lesen (kein INSERT/UPDATE/DELETE-Grant, daher auch keine Policy dafür).
create policy betriebe_lesen on app.betriebe
	for select to crm_app
	using (id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- rollen und benutzer: SELECT/INSERT/UPDATE/DELETE nur im eigenen Betrieb.
-- USING filtert vorhandene Zeilen (SELECT/UPDATE/DELETE), WITH CHECK prüft neue Werte (INSERT/UPDATE).
create policy rollen_mandant on app.rollen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create policy benutzer_mandant on app.benutzer
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
