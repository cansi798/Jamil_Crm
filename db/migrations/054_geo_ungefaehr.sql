-- Auftragskarte: Wird die genaue Adresse nicht gefunden (Tippfehler, neue Straße), wird nur „PLZ Ort“ gesucht und der
-- Punkt als ungefähr markiert – so fehlt der Auftrag nicht auf der Karte. Bisher nicht gefundene Adressen neu versuchen.

alter table app.geo_adressen add column ungefaehr boolean not null default false;
grant update (ungefaehr) on app.geo_adressen to crm_app;

update app.geo_adressen set status = 'offen', versuche = 0, abgefragt = null where status = 'nicht_gefunden';
