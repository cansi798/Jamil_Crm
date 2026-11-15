-- Angebote und Auftragsbestätigungen über Lexware, drei Terminvorschläge (Plan „Lexware als Belegsystem“, Tasks T5,
-- T6, T10; Jamil Talk #6093: XL ja, drei Terminvorschläge ja, § 35a/§ 13b berücksichtigen). Umsetzungsplan:
-- docs/superpowers/plans/2026-11-15-lexware-phase2.md.
--
-- 1. Schalter `belege_in_lexware` (Standard an). Wirksam, sobald der Betrieb einmal erfolgreich mit Lexware verbunden
--    war (organisation_id gesetzt): Dann vergibt das CRM KEINE eigene Angebotsnummer mehr (Trigger), das Angebot ist
--    bis zum Versand ein CRM-Entwurf „noch ohne Nummer“; Nummer und PDF kommen aus Lexware (festgeschrieben).
-- 2. angebote: beleg_quelle crm|lexware, Lexware-Felder; nummer nullable – bei Lexware-Angeboten nur die
--    Lexware-Nummer (Check). Ein in Lexware festgeschriebenes Angebot wird nie wieder Entwurf (Trigger).
-- 3. app.lexware_dateien: Zwischenspeicher der PDFs aus Lexware (Original bleibt in Lexware, jederzeit neu ladbar).
-- 4. auftragsbestaetigungen: bei Lexware-Betrieben ein Spiegel (Nummer + PDF aus Lexware, lexware_id).
-- 5. app.angebot_terminvorschlaege (bis zu drei Baubeginn-Termine, nur im Entwurf änderbar), Wahl im Nachweis
--    (angebot_entscheidungen) und am Auftrag (baubeginn).
-- 6. Mail-Zweck „angebot“ (Angebot an den Kunden senden).

-- 1 ——— Schalter
alter table app.lexware_konfig add column belege_in_lexware boolean not null default true;
grant select (belege_in_lexware), insert (belege_in_lexware), update (belege_in_lexware) on app.lexware_konfig to crm_app;

-- Ist der Betrieb im Lexware-Belegmodus? (für Trigger; die App liest die Konfig selbst)
create function app.lexware_beleg_modus(p_betrieb uuid)
returns boolean language sql stable security definer set search_path = app, pg_temp as $$
	select coalesce((select l.belege_in_lexware and l.organisation_id is not null
		from app.lexware_konfig l where l.betrieb_id = p_betrieb), false);
$$;
revoke all on function app.lexware_beleg_modus(uuid) from public, crm_admin, crm_auth;
grant execute on function app.lexware_beleg_modus(uuid) to crm_app;

-- 2 ——— Angebote
alter table app.angebote
	add column beleg_quelle text not null default 'crm' check (beleg_quelle in ('crm', 'lexware')),
	add column lexware_id uuid,
	add column lexware_nummer text check (char_length(lexware_nummer) <= 40),
	add column lexware_status text check (lexware_status in ('draft', 'open', 'accepted', 'rejected', 'voided')),
	add column lexware_version integer check (lexware_version >= 0),
	add column lexware_stand timestamptz,
	-- Fortschritt beim Versand: wartet (in der Warteschlange) → festgeschrieben (Nummer da) → pdf (PDF geholt, im Portal)
	-- → gesendet (Mail raus bzw. von Hand) | fehler
	add column lexware_phase text check (lexware_phase in ('wartet', 'festgeschrieben', 'pdf', 'gesendet', 'fehler')),
	add column lexware_fehler text check (char_length(lexware_fehler) <= 1000);
alter table app.angebote alter column nummer drop not null;
alter table app.angebote add constraint angebote_nummer_quelle check (
	(beleg_quelle = 'crm' and nummer is not null)
	or (beleg_quelle = 'lexware' and (nummer is null or (lexware_nummer is not null and nummer = lexware_nummer))));
alter table app.angebote add constraint angebote_lexware_eindeutig unique (betrieb_id, lexware_id);
grant update (nummer, lexware_id, lexware_nummer, lexware_status, lexware_version, lexware_stand, lexware_phase, lexware_fehler, versendet_am)
	on app.angebote to crm_app;

-- Nummer: nur ohne Lexware-Belegmodus aus dem CRM-Nummernkreis
create or replace function app.angebot_nummer_setzen()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
	v_kontext text := nullif(current_setting('app.betrieb_id', true), '');
begin
	if v_kontext is not null and v_kontext is distinct from new.betrieb_id::text then
		raise exception 'angebot_nummer_setzen: Betriebskontext passt nicht' using errcode = '42501';
	end if;
	if app.lexware_beleg_modus(new.betrieb_id) then
		new.beleg_quelle := 'lexware';
		new.nummer := null;
	else
		new.beleg_quelle := 'crm';
		if new.nummer is null then
			new.nummer := app.naechste_angebotsnummer(new.betrieb_id);
		end if;
	end if;
	return new;
end;
$$;
revoke execute on function app.angebot_nummer_setzen() from public, crm_app, crm_admin, crm_auth;

-- Lexware-Angebot: festgeschrieben (lexware_id da) → nie wieder Entwurf, Lexware-ID/-Nummer und Quelle unveränderlich;
-- versendet_am kommt erst mit dem tatsächlichen Versand (nicht schon beim Klick, Nachfassen zählt ab dann).
create function app.angebot_lexware_schutz()
returns trigger
language plpgsql
as $$
begin
	if new.beleg_quelle is distinct from old.beleg_quelle then
		raise exception 'Die Belegquelle eines Angebots ist unveränderlich' using errcode = '55000';
	end if;
	if old.lexware_id is not null and (new.lexware_id is distinct from old.lexware_id
		or new.lexware_nummer is distinct from old.lexware_nummer and old.lexware_nummer is not null) then
		raise exception 'Lexware-Beleg ist festgeschrieben' using errcode = '55000';
	end if;
	if old.beleg_quelle = 'lexware' and old.lexware_id is not null and new.status = 'entwurf' then
		raise exception 'Angebot ist in Lexware festgeschrieben – bitte „Neue Version“' using errcode = '55000';
	end if;
	if new.beleg_quelle = 'lexware' and new.status = 'versendet' and old.status is distinct from 'versendet' then
		new.versendet_am := null;
	end if;
	return new;
end;
$$;
-- nach angebote_versendet_am (Triggerreihenfolge alphabetisch: „angebote_lexware…“ < „angebote_versendet_am“ – daher
-- eigener Name mit „zz“, damit er NACH dem Setzen von versendet_am läuft)
create trigger angebote_zz_lexware_schutz before update on app.angebote
	for each row execute function app.angebot_lexware_schutz();

-- Neue Arten der Lexware-Warteschlange
alter table app.lexware_auftraege drop constraint lexware_auftraege_art_check;
alter table app.lexware_auftraege add constraint lexware_auftraege_art_check check (art in (
	'kontakt_anlegen', 'kontakt_aktualisieren', 'kontakte_abgleichen', 'belege_abgleichen', 'abos_einrichten',
	'angebot_festschreiben', 'angebot_versand', 'ab_anlegen', 'ab_versand'));

-- 3 ——— PDF-Zwischenspeicher
create table app.lexware_dateien (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	lexware_id uuid not null,
	typ text not null check (typ in ('quotation', 'orderconfirmation', 'invoice', 'downpaymentinvoice', 'creditnote', 'dunning')),
	name text not null check (char_length(name) between 1 and 200),
	pdf bytea not null check (octet_length(pdf) between 5 and 10485760),
	sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
	geholt timestamptz not null default now(),
	unique (id, betrieb_id),
	unique (betrieb_id, lexware_id)
);
revoke all on app.lexware_dateien from public, crm_app, crm_admin, crm_auth;
grant select, insert (betrieb_id, lexware_id, typ, name, pdf, sha256), update (name, pdf, sha256, geholt), delete on app.lexware_dateien to crm_app;
alter table app.lexware_dateien enable row level security;
alter table app.lexware_dateien force row level security;
create policy lexware_dateien_mandant on app.lexware_dateien for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid) with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);

