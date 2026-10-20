-- Frei gestaltbare Protokolle (Wunsch Jamil, Talk msg 2649): Protokoll-Vorlagen wie ein Formular (Seiten, Abschnitte,
-- Felder mit Pflicht und Bedingungen), ausgefüllte Protokolle zu Auftrag/Objekt/Anlage mit Fotos und Unterschrift.
--
-- * app.protokoll_vorlagen: versioniert. Eine Zeile ist EINE Version und nach dem Anlegen unveränderlich (crm_app darf
--   nur `aktuell` und `archiviert` ändern). „Bearbeiten“ legt eine neue Version derselben Gruppe an; ausgefüllte
--   Protokolle zeigen weiter auf ihre Version.
-- * app.protokolle: ausgefülltes Protokoll (Antworten als JSON, Status entwurf/abgeschlossen). Abgeschlossen ist
--   gesperrt (Trigger): nur noch die Ablage des PDFs (pdf_datei_id) darf sich ändern.
-- * app.protokoll_dateien: Fotos und Unterschriften eines Protokolls (bytea wie app.dateien, max. 10 MB); nach dem
--   Abschluss weder neue noch gelöschte Dateien.
-- Mandantentrennung wie 017/032: betrieb_id not null, RLS aktiv und erzwungen, Fremdschlüssel mit (id, betrieb_id).
--
-- Rechte: neu `protokolle.vorlagen_bearbeiten` (Chef/Büro) und `protokolle.ausfuellen` (Monteur und höher).

create table app.protokoll_vorlagen (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	-- alle Versionen einer Vorlage teilen die Gruppe
	gruppe_id uuid not null,
	version integer not null check (version between 1 and 100000),
	name text not null check (char_length(name) between 1 and 200),
	beschreibung text check (char_length(beschreibung) <= 1000),
	schema jsonb not null check (jsonb_typeof(schema) = 'object' and pg_column_size(schema) <= 262144),
	aktuell boolean not null default true,
	archiviert boolean not null default false,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	von_benutzer_id uuid,
	unique (id, betrieb_id),
	unique (betrieb_id, gruppe_id, version),
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id)
);
-- höchstens eine aktuelle Version je Gruppe
create unique index protokoll_vorlagen_aktuell_idx on app.protokoll_vorlagen (betrieb_id, gruppe_id) where aktuell;
create index protokoll_vorlagen_betrieb_idx on app.protokoll_vorlagen (betrieb_id, name);

create table app.protokolle (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	vorlage_id uuid not null,
	titel text not null check (char_length(titel) between 1 and 200),
	auftrag_id uuid,
	objekt_id uuid,
	anlage_id uuid,
	antworten jsonb not null default '{}' check (jsonb_typeof(antworten) = 'object' and pg_column_size(antworten) <= 524288),
	-- zuletzt bearbeiteter Schritt (Seite) des Assistenten
	schritt integer not null default 0 check (schritt between 0 and 200),
	status text not null default 'entwurf' check (status in ('entwurf', 'abgeschlossen')),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	von_benutzer_id uuid,
	abgeschlossen timestamptz,
	abgeschlossen_von uuid,
	-- Name der Person, die (als Kunde) unterschrieben hat – für Liste und PDF
	unterschrieben_von text check (char_length(unterschrieben_von) <= 200),
	-- abgelegtes PDF in den Dokumenten des Auftrags (app.dateien)
	pdf_datei_id uuid,
	unique (id, betrieb_id),
	check (auftrag_id is not null or objekt_id is not null or anlage_id is not null),
	check ((status = 'abgeschlossen') = (abgeschlossen is not null)),
	foreign key (vorlage_id, betrieb_id) references app.protokoll_vorlagen (id, betrieb_id) on delete restrict,
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (objekt_id, betrieb_id) references app.objekte (id, betrieb_id) on delete cascade,
	foreign key (anlage_id, betrieb_id) references app.anlagen (id, betrieb_id) on delete set null (anlage_id),
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id),
	foreign key (abgeschlossen_von, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (abgeschlossen_von),
	foreign key (pdf_datei_id, betrieb_id) references app.dateien (id, betrieb_id) on delete set null (pdf_datei_id)
);
create index protokolle_f_auftrag_idx on app.protokolle (auftrag_id, betrieb_id);
create index protokolle_f_objekt_idx on app.protokolle (objekt_id, betrieb_id);
create index protokolle_f_anlage_idx on app.protokolle (anlage_id, betrieb_id);
create index protokolle_f_vorlage_idx on app.protokolle (vorlage_id, betrieb_id);

