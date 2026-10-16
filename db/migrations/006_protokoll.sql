-- Änderungsprotokoll (Task 10) und Ruling R17 (kleine Rechte-Härtungen an benutzer).
--
-- app.aenderungen hält für jede protokollierte Tabelle fest, wer wann was angelegt, geändert oder gelöscht hat
-- (Zustand vorher/nachher als JSON). Eingetragen wird ausschließlich vom Trigger app.protokolliere() (SECURITY
-- DEFINER, Eigentümer crm; Ruling R18): crm_app darf nur lesen (eigener Betrieb) – nie einfügen, ändern oder
-- löschen, kann dem Protokoll also weder Einträge unterschieben noch die Zeit zurückdatieren. crm_admin und
-- crm_auth haben keinen Zugriff.
--
-- Trigger anhängen (Task 11 für kunden/objekte, jede weitere Fachtabelle genauso):
--
--   create trigger kunden_protokoll
--     after insert or update or delete on app.kunden
--     for each row execute function app.protokolliere();
--
-- Der Trigger braucht keine zusätzlichen Rechte für crm_app (er läuft als Eigentümer crm). Voraussetzung: Die
-- Tabelle hat die Spalten id (uuid) und betrieb_id. Spalten, die nie ins Protokoll gehören
-- (Geheimnisse, reine Betriebsdaten wie letzte_aktivitaet), werden als Argumente des Triggers aufgezählt:
--
--   execute function app.protokolliere('passwort_hash', 'letzte_aktivitaet')
--
-- Es gilt eine Ausschlussliste (alles andere wird protokolliert). Deshalb prüft tests/db/protokoll.test.ts für
-- benutzer und einladungen, dass jede Spalte entweder protokolliert oder ausdrücklich ausgeschlossen ist: Eine neue
-- Spalte fällt dort auf und zwingt zur Entscheidung.

create table app.aenderungen (
	id bigserial primary key,
	-- Bewusst ohne Fremdschlüssel auf betriebe: Wird ein Betrieb gelöscht, löschen die Kaskaden seine Zeilen, und
	-- die Trigger würden sonst gegen einen schon gelöschten Betrieb protokollieren (Fehler). Mandantentrennung
	-- steht trotzdem fest: RLS auf betrieb_id.
	betrieb_id uuid not null,
	-- Wer hat geändert? NULL bei Systemvorgängen ohne Benutzerkontext (z. B. Annahme einer Einladung durch den
	-- neuen Benutzer selbst über app.einladung_annehmen, Löschkaskaden der Plattform). Kein Fremdschlüssel: Das
	-- Protokoll darf nie durch das Löschen eines Benutzers verändert werden.
	benutzer_id uuid,
	tabelle text not null,
	datensatz_id uuid not null,
	aktion text not null check (aktion in ('angelegt', 'geaendert', 'geloescht')),
	vorher jsonb,
	nachher jsonb,
	zeit timestamptz not null default now(),
	-- 'oberflaeche' (Standard), später z. B. 'sprache' (Sprachsteuerung); gesetzt über die Sitzungsvariable app.quelle.
	quelle text not null default 'oberflaeche' check (length(quelle) between 1 and 40),
	check (
		(aktion = 'angelegt' and vorher is null and nachher is not null)
		or (aktion = 'geaendert' and vorher is not null and nachher is not null)
		or (aktion = 'geloescht' and vorher is not null and nachher is null)
	)
);
-- Abfrage "Verlauf eines Datensatzes, neueste zuerst"
create index aenderungen_datensatz_idx on app.aenderungen (betrieb_id, tabelle, datensatz_id, id desc);

revoke all on app.aenderungen from public, crm_app, crm_admin, crm_auth;
revoke all on sequence app.aenderungen_id_seq from public, crm_app, crm_admin, crm_auth;
-- Nur lesen: Einträge entstehen ausschließlich im SECURITY-DEFINER-Trigger (kein INSERT, keine Sequenz für crm_app).
grant select on app.aenderungen to crm_app;

alter table app.aenderungen enable row level security;
alter table app.aenderungen force row level security;

create policy aenderungen_lesen on app.aenderungen
	for select to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- Generischer Protokoll-Trigger (AFTER INSERT/UPDATE/DELETE, FOR EACH ROW).
