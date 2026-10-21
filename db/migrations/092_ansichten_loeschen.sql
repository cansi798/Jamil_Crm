-- Gespeicherte Ansichten: geteilte Team-Ansichten dürfen außer dem Ersteller auch Chef/Büro löschen (Aufräumen).
-- Die Datenbank erlaubt das Löschen eigener und geteilter Ansichten des Betriebs; WER eine fremde geteilte Ansicht
-- löschen darf (Recht „Alle Aufträge ansehen“ = teilen dürfen), prüft die App (src/lib/server/ansichten.ts).
-- Private Ansichten anderer bleiben auch in der Datenbank unlöschbar.
drop policy gespeicherte_ansichten_loeschen on app.gespeicherte_ansichten;
create policy gespeicherte_ansichten_loeschen on app.gespeicherte_ansichten for delete to crm_app
	using (betrieb_id = nullif(current_setting('app.betrieb_id', true), '')::uuid
		and (benutzer_id = nullif(current_setting('app.benutzer_id', true), '')::uuid or geteilt));
