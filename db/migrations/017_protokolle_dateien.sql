-- Fotos, Notizen und Baustellen-Protokolle (Stufe 2a): app.dateien (Fotos/PDFs je Auftrag, max 10 MB, in DB als bytea)
-- und app.baustellen_protokolle (Abnahme, Regiebericht, Aufmaß, Mängelliste) mit Unterschrift und PDF.
-- Mandantentrennung wie 007/011/013: betrieb_id not null, RLS aktiv und erzwungen, Änderungsprotokoll per app.protokolliere.

-- Dateien (Fotos, PDFs, Dokumente) zu Aufträgen.
create table app.dateien (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid not null,
	name text not null check (char_length(name) between 1 and 255),
	typ text not null check (char_length(typ) between 1 and 100),
	groesse integer not null check (groesse > 0 and groesse <= 10485760),
	inhalt bytea not null,
	beschreibung text check (char_length(beschreibung) <= 500),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade
);
create index dateien_auftrag_idx on app.dateien (auftrag_id, betrieb_id);
create index dateien_betrieb_idx on app.dateien (betrieb_id, angelegt desc);

-- Baustellen-Protokolle (Abnahme, Regiebericht, Aufmaß, Mängelliste).
create table app.baustellen_protokolle (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid not null,
	typ text not null check (typ in ('abnahme', 'regiebericht', 'aufmass', 'maengelliste')),
	inhalt jsonb not null default '{}',
	unterschrift bytea check (unterschrift is null or octet_length(unterschrift) <= 512000),
	pdf bytea,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	von_benutzer_id uuid,
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id)
);
create index protokolle_auftrag_idx on app.baustellen_protokolle (auftrag_id, betrieb_id);
create index protokolle_betrieb_idx on app.baustellen_protokolle (betrieb_id, angelegt desc);

-- Rechte. id, betrieb_id, angelegt, geaendert setzen nie die Anwendung.
revoke all on app.dateien, app.baustellen_protokolle from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.dateien to crm_app;
grant insert (betrieb_id, auftrag_id, name, typ, groesse, inhalt, beschreibung) on app.dateien to crm_app;
grant update (beschreibung) on app.dateien to crm_app;

grant select, delete on app.baustellen_protokolle to crm_app;
grant insert (betrieb_id, auftrag_id, typ, inhalt, von_benutzer_id) on app.baustellen_protokolle to crm_app;
grant update (inhalt, unterschrift, pdf) on app.baustellen_protokolle to crm_app;

-- Row Level Security (strikt).
alter table app.dateien enable row level security;
alter table app.dateien force row level security;
alter table app.baustellen_protokolle enable row level security;
alter table app.baustellen_protokolle force row level security;

create policy dateien_mandant on app.dateien
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy protokolle_mandant on app.baustellen_protokolle
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Trigger: geaendert aktualisieren.
create trigger dateien_geaendert before update on app.dateien
	for each row execute function app.setze_geaendert();
create trigger protokolle_geaendert before update on app.baustellen_protokolle
	for each row execute function app.setze_geaendert();

-- Trigger: Änderungsprotokoll. inhalt (JSON, kann groß sein) und bytea-Felder nie ins Protokoll.
create trigger dateien_protokoll
	after insert or update or delete on app.dateien
	for each row execute function app.protokolliere('geaendert', 'inhalt');
create trigger protokolle_protokoll
	after insert or update or delete on app.baustellen_protokolle
	for each row execute function app.protokolliere('geaendert', 'inhalt', 'unterschrift', 'pdf');