-- Leitfaden beim Termin (Wunsch Jamil, Talk msgs 4302/4304; Entscheidungen msg 4340: 1c / 2b / 3a / 4b).
--
-- * app.leitfaden_vorlagen: EIN Leitfaden je Firma (3a) – ein/aus, Name, für welche Termin-Arten bzw. Terminarten er
--   erscheint (1c, Standard: Besichtigung), Schritte (jsonb, geprüft in src/lib/leitfaden.ts), Version (+1 je Speichern).
--   Fehlt die Zeile, gilt der Leitfaden als ausgeschaltet; die Einstellungsseite zeigt dann die Startvorlage.
-- * app.leitfaden_durchlaeufe: ein Durchlauf je Termin (einsatz). Beim Start werden Name und Schritte der Vorlage
--   kopiert – spätere Änderungen an der Vorlage verändern laufende Durchläufe nicht. Antworten je Schritt mit Zeitpunkt
--   (die spätere Eingabe gewinnt, auch wenn sie offline war). Abschluss mit allen Pflichtschritten = 'abgeschlossen',
--   sonst nur mit Begründung = 'mit_begruendung' (2b) – dann bekommt das Büro einen Hinweis in Glocke/Push.
--   Wird der Termin gelöscht, bleibt der Durchlauf beim Auftrag stehen (einsatz_id wird leer).
-- * app.leitfaden_eingaben: Kennung jeder Eingabe vom Gerät (opId). Offline gesammelte Eingaben werden später
--   nachgeschickt (4b) – kommt dieselbe Eingabe zweimal an, wirkt sie nur einmal (idempotent).
--
-- Alles mit betrieb_id, RLS (strikt wie überall) und Änderungsprotokoll (Vorlage, Durchlauf).

create table app.leitfaden_vorlagen (
	-- id nur fürs Änderungsprotokoll (datensatz_id); je Betrieb genau eine Zeile
	id uuid not null default gen_random_uuid() unique,
	betrieb_id uuid primary key references app.betriebe (id) on delete cascade,
	aktiv boolean not null default false,
	name text not null default 'Leitfaden Besichtigung' check (char_length(btrim(name)) between 1 and 100),
	-- Termin-Arten (fest: besichtigung/montage/wartung) und Terminarten (Liste des Betriebs), bei denen er erscheint
	arten text[] not null default '{besichtigung}' check (arten <@ array['besichtigung', 'montage', 'wartung']::text[]),
	terminarten uuid[] not null default '{}' check (cardinality(terminarten) <= 100),
	schritte jsonb not null default '[]' check (jsonb_typeof(schritte) = 'array' and jsonb_array_length(schritte) <= 40),
	version integer not null default 1 check (version >= 1),
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now()
);

