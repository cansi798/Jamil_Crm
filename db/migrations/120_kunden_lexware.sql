-- Kunden ↔ Lexware-Kontakte (Plan „Lexware als Belegsystem“, Task T4; Jamil Talk #6093 Antwort 6: § 13b berücksichtigen).
--
-- * lexware_id/lexware_version: verknüpfter Kontakt in Lexware (PUT braucht die aktuelle version, sonst 409).
-- * lexware_stand: wann der Kontakt zuletzt nach Lexware übertragen bzw. von dort gelesen wurde. Ist geaendert > stand,
--   gibt es neue Daten im CRM → „Kunde in Lexware aktualisieren“.
-- * lexware_geaendert: Lexware hat den Kontakt geändert (Rückmeldung contact.changed) – das CRM führt bei den
--   Stammdaten (Plan Frage 8), fragt aber „übernehmen?“.
-- * § 13b UStG (Bauleistungen an Bauleister): bauleister_13b + bescheinigung_13b_bis (Bescheinigung des Finanzamts,
--   höchstens 3 Jahre). leitweg_id: Behörden (XRechnung, buyerReference). Wirken erst mit den Rechnungen (Phase 3).

alter table app.kunden add column lexware_id uuid;
alter table app.kunden add column lexware_version integer check (lexware_version >= 0);
alter table app.kunden add column lexware_stand timestamptz;
alter table app.kunden add column lexware_geaendert boolean not null default false;
alter table app.kunden add column bauleister_13b boolean not null default false;
alter table app.kunden add column bescheinigung_13b_bis date;
alter table app.kunden add column leitweg_id text check (char_length(leitweg_id) <= 100);
alter table app.kunden add constraint kunden_lexware_eindeutig unique (betrieb_id, lexware_id);
alter table app.kunden add constraint kunden_13b_nur_firma check (not bauleister_13b or art = 'firma');

grant update (lexware_id, lexware_version, lexware_stand, lexware_geaendert, bauleister_13b, bescheinigung_13b_bis, leitweg_id) on app.kunden to crm_app;

-- Abgleich-Stand (Version, Zeitpunkt) ist technisch und gehört nicht ins Änderungsprotokoll des Kunden
drop trigger kunden_protokoll on app.kunden;
create trigger kunden_protokoll
	after insert or update or delete on app.kunden
	for each row execute function app.protokolliere('geaendert', 'lexware_version', 'lexware_stand');
