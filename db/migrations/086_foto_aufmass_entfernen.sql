-- Foto-Aufmaß komplett entfernt (Entscheidung Jamil, Talk msg 2904).
--
-- Die Tabelle aus Migration 083 (KI-Schätzungen samt Lerndaten) fällt weg, ebenso ihre Einträge im Verlauf.
-- Aufmaß-Vorlagen (msg 2842) kommen später ohne KI-Vorbelegung aus Fotos.

delete from app.aenderungen where tabelle = 'aufmass_schaetzungen';
drop table if exists app.aufmass_schaetzungen;