-- 4 ——— Auftragsbestätigung als Lexware-Spiegel
alter table app.auftragsbestaetigungen
	add column beleg_quelle text not null default 'crm' check (beleg_quelle in ('crm', 'lexware')),
	add column lexware_id uuid,
	add constraint auftragsbestaetigungen_lexware check (beleg_quelle = 'crm' or lexware_id is not null),
	add constraint auftragsbestaetigungen_lexware_eindeutig unique (betrieb_id, lexware_id);
grant insert (beleg_quelle, lexware_id), update (mail_an) on app.auftragsbestaetigungen to crm_app;

-- 5 ——— Drei Terminvorschläge für den Baubeginn
create table app.angebot_terminvorschlaege (
	id uuid primary key default gen_random_uuid(),
	betrieb_id uuid not null references app.betriebe (id) on delete cascade,
	angebot_id uuid not null,
	pos smallint not null check (pos between 1 and 3),
	beginn date not null,
	hinweis text check (char_length(hinweis) <= 200),
	unique (id, betrieb_id),
	unique (angebot_id, pos),
	unique (angebot_id, beginn),
	foreign key (angebot_id, betrieb_id) references app.angebote (id, betrieb_id) on delete cascade
);
create index angebot_terminvorschlaege_angebot_idx on app.angebot_terminvorschlaege (angebot_id, betrieb_id);
revoke all on app.angebot_terminvorschlaege from public, crm_app, crm_admin, crm_auth;
grant select, insert (betrieb_id, angebot_id, pos, beginn, hinweis), delete on app.angebot_terminvorschlaege to crm_app;
alter table app.angebot_terminvorschlaege enable row level security;
alter table app.angebot_terminvorschlaege force row level security;
create policy angebot_terminvorschlaege_mandant on app.angebot_terminvorschlaege for all to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid) with check (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid);
-- nur im Entwurf änderbar (gleiche Regel wie Positionen)
create trigger angebot_terminvorschlaege_nur_entwurf before insert or update or delete on app.angebot_terminvorschlaege
	for each row execute function app.angebot_position_nur_entwurf();

alter table app.angebot_entscheidungen
	add column termin_vorschlag_id uuid,
	add column termin_beginn date,
	add column termin_wunsch_text text check (char_length(termin_wunsch_text) <= 1000),
	add constraint angebot_entscheidungen_termin_fk foreign key (termin_vorschlag_id, betrieb_id)
		references app.angebot_terminvorschlaege (id, betrieb_id) on delete set null (termin_vorschlag_id);
grant insert (termin_vorschlag_id, termin_beginn, termin_wunsch_text) on app.angebot_entscheidungen to crm_app;

alter table app.auftraege add column baubeginn date;
grant update (baubeginn) on app.auftraege to crm_app;

-- 6 ——— Mail-Zweck „angebot“
alter table app.mail_vorlagen drop constraint mail_vorlagen_zweck_check;
alter table app.mail_vorlagen add constraint mail_vorlagen_zweck_check
	check (zweck in ('allgemein', 'angebot', 'nachfassen_angebot', 'zahlungserinnerung', 'auftragsbestaetigung', 'buchungsbestaetigung', 'portal_link', 'bewertung'));
