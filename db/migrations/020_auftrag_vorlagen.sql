-- Auftrags-To-do-Vorlagen – Jamils Wunsch (17.10.2026).
--
-- Vorlagen für wiederkehrende Auftrags-To-dos (z.B. "Wartung Heizung" mit 5 Aufgaben).
-- Beim Anlegen eines Auftrags kann eine Vorlage gewählt werden, die To-dos werden automatisch erstellt.
--
-- Wie in 011: betrieb_id not null, RLS aktiv UND erzwungen, zusammengesetzte Fremdschlüssel (x_id, betrieb_id).

create table app.auftrag_vorlagen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null,
	beschreibung text,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	constraint auftrag_vorlagen_laengen check (
		char_length(btrim(name)) between 1 and 100 and char_length(name) <= 100
		and char_length(beschreibung) <= 500
	)
);

create table app.auftrag_vorlagen_todos (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	vorlage_id uuid not null,
	titel text not null,
	beschreibung text,
	sortierung int not null default 0,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (vorlage_id, betrieb_id) references app.auftrag_vorlagen (id, betrieb_id) on delete cascade,
	constraint auftrag_vorlagen_todos_laengen check (
		char_length(btrim(titel)) between 1 and 200 and char_length(titel) <= 200
		and char_length(beschreibung) <= 500
	)
);

create index auftrag_vorlagen_betrieb_idx on app.auftrag_vorlagen (betrieb_id);
create index auftrag_vorlagen_todos_vorlage_idx on app.auftrag_vorlagen_todos (vorlage_id, betrieb_id);

-- Trigger für geaendert
create trigger auftrag_vorlagen_geaendert before update on app.auftrag_vorlagen
	for each row execute function app.setze_geaendert();
create trigger auftrag_vorlagen_todos_geaendert before update on app.auftrag_vorlagen_todos
	for each row execute function app.setze_geaendert();

-- Rechte
revoke all on app.auftrag_vorlagen, app.auftrag_vorlagen_todos from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.auftrag_vorlagen, app.auftrag_vorlagen_todos to crm_app;
grant insert (betrieb_id, name, beschreibung) on app.auftrag_vorlagen to crm_app;
grant update (name, beschreibung) on app.auftrag_vorlagen to crm_app;
grant insert (betrieb_id, vorlage_id, titel, beschreibung, sortierung) on app.auftrag_vorlagen_todos to crm_app;
grant update (titel, beschreibung, sortierung) on app.auftrag_vorlagen_todos to crm_app;

-- Row Level Security (strikt)
alter table app.auftrag_vorlagen enable row level security;
alter table app.auftrag_vorlagen force row level security;
alter table app.auftrag_vorlagen_todos enable row level security;
alter table app.auftrag_vorlagen_todos force row level security;

create policy auftrag_vorlagen_mandant on app.auftrag_vorlagen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create policy auftrag_vorlagen_todos_mandant on app.auftrag_vorlagen_todos
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll (nur Vorlagen, To-dos sind zu klein)
create trigger auftrag_vorlagen_protokoll
	after insert or update or delete on app.auftrag_vorlagen
	for each row execute function app.protokolliere('geaendert');
