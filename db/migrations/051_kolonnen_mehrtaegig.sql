-- Plantafel (Wünsche Jamil, msgs 2508, 2510, 2513): Kolonnen und mehrtägige Termine.
--
-- Kolonne: Name, Mitglieder, optional Kolonnenführer und Fahrzeug. Wird eine Kolonne eingeplant, bekommt jedes
-- Mitglied seinen eigenen Einsatz (damit Warnungen, „Meine Aufträge“, Tagesplan und Auslastung unverändert gelten);
-- alle Einsätze dieser Planung tragen dieselbe gruppe_id und die kolonne_id. Mitglieder können je Tag wechseln –
-- einzelne Einsätze lassen sich wie bisher ändern oder löschen.
--
-- Mehrtägig: Ein Termin über mehrere Tage ist ebenfalls eine Gruppe – je Tag (und Person) ein Einsatz mit den
-- täglichen Arbeitszeiten. Die Plantafel zeigt eine Gruppe als durchgehenden Balken; Verschieben und Verlängern
-- ändern die ganze Gruppe.

create table app.kolonnen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 100),
	leiter_id uuid,
	fahrzeug text check (char_length(fahrzeug) <= 100),
	aktiv boolean not null default true,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (leiter_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (leiter_id)
);
create unique index kolonnen_name_idx on app.kolonnen (betrieb_id, lower(btrim(name)));

create table app.kolonnen_mitglieder (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	kolonne_id uuid not null,
	benutzer_id uuid not null,
	primary key (kolonne_id, benutzer_id),
	foreign key (kolonne_id, betrieb_id) references app.kolonnen (id, betrieb_id) on delete cascade,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index kolonnen_mitglieder_benutzer_idx on app.kolonnen_mitglieder (benutzer_id, betrieb_id);

alter table app.einsaetze
	add column gruppe_id uuid,
	add column kolonne_id uuid;
alter table app.einsaetze add constraint einsaetze_kolonne_fk foreign key (kolonne_id, betrieb_id)
	references app.kolonnen (id, betrieb_id) on delete set null (kolonne_id);
create index einsaetze_gruppe_idx on app.einsaetze (gruppe_id, betrieb_id) where gruppe_id is not null;
grant insert (gruppe_id, kolonne_id) on app.einsaetze to crm_app;
grant update (gruppe_id, kolonne_id) on app.einsaetze to crm_app;

create trigger kolonnen_geaendert before update on app.kolonnen for each row execute function app.setze_geaendert();

revoke all on app.kolonnen, app.kolonnen_mitglieder from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.kolonnen, app.kolonnen_mitglieder to crm_app;
grant insert (betrieb_id, name, leiter_id, fahrzeug, aktiv) on app.kolonnen to crm_app;
grant update (name, leiter_id, fahrzeug, aktiv) on app.kolonnen to crm_app;
grant insert (betrieb_id, kolonne_id, benutzer_id) on app.kolonnen_mitglieder to crm_app;

alter table app.kolonnen enable row level security;
alter table app.kolonnen force row level security;
alter table app.kolonnen_mitglieder enable row level security;
alter table app.kolonnen_mitglieder force row level security;
create policy kolonnen_mandant on app.kolonnen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy kolonnen_mitglieder_mandant on app.kolonnen_mitglieder for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger kolonnen_protokoll after insert or update or delete on app.kolonnen
	for each row execute function app.protokolliere('geaendert');