--
-- SECURITY DEFINER, Eigentümer crm (Ruling R18): Der Trigger schreibt in die Tabelle, auf die crm_app keinen
-- Schreibzugriff hat. Deshalb:
--   * fester search_path (app, pg_temp); EXECUTE nur für den Trigger-Mechanismus (nicht für public/crm_app);
--   * betrieb_id und Datensatz-ID stammen aus der Zeile selbst (NEW bei INSERT/UPDATE, OLD bei DELETE), zeit ist
--     immer now() (Spaltenvorgabe);
--   * Schutz gegen Fehlbenutzung (fail closed): Ist app.betrieb_id gesetzt und weicht vom Betrieb der Zeile ab,
--     wird die Änderung mit einer Ausnahme abgebrochen; ebenso bei einem nicht-leeren app.benutzer_id, das keine
--     UUID ist. Ohne Betriebskontext (Einladung annehmen über crm_auth, Kaskaden, Migrationen) ist benutzer_id NULL.
-- Aktionen ohne sichtbare Änderung (alle geänderten Spalten sind ausgeschlossen, z. B. nur letzte_aktivitaet)
-- erzeugen keinen Eintrag. Zeilen ohne betrieb_id (Plattform-Admins in benutzer) gehören keinem Betrieb, ein Eintrag
-- ohne Betrieb wäre für keinen Mandanten lesbar: Sie werden nicht protokolliert (und brechen nichts).
create function app.protokolliere()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	-- ohne Trigger-Argumente ist tg_argv NULL, nicht leer
	v_ausschluss text[] := coalesce(tg_argv, '{}'::text[]);
	v_zeile jsonb;
	v_vorher jsonb;
	v_nachher jsonb;
	v_betrieb uuid;
	v_datensatz uuid;
	v_kontext_betrieb text := nullif(current_setting('app.betrieb_id', true), '');
	v_kontext_benutzer text := nullif(current_setting('app.benutzer_id', true), '');
	v_benutzer uuid;
	v_quelle text;
begin
	if tg_op = 'INSERT' then
		v_zeile := to_jsonb(new);
		v_nachher := v_zeile - v_ausschluss;
	elsif tg_op = 'UPDATE' then
		v_zeile := to_jsonb(new);
		v_vorher := to_jsonb(old) - v_ausschluss;
		v_nachher := v_zeile - v_ausschluss;
		if v_vorher = v_nachher then
			return null;
		end if;
	else
		v_zeile := to_jsonb(old);
		v_vorher := v_zeile - v_ausschluss;
	end if;

	v_betrieb := (v_zeile ->> 'betrieb_id')::uuid;
	if v_betrieb is null then
		return null;
	end if;
	if v_kontext_betrieb is not null and v_kontext_betrieb is distinct from v_betrieb::text then
		raise exception 'protokolliere: Betriebskontext passt nicht zum Betrieb des Datensatzes'
			using errcode = '42501';
	end if;
	v_datensatz := (v_zeile ->> 'id')::uuid;

	if v_kontext_benutzer is not null then
		if v_kontext_benutzer !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
			raise exception 'protokolliere: app.benutzer_id ist keine UUID' using errcode = '22023';
		end if;
		v_benutzer := v_kontext_benutzer::uuid;
	end if;
	v_quelle := left(coalesce(nullif(current_setting('app.quelle', true), ''), 'oberflaeche'), 40);

	insert into app.aenderungen (betrieb_id, benutzer_id, tabelle, datensatz_id, aktion, vorher, nachher, quelle)
	values (
		v_betrieb, v_benutzer, tg_table_name, v_datensatz,
		case tg_op when 'INSERT' then 'angelegt' when 'UPDATE' then 'geaendert' else 'geloescht' end,
		v_vorher, v_nachher, v_quelle
	);
	return null;
end;
$$;

revoke execute on function app.protokolliere() from public, crm_app, crm_admin, crm_auth;

-- Rollen: alles protokollieren.
create trigger rollen_protokoll
	after insert or update or delete on app.rollen
	for each row execute function app.protokolliere();

-- Benutzer: nie ins Protokoll – Geheimnisse (passwort_hash, totp_geheim), 2FA-Zustand (totp_aktiv, totp_letzter_schritt,
-- totp_fehlversuche, totp_gesperrt_bis, totp_sperr_stufe; crm_app darf totp_aktiv selbst nicht lesen, Ruling R6) und
-- reines Betriebsrauschen (letzte_aktivitaet).
create trigger benutzer_protokoll
	after insert or update or delete on app.benutzer
	for each row execute function app.protokolliere(
		'passwort_hash', 'totp_geheim', 'totp_aktiv', 'totp_letzter_schritt',
		'totp_fehlversuche', 'totp_gesperrt_bis', 'totp_sperr_stufe', 'letzte_aktivitaet'
	);

-- Einladungen: token_hash ist ein Geheimnis (wer ihn kennt, kennt den Link nicht, aber er gehört nicht ins Protokoll).
create trigger einladungen_protokoll
	after insert or update or delete on app.einladungen
	for each row execute function app.protokolliere('token_hash');

-- ---------------------------------------------------------------------------------------------------------------
-- Ruling R17: Rechte an benutzer weiter einschränken.
-- Benutzer werden nie gelöscht (kein Löschfeature; ein DELETE würde die Letzter-Verwalter-Regel umgehen) und
-- ihre Schlüssel id/betrieb_id ändern sich nie. Kaskaden beim Löschen eines Betriebs laufen als Eigentümer.
revoke delete on app.benutzer from crm_app;
revoke update (id, betrieb_id) on app.benutzer from crm_app;
