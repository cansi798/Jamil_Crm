-- Wünsche Jamil (19.10.2026), Phase 2 – Aufträge:
--   1. Termine (Einsätze) haben eine Art: Besichtigung, Montage oder Wartung. Bestehende Einsätze sind Montage.
--   2. Zuständige Mitarbeiter je Auftrag (mehrere). Zuständige sehen den Auftrag (wie bei To-dos und Einsätzen).

alter table app.einsaetze add column art text not null default 'montage'
	check (art in ('besichtigung', 'montage', 'wartung'));
grant insert (art) on app.einsaetze to crm_app;
grant update (art) on app.einsaetze to crm_app;

create table app.auftrag_zustaendige (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid not null,
	benutzer_id uuid not null,
	angelegt timestamptz not null default now(),
	primary key (auftrag_id, benutzer_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete cascade
);
create index auftrag_zustaendige_benutzer_idx on app.auftrag_zustaendige (benutzer_id, betrieb_id);

revoke all on app.auftrag_zustaendige from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.auftrag_zustaendige to crm_app;
grant insert (betrieb_id, auftrag_id, benutzer_id) on app.auftrag_zustaendige to crm_app;

alter table app.auftrag_zustaendige enable row level security;
alter table app.auftrag_zustaendige force row level security;
create policy auftrag_zustaendige_mandant on app.auftrag_zustaendige
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
