-- Nachkalkulation (Wunsch Jamil, Talk msgs 2770–2774, Punkt 1): Fahrtkosten je km für Plan/Ist.
-- km-Satz: entweder fest eingetragen (km_satz_cent) oder aus den Fahrzeugkosten der Kalkulation ÷ gefahrene km pro
-- Jahr (jahres_km). Rechnung: src/lib/nachkalkulation.ts. Vertraulich wie die übrige Kalkulation (kein Protokoll).

alter table app.kalkulation_betrieb
	add column km_satz_cent bigint check (km_satz_cent between 0 and 100000),
	add column jahres_km integer check (jahres_km between 1 and 10000000);
grant insert (km_satz_cent, jahres_km) on app.kalkulation_betrieb to crm_app;
grant update (km_satz_cent, jahres_km) on app.kalkulation_betrieb to crm_app;