create table app.leitfaden_durchlaeufe (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	einsatz_id uuid,
	auftrag_id uuid not null,
	-- für wen der Termin war (eingeteilte Person)
	benutzer_id uuid,
	name text not null check (char_length(name) between 1 and 100),
	version integer not null default 1,
	schritte jsonb not null check (jsonb_typeof(schritte) = 'array'),
	antworten jsonb not null default '{}' check (jsonb_typeof(antworten) = 'object'),
	status text not null default 'offen' check (status in ('offen', 'abgeschlossen', 'mit_begruendung')),
	begruendung text check (char_length(begruendung) <= 1000),
	-- beim Abschluss angelegte Aufgaben/Notiz (damit ein zweiter Abschluss nichts doppelt anlegt)
	ergebnis jsonb not null default '{}' check (jsonb_typeof(ergebnis) = 'object'),
	abgeschlossen_am timestamptz,
	abgeschlossen_von uuid,
	angelegt timestamptz not null default now(),
	geaendert timestamptz not null default now(),
	unique (id, betrieb_id),
	unique (einsatz_id),
	constraint leitfaden_begruendung check (status <> 'mit_begruendung' or nullif(btrim(begruendung), '') is not null),
	foreign key (einsatz_id, betrieb_id) references app.einsaetze (id, betrieb_id) on delete set null (einsatz_id),
	foreign key (auftrag_id, betrieb_id) references app.auftraege (id, betrieb_id) on delete cascade,
	foreign key (benutzer_id, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (benutzer_id),
	foreign key (abgeschlossen_von, betrieb_id) references app.benutzer (id, betrieb_id) on delete set null (abgeschlossen_von)
);
create index leitfaden_durchlaeufe_auftrag_idx on app.leitfaden_durchlaeufe (auftrag_id, betrieb_id);

create table app.leitfaden_eingaben (
	op_id uuid primary key,
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	durchlauf_id uuid not null,
	art text not null check (art in ('eingabe', 'foto', 'abschluss')),
	-- Ergebnis der Eingabe (z. B. Datei-Kennung eines Fotos), damit eine Wiederholung dieselbe Antwort bekommt
	ergebnis jsonb,
	angelegt timestamptz not null default now(),
	foreign key (durchlauf_id, betrieb_id) references app.leitfaden_durchlaeufe (id, betrieb_id) on delete cascade
);
create index leitfaden_eingaben_durchlauf_idx on app.leitfaden_eingaben (durchlauf_id, betrieb_id);

create trigger leitfaden_vorlagen_geaendert before update on app.leitfaden_vorlagen
	for each row execute function app.setze_geaendert();
create trigger leitfaden_durchlaeufe_geaendert before update on app.leitfaden_durchlaeufe
	for each row execute function app.setze_geaendert();

revoke all on app.leitfaden_vorlagen, app.leitfaden_durchlaeufe, app.leitfaden_eingaben from public, crm_app, crm_admin, crm_auth;
grant select, insert, delete on app.leitfaden_vorlagen to crm_app;
grant update (aktiv, name, arten, terminarten, schritte, version) on app.leitfaden_vorlagen to crm_app;
grant select, insert on app.leitfaden_durchlaeufe to crm_app;
grant update (antworten, status, begruendung, ergebnis, abgeschlossen_am, abgeschlossen_von) on app.leitfaden_durchlaeufe to crm_app;
grant select, insert on app.leitfaden_eingaben to crm_app;

alter table app.leitfaden_vorlagen enable row level security;
alter table app.leitfaden_vorlagen force row level security;
alter table app.leitfaden_durchlaeufe enable row level security;
alter table app.leitfaden_durchlaeufe force row level security;
alter table app.leitfaden_eingaben enable row level security;
alter table app.leitfaden_eingaben force row level security;
create policy leitfaden_vorlagen_mandant on app.leitfaden_vorlagen for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy leitfaden_durchlaeufe_mandant on app.leitfaden_durchlaeufe for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
create policy leitfaden_eingaben_mandant on app.leitfaden_eingaben for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid)
	with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

create trigger leitfaden_vorlagen_protokoll after insert or update or delete on app.leitfaden_vorlagen
	for each row execute function app.protokolliere('geaendert');
create trigger leitfaden_durchlaeufe_protokoll after insert or update or delete on app.leitfaden_durchlaeufe
	for each row execute function app.protokolliere('geaendert');

-- Hinweis ans Büro (2b): Abschluss nur mit Begründung → alle aktiven Benutzer mit „Alle Aufträge ansehen“ (Büro, Chef)
-- bekommen eine Nachricht (Glocke + Push wie bei den übrigen Benachrichtigungen, Kategorie „termin“); nie der Auslöser.
create function app.benachrichtige_leitfaden() returns trigger language plpgsql set search_path = app, pg_temp as $$
declare z record; a record;
begin
	if new.status <> 'mit_begruendung' or old.status = 'mit_begruendung' then return null; end if;
	select x.nummer, x.titel into a from app.auftraege x where x.id = new.auftrag_id and x.betrieb_id = new.betrieb_id;
	for z in
		select b.id from app.benutzer b join app.rollen r on r.id = b.rolle_id and r.betrieb_id = b.betrieb_id
		where b.betrieb_id = new.betrieb_id and b.aktiv and 'auftraege.alle_lesen' = any (r.rechte)
	loop
		perform app.benachrichtige(new.betrieb_id, z.id, 'termin', 'leitfaden:' || new.id,
			'Leitfaden mit Begründung abgeschlossen: ' || coalesce(a.nummer || ' ' || a.titel, new.name),
			concat_ws(' · ', left(new.begruendung, 300), app.benachrichtigung_von(new.betrieb_id)),
			'/auftraege/' || new.auftrag_id || '#leitfaden');
	end loop;
	return null;
end $$;
create trigger leitfaden_durchlaeufe_benachrichtigen after update of status on app.leitfaden_durchlaeufe
	for each row execute function app.benachrichtige_leitfaden();
