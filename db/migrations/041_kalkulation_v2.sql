-- Kalkulation v2 (Wunsch Jamil, msgs 2515/2516, Excel „Gewinnkalkulation“): freie Kostenzeilen statt einer
-- Gemeinkosten-Summe, Kosten je Mitarbeiter mit produktiven Tagen und effektiven Stunden.
--
--   Kosten-Stundensatz  = (Summe Kostenzeilen pro Jahr + Personalkosten) / Summe produktiver Stunden
--   Verrechnungssatz    = Kosten-Stundensatz × (1 + Wagnis % + Gewinn %)
--
-- Kostenzeile: Name, Kategorie, Nettobetrag, Intervall (monatlich, jährlich, einmalig mit Abschreibung in Monaten).
-- Produktive Stunden je Mitarbeiter = Tage im Jahr × effektive Stunden pro Tag (Standard des Betriebs, je Mitarbeiter
-- überschreibbar). Vertraulich wie v1: kein Änderungsprotokoll, Zugriff nur mit „Preise sehen“ + „Einstellungen“.

create table app.kalkulation_kosten (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 200),
	kategorie text not null check (kategorie in ('fixkosten', 'fahrzeug', 'versicherung', 'software', 'personal', 'sonstiges')),
	betrag_cent bigint not null check (betrag_cent between 0 and 100000000000),
	intervall text not null check (intervall in ('monatlich', 'jaehrlich', 'einmalig')),
	abschreibung_monate smallint check (abschreibung_monate between 1 and 600),
	aktiv boolean not null default true,
	sortierung integer not null default 0,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	constraint kalkulation_kosten_abschreibung check ((intervall = 'einmalig') = (abschreibung_monate is not null))
);
create index kalkulation_kosten_betrieb_idx on app.kalkulation_kosten (betrieb_id, sortierung, angelegt);

create trigger kalkulation_kosten_geaendert before update on app.kalkulation_kosten
	for each row execute function app.setze_geaendert();

alter table app.kalkulation_betrieb
	add column standard_tage numeric(5, 1) not null default 210 check (standard_tage between 0 and 366),
	add column standard_stunden_tag numeric(4, 2) not null default 7 check (standard_stunden_tag > 0 and standard_stunden_tag <= 24);
grant insert (standard_tage, standard_stunden_tag) on app.kalkulation_betrieb to crm_app;
grant update (standard_tage, standard_stunden_tag) on app.kalkulation_betrieb to crm_app;

-- Mitarbeiter: Tage/Stunden je Person überschreibbar (leer = Standard des Betriebs); die v1-Felder bleiben, werden aber
-- nicht mehr gerechnet und bekommen Standardwerte für neue Zeilen.
alter table app.kalkulation_mitarbeiter
	add column tage_jahr numeric(5, 1) check (tage_jahr between 0 and 366),
	add column stunden_tag numeric(4, 2) check (stunden_tag > 0 and stunden_tag <= 24),
	alter column wochenstunden set default 40,
	alter column urlaubstage set default 0,
	alter column krankheitstage set default 0;
grant insert (tage_jahr, stunden_tag) on app.kalkulation_mitarbeiter to crm_app;
grant update (tage_jahr, stunden_tag) on app.kalkulation_mitarbeiter to crm_app;

revoke all on app.kalkulation_kosten from public, crm_app, crm_admin, crm_auth;
grant select, delete on app.kalkulation_kosten to crm_app;
grant insert (betrieb_id, name, kategorie, betrag_cent, intervall, abschreibung_monate, aktiv, sortierung)
	on app.kalkulation_kosten to crm_app;
grant update (name, kategorie, betrag_cent, intervall, abschreibung_monate, aktiv, sortierung) on app.kalkulation_kosten to crm_app;

alter table app.kalkulation_kosten enable row level security;
alter table app.kalkulation_kosten force row level security;
create policy kalkulation_kosten_mandant on app.kalkulation_kosten
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Bisherige Gemeinkosten-Summe (v1) als eine Kostenzeile übernehmen – nichts geht verloren.
insert into app.kalkulation_kosten (betrieb_id, name, kategorie, betrag_cent, intervall)
select betrieb_id, 'Gemeinkosten (Summe aus der bisherigen Kalkulation)', 'sonstiges', gemeinkosten_cent, 'jaehrlich'
from app.kalkulation_betrieb where gemeinkosten_cent > 0;
