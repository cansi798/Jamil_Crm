-- Auftragskarte (Wunsch Jamil msg 2602): Koordinaten zu Adressen, je Betrieb zwischengespeichert. Gesucht wird auf
-- dem Server über Nominatim (OpenStreetMap) – höchstens eine Anfrage pro Sekunde, eigener User-Agent. Der Schlüssel ist
-- die Adresse als Text (Objekt, Kunde oder Einmal-Kunde); ändert sich die Adresse, wird neu gesucht.

create table app.geo_adressen (
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	adresse text not null check (char_length(adresse) between 3 and 400),
	lat double precision check (lat between -90 and 90),
	lng double precision check (lng between -180 and 180),
	status text not null default 'offen' check (status in ('offen', 'gefunden', 'nicht_gefunden', 'fehler')),
	versuche smallint not null default 0,
	abgefragt timestamptz,
	angelegt timestamptz not null default now(),
	primary key (betrieb_id, adresse),
	constraint geo_koordinaten check ((status = 'gefunden') = (lat is not null and lng is not null))
);

revoke all on app.geo_adressen from public, crm_app, crm_admin, crm_auth;
grant select on app.geo_adressen to crm_app;
grant insert (betrieb_id, adresse) on app.geo_adressen to crm_app;
grant update (lat, lng, status, versuche, abgefragt) on app.geo_adressen to crm_app;

alter table app.geo_adressen enable row level security;
alter table app.geo_adressen force row level security;
create policy geo_adressen_mandant on app.geo_adressen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
