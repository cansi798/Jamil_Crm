-- Frei zusammenstellbarer Start (Wunsch Jamil, Talk msg 2942): Jede Person legt ihre Kacheln selbst fest
-- (hinzufügen, entfernen, verschieben, Größe). Gespeichert wird je Benutzer nur die Liste
-- [{ "id": "...", "groesse": "s|m|l|breit", "hoehe": 1|2 }, …] – die App prüft beim Speichern, welche Kacheln die
-- Person sehen darf. Kein Eintrag = Vorgabe der Rolle (Chef/Büro/Monteur); „Standard wiederherstellen“ löscht den
-- Eintrag. Lesen und Schreiben nur die eigene Zeile (RLS).

create table app.start_layouts (
	benutzer_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	kacheln jsonb not null check (jsonb_typeof(kacheln) = 'array' and jsonb_array_length(kacheln) <= 40 and pg_column_size(kacheln) <= 16384),
	geaendert timestamptz not null default now(),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index start_layouts_betrieb_idx on app.start_layouts (betrieb_id);
create trigger start_layouts_geaendert before update on app.start_layouts for each row execute function app.setze_geaendert();

revoke all on app.start_layouts from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.start_layouts to crm_app;
grant insert (benutzer_id, betrieb_id, kacheln) on app.start_layouts to crm_app;
grant update (kacheln) on app.start_layouts to crm_app;

alter table app.start_layouts enable row level security;
alter table app.start_layouts force row level security;
create policy start_layouts_eigene on app.start_layouts for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id = nullif(current_setting('app.benutzer_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and benutzer_id = nullif(current_setting('app.benutzer_id', true), '')::uuid);
