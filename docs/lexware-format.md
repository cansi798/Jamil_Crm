# Lexware-Format: CRM → Lexware Office (Public API)

Stand 21.11.2026 · Auftrag Can #6714/#6717–#6719 · Branch `lexware-format`

**Ziel:** Alles, was im CRM entsteht (Kunden, Angebote, Auftragsbestätigungen, Rechnungen bzw. Rechnungsentwürfe mit
Positionen, Einheiten, Steuersätzen, Zahlungszielen, Leistungsdatum), liegt in einem Format vor, das die Lexware-Office-API
**ohne weitere Umrechnung** annimmt. Für die spätere Anbindung (z. B. Supabase Edge Function) fehlt dann nur noch:
API-Schlüssel als Secret, HTTP-Aufruf, Ratenlimit, Antwort speichern.

**Quellen (nur offizielle Lexware-Seiten, gelesen 21.11.2026):**

- API-Referenz: <https://developers.lexware.io/docs/> – im Folgenden **D#anker** = `https://developers.lexware.io/docs/#anker`
- Kochbuch Rechnungen: <https://developers.lexware.io/cookbooks/invoices/> – **KR**
- Kochbuch Public API: <https://developers.lexware.io/cookbooks/public-api/> – **KP**

## 1. Wo es im Code steht

| Datei | Inhalt |
|---|---|
| `src/lib/server/lexware/format.ts` | **Reine Abbildungsschicht** (ohne Netz, ohne Datenbank): Typen nach Doku, `kontaktZuLexware`, `angebotZuLexwareQuotation`, `abZuLexwareOrderConfirmation`, `rechnungZuLexwareInvoice`, Prüfer `pruefeBeleg`/`pruefeKontakt` (Pflichtfelder + Grenzen = „Schema“), `erwarteteSummen` (rechnet wie Lexware) |
| `src/lib/server/lexware/belege.ts`, `kontakte.ts` | eigentliche Belegbauer (Texte § 35a/§ 13b, Terminvorschläge, Zahlungsziel) – `format.ts` verpackt und prüft sie, es gibt genau **eine** Abbildung |
| `src/lib/server/lexware/land.ts` | `landAusPlz` (Land aus „AT-1010“ usw.), `suchText` (Suchfilter HTML- + URL-kodiert) |
| `src/lib/server/lexware/export.ts` | lädt die CRM-Daten und baut das **Paket** (Kontakt + Beleg) |
| `GET /api/angebote/{id}/lexware-json` | Knopf „Lexware-JSON herunterladen“ im Angebot (Rechte wie Angebote: `angebote.bearbeiten` + `preise.sehen`) |
| `GET /api/rechnungen/{id}/lexware-json` | Knopf „Lexware-JSON“ in der Rechnung (`rechnungen.sehen` + `preise.sehen`) |
| `tests/unit/lexware-format.test.ts`, `tests/db/lexware-format.test.ts` | Beispiele aus dem Seed, Cent → Euro, Steuern, Leistungsdatum, 500 Zufallsangebote Summe CRM = Summe Lexware |

Der Export ruft Lexware **nicht** auf und enthält **keine** Zugangsdaten.

### Aufbau des Pakets

```json
{
  "format": "lexware-office-v1",
  "quelle": { "art": "angebot", "id": "…", "nummer": null },
  "kontakt": { "methode": "POST", "pfad": "/v1/contacts", "body": { … }, "fehler": [], "warnungen": [] },
  "beleg":   { "methode": "POST", "pfad": "/v1/quotations", "body": { … }, "fehler": [], "warnungen": [],
               "erwartet": { "nettoCent": 155100, "steuerCent": 29469, "bruttoCent": 184569, "jeSatz": [ … ] } },
  "hinweise": [ "…" ]
}
```

- `kontakt` ist `null`, wenn der Kunde schon mit Lexware verknüpft ist (dann steht `address.contactId` im Beleg) oder es keinen Kunden gibt.
- `fehler` nicht leer → Lexware würde ablehnen (406/400): **nicht senden**.
- `erwartet` = was Lexware als `totalPrice` zurückgeben wird; nach dem Anlegen vergleichen (Abweichung = Rundungs-/Datenfehler).