create table app.protokoll_dateien (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	protokoll_id uuid not null,
	feld_id text not null check (char_length(feld_id) between 1 and 60),
	art text not null check (art in ('foto', 'unterschrift')),
	name text not null check (char_length(name) between 1 and 255),
	typ text not null check (typ in ('image/jpeg', 'image/png')),
	groesse integer not null check (groesse > 0 and groesse <= 10485760),
	inhalt bytea not null check (octet_length(inhalt) <= 10485760),
	angelegt timestamptz not null default now(),
	von_benutzer_id uuid,
	unique (id, betrieb_id),
	foreign key (protokoll_id, betrieb_id) references app.protokolle (id, betrieb_id) on delete cascade,
	foreign key (von_benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (von_benutzer_id)
);
create index protokoll_dateien_protokoll_idx on app.protokoll_dateien (protokoll_id, betrieb_id, angelegt);

-- Rechte. id, betrieb_id, angelegt, geaendert setzt nie die Anwendung.
revoke all on app.protokoll_vorlagen, app.protokolle, app.protokoll_dateien from public, crm_app, crm_admin, crm_auth;
grant select on app.protokoll_vorlagen to crm_app;
grant insert (betrieb_id, gruppe_id, version, name, beschreibung, schema, aktuell, archiviert, von_benutzer_id)
	on app.protokoll_vorlagen to crm_app;
-- eine Version selbst bleibt unverändert: nur „aktuell“ und „archiviert“
grant update (aktuell, archiviert) on app.protokoll_vorlagen to crm_app;
-- Löschen nur, solange kein Protokoll die Version benutzt (Fremdschlüssel restrict)
grant delete on app.protokoll_vorlagen to crm_app;

grant select, delete on app.protokolle to crm_app;
grant insert (betrieb_id, vorlage_id, titel, auftrag_id, objekt_id, anlage_id, antworten, von_benutzer_id) on app.protokolle to crm_app;
grant update (antworten, schritt, status, abgeschlossen, abgeschlossen_von, unterschrieben_von, pdf_datei_id) on app.protokolle to crm_app;

grant select, delete on app.protokoll_dateien to crm_app;
grant insert (betrieb_id, protokoll_id, feld_id, art, name, typ, groesse, inhalt, von_benutzer_id) on app.protokoll_dateien to crm_app;

-- Row Level Security (strikt)
alter table app.protokoll_vorlagen enable row level security;
alter table app.protokoll_vorlagen force row level security;
alter table app.protokolle enable row level security;
alter table app.protokolle force row level security;
alter table app.protokoll_dateien enable row level security;
alter table app.protokoll_dateien force row level security;

create policy protokoll_vorlagen_mandant on app.protokoll_vorlagen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy protokolle_f_mandant on app.protokolle for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy protokoll_dateien_mandant on app.protokoll_dateien for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger protokoll_vorlagen_geaendert before update on app.protokoll_vorlagen
	for each row execute function app.setze_geaendert();
create trigger protokolle_f_geaendert before update on app.protokolle
	for each row execute function app.setze_geaendert();

-- Sperre: Ein abgeschlossenes Protokoll ändert sich nicht mehr (nur das PDF wird noch abgelegt) und lässt sich nicht
-- wieder öffnen. Gilt für jede Rolle, auch an der Anwendung vorbei.
create function app.protokoll_sperre()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
	if old.status = 'abgeschlossen' then
		if new.antworten is distinct from old.antworten or new.status is distinct from old.status
			or new.schritt is distinct from old.schritt or new.abgeschlossen is distinct from old.abgeschlossen
			or new.abgeschlossen_von is distinct from old.abgeschlossen_von
			or new.unterschrieben_von is distinct from old.unterschrieben_von
			or new.vorlage_id is distinct from old.vorlage_id then
			raise exception 'Protokoll ist abgeschlossen und kann nicht mehr geändert werden' using errcode = '55000';
		end if;
	end if;
	return new;
end
$$;
create trigger protokolle_f_sperre before update on app.protokolle
	for each row execute function app.protokoll_sperre();

create function app.protokoll_dateien_sperre()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
declare
	v_status text;
	v_zeile app.protokoll_dateien;
begin
	v_zeile := case when tg_op = 'DELETE' then old else new end;
	select status into v_status from app.protokolle where id = v_zeile.protokoll_id and betrieb_id = v_zeile.betrieb_id;
	-- Beim Löschen des Protokolls (Kaskade) gibt es die Zeile nicht mehr: dann erlaubt
	if v_status = 'abgeschlossen' then
		raise exception 'Protokoll ist abgeschlossen – Fotos und Unterschriften bleiben unverändert' using errcode = '55000';
	end if;
	return v_zeile;
end
$$;
create trigger protokoll_dateien_sperre before insert or delete on app.protokoll_dateien
	for each row execute function app.protokoll_dateien_sperre();

-- Änderungsprotokoll: Schema/Antworten (groß) und Schritt (Autospeichern) nie ins Protokoll; so entstehen Einträge
-- nur für Anlegen, Abschließen, PDF-Ablage, Archivieren.
create trigger protokoll_vorlagen_protokoll after insert or update or delete on app.protokoll_vorlagen
	for each row execute function app.protokolliere('geaendert', 'schema');
create trigger protokolle_f_protokoll after insert or update or delete on app.protokolle
	for each row execute function app.protokolliere('geaendert', 'antworten', 'schritt');
create trigger protokoll_dateien_protokoll after insert or update or delete on app.protokoll_dateien
	for each row execute function app.protokolliere('inhalt');

-- Rechte der bestehenden Rollen: wer Protokolle bearbeitet (Chef, Büro), gestaltet auch Vorlagen; ausfüllen darf, wer
-- Aufträge sieht (Monteur und höher) oder Protokolle bearbeitet.
update app.rollen set rechte = array_append(rechte, 'protokolle.vorlagen_bearbeiten')
where 'protokolle.bearbeiten' = any (rechte) and not ('protokolle.vorlagen_bearbeiten' = any (rechte));
update app.rollen set rechte = array_append(rechte, 'protokolle.ausfuellen')
where ('auftraege.lesen' = any (rechte) or 'auftraege.alle_lesen' = any (rechte) or 'protokolle.bearbeiten' = any (rechte))
	and not ('protokolle.ausfuellen' = any (rechte));
