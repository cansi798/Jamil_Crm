-- Foto-Aufmaß mit KI (Wunsch Jamil, Talk msgs 2770–2774 Punkt 8, Änderung msg 2780).
--
-- Jede KI-Schätzung wird gespeichert – mit den Eingaben des Nutzers (nur Zahlen und Raumart: Wand-/Bodenfläche,
-- Raumhöhe, Anzahl WC/Dusche …, Referenzmaß), dem Ergebnis der KI, dem, was der Nutzer am Ende übernommen hat
-- (korrigiert oder bestätigt), und später dem tatsächlichen Verbrauch aus Zeiterfassung/Material. Daraus lernt das
-- CRM: Kalibrierfaktoren je Menge und Beispiele für die KI (src/lib/foto-aufmass.ts). Keine Fotos, keine Kundendaten.

create table app.aufmass_schaetzungen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid,
	angelegt_von uuid,
	raumart text not null check (raumart in ('bad', 'gaeste_wc', 'kueche', 'flur', 'wohnraum', 'sonstiges')),
	eingaben jsonb not null check (jsonb_typeof(eingaben) = 'object' and pg_column_size(eingaben) <= 8192),
	ki jsonb not null check (jsonb_typeof(ki) = 'object' and pg_column_size(ki) <= 65536),
	-- vom Nutzer übernommene Werte (Mengen und Positionen) – leer, solange nicht übernommen
	final jsonb check (final is null or (jsonb_typeof(final) = 'object' and pg_column_size(final) <= 65536)),
	-- tatsächlicher Verbrauch (aus dem Auftrag), sobald bekannt
	ist jsonb check (ist is null or (jsonb_typeof(ist) = 'object' and pg_column_size(ist) <= 8192)),
	status text not null default 'entwurf' check (status in ('entwurf', 'uebernommen', 'verworfen')),
	angebot_id uuid,
	-- auf wie vielen früheren Schätzungen Kalibrierung und Beispiele beruhten
	basis_n integer not null default 0 check (basis_n between 0 and 100000),
	konfidenz numeric(3, 2) check (konfidenz between 0 and 1),
	fotos smallint not null default 0 check (fotos between 0 and 10),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete set null (auftrag_id),
	foreign key (angelegt_von, betrieb_id) references app.benutzer (id, betrieb_id),
	foreign key (angebot_id, betrieb_id) references app.angebote (id, betrieb_id) on delete set null (angebot_id)
);
create index aufmass_schaetzungen_lernen_idx on app.aufmass_schaetzungen (betrieb_id, raumart, status, angelegt desc);
create index aufmass_schaetzungen_auftrag_idx on app.aufmass_schaetzungen (auftrag_id, betrieb_id);

create trigger aufmass_schaetzungen_geaendert before update on app.aufmass_schaetzungen for each row execute function app.setze_geaendert();

revoke all on app.aufmass_schaetzungen from public, crm_app, crm_admin, crm_auth;
grant select on app.aufmass_schaetzungen to crm_app;
grant insert (betrieb_id, auftrag_id, angelegt_von, raumart, eingaben, ki, basis_n, konfidenz, fotos) on app.aufmass_schaetzungen to crm_app;
grant update (final, ist, status, angebot_id) on app.aufmass_schaetzungen to crm_app;

alter table app.aufmass_schaetzungen enable row level security;
alter table app.aufmass_schaetzungen force row level security;
create policy aufmass_schaetzungen_mandant on app.aufmass_schaetzungen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger aufmass_schaetzungen_protokoll after insert or update or delete on app.aufmass_schaetzungen
	for each row execute function app.protokolliere('geaendert');
