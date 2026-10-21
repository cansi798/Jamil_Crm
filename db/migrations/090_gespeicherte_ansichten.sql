-- Gespeicherte Ansichten (Wunsch Jamil, Talk msgs 2830, 2921): Filter einer Seite unter einem Namen speichern und mit
-- einem Klick wieder öffnen – Plantafel, Auftragskarte, Aufträge, Aufgaben, Angebote, Kunden, Zeiten, Nachkalkulation.
-- Gespeichert wird nur der Filter-Teil der Adresse (Query), nie Daten. „Als Standard“ öffnet die Seite mit dieser
-- Ansicht; „fürs Team teilen“ (nur Chef/Büro) macht sie für alle im Betrieb sichtbar – ändern darf nur der Ersteller.

create table app.gespeicherte_ansichten (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	seite text not null check (seite in ('plantafel', 'karte', 'auftraege', 'todos', 'angebote', 'kunden', 'zeiten', 'nachkalkulation')),
	name text not null check (char_length(btrim(name)) between 1 and 80),
	query text not null check (char_length(query) <= 2000 and query !~ '[\s<>"''`\\]'),
	ist_standard boolean not null default false,
	geteilt boolean not null default false,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index gespeicherte_ansichten_idx on app.gespeicherte_ansichten (betrieb_id, seite, benutzer_id);
-- je Benutzer und Seite höchstens ein Standard
create unique index gespeicherte_ansichten_standard_idx on app.gespeicherte_ansichten (benutzer_id, seite) where ist_standard;

create trigger gespeicherte_ansichten_geaendert before update on app.gespeicherte_ansichten for each row execute function app.setze_geaendert();

revoke all on app.gespeicherte_ansichten from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.gespeicherte_ansichten to crm_app;
grant insert (betrieb_id, benutzer_id, seite, name, query, ist_standard, geteilt) on app.gespeicherte_ansichten to crm_app;
grant update (name, query, ist_standard, geteilt) on app.gespeicherte_ansichten to crm_app;

alter table app.gespeicherte_ansichten enable row level security;
alter table app.gespeicherte_ansichten force row level security;
-- lesen: eigene und geteilte des Betriebs
create policy gespeicherte_ansichten_lesen on app.gespeicherte_ansichten for select to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and (benutzer_id = nullif(current_setting('app.benutzer_id', true), '')::uuid or geteilt));
-- schreiben: nur eigene
create policy gespeicherte_ansichten_anlegen on app.gespeicherte_ansichten for insert to crm_app
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id = nullif(current_setting('app.benutzer_id', true), '')::uuid);
create policy gespeicherte_ansichten_aendern on app.gespeicherte_ansichten for update to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id = nullif(current_setting('app.benutzer_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id = nullif(current_setting('app.benutzer_id', true), '')::uuid);
create policy gespeicherte_ansichten_loeschen on app.gespeicherte_ansichten for delete to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id = nullif(current_setting('app.benutzer_id', true), '')::uuid);
