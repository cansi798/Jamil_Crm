-- Ausgangsbelege (Jamil, Talk msg 2948): der Menübereich „Angebote“ heißt jetzt „Ausgangsbelege“ und hat die Reiter
-- Angebote, Auftragsbestätigungen und Rechnungen. Gespeicherte Ansichten gibt es für alle drei Reiter – die Liste der
-- erlaubten Seiten wird um 'auftragsbestaetigungen' und 'rechnungen' erweitert ('angebote' bleibt unverändert).

alter table app.gespeicherte_ansichten drop constraint gespeicherte_ansichten_seite_check;
alter table app.gespeicherte_ansichten add constraint gespeicherte_ansichten_seite_check check (seite in (
	'plantafel', 'karte', 'auftraege', 'todos', 'angebote', 'kunden', 'zeiten', 'nachkalkulation',
	'auftragsbestaetigungen', 'rechnungen'
));
