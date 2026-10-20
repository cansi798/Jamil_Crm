-- Zeiterfassung (Wunsch Jamil, Talk msgs 2770/2772/2774): Arbeitszeit, Pausen und Fahrten je Auftrag und Mitarbeiter
-- mit einem Tipp (Start / Pause / Fertig, Abfahrt / Angekommen), dazu Material je Auftrag (geplant aus dem
-- angenommenen Angebot, tatsächlich verbraucht inkl. Lieferschein). Rechnen: src/lib/zeiterfassung.ts.
--
-- * app.zeit_eintraege: ein Abschnitt je Zeile – art „arbeit“, „pause“ oder „fahrt“, Beginn und Ende (leer = läuft).
--   Je Person läuft höchstens EIN Abschnitt (eindeutiger Teilindex), und die Abschnitte einer Person überschneiden
--   sich nie (Ausschluss-Bedingung, btree_gist aus 060). Nachträge und Korrekturen tragen einen Grund
--   (korrektur_grund); das Änderungsprotokoll hält jede Änderung mit altem und neuem Wert fest (Verlauf).
--   Freigabe durch Chef/Büro (freigegeben_am/-von); freigegebene Zeilen ändert nur noch, wer alle Zeiten verwaltet.
--   Kilometer: km (gilt) und km_berechnet (Vorschlag aus Route bzw. Luftlinie × Faktor) mit km_quelle.
-- * app.zeit_taetigkeiten (Jamil msg 2776): Tätigkeiten ohne Auftrag (Lager, Werkstatt, Fahrzeugpflege, Büro,
--   Schulung …) je Betrieb, in den Einstellungen pflegbar. Ein Arbeitsabschnitt gehört zu einem Auftrag ODER einer
--   Tätigkeit (oder – nur nachgetragen – zu keinem). Diese Stunden zählen im Arbeitszeitnachweis, in der
--   Nachkalkulation aber als „nicht produktiv / Gemeinkosten“.
-- * app.auftrag_material: tatsächlich verbrauchtes Material (Bezug auf die Angebotsposition, wenn geplant).
--
-- Mandantentrennung wie überall: betrieb_id not null, RLS aktiv und erzwungen, Fremdschlüssel mit (id, betrieb_id).
-- Wer welche Zeilen sieht (eigene bzw. alle), prüft die Anwendung (Rechte zeiten.erfassen / zeiten.verwalten).

create table app.zeit_taetigkeiten (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	name text not null check (char_length(btrim(name)) between 1 and 80),
	aktiv boolean not null default true,
	sortierung integer not null default 0,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id)
);
create unique index zeit_taetigkeiten_name_idx on app.zeit_taetigkeiten (betrieb_id, lower(btrim(name)));

create table app.zeit_eintraege (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	benutzer_id uuid not null,
	auftrag_id uuid,
	-- Tätigkeit ohne Auftrag (Lager, Werkstatt, …)
	taetigkeit_id uuid,
	art text not null check (art in ('arbeit', 'pause', 'fahrt')),
	beginn timestamptz not null,
	ende timestamptz,
	-- Pause innerhalb eines nachgetragenen Arbeitsabschnitts (z. B. „8–16:30 Uhr, 30 Min. Pause“)
	pause_min integer not null default 0 check (pause_min between 0 and 720),
	km numeric(7, 1) check (km between 0 and 5000),
	km_berechnet numeric(7, 1) check (km_berechnet between 0 and 5000),
	km_quelle text check (km_quelle in ('route', 'luftlinie', 'manuell')),
	start_adresse text check (char_length(start_adresse) <= 400),
	ziel_adresse text check (char_length(ziel_adresse) <= 400),
	notiz text check (char_length(notiz) <= 500),
	-- nachgetragen oder von Hand korrigiert (dann mit Grund)
	manuell boolean not null default false,
	korrektur_grund text check (char_length(korrektur_grund) <= 300),
	freigegeben_am timestamptz,
	freigegeben_von uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete set null (auftrag_id),
	foreign key (freigegeben_von, betrieb_id) references app.benutzer (id, betrieb_id),
	foreign key (taetigkeit_id, betrieb_id) references app.zeit_taetigkeiten (id, betrieb_id),
	check (auftrag_id is null or taetigkeit_id is null),
	check (ende is null or (ende > beginn and ende - beginn <= interval '7 days')),
	check (art = 'arbeit' or pause_min = 0),
	check (art = 'fahrt' or (km is null and km_berechnet is null and km_quelle is null)),
	check ((freigegeben_am is null) = (freigegeben_von is null)),
	check (freigegeben_am is null or ende is not null),
	-- Abschnitte einer Person überschneiden sich nie (halboffen; ein laufender reicht bis „unendlich“)
	constraint zeit_eintraege_keine_ueberschneidung exclude using gist (
		betrieb_id with =, benutzer_id with =, tstzrange(beginn, coalesce(ende, 'infinity'::timestamptz), '[)') with &&
	)
);
-- je Person höchstens ein laufender Abschnitt
create unique index zeit_eintraege_einer_laeuft on app.zeit_eintraege (betrieb_id, benutzer_id) where ende is null;
create index zeit_eintraege_benutzer_idx on app.zeit_eintraege (betrieb_id, benutzer_id, beginn);
create index zeit_eintraege_auftrag_idx on app.zeit_eintraege (auftrag_id, betrieb_id);
create index zeit_eintraege_zeit_idx on app.zeit_eintraege (betrieb_id, beginn);

