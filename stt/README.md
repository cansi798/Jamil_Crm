# crm-stt – Spracherkennung auf dem eigenen Server

Kleiner HTTP-Dienst (Python 3.12, faster-whisper 1.2.1, Modell `small`, int8, Deutsch). Er läuft als Container
`crm-stt` in der Sandbox `/opt/crm-sandbox`, **nur** im internen Netz `crm-intern` (kein Internet, kein Port nach
außen). Die App erreicht ihn als `http://crm-stt:8080` (Umgebung `CRM_STT_URL`).

## Schnittstelle

| Aufruf | Antwort |
| --- | --- |
| `GET /gesund` | `200 {"ok": true, "modell": "small"}` |
| `POST /transkribiere` (multipart, Feld `audio`, oder rohe Bytes mit `Content-Type: audio/…`) | `200 {"text", "dauer_s", "sprache": "de", "rechenzeit_s"}` |

Fehler (immer mit deutscher Meldung `fehler` und Kennung `grund`): `413 zu_gross` (> 5 MB), `422 leer`,
`422 unlesbar` (kein Audio), `422 zu_lang` (> 60 s), `503 belegt` (mehr als 4 Anfragen warten).
Stille ergibt `200` mit leerem Text (die App meldet dann „Ich habe nichts verstanden – bitte noch einmal“).

## Datenschutz

- Audio wird nur im Arbeitsspeicher dekodiert (PyAV → 16 kHz mono) und danach verworfen – keine Datei, auch nicht
  in `/tmp` (Test `test_keine_dateien_in_tmp`), Wurzeldateisystem schreibgeschützt.
- Weder Audio noch erkannter Text stehen im Log (Zugriffslog abgeschaltet).
- Das Modell liegt im Image (beim Bauen geladen); zur Laufzeit gilt `HF_HUB_OFFLINE=1`.

Hinweis: `WhisperModel.transcribe(pfad)` ist mit faster-whisper 1.2.1 und neuem PyAV kaputt
(`open() got an unexpected keyword argument 'metadata_errors'`) – deshalb dekodiert der Dienst selbst und übergibt
ein numpy-Array.

## Ressourcen

`cpus: 1.5`, `memory: 2g`, `cpu_shares: 64` (Nextcloud hat Vorrang), 2 Rechen-Threads, eine Umwandlung gleichzeitig.

Messung 17.10.2026 (AMD EPYC, nur AVX2, Grenze 1,5 CPUs, Modell small/int8, 2 Threads):

| Audio | Wandzeit | CPU-Zeit |
| --- | --- | --- |
| 2 s („Neuer Auftrag für Müller“) | 4,4–5,8 s | 6,3–8,2 s |
| 10 s | 5,7–7,9 s | 8,3–10,4 s |

Der Encoder rechnet immer ein 30-s-Fenster; kurze Befehle kosten deshalb fast so viel wie lange. Das Plan-Ziel
„10 s in < 6 s“ wird auf diesem Server knapp verfehlt. Modell `base` wäre ~2,5 s schnell, erkennt deutsche Namen aber
nicht brauchbar (synthetisch: „Fügel, Läder“ statt „für Müller“) – deshalb bleibt es bei `small`.

## Tests

```sh
sudo docker run --rm --network none --cpus 1.5 --memory 2g \
  -v /home/can/projekte/crm-system/stt:/pruefung:ro crm-stt:1d \
  python -m pytest -q -s -p no:cacheprovider /pruefung/test_server.py
```

Testdaten in `testdaten/` sind synthetisch (`espeak-ng -v de`, 16 kHz mono).
