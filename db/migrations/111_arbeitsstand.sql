-- Arbeitsstand im Status „In Arbeit“ (Jamil, Talk msg 3658): Die Spalte „In Arbeit“ zeigt drei Untergruppen – „Arbeiten
-- durchführen“, „Qualitätsprüfung durchführen“, „Endabnahme mit Kunden durchführen“. Für „Arbeiten fertig“ und
-- „Qualitätsprüfung erledigt“ gibt es keine vorhandenen Daten, darum EIN kleines Feld am Auftrag:
--   leer       = Arbeiten durchführen (Start)
--   qualitaet  = Arbeiten sind fertig, als Nächstes die Qualitätsprüfung
--   abnahme    = Qualitätsprüfung erledigt, als Nächstes die Endabnahme mit dem Kunden
-- Nach der Endabnahme geht der Auftrag wie bisher auf den Status „Abgenommen“. Bei jedem Statuswechsel wird das Feld
-- geleert (Trigger) – kommt ein Auftrag später wieder in „In Arbeit“ (z. B. Nacharbeiten), beginnt er bei „Arbeiten
-- durchführen“. Nur Anzeige und Orientierung; Statuskette und Rechte bleiben.

alter table app.auftraege add column arbeitsstand text check (arbeitsstand in ('qualitaet', 'abnahme'));
grant update (arbeitsstand) on app.auftraege to crm_app;

create function app.auftrag_arbeitsstand_zuruecksetzen()
returns trigger
language plpgsql
as $$
begin
	if new.status is distinct from old.status then
		new.arbeitsstand := null;
	end if;
	return new;
end;
$$;

create trigger auftrag_arbeitsstand_zuruecksetzen before update of status on app.auftraege
	for each row execute function app.auftrag_arbeitsstand_zuruecksetzen();
