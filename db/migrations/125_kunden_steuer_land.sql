-- Steuerdaten und Land am Kunden (Can #6739, Lexware-Format docs/lexware-format.md, offene Punkte 1 und 2).
--
-- Lexware braucht in jeder Adresse ein Land (ISO 3166 alpha-2, Doku „Contacts“ → Address: countryCode Pflicht) und
-- für Rechnungen nach § 13b UStG einen Firmenkontakt mit gültiger USt-ID (Kochbuch Rechnungen → „FAQ und Hinweise“).
--
-- 1. kunden.land: Pflicht, Standard 'DE' (alle bestehenden Kunden). Kunden, deren PLZ ein Länderkürzel trägt
--    („A-1010“, „CH-8001“), bekommen das passende Land; die PLZ selbst bleibt unverändert (nichts wird gelöscht).
-- 2. kunden.ust_id (USt-IdNr., z. B. DE123456789) und kunden.steuernummer – freiwillig; die grobe Formatprüfung je
--    Länderpräfix macht die App (src/lib/ust-id.ts), keine Online-Prüfung. Hier nur Länge und Zeichen.
-- 3. auftraege.einmal_land: Land des Einmal-Kunden (NULL = Deutschland bzw. Länderkürzel der PLZ). Wird beim
--    „Als Kunden übernehmen“ mitgenommen.
-- Spaltenrechte für crm_app wie bei den übrigen Kundenfeldern; RLS und Änderungsprotokoll gelten unverändert.

alter table app.kunden
	add column land text not null default 'DE' constraint kunden_land check (land ~ '^[A-Z]{2}$'),
	add column ust_id text constraint kunden_ust_id check (ust_id ~ '^[A-Z]{2}[0-9A-Z.+*-]{2,18}$'),
	add column steuernummer text constraint kunden_steuernummer check (char_length(steuernummer) between 5 and 30 and steuernummer ~ '^[0-9 /.-]+$');

grant insert (land, ust_id, steuernummer), update (land, ust_id, steuernummer) on app.kunden to crm_app;

alter table app.auftraege
	add column einmal_land text constraint auftraege_einmal_land check (einmal_land ~ '^[A-Z]{2}$');
alter table app.auftraege drop constraint auftraege_einmal_nur_mit_name;
alter table app.auftraege add constraint auftraege_einmal_nur_mit_name check (
	einmal_name is not null
	or (einmal_telefon is null and einmal_email is null and einmal_strasse is null and einmal_plz is null and einmal_ort is null
		and einmal_land is null)
);
grant insert (einmal_land), update (einmal_land) on app.auftraege to crm_app;

-- Bestand: Land aus dem Länderkürzel der PLZ (gleiche Liste wie src/lib/server/lexware/land.ts)
update app.kunden k set land = m.land
from (values ('D', 'DE'), ('DE', 'DE'), ('A', 'AT'), ('AT', 'AT'), ('CH', 'CH'), ('FL', 'LI'), ('LI', 'LI'), ('F', 'FR'), ('FR', 'FR'),
	('B', 'BE'), ('BE', 'BE'), ('L', 'LU'), ('LU', 'LU'), ('NL', 'NL'), ('DK', 'DK'), ('PL', 'PL'), ('CZ', 'CZ'), ('I', 'IT'), ('IT', 'IT'),
	('E', 'ES'), ('ES', 'ES'), ('S', 'SE'), ('SE', 'SE'), ('N', 'NO'), ('NO', 'NO')) as m(praefix, land)
where upper(substring(btrim(k.plz) from '^([A-Za-z]{1,2})\s*[- ]')) = m.praefix and k.land is distinct from m.land;
