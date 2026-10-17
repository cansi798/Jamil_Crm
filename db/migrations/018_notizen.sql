-- Notizen zu Aufträgen (Stufe 2a Ergänzung): Freitext-Notizen je Auftrag.
-- Mandantentrennung wie 007/011/013: betrieb_id not null, RLS aktiv und erzwungen, Änderungsprotokoll per app.protokolliere.

create table app.notizen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid not null,
	text text not null check (char_length(text) between 1 and 10000),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	von_benutzer_id uuid,
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id)
);
create index notizen_auftrag_idx on app.notizen (auftrag_id, betrieb_id);
create index notizen_betrieb_idx on app.notizen (betrieb_id, angelegt desc);

-- Rechte
revoke all on app.notizen from public, crm_app, crm_admin, crm_auth;
grant select, insert, delete on app.notizen to crm_app;
grant update (text) on app.notizen to crm_app;
grant select on app.notizen to crm_admin;

-- RLS
alter table app.notizen enable row level security;
alter table app.notizen force row level security;

create policy notizen_mandant on app.notizen
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll
create trigger notizen_protokoll
	after insert or update or delete on app.notizen
	for each row execute function app.protokolliere();