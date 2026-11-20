-- Erinnerung „Rechnung erstellen“ bei Abnahme (Jamil, Talk „CRM System“ msgs 6525/6527/6530, 20.11.2026):
-- Wechselt ein Auftrag auf „Abgenommen“, legt das CRM nur eine Aufgabe „Rechnung für Auftrag <Nr> erstellen“ an – keinen
-- Rechnungsentwurf. Wem sie zugewiesen wird, bestimmt der Betrieb selbst (msg 6530):
--   standard = Büro, sonst wer Rechnungen erstellen darf (Chef vorn) – wie bisher
--   person   = eine feste Person (benutzer_id)
--   rolle    = die erste aktive Person mit dieser Rolle (rolle_id)
-- Ohne Zeile gilt „standard“. Ist die gewählte Person/Rolle nicht (mehr) aktiv, gilt ebenfalls „standard“.
create table app.rechnung_erinnerung_einstellung (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	id uuid not null unique default gen_random_uuid(),
	zuweisung text not null default 'standard' check (zuweisung in ('standard', 'person', 'rolle')),
	benutzer_id uuid,
	rolle_id uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (benutzer_id),
	foreign key (rolle_id, betrieb_id) references app.rollen (id, betrieb_id) on delete set null (rolle_id)
);
create trigger rechnung_erinnerung_einstellung_geaendert before update on app.rechnung_erinnerung_einstellung
	for each row execute function app.setze_geaendert();
create trigger rechnung_erinnerung_einstellung_protokoll after insert or update or delete on app.rechnung_erinnerung_einstellung
	for each row execute function app.protokolliere('geaendert');

revoke all on app.rechnung_erinnerung_einstellung from public, crm_app, crm_admin, crm_auth;
grant select on app.rechnung_erinnerung_einstellung to crm_app;
grant insert (betrieb_id, zuweisung, benutzer_id, rolle_id) on app.rechnung_erinnerung_einstellung to crm_app;
grant update (zuweisung, benutzer_id, rolle_id) on app.rechnung_erinnerung_einstellung to crm_app;
alter table app.rechnung_erinnerung_einstellung enable row level security;
alter table app.rechnung_erinnerung_einstellung force row level security;
create policy rechnung_erinnerung_einstellung_mandant on app.rechnung_erinnerung_einstellung for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