## 2. Feld-Mapping CRM → Lexware

### 2.1 Kunde → Kontakt `POST /v1/contacts`

Beleg: D#contacts-endpoint-create-a-contact (Pflicht: `version` = 0, `roles`, `person` XOR `company`; Person/Firma: `lastName` bzw. `name`; Adresse: `countryCode`), D#contacts-endpoint-contact-properties.

| CRM (`app.kunden`) | Lexware | Regel / Beleg |
|---|---|---|
| – | `version: 0` | Pflicht beim Anlegen; beim PUT die aktuelle Version (D#optimistic-locking) |
| – | `roles.customer: {}` | Rolle als leeres Objekt; Kundennummer vergibt Lexware, nicht setzbar (D#roles-details) |
| `art = privat` | `person` | D#person-details |
| `anrede` | `person.salutation` | max. 25 Zeichen, optional (D#person-details) |
| `vorname` / `nachname` | `person.firstName` / `person.lastName` | `lastName` Pflicht |
| `art = firma`, `firma` | `company.name` | Pflicht (D#company-details) |
| `anrede`, `vorname`, `nachname`, `email`, `telefon` (Firma) | `company.contactPersons[0]` mit `primary: true` | höchstens **eine** Ansprechperson per API (D#company-contact-person-details) |
| `ust_id` / `steuernummer` (Migration 125, nur Firmen) | `company.vatRegistrationId` / `company.taxNumber` | D#company-details; USt-ID für § 13b Pflicht (KR „FAQ und Hinweise“); Form grob je Länderpräfix geprüft (`src/lib/ust-id.ts`), keine Online-Prüfung |
| `strasse` | `addresses.billing[0].street` | höchstens eine Rechnungsadresse per API (D#addresses-details) |
| `plz` | `addresses.billing[0].zip` | passendes Länderkürzel wird abgetrennt („AT-1010“ + Land AT → `1010`) |
| `land` (Migration 125, Standard `DE`) | `addresses.billing[0].countryCode` | **Pflicht**, ISO 3166 alpha-2 (D#address-details, D#faq-country-codes); Rückfall ohne Land (Einmal-Kunde): Kürzel der PLZ, sonst `DE` (`adresseLand`) |
| `ort` | `addresses.billing[0].city` | |
| `email` | `emailAddresses.private[0]` (Privat) / `.business[0]` (Firma) | höchstens ein Eintrag je Liste (D#email-addresses-details) |
| `telefon` | `phoneNumbers.private[0]` / `.business[0]` | höchstens ein Eintrag je Liste (D#phone-numbers-details) |
| `id` | `note: "CRM-Kunde <id>"` | max. 1000 Zeichen (D#contacts-endpoint-contact-properties) – Marke für Zuordnung/Doppelschutz |
| `leitweg_id` | `xRechnung.buyerReference` | nur zusammen mit `vendorNumberAtCustomer` (D#contact-xrechnung-details) – CRM hat die Lieferantennummer nicht → Warnung |

### 2.2 Gemeinsame Belegteile (Angebot, AB, Rechnung)

Beleg: D#invoices-endpoint-invoices-properties, D#invoices-address-details, D#invoices-lineItems-details, D#invoices-unitPrice-details, D#invoices-taxConditions-details, D#faq-texts-in-sales-vouchers, D#faq-datetime-format.

| CRM | Lexware | Regel / Beleg |
|---|---|---|
| Datum (`angebote.datum`, Rechnung: heute) | `voucherDate` | Format `yyyy-MM-ddTHH:mm:ss.SSSXXX`, Millisekunden genau 3-stellig, Zone `Z` oder `+01:00` (D#faq-datetime-format); CRM schickt `T00:00:00.000` mit Berliner Versatz |
| Kunde mit Lexware-ID | `address.contactId` | Kontakt braucht Rolle customer (D#invoices-address-details) |
| Kunde ohne Lexware-ID / Einmal-Kunde (`einmal_land`) | `address.name`, `street`, `zip`, `city`, `countryCode` | „Einmal-Adresse“, Lexware bucht auf den Sammelkunden (KR „Kundenangaben“); `name` + `countryCode` Pflicht |
| Position | `lineItems[]`, `type: "custom"` | manuelle Position ohne Lexware-Artikel; max. 300 (D#invoices-lineItems-details); CRM max. 200 |
| `bezeichnung` | `lineItems[].name` | max. 255 (D#faq-texts-in-sales-vouchers); CRM max. 200 |
| `beschreibung` | `lineItems[].description` | max. 2000; Markdown `**fett**`, `__kursiv__`, `- Liste` wird formatiert (D#faq-text-formatting) |
| `menge` (numeric 12,3) | `lineItems[].quantity` | bis 4 Nachkommastellen (D#invoices-lineItems-details) |
| `einheit` (`Stk`, `m²`, `m`, `lfm`, `m³`, `h`, `psch`, `kg`, `l`) | `lineItems[].unitName` | frei; unbekannte Einheiten legt Lexware an (D#invoices-lineItems-details, KR „Einheit“) |
| `einzelpreis_cent` | `unitPrice.netAmount` = Cent / 100 | Euro, bis 4 Nachkommastellen; nur EUR (D#invoices-unitPrice-details) |
| – | `unitPrice.currency: "EUR"` | Pflicht |
| `mwst_satz` (0/7/19) | `unitPrice.taxRatePercentage` | 0/7/19 (5/16 nur Corona-Zeitraum 2020, D#faq-valid-tax-rates); **0 bei steuerfreien Arten** |
| – (kein Rabatt im CRM) | `discountPercentage: 0` | optional, 2 Nachkommastellen (D#invoices-lineItems-details) |
| – | `totalPrice: { currency: "EUR" }` | Pflicht; Summen rechnet Lexware (D#invoices-totalPrice-details, KR „FAQ“) |
| Steuerfall (s. 2.5) | `taxConditions.taxType` | Pflicht (D#invoices-taxConditions-details) |
| Titel | `title` | max. 25 (D#faq-texts-in-sales-vouchers) |
| `einleitung` | `introduction` | max. 2000 |
| `schluss` + Pflichttexte | `remark` | max. 2000; Zeilenumbruch `\n` |
| – | `language` | nicht gesetzt = `de` (D#invoices-endpoint-invoices-properties); per API nur Deutsch (KR „FAQ“) |

### 2.3 Angebot → `POST /v1/quotations[?finalize=true]`

Beleg: D#quotations-endpoint-create-a-quotation (Pflicht: `voucherDate`, `expirationDate`, `address`, `lineItems`, `totalPrice`, `taxConditions`).

| CRM (`app.angebote`) | Lexware | Regel / Beleg |
|---|---|---|
| `gueltig_bis` | `expirationDate` | Pflicht beim Angebot |
| Terminvorschläge (`angebot_terminvorschlaege`) | Satz in `remark` | Lexware hat kein Feld dafür |
| – | `?finalize=true` beim Versenden | ohne = Entwurf (`draft`) in Lexware (D#quotations-endpoint-create-a-quotation) |
| – | keine optionalen/alternativen Positionen | sonst 406 beim Weiterführen zur AB/Rechnung (D#invoices-endpoint-pursue-to-an-invoice) |

### 2.4 Rechnung / Rechnungsentwurf → `POST /v1/invoices[?precedingSalesVoucherId=…][&finalize=true]`

Beleg: D#invoices-endpoint-create-an-invoice (Pflicht zusätzlich `shippingConditions`), D#invoices-shippingConditions-details, D#invoices-paymentConditions-details, D#invoices-endpoint-pursue-to-an-invoice.

| CRM (`app.rechnungen`) | Lexware | Regel / Beleg |
|---|---|---|
| `positionen` (Schnappschuss) | `lineItems[]` | wie 2.2 |
| `leistung_von` = `leistung_bis` | `shippingConditions: { shippingType: "service", shippingDate }` | **Leistungsdatum Pflicht** |
| `leistung_von` < `leistung_bis` | `{ shippingType: "serviceperiod", shippingDate, shippingEndDate }` | Ende nicht vor Beginn |
| `zahlungsziel_tage` | `paymentConditions.paymentTermDuration` + `paymentTermLabel` | ohne Angabe nimmt Lexware den Standard (D#invoices-paymentConditions-details); Skonto (`paymentDiscountConditions`) nutzt das CRM nicht |
| `festschreiben` | `?finalize=true` | ohne = Entwurf; Status lässt sich danach per API nicht ändern |
| `vorgaenger_id` (Lexware-AB/-Angebot) | `?precedingSalesVoucherId=` | Belegkette; AB im Entwurf → 406 |
| `art = teil` | `title: "Teilrechnung"` | normale Rechnung mit weniger Positionen |
| `art = abschlag/schluss` | – | per API **nicht** anlegbar (D#down-payment-invoices-endpoint-purpose, D#invoices-endpoint-closing-invoices) – CRM bereitet vor, Fertigstellen in Lexware |

### 2.5 Steuerfall

| CRM | `taxType` | Satz | Beleg |
|---|---|---|---|
| normal | `net` | `mwst_satz` | D#invoices-taxConditions-details |
| `lexware_konfig.kleinunternehmer` | `vatfree` | 0 | Lexware-Konto muss „Kleinunternehmer/steuerfrei“ eingestellt sein (KR „Rechnungsarten“; D#profile-endpoint-profile-properties `smallBusiness`) |
| Firmenkunde `bauleister_13b`, Bescheinigung gültig, `ust_id` vorhanden | `constructionService13b` | 0 | nur mit Kontakt (`contactId`), Firma mit gültiger USt-ID; kein Sammelkunde (D#invoices-endpoint-purpose, KR „FAQ“) |
| dasselbe **ohne** `ust_id` | – | – | **Fehler** im Paket; die Warteschlange sendet nicht („§ 13b: Beim Kunden fehlt die USt-IdNr.“); Hinweis in der Kundenakte |
| § 13b-Bescheinigung abgelaufen | `net` + Warnung | `mwst_satz` | CRM-Regel |
| § 35a (Privatkunde) | Satz in `remark` | – | Lexware hat kein Feld |

### 2.6 Summen und Rundung

- Lexware rechnet Brutto und Steuer selbst; geschickt werden nur Netto-Einzelpreis und Steuersatz (KR „FAQ und Hinweise“). `totalNetAmount`, `totalGrossAmount`, `totalTaxAmount`, `lineItemAmount` sind **read-only** (D#invoices-totalPrice-details, D#invoices-lineItems-details).
- CRM rechnet in ganzen Cent: Position = round(Menge × Preis), MwSt = round(Σ Netto × Satz). `erwarteteSummen` rechnet Lexware nach (Position auf 2 Stellen, Steuer je Satz) – Test: 500 Zufallsangebote, CRM = Lexware.
- Cent → Euro: `cent / 100` (z. B. 950 → `9.5`, 7 → `0.07`); JSON hat dann höchstens 2 Nachkommastellen.

## 3. Weitere Ressourcen (gelesen, Stand der Nutzung)

| Ressource | Nutzt das CRM? | Beleg |
|---|---|---|
| Order Confirmations `POST /v1/order-confirmations` | ja (AB nach Annahme, `shippingConditions` = gewählter Baubeginn oder `none`) | D#order-confirmations-endpoint-create-an-order-confirmation |
| Dunnings `POST /v1/dunnings?precedingSalesVoucherId=` | ja; immer Entwurf, Kontakt und Steuerart wie die Rechnung | D „Dunnings Endpoint“ → Purpose (Anker D#dunnings-address-details) |
| Payments `GET /v1/payments/{id}` | ja (offener Betrag) | D#payments-endpoint |
| Voucherlist `GET /v1/voucherlist` | ja (Abgleich, Suche nach Zeitüberschreitung); max. 250 je Seite, max. 10 000 Treffer | D#voucherlist-endpoint, D#paging-of-resources |
| Event Subscriptions | ja (Rückmeldungen, Signatur `X-Lxo-Signature` RSA-SHA512) | D#event-subscriptions-endpoint-verify-authenticity |
| Profile `GET /v1/profile` | ja (Organisation, `smallBusiness`, `taxType`) | D#profile-endpoint |
| Credit Notes | nein (Gutschrift/Storno macht man in Lexware); nur eine Gutschrift je Rechnung | D#credit-notes-endpoint-purpose |
| Delivery Notes | nein (Handwerk ohne Lieferschein) | D#delivery-notes-endpoint-purpose |
| Vouchers (Buchhaltungsbelege) | nein – das sind Buchungsbelege für fremde PDFs, **nicht** für CRM-Rechnungen | D#vouchers-endpoint-purpose |
| Files `POST /v1/files` | nein (nur Beleg-Upload „Zu prüfen“); PDFs über `GET …/{id}/file` | D#files-endpoint-purpose, D#invoices-endpoint-download-an-invoice-file |
| Articles | nein (Katalog bleibt im CRM; Positionen als `custom`) – möglich später: `title`, `type` PRODUCT/SERVICE, `unitName`, `price {leadingPrice, netPrice, taxRate}` | D#articles-endpoint-create-an-article |
| Payment Conditions `GET /v1/payment-conditions` | nein (nur lesbar; CRM schickt Zahlungsziel je Rechnung) | D#payment-conditions-endpoint |
| Countries `GET /v1/countries` | nein (Liste gültiger Codes; ungültiger Code → Lexware nennt die Liste) | D#countries-endpoint |

## 4. Was Lexware Office NICHT kann bzw. Einschränkungen

1. **Nummern vergibt nur Lexware** (Nummernkreise in Lexware); die API kann sie nicht setzen. **Jede** per API angelegte Rechnung – auch ein Entwurf – verbraucht eine Nummer (KR „Rechnungsnummer“, „FAQ und Hinweise“). → CRM legt Rechnungen erst an, wenn sie wirklich gebraucht werden.
2. **Keine Änderung per API nach dem Anlegen**: Für Angebote, AB, Rechnungen gibt es nur `POST` und `GET`, kein `PUT` (D#invoices-endpoint, D#quotations-endpoint). Korrekturen nur in Lexware (Entwurf bearbeiten) bzw. Storno/Gutschrift.
3. **Status nicht setzbar**: „The status of an invoice/quotation cannot be changed via the api“ – Festschreiben nur beim Anlegen (`finalize=true`), Angebot „angenommen“ muss man in Lexware klicken (D#invoices-endpoint-create-an-invoice, D#quotations-endpoint-create-a-quotation).
4. **Abschlags- und Schlussrechnungen** nur lesbar (D#down-payment-invoices-endpoint-purpose, D#invoices-endpoint-closing-invoices).
5. **Mahnungen** bleiben immer Entwurf (D „Dunnings Endpoint“ → Purpose).
6. **PDF erst nach dem Festschreiben**; Entwurf → 409 bzw. 406 (D#invoices-endpoint-download-an-invoice-file).
7. **Kontakte**: höchstens eine Ansprechperson, eine Rechnungs-/Lieferadresse, ein Eintrag je E-Mail-/Telefonart; Kontakte mit mehr lassen sich per API nicht ändern (D#company-contact-person-details, D#addresses-details).
8. **§ 13b / Drittland** nur mit echtem Kontakt (Firma, USt-ID), nie mit Einmal-Adresse/Sammelkunde (KR „FAQ“, D#invoices-endpoint-purpose).
9. **Steuerfrei (vatfree)** nur, wenn das Lexware-Konto so eingestellt ist – sonst Validierungsfehler (KR „Rechnungsarten“).
10. **Nur EUR**, Rechnungen per API **nur Deutsch** (KR „Preis“, „FAQ“).
11. **Gesamtbetrag nicht negativ** (negative Einzelpositionen erlaubt) (KR „FAQ“).
12. **Optionale/alternative Positionen** im Angebot verhindern das Weiterführen zu AB/Rechnung (406) (D#invoices-endpoint-pursue-to-an-invoice).
13. **Artikel-Positionen** (`service`/`material`) brauchen eine Lexware-Artikel-ID – das CRM schickt immer `custom` (D#invoices-lineItems-details).
14. **Suche** (`name`/`email`-Filter, Belegliste): `&`, `<`, `>` müssen HTML-kodiert und dann URL-kodiert werden, mindestens 3 Zeichen (D#faq-search-string-encoding, D#contacts-endpoint-filtering-contacts).
15. **Keine Zahlungsbuchung per API** für Verkaufsbelege; Zahlungen nur lesen (D#payments-endpoint).

## 5. Abgleich: vorhandene Lexware-Umsetzung ↔ Doku

**Passt:** Pflichtfelder aller vier Belegarten, Datumsformat, `contactId`/Einmal-Adresse, `custom`-Positionen mit `unitPrice` (EUR, Netto, Satz, 0 bei vatfree/§ 13b), Leistungsdatum (service/serviceperiod), Zahlungsziel, Titel ≤ 25, Texte ≤ 2000, keine optionalen Positionen, Versionsnummer beim Kontakt-PUT, 2 Anfragen/s (CRM hält 1,5/s ein), Webhook-Signatur, Summen identisch.

**Lücken – in diesem Branch behoben:**

1. `countryCode` war immer `DE`, auch bei „AT-1010“ / „CH-8001“ → jetzt aus dem PLZ-Präfix (`land.ts`), PLZ ohne Präfix.
2. Kontaktsuche nach Zeitüberschreitung kodierte `&`, `<`, `>` nicht HTML → „Müller & Söhne“ wurde nicht gefunden (Doppel-Kontakt möglich) → `suchText`.
3. Telefon wurde auf 30 Zeichen gekürzt (Doku nennt keine Grenze) → jetzt bis 50 (CRM-Höchstlänge).
4. § 13b mit Einmal-Adresse hätte Lexware abgelehnt, ohne dass das CRM es vorher merkt → `pruefeBeleg` meldet es.
5. Keine Vorab-Prüfung/kein Vergleich der Summen → `pruefeBeleg`, `pruefeKontakt`, `erwarteteSummen`.

6. USt-IdNr., Steuernummer und Land am Kunden (Migration 125, Can #6739); Land auch am Einmal-Kunden; § 13b ohne USt-IdNr. = Fehler.

**Lücken – offen:** Leitweg-ID ohne Lieferantennummer (XRechnung), keine Rabatte, Einheiten als Kürzel.

## 6. Hinweise für die spätere Supabase-Anbindung

- **Edge Function** (Deno) nimmt das Paket (`/api/…/lexware-json` bzw. dieselbe Funktion `format.ts` serverseitig), schickt erst `kontakt` (falls nicht `null`), setzt die Antwort-`id` als `beleg.body.address.contactId`, dann `beleg`. Basis-URL `https://api.lexware.io` (alter Host `api.lexoffice.io` nur bis Dez. 2025, D „Introduction“).
- **Schlüssel**: `Authorization: Bearer <API-Key>`; nur als Supabase-Secret (`supabase secrets set LEXWARE_API_KEY=…`), nie im Browser, nie in Tabellen im Klartext, nie in Logs. Lebensdauer 24 Monate, Erneuerung unter app.lexware.de/addons/public-api (KP „API Key“). Nach neuem Schlüssel Event-Subscriptions neu anlegen (D#event-subscriptions-endpoint-purpose); auf `token.revoked` reagieren (KP).
- **Ratenlimit**: 2 Anfragen/s je Client über alle Endpunkte, Token-Bucket; 429 → später mit Backoff wiederholen (D#api-rate-limits). Empfehlung: Warteschlangen-Tabelle + eine Funktion mit Sperre (wie `app.lexware_auftraege`), ≤ 1,5/s.
- **Idempotenz**: Lexware hat keinen Idempotenz-Schlüssel. Bei Zeitüberschreitung (504 nach 30 s, D#error-codes) vor dem Neuversuch in der Belegliste suchen (Kontakt + Betrag + Zeit), Kontakte über die Marke „CRM-Kunde <id>“ in `note`.
- **Fehler**: 406 = Validierung, Felder in `details[].field` (D#error-codes-regular-error-response); `contacts`, `files`, `vouchers` liefern das alte Format `IssueList[]` (D#error-codes-legacy-error-response). 401 kann auch Störung bei Lexware sein (D#faq-getting-http-status-code-401).
- **Webhooks**: HTTPS mit gutem Zertifikat (KP), sofort 200/204 antworten, in eine Queue legen (Timeout 5 s, D#event-subscriptions-endpoint-purpose), Signatur prüfen; Inhalt nur `resourceId` → Beleg per GET holen.
- **Zeitzone**: Datumswerte immer mit Berliner Versatz (`lexwareDatum`) – nicht `toISOString()` (UTC verschiebt den Tag).
