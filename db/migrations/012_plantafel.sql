-- Plantafel: Einsätze und Abwesenheiten – Stufe 1b, Task 5.
--
-- Ein Einsatz plant einen Mitarbeiter für einen Zeitraum in einem Auftrag ein. Zeiten sind Zeitpunkte (timestamptz);
-- Tage, Wochen und „heute“ rechnet die Anwendung in Europe/Berlin (src/lib/zeit.ts). Zeiträume sind halboffen
-- [beginn, ende): 10–12 und 12–14 Uhr überschneiden sich nicht. Ein Einsatz dauert höchstens 14 Stunden.
-- Abwesenheiten (Urlaub, Krankheit, Sonstiges) sind ganztägig; von und bis zählen beide mit.
--
-- Doppelbelegungen und Einsätze während einer Abwesenheit sind erlaubt – die Anwendung warnt nur (Pflichtenheft).
--
-- Mandantentrennung wie 007/011: RLS aktiv und erzwungen, zusammengesetzte Fremdschlüssel (x_id, betrieb_id) auf
-- Auftrag und Benutzer. Wird ein Auftrag gelöscht (nur als Anfrage möglich), fallen seine Einsätze mit. Benutzer
-- werden nie gelöscht (nur deaktiviert); ihre Einsätze und Abwesenheiten bleiben stehen.

create table app.einsaetze (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid not null,
	benutzer_id uuid not null,
	beginn timestamptz not null,
	ende timestamptz not null,
	notiz text,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id),
	constraint einsaetze_zeitraum check (ende > beginn and ende - beginn <= interval '14 hours'),
	constraint einsaetze_laengen check (char_length(notiz) <= 500)
);
-- Plantafel (Woche eines Betriebs), Warnungen und „Meine Einsätze heute“ (je Mitarbeiter nach Beginn)
create index einsaetze_benutzer_idx on app.einsaetze (betrieb_id, benutzer_id, beginn);
create index einsaetze_zeit_idx on app.einsaetze (betrieb_id, beginn);
create index einsaetze_auftrag_idx on app.einsaetze (auftrag_id, betrieb_id);

create table app.abwesenheiten (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	art text not null check (art in ('urlaub', 'krank', 'sonstiges')),
	von date not null,
	bis date not null,
	notiz text,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id),
	constraint abwesenheiten_zeitraum check (bis >= von),
	constraint abwesenheiten_laengen check (char_length(notiz) <= 200)
);
create index abwesenheiten_benutzer_idx on app.abwesenheiten (betrieb_id, benutzer_id, von);
create index abwesenheiten_zeit_idx on app.abwesenheiten (betrieb_id, von, bis);

create trigger einsaetze_geaendert before update on app.einsaetze
	for each row execute function app.setze_geaendert();
create trigger abwesenheiten_geaendert before update on app.abwesenheiten
	for each row execute function app.setze_geaendert();

-- Rechte: id, betrieb_id, angelegt, geaendert setzt nie die Anwendung; der Mitarbeiter einer Abwesenheit ist fest.
revoke all on app.einsaetze, app.abwesenheiten from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.einsaetze, app.abwesenheiten to crm_app;
grant insert (betrieb_id, auftrag_id, benutzer_id, beginn, ende, notiz) on app.einsaetze to crm_app;
grant update (auftrag_id, benutzer_id, beginn, ende, notiz) on app.einsaetze to crm_app;
grant insert (betrieb_id, benutzer_id, art, von, bis, notiz) on app.abwesenheiten to crm_app;
grant update (art, von, bis, notiz) on app.abwesenheiten to crm_app;

alter table app.einsaetze enable row level security;
alter table app.einsaetze force row level security;
alter table app.abwesenheiten enable row level security;
alter table app.abwesenheiten force row level security;

create policy einsaetze_mandant on app.einsaetze
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create policy abwesenheiten_mandant on app.abwesenheiten
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger einsaetze_protokoll
	after insert or update or delete on app.einsaetze
	for each row execute function app.protokolliere('geaendert');
create trigger abwesenheiten_protokoll
	after insert or update or delete on app.abwesenheiten
	for each row execute function app.protokolliere('geaendert');
