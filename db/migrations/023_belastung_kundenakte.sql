-- Wünsche Jamil (19.10.2026), Phase 1:
--   1. To-dos: „Lautstärke“ und „Schmutz“ je Stufe 1–5 (optional) – z. B. für Arbeiten in bewohnten Räumen.
--   2. Kundenakte: Notizen und Dokumente je Kunde (bisher nur je Auftrag, 017/018).
--
-- Mandantentrennung wie 007/017/018: betrieb_id not null, RLS aktiv und erzwungen, zusammengesetzte Fremdschlüssel.

alter table app.todos add column lautstaerke smallint check (lautstaerke between 1 and 5);
alter table app.todos add column schmutz smallint check (schmutz between 1 and 5);
grant insert (lautstaerke, schmutz) on app.todos to crm_app;
grant update (lautstaerke, schmutz) on app.todos to crm_app;

create table app.kunden_notizen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	kunde_id uuid not null,
	text text not null check (char_length(btrim(text)) between 1 and 10000),
	von_benutzer_id uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id) on delete cascade,
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id)
);
create index kunden_notizen_kunde_idx on app.kunden_notizen (kunde_id, betrieb_id, angelegt desc);

-- Dokumente: höchstens 5 MB (die Vorschau nimmt Anfragen bis 6 MB an), Inhalt als bytea
create table app.kunden_dateien (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	kunde_id uuid not null,
	name text not null check (char_length(btrim(name)) between 1 and 255),
	typ text not null check (char_length(typ) between 1 and 100),
	groesse integer not null check (groesse > 0 and groesse <= 5242880),
	inhalt bytea not null check (octet_length(inhalt) <= 5242880),
	beschreibung text check (char_length(beschreibung) <= 500),
	von_benutzer_id uuid,
	angelegt timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (kunde_id, betrieb_id) references app.kunden (id, betrieb_id) on delete cascade,
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id)
);
create index kunden_dateien_kunde_idx on app.kunden_dateien (kunde_id, betrieb_id, angelegt desc);

create trigger kunden_notizen_geaendert before update on app.kunden_notizen
	for each row execute function app.setze_geaendert();

revoke all on app.kunden_notizen, app.kunden_dateien from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.kunden_notizen, app.kunden_dateien to crm_app;
grant insert (betrieb_id, kunde_id, text, von_benutzer_id) on app.kunden_notizen to crm_app;
grant update (text) on app.kunden_notizen to crm_app;
grant insert (betrieb_id, kunde_id, name, typ, groesse, inhalt, beschreibung, von_benutzer_id) on app.kunden_dateien to crm_app;

alter table app.kunden_notizen enable row level security;
alter table app.kunden_notizen force row level security;
alter table app.kunden_dateien enable row level security;
alter table app.kunden_dateien force row level security;

create policy kunden_notizen_mandant on app.kunden_notizen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy kunden_dateien_mandant on app.kunden_dateien
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll (Datei-Inhalt nie)
create trigger kunden_notizen_protokoll
	after insert or update or delete on app.kunden_notizen
	for each row execute function app.protokolliere('geaendert');
create trigger kunden_dateien_protokoll
	after insert or update or delete on app.kunden_dateien
	for each row execute function app.protokolliere('inhalt');
