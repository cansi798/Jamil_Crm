-- Angebots-Vorlagen – Jamils Wunsch (19.10.2026): „es sollen auch Angebotsvorlagen erstellbar sein“.
--
-- Eine Vorlage = Name + optional Einleitung/Schlusstext + geordnete Positionen. Eine Position ist entweder aus dem
-- Katalog (katalog_position_id gesetzt, KEIN Preis: der kommt beim Einfügen ins Angebot aus dem aktuellen Katalog)
-- oder frei (Bezeichnung, Einheit, Preis). Bezeichnung und Einheit werden auch bei Katalogpositionen gespeichert –
-- verschwindet die Katalogposition, bleibt die Vorlagenzeile als freie Position (ohne Preis) erhalten.
--
-- Wie in 013/020: betrieb_id not null, RLS aktiv UND erzwungen, zusammengesetzte Fremdschlüssel (x_id, betrieb_id).

create table app.angebot_vorlagen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null,
	einleitung text,
	schluss text,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	constraint angebot_vorlagen_laengen check (
		char_length(btrim(name)) between 1 and 100 and char_length(name) <= 100
		and char_length(einleitung) <= 2000 and char_length(schluss) <= 2000
	)
);

create table app.angebot_vorlagen_positionen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	vorlage_id uuid not null,
	pos smallint not null check (pos between 1 and 200),
	katalog_position_id uuid,
	bezeichnung text not null,
	beschreibung text,
	menge numeric(12, 3) not null check (menge > 0 and menge <= 1000000),
	einheit app.einheit not null,
	-- nur freie Positionen haben einen Preis; Katalogpositionen holen ihn beim Einfügen
	einzelpreis_cent bigint check (einzelpreis_cent between 0 and 1000000000),
	unique (id, betrieb_id),
	constraint angebot_vorlagen_positionen_pos unique (vorlage_id, pos) deferrable initially deferred,
	foreign key (vorlage_id, betrieb_id) references app.angebot_vorlagen (id, betrieb_id) on delete cascade,
	foreign key (katalog_position_id, betrieb_id) references app.katalog_positionen (id, betrieb_id)
		on delete set null (katalog_position_id),
	constraint angebot_vorlagen_positionen_preis check (katalog_position_id is null or einzelpreis_cent is null),
	constraint angebot_vorlagen_positionen_laengen check (
		char_length(btrim(bezeichnung)) between 1 and 200 and char_length(bezeichnung) <= 200
		and char_length(beschreibung) <= 2000
	)
);

create index angebot_vorlagen_betrieb_idx on app.angebot_vorlagen (betrieb_id);
create index angebot_vorlagen_positionen_vorlage_idx on app.angebot_vorlagen_positionen (vorlage_id, betrieb_id);
create index angebot_vorlagen_positionen_katalog_idx on app.angebot_vorlagen_positionen (katalog_position_id, betrieb_id);

create trigger angebot_vorlagen_geaendert before update on app.angebot_vorlagen
	for each row execute function app.setze_geaendert();

-- Rechte (Positionen werden beim Ändern komplett ersetzt: delete + insert, kein update nötig)
revoke all on app.angebot_vorlagen, app.angebot_vorlagen_positionen from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.angebot_vorlagen, app.angebot_vorlagen_positionen to crm_app;
grant insert (betrieb_id, name, einleitung, schluss) on app.angebot_vorlagen to crm_app;
grant update (name, einleitung, schluss) on app.angebot_vorlagen to crm_app;
grant insert (betrieb_id, vorlage_id, pos, katalog_position_id, bezeichnung, beschreibung, menge, einheit, einzelpreis_cent)
	on app.angebot_vorlagen_positionen to crm_app;

alter table app.angebot_vorlagen enable row level security;
alter table app.angebot_vorlagen force row level security;
alter table app.angebot_vorlagen_positionen enable row level security;
alter table app.angebot_vorlagen_positionen force row level security;

create policy angebot_vorlagen_mandant on app.angebot_vorlagen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create policy angebot_vorlagen_positionen_mandant on app.angebot_vorlagen_positionen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll: nur der Kopf (ohne Preise); die Positionen werden bei jeder Änderung ersetzt
create trigger angebot_vorlagen_protokoll
	after insert or update or delete on app.angebot_vorlagen
	for each row execute function app.protokolliere('geaendert');
