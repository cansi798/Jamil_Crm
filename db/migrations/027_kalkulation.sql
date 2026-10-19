-- Kalkulation / Stundensatz (Wunsch Jamil, 19.10.2026): Firmenwerte (eine Zeile je Betrieb) und Mitarbeiter mit
-- Gehalt, Arbeitszeit und Abwesenheiten. Rechnung: src/lib/kalkulation.ts.
--
-- Geld in ganzen Cent, Prozente/Stunden/Tage als numeric. Gehälter sind vertraulich: kein Änderungsprotokoll (das würde
-- alte und neue Gehälter in app.aenderungen kopieren); Zugriff nur mit „Preise sehen“ + „Einstellungen“ (Anwendung).

create table app.kalkulation_betrieb (
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	jahr smallint not null check (jahr between 2000 and 2100),
	gemeinkosten_cent bigint not null default 0 check (gemeinkosten_cent between 0 and 100000000000),
	anzahl_produktiv numeric(7, 2) not null default 0 check (anzahl_produktiv between 0 and 10000),
	feiertage numeric(5, 1) not null default 10 check (feiertage between 0 and 366),
	puffer_art text not null default 'prozent' check (puffer_art in ('prozent', 'stunden')),
	puffer_wert numeric(8, 2) not null default 0 check (puffer_wert >= 0 and (puffer_art = 'stunden' or puffer_wert <= 100)),
	gewinn_prozent numeric(6, 2) not null default 0 check (gewinn_prozent between 0 and 1000),
	risiko_prozent numeric(6, 2) not null default 0 check (risiko_prozent between 0 and 1000),
	aktueller_satz_cent bigint check (aktueller_satz_cent between 0 and 100000000),
	geaendert timestamptz not null default now()
);

create table app.kalkulation_mitarbeiter (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 200),
	-- optional: Verknüpfung mit einem Benutzer der Software
	benutzer_id uuid,
	brutto_cent bigint not null check (brutto_cent between 0 and 1000000000),
	ag_art text not null check (ag_art in ('prozent', 'euro')),
	ag_prozent numeric(6, 2) check (ag_prozent between 0 and 100),
	ag_euro_cent bigint check (ag_euro_cent between 0 and 1000000000),
	wochenstunden numeric(5, 2) not null check (wochenstunden > 0 and wochenstunden <= 80),
	urlaubstage numeric(5, 1) not null check (urlaubstage between 0 and 366),
	krankheitstage numeric(5, 1) not null check (krankheitstage between 0 and 366),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (benutzer_id),
	constraint kalkulation_ag_passt check (
		(ag_art = 'prozent' and ag_prozent is not null and ag_euro_cent is null)
		or (ag_art = 'euro' and ag_euro_cent is not null and ag_prozent is null)
	)
);
create index kalkulation_mitarbeiter_betrieb_idx on app.kalkulation_mitarbeiter (betrieb_id, angelegt);

create trigger kalkulation_betrieb_geaendert before update on app.kalkulation_betrieb
	for each row execute function app.setze_geaendert();
create trigger kalkulation_mitarbeiter_geaendert before update on app.kalkulation_mitarbeiter
	for each row execute function app.setze_geaendert();

revoke all on app.kalkulation_betrieb, app.kalkulation_mitarbeiter from public, crm_app, crm_admin, crm_auth;
grant select on app.kalkulation_betrieb, app.kalkulation_mitarbeiter to crm_app;
grant insert (betrieb_id, jahr, gemeinkosten_cent, anzahl_produktiv, feiertage, puffer_art, puffer_wert, gewinn_prozent,
	risiko_prozent, aktueller_satz_cent) on app.kalkulation_betrieb to crm_app;
grant update (jahr, gemeinkosten_cent, anzahl_produktiv, feiertage, puffer_art, puffer_wert, gewinn_prozent, risiko_prozent,
	aktueller_satz_cent) on app.kalkulation_betrieb to crm_app;
grant delete on app.kalkulation_mitarbeiter to crm_app;
grant insert (betrieb_id, name, benutzer_id, brutto_cent, ag_art, ag_prozent, ag_euro_cent, wochenstunden, urlaubstage,
	krankheitstage) on app.kalkulation_mitarbeiter to crm_app;
grant update (name, benutzer_id, brutto_cent, ag_art, ag_prozent, ag_euro_cent, wochenstunden, urlaubstage, krankheitstage)
	on app.kalkulation_mitarbeiter to crm_app;

alter table app.kalkulation_betrieb enable row level security;
alter table app.kalkulation_betrieb force row level security;
alter table app.kalkulation_mitarbeiter enable row level security;
alter table app.kalkulation_mitarbeiter force row level security;

create policy kalkulation_betrieb_mandant on app.kalkulation_betrieb
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy kalkulation_mitarbeiter_mandant on app.kalkulation_mitarbeiter
	for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
