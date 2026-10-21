import type { Schema } from './protokoll-formular';

/**
 * Beispiel-Vorlagen für Protokolle (Wunsch Jamil, Talk msg 2649): „Abdichtungsprotokoll Bad“ (Foto der Abdichtung als
 * Pflicht-Schritt, Mängel nur bei „ja“, Unterschrift des Kunden am Ende) und „Abnahmeprotokoll“ (Foto der Mängel nur
 * Pflicht, wenn Mängel vorhanden). Der Seed legt sie für den Testbetrieb an; jeder Betrieb kann sie unter
 * Einstellungen → Protokoll-Vorlagen übernehmen und frei ändern.
 */

export type Startvorlage = { schluessel: string; name: string; beschreibung: string; schema: Schema; art?: 'protokoll' | 'aufmass' };

export const STARTVORLAGEN: Startvorlage[] = [
	{
		schluessel: 'abdichtung-bad',
		name: 'Abdichtungsprotokoll Bad',
		beschreibung: 'Verbundabdichtung im Bad (DIN 18534): Untergrund, Ausführung, Pflicht-Foto der Abdichtung, Unterschrift.',
		schema: {
			seiten: [
				{
					id: 's_untergrund',
					titel: 'Untergrund',
					abschnitte: [
						{
							id: 'a_untergrund',
							titel: 'Vor der Abdichtung',
							felder: [
								{ id: 'hinweis_start', typ: 'hinweis', label: 'Abdichtung nach DIN 18534', hilfe: 'Bitte jeden Schritt vor Ort ausfüllen. Weiter geht es erst, wenn alle Pflichtfelder erledigt sind.' },
								{ id: 'datum', typ: 'datum', label: 'Datum der Abdichtung', pflicht: true },
								{
									id: 'untergrund',
									typ: 'auswahl',
									label: 'Untergrund',
									pflicht: true,
									optionen: ['Zementestrich', 'Anhydritestrich', 'Gipskarton', 'Mauerwerk / Putz', 'Altfliesen']
								},
								{ id: 'restfeuchte', typ: 'messwert', label: 'Restfeuchte Estrich', einheit: 'CM-%', min: 0, max: 10, hilfe: 'Zementestrich höchstens 2,0 CM-%, Anhydrit höchstens 0,5 CM-%.' },
								{ id: 'tragfaehig', typ: 'janein', label: 'Untergrund tragfähig, sauber und trocken?', pflicht: true }
							]
						}
					]
				},
				{
					id: 's_abdichtung',
					titel: 'Abdichtung',
					abschnitte: [
						{
							id: 'a_system',
							titel: 'System',
							felder: [
								{ id: 'system', typ: 'auswahl', label: 'Abdichtungssystem', pflicht: true, optionen: ['Flüssigabdichtung', 'Dichtbahn', 'Dichtschlämme'] },
								{ id: 'produkt', typ: 'text', label: 'Hersteller / Produkt' },
								{ id: 'schichtdicke', typ: 'messwert', label: 'Schichtdicke (trocken)', einheit: 'mm', min: 0, max: 10 }
							]
						},
						{
							id: 'a_ausfuehrung',
							titel: 'Ausführung',
							felder: [
								{
									id: 'ausfuehrung',
									typ: 'checkliste',
									label: 'Ausführung geprüft',
									pflicht: true,
									optionen: ['Grundierung aufgetragen', 'Dichtband in Ecken und Übergängen', 'Manschetten an Durchdringungen', 'Bodenablauf eingebunden', 'Zwei Schichten aufgetragen']
								}
							]
						}
					]
				},
				{
					id: 's_fotos',
					titel: 'Fotos',
					abschnitte: [
						{
							id: 'a_fotos',
							felder: [
								{ id: 'foto_abdichtung', typ: 'foto', label: 'Foto der Abdichtung', pflicht: true, minFotos: 1, hilfe: 'Gesamtansicht – ohne Foto geht es nicht weiter.' },
								{ id: 'foto_details', typ: 'foto', label: 'Detailfotos (Ecken, Durchdringungen)' }
							]
						}
					]
				},
				{
					id: 's_maengel',
					titel: 'Mängel',
					abschnitte: [
						{
							id: 'a_maengel',
							felder: [
								{ id: 'mangel', typ: 'janein', label: 'Mangel festgestellt?', pflicht: true },
								{
									id: 'mangel_text',
									typ: 'textlang',
									label: 'Beschreibung des Mangels',
									pflicht: true,
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' }
								},
								{
									id: 'mangel_foto',
									typ: 'foto',
									label: 'Foto des Mangels',
									pflicht: true,
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' }
								}
							]
						}
					]
				},
				{
					id: 's_abschluss',
					titel: 'Unterschrift',
					abschnitte: [
						{
							id: 'a_abschluss',
							felder: [
								{ id: 'bemerkung', typ: 'textlang', label: 'Bemerkung' },
								{ id: 'unterschrift_kunde', typ: 'unterschrift', label: 'Unterschrift Kunde', wer: 'kunde', pflicht: true },
								{ id: 'unterschrift_monteur', typ: 'unterschrift', label: 'Unterschrift Monteur', wer: 'monteur' }
							]
						}
					]
				}
			]
		}
	},
	{
		schluessel: 'abnahme',
		name: 'Abnahmeprotokoll',
		beschreibung: 'Abnahme der Leistung mit Begehung, Mängeln (Foto nur Pflicht bei Mängeln) und Unterschrift des Kunden.',
		schema: {
			seiten: [
				{
					id: 's_abnahme',
					titel: 'Abnahme',
					abschnitte: [
						{
							id: 'a_abnahme',
							felder: [
								{ id: 'datum', typ: 'datum', label: 'Datum der Abnahme', pflicht: true },
								{ id: 'uhrzeit', typ: 'uhrzeit', label: 'Uhrzeit' },
								{ id: 'art', typ: 'auswahl', label: 'Art der Abnahme', pflicht: true, optionen: ['Gesamtabnahme', 'Teilabnahme'] },
								{
									id: 'teil',
									typ: 'text',
									label: 'Welcher Teil wird abgenommen?',
									pflicht: true,
									bedingung: { feld: 'art', op: 'gleich', wert: 'Teilabnahme', wirkung: 'zeigen' }
								},
								{ id: 'leistungen', typ: 'textlang', label: 'Abgenommene Leistungen' }
							]
						}
					]
				},
				{
					id: 's_pruefung',
					titel: 'Begehung',
					abschnitte: [
						{
							id: 'a_begehung',
							felder: [
								{
									id: 'begehung',
									typ: 'checkliste',
									label: 'Begehung',
									optionen: ['Arbeiten vollständig ausgeführt', 'Baustelle sauber übergeben', 'Unterlagen / Anleitungen übergeben', 'Bedienung und Wartung erklärt']
								},
								{ id: 'mangel', typ: 'janein', label: 'Mängel vorhanden?', pflicht: true },
								{
									id: 'maengel',
									typ: 'textlang',
									label: 'Mängel',
									pflicht: true,
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' }
								},
								{
									id: 'mangel_foto',
									typ: 'foto',
									label: 'Fotos der Mängel',
									hilfe: 'Pflicht, sobald Mängel vorhanden sind.',
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'pflicht' }
								},
								{
									id: 'frist',
									typ: 'datum',
									label: 'Frist zur Mängelbeseitigung',
									bedingung: { feld: 'mangel', op: 'gleich', wert: 'ja', wirkung: 'zeigen' }
								}
							]
						}
					]
				},
				{
					id: 's_fotos',
					titel: 'Fotos',
					abschnitte: [{ id: 'a_fotos', felder: [{ id: 'foto_fertig', typ: 'foto', label: 'Foto der fertigen Arbeit', pflicht: true }] }]
				},
				{
					id: 's_unterschrift',
					titel: 'Unterschrift',
					abschnitte: [
						{
							id: 'a_unterschrift',
							felder: [
								{
									id: 'hinweis_abnahme',
									typ: 'hinweis',
									label: 'Erklärung',
									hilfe: 'Mit seiner Unterschrift bestätigt der Auftraggeber die Abnahme der oben genannten Leistungen – vorbehaltlich der aufgeführten Mängel.'
								},
								{ id: 'unterschrift_kunde', typ: 'unterschrift', label: 'Unterschrift Auftraggeber', wer: 'kunde', pflicht: true },
								{ id: 'unterschrift_monteur', typ: 'unterschrift', label: 'Unterschrift Auftragnehmer', wer: 'monteur' }
							]
						}
					]
				}
			]
		}
	},
	// Aufmaß-Vorlagen (Jamil msg 2842) – Katalog-Verknüpfungen legt jeder Betrieb selbst an (Positionen sind je Betrieb)
	{
		schluessel: 'aufmass-bad',
		art: 'aufmass',
		name: 'Aufmaß Bad',
		beschreibung: 'Je Raum Länge, Breite, Höhe und Fliesenhöhe; Boden-, Wandfläche und Umfang werden berechnet, unten die Summen mit Verschnitt.',
		schema: {
			seiten: [
				{
					id: 's_allgemein',
					titel: 'Allgemein',
					abschnitte: [
						{
							id: 'a_allgemein',
							felder: [
								{ id: 'verschnitt', typ: 'zahl', label: 'Verschnitt in %', kuerzel: 'verschnitt', min: 0, max: 50, hilfe: 'Üblich sind 10 %.' },
								{ id: 'bemerkung', typ: 'textlang', label: 'Bemerkung' }
							]
						}
					]
				},
				{
					id: 's_raeume',
					titel: 'Räume',
					abschnitte: [
						{
							id: 'a_raum',
							titel: 'Raum',
							wiederholbar: true,
							wiederholName: 'Raum',
							felder: [
								{ id: 'raum_name', typ: 'text', label: 'Raumname', hilfe: 'z. B. Bad OG' },
								{ id: 'raum_l', typ: 'mass', label: 'Länge', kuerzel: 'L', einheit: 'm', pflicht: true },
								{ id: 'raum_b', typ: 'mass', label: 'Breite', kuerzel: 'B', einheit: 'm', pflicht: true },
								{ id: 'raum_h', typ: 'mass', label: 'Raumhöhe', kuerzel: 'H', einheit: 'm', pflicht: true },
								{ id: 'raum_fh', typ: 'mass', label: 'Fliesenhöhe', kuerzel: 'FH', einheit: 'm', pflicht: true, hilfe: 'Raumhoch gefliest: Raumhöhe eintragen.' },
								{ id: 'raum_abzug', typ: 'abzug', label: 'Abzug Tür/Fenster', kuerzel: 'abzug', hilfe: 'Summe der Öffnungen in der gefliesten Höhe; ohne: 0' },
								{ id: 'raum_boden', typ: 'flaeche', label: 'Bodenfläche', kuerzel: 'boden', formel: 'L * B' },
								{ id: 'raum_wand', typ: 'formel', label: 'Wandfläche Fliesen', kuerzel: 'wand', einheit: 'm²', formel: '2 * (L + B) * FH - abzug' },
								{ id: 'raum_umfang', typ: 'umfang', label: 'Umfang', kuerzel: 'umfang', formel: '2 * (L + B)' },
								{ id: 'raum_foto', typ: 'foto', label: 'Foto des Raums' }
							]
						}
					]
				},
				{
					id: 's_summe',
					titel: 'Summen',
					abschnitte: [
						{
							id: 'a_summe',
							felder: [
								{ id: 'summe_boden', typ: 'formel', label: 'Bodenfläche gesamt', einheit: 'm²', formel: 'summe(boden)' },
								{ id: 'summe_wand', typ: 'formel', label: 'Wandfläche gesamt', einheit: 'm²', formel: 'summe(wand)' },
								{ id: 'summe_fliesen', typ: 'formel', label: 'Fliesen inkl. Verschnitt', einheit: 'm²', formel: '(summe(boden) + summe(wand)) * (1 + verschnitt / 100)' },
								{ id: 'summe_umfang', typ: 'formel', label: 'Umfang gesamt (Silikon/Sockel)', einheit: 'm', formel: 'summe(umfang)' }
							]
						}
					]
				}
			]
		}
	},
	{
		schluessel: 'aufmass-boden',
		art: 'aufmass',
		name: 'Aufmaß Boden/Fliesen',
		beschreibung: 'Bodenflächen je Raum mit Abzügen, Sockel abzüglich Türbreiten, Summen mit Verschnitt.',
		schema: {
			seiten: [
				{
					id: 's_allgemein',
					titel: 'Allgemein',
					abschnitte: [
						{
							id: 'a_allgemein',
							felder: [
								{ id: 'verschnitt', typ: 'zahl', label: 'Verschnitt in %', kuerzel: 'verschnitt', min: 0, max: 50, hilfe: 'Gerade verlegt ca. 5–10 %, diagonal ca. 15 %.' },
								{ id: 'belag', typ: 'auswahl', label: 'Belag', optionen: ['Fliesen', 'Feinsteinzeug', 'Vinyl', 'Laminat', 'Parkett'] }
							]
						}
					]
				},
				{
					id: 's_raeume',
					titel: 'Räume',
					abschnitte: [
						{
							id: 'a_raum',
							titel: 'Raum',
							wiederholbar: true,
							wiederholName: 'Raum',
							felder: [
								{ id: 'raum_name', typ: 'text', label: 'Raumname' },
								{ id: 'raum_l', typ: 'mass', label: 'Länge', kuerzel: 'L', einheit: 'm', pflicht: true },
								{ id: 'raum_b', typ: 'mass', label: 'Breite', kuerzel: 'B', einheit: 'm', pflicht: true },
								{ id: 'raum_abzug', typ: 'abzug', label: 'Abzug (Einbauten, Kamin …)', kuerzel: 'abzug', hilfe: 'ohne: 0' },
								{ id: 'raum_tueren', typ: 'mass', label: 'Türbreiten zusammen', kuerzel: 'TB', einheit: 'm', hilfe: 'ohne: 0' },
								{ id: 'raum_flaeche', typ: 'flaeche', label: 'Bodenfläche', kuerzel: 'flaeche', formel: 'L * B - abzug' },
								{ id: 'raum_sockel', typ: 'umfang', label: 'Sockel', kuerzel: 'sockel', formel: '2 * (L + B) - TB' }
							]
						}
					]
				},
				{
					id: 's_summe',
					titel: 'Summen',
					abschnitte: [
						{
							id: 'a_summe',
							felder: [
								{ id: 'summe_flaeche', typ: 'formel', label: 'Fläche gesamt', einheit: 'm²', formel: 'summe(flaeche)' },
								{ id: 'summe_belag', typ: 'formel', label: 'Belag inkl. Verschnitt', einheit: 'm²', formel: 'summe(flaeche) * (1 + verschnitt / 100)' },
								{ id: 'summe_sockel', typ: 'formel', label: 'Sockel gesamt', einheit: 'm', formel: 'summe(sockel)' }
							]
						}
					]
				}
			]
		}
	}
];
