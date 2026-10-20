-- Auftragsquellen (Wunsch Jamil msg 2593): Woher kommt der Auftrag? Zentral gepflegt (Name, aktiv, Reihenfolge),
-- je Auftrag eine Quelle (für neue Aufträge Pflicht in der Oberfläche, bei alten optional). Auswertung je Quelle.

create table app.auftrag_quellen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 100),
	aktiv boolean not null default true,
	sortierung integer not null default 0,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id)
);
create unique index auftrag_quellen_name_idx on app.auftrag_quellen (betrieb_id, lower(btrim(name)));

alter table app.auftraege add column quelle_id uuid;
alter table app.auftraege add constraint auftraege_quelle_fk foreign key (quelle_id, betrieb_id)
	references app.auftrag_quellen (id, betrieb_id) on delete set null (quelle_id);
create index auftraege_quelle_idx on app.auftraege (quelle_id, betrieb_id);
grant insert (quelle_id) on app.auftraege to crm_app;
grant update (quelle_id) on app.auftraege to crm_app;

create trigger auftrag_quellen_geaendert before update on app.auftrag_quellen for each row execute function app.setze_geaendert();

revoke all on app.auftrag_quellen from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.auftrag_quellen to crm_app;
grant insert (betrieb_id, name, aktiv, sortierung) on app.auftrag_quellen to crm_app;
grant update (name, aktiv, sortierung) on app.auftrag_quellen to crm_app;

alter table app.auftrag_quellen enable row level security;
alter table app.auftrag_quellen force row level security;
create policy auftrag_quellen_mandant on app.auftrag_quellen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger auftrag_quellen_protokoll after insert or update or delete on app.auftrag_quellen
	for each row execute function app.protokolliere('geaendert');

-- Startliste für alle bestehenden Betriebe (neue Betriebe bekommen sie beim ersten Lesen)
insert into app.auftrag_quellen (betrieb_id, name, sortierung)
select b.id, q.name, q.nr
from app.betriebe b
cross join (values ('Website', 1), ('Hornbach', 2), ('Obi', 3), ('Empfehlung', 4), ('Zeitung', 5), ('MyHammer', 6),
	('Telefon', 7), ('Sonstiges', 8)) as q (name, nr);
