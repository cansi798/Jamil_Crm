-- Empfehlungen aus dem Prüfbericht vom 21.11.2026 (Can 23:21: „Crm Empfehlung einfach immer umsetzen“).
--
-- 1. Indizes: Verläufe je Auftrag lesen das Änderungsprotokoll über die Auftrags-ID im JSON
--    (coalesce(nachher ->> 'auftrag_id', vorher ->> 'auftrag_id')) – ohne Index wird die Auftragsseite mit wachsendem
--    Protokoll langsamer. Portal-Ereignisse werden je Link gezählt (Fehlversuche, Zugriffe).
-- 2. Lexware „Kontakt geändert“ (Webhook): Das CRM führt bei den Stammdaten. Bisher hat jedes Update am Kunden –
--    auch das rein technische Merken des Lexware-Stands – „geaendert“ auf jetzt gesetzt; zusammen mit
--    lexware_stand = now() im Webhook galt eine NOCH NICHT gesendete CRM-Änderung danach als „schon übertragen“ und
--    ging verloren. Jetzt: Ändern sich nur Lexware-Abgleichsfelder, bleibt „geaendert“ stehen (der Webhook setzt den
--    Stand außerdem nicht mehr, siehe src/lib/server/lexware/ereignis.ts).

create index aenderungen_auftrag_json_idx on app.aenderungen
	(betrieb_id, tabelle, (coalesce(nachher ->> 'auftrag_id', vorher ->> 'auftrag_id')), id desc)
	where coalesce(nachher ->> 'auftrag_id', vorher ->> 'auftrag_id') is not null;

create index portal_ereignisse_link_idx on app.portal_ereignisse (link_id, betrieb_id, zeit desc) where link_id is not null;

create function app.kunden_setze_geaendert()
returns trigger
language plpgsql
as $$
begin
	-- Nur Abgleichsfelder (Lexware) geändert → kein fachliches Ändern, „geaendert“ bleibt
	if (to_jsonb(new) - array['geaendert', 'lexware_id', 'lexware_version', 'lexware_stand', 'lexware_geaendert', 'lexware_kundennummer'])
		is not distinct from (to_jsonb(old) - array['geaendert', 'lexware_id', 'lexware_version', 'lexware_stand', 'lexware_geaendert', 'lexware_kundennummer']) then
		new.geaendert := old.geaendert;
	else
		new.geaendert := now();
	end if;
	return new;
end;
$$;

drop trigger kunden_geaendert on app.kunden;
create trigger kunden_geaendert before update on app.kunden
	for each row execute function app.kunden_setze_geaendert();
