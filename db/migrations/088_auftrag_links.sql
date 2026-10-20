-- Links am Auftrag (Wunsch Jamil, Talk msg 2850): Webadressen, die für Monteure wichtig sind – z. B. das Portal eines
-- Partners, über das Abnahmeprotokolle kommen. Titel, Adresse (nur http/https), Notiz; optional im Kundenportal
-- sichtbar (Standard: aus). Änderungen stehen im Verlauf des Auftrags.

create table app.auftrag_links (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid not null,
	titel text not null check (char_length(btrim(titel)) between 1 and 200),
	-- nur http/https, keine Leer- oder Steuerzeichen (javascript:, data: usw. sind damit ausgeschlossen)
	url text not null check (char_length(url) <= 2000 and url ~ '^https?://[^\s<>"''`\\]+$'),
	notiz text check (char_length(notiz) <= 500),
	im_portal boolean not null default false,
	sortierung integer not null default 0,
	angelegt_von uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (angelegt_von, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (angelegt_von)
);
create index auftrag_links_auftrag_idx on app.auftrag_links (auftrag_id, betrieb_id, sortierung);

create trigger auftrag_links_geaendert before update on app.auftrag_links for each row execute function app.setze_geaendert();

revoke all on app.auftrag_links from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.auftrag_links to crm_app;
grant insert (betrieb_id, auftrag_id, titel, url, notiz, im_portal, sortierung, angelegt_von) on app.auftrag_links to crm_app;
grant update (titel, url, notiz, im_portal, sortierung) on app.auftrag_links to crm_app;

alter table app.auftrag_links enable row level security;
alter table app.auftrag_links force row level security;
create policy auftrag_links_mandant on app.auftrag_links for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger auftrag_links_protokoll after insert or update or delete on app.auftrag_links
	for each row execute function app.protokolliere('geaendert');