create table app.auftrag_material (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	auftrag_id uuid not null,
	-- geplante Position (aus dem angenommenen Angebot); leer = zusätzliches Material oder vom Lieferschein
	angebot_position_id uuid,
	bezeichnung text not null check (char_length(btrim(bezeichnung)) between 1 and 200),
	einheit text not null check (char_length(btrim(einheit)) between 1 and 20),
	menge numeric(12, 3) not null check (menge >= 0 and menge <= 1000000),
	-- Einkaufspreis je Einheit (nur mit „Preise sehen“ sichtbar); leer = Materialanteil der Angebotsposition
	preis_cent bigint check (preis_cent between 0 and 1000000000),
	quelle text not null default 'zusatz' check (quelle in ('plan', 'zusatz', 'lieferschein')),
	benutzer_id uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (angebot_position_id, betrieb_id) references app.angebot_positionen (id, betrieb_id) on delete set null (angebot_position_id),
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id)
);
create index auftrag_material_auftrag_idx on app.auftrag_material (auftrag_id, betrieb_id);
-- je geplanter Position höchstens eine Ist-Zeile
create unique index auftrag_material_position_idx on app.auftrag_material (betrieb_id, auftrag_id, angebot_position_id)
	where angebot_position_id is not null;

create trigger zeit_taetigkeiten_geaendert before update on app.zeit_taetigkeiten for each row execute function app.setze_geaendert();
create trigger zeit_eintraege_geaendert before update on app.zeit_eintraege for each row execute function app.setze_geaendert();
create trigger auftrag_material_geaendert before update on app.auftrag_material for each row execute function app.setze_geaendert();

revoke all on app.zeit_taetigkeiten, app.zeit_eintraege, app.auftrag_material from public, crm_app, crm_admin, crm_auth;

grant select, delete on app.zeit_taetigkeiten to crm_app;
grant insert (betrieb_id, name, aktiv, sortierung) on app.zeit_taetigkeiten to crm_app;
grant update (name, aktiv, sortierung) on app.zeit_taetigkeiten to crm_app;

grant select, delete on app.zeit_eintraege to crm_app;
grant insert (betrieb_id, benutzer_id, auftrag_id, taetigkeit_id, art, beginn, ende, pause_min, km, km_berechnet, km_quelle, start_adresse,
	ziel_adresse, notiz, manuell, korrektur_grund) on app.zeit_eintraege to crm_app;
grant update (auftrag_id, taetigkeit_id, art, beginn, ende, pause_min, km, km_berechnet, km_quelle, start_adresse, ziel_adresse, notiz, manuell,
	korrektur_grund, freigegeben_am, freigegeben_von) on app.zeit_eintraege to crm_app;

grant select, delete on app.auftrag_material to crm_app;
grant insert (betrieb_id, auftrag_id, angebot_position_id, bezeichnung, einheit, menge, preis_cent, quelle, benutzer_id)
	on app.auftrag_material to crm_app;
grant update (bezeichnung, einheit, menge, preis_cent, benutzer_id) on app.auftrag_material to crm_app;

alter table app.zeit_taetigkeiten enable row level security;
alter table app.zeit_taetigkeiten force row level security;
alter table app.zeit_eintraege enable row level security;
alter table app.zeit_eintraege force row level security;
alter table app.auftrag_material enable row level security;
alter table app.auftrag_material force row level security;

create policy zeit_taetigkeiten_mandant on app.zeit_taetigkeiten for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy zeit_eintraege_mandant on app.zeit_eintraege for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy auftrag_material_mandant on app.auftrag_material for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Änderungsprotokoll (Verlauf, Korrekturen nachvollziehbar); Preise des Materials nie ins Protokoll
create trigger zeit_taetigkeiten_protokoll after insert or update or delete on app.zeit_taetigkeiten
	for each row execute function app.protokolliere('geaendert');
create trigger zeit_eintraege_protokoll after insert or update or delete on app.zeit_eintraege
	for each row execute function app.protokolliere('geaendert');
create trigger auftrag_material_protokoll after insert or update or delete on app.auftrag_material
	for each row execute function app.protokolliere('geaendert', 'preis_cent');

-- Neue Rechte: „Eigene Zeiten erfassen“ für alle, die Aufträge sehen; „Zeiten aller verwalten“ für Chef und Büro
update app.rollen set rechte = array_append(rechte, 'zeiten.erfassen')
where (rechte && array['auftraege.lesen', 'auftraege.alle_lesen', 'auftraege.bearbeiten']::text[])
	and not ('zeiten.erfassen' = any (rechte));
update app.rollen set rechte = array_append(rechte, 'zeiten.verwalten')
where (vorlage in ('chef', 'buero') or 'einstellungen' = any (rechte)) and not ('zeiten.verwalten' = any (rechte));

-- Startliste „Tätigkeiten ohne Auftrag“ für bestehende Betriebe (neue bekommen sie beim ersten Aufruf der Zeiterfassung)
insert into app.zeit_taetigkeiten (betrieb_id, name, sortierung)
select b.id, t.name, t.nr
from app.betriebe b
cross join (values ('Lager aufräumen', 1), ('Werkstatt', 2), ('Fahrzeugpflege', 3), ('Büro', 4), ('Schulung', 5),
	('Material holen', 6)) as t (name, nr)
on conflict do nothing;
