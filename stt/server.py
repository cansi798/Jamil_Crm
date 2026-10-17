"""STT-Dienst crm-stt (Stufe 1d): Sprache → Text mit faster-whisper, nur im internen Netz der Sandbox.

HTTP (Port STT_PORT, Standard 8080):
  GET  /gesund        → 200 {"ok": true, "modell": "small"}
  POST /transkribiere → 200 {"text", "dauer_s", "sprache", "rechenzeit_s"}
       Körper: multipart/form-data mit Feld "audio" ODER die rohen Audio-Bytes (Content-Type audio/* bzw.
       application/octet-stream). Formate: alles, was FFmpeg/PyAV lesen kann (webm/opus, ogg/opus, mp4/aac, wav).
       Fehler: 413 {"grund": "zu_gross"} (> 5 MB), 422 {"grund": "leer" | "unlesbar" | "zu_lang"} (> 60 s),
       503 {"grund": "belegt"}; immer mit deutscher Meldung "fehler".

Datenschutz: Audio wird nur im Arbeitsspeicher verarbeitet (keine Datei, auch nicht in /tmp) und danach verworfen;
weder Audio noch erkannter Text landen im Log. Dekodiert wird selbst über PyAV (AudioResampler → 16 kHz mono) –
`WhisperModel.transcribe(pfad)` ist mit faster-whisper 1.2.1 und neuem PyAV kaputt (`metadata_errors`).
"""

import io
import json
import os
import threading
import time
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import av
import numpy as np

MAX_BYTES = 5 * 1024 * 1024
# Spielraum für die multipart-Hülle um die Audiodaten
MAX_KOERPER = MAX_BYTES + 64 * 1024
MAX_SEKUNDEN = 60
# MediaRecorder stoppt bei 60 s; Container-Dauer kann wenige Millisekunden darüber liegen.
TOLERANZ_S = 0.5
RATE = 16000
# Höchstens so viele Anfragen warten gleichzeitig auf das Modell (danach 503).
MAX_WARTEND = 4

# Fachwörter als Startkontext: verbessert die Erkennung typischer Befehle (keine Kundendaten).
STARTKONTEXT = (
    "Neuer Auftrag, neuer Kunde, To-do, Termin, Einsatz, Angebot, verschieben, morgen, übermorgen, "
    "Montag, Dienstag, Mittwoch, Donnerstag, Freitag, Badsanierung, Fliesen, Trockenbau, Maler."
)


class Fehler(Exception):
    def __init__(self, status: int, grund: str, meldung: str):
        super().__init__(meldung)
        self.status = status
        self.grund = grund
        self.meldung = meldung


class Transkribierer:
    """Hält das Whisper-Modell (einmal geladen) und lässt immer nur eine Umwandlung gleichzeitig rechnen."""

    def __init__(self, modell_pfad: str | None = None, threads: int | None = None):
        self.modell_pfad = modell_pfad or os.environ.get("STT_MODELL_PFAD", "/modelle/small")
        self.threads = threads or int(os.environ.get("STT_THREADS", "2"))
        self.modell_name = os.environ.get("STT_MODELL", os.path.basename(self.modell_pfad))
        self._modell = None
        self._lade_sperre = threading.Lock()
        self._rechnen = threading.Lock()
        self._plaetze = threading.BoundedSemaphore(MAX_WARTEND)

    def modell(self):
        with self._lade_sperre:
            if self._modell is None:
                from faster_whisper import WhisperModel

                self._modell = WhisperModel(
                    self.modell_pfad, device="cpu", compute_type="int8", cpu_threads=self.threads, num_workers=1
                )
            return self._modell

    def transkribiere(self, audio: np.ndarray) -> tuple[str, float]:
        if not self._plaetze.acquire(blocking=False):
            raise Fehler(503, "belegt", "Spracherkennung ist gerade ausgelastet – bitte gleich noch einmal.")
        try:
            with self._rechnen:
                start = time.process_time()
                segmente, _info = self.modell().transcribe(
                    audio,
                    language="de",
                    beam_size=1,
                    vad_filter=True,
                    condition_on_previous_text=False,
                    initial_prompt=STARTKONTEXT,
                )
                text = " ".join(s.text.strip() for s in segmente).strip()
                return text, time.process_time() - start
        finally:
            self._plaetze.release()


def dekodiere(daten: bytes) -> np.ndarray:
    """Audio-Bytes → float32 16 kHz mono (im Speicher). Bricht ab, sobald mehr als 60 s gelesen sind."""
    if len(daten) == 0:
        raise Fehler(422, "leer", "Die Aufnahme ist leer.")
    grenze = int((MAX_SEKUNDEN + TOLERANZ_S) * RATE)
    teile: list[np.ndarray] = []
    anzahl = 0
    try:
        with av.open(io.BytesIO(daten), mode="r") as container:
            spur = next((s for s in container.streams if s.type == "audio"), None)
            if spur is None:
                raise Fehler(422, "unlesbar", "Die Aufnahme enthält keine Tonspur.")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=RATE)

            def nimm(frames):
                nonlocal anzahl
                for f in frames:
                    werte = f.to_ndarray().reshape(-1)
                    teile.append(werte)
                    anzahl += werte.shape[0]
                if anzahl > grenze:
                    raise Fehler(422, "zu_lang", f"Die Aufnahme ist zu lang (höchstens {MAX_SEKUNDEN} Sekunden).")

            for frame in container.decode(spur):
                frame.pts = None
                nimm(resampler.resample(frame))
            nimm(resampler.resample(None))
    except Fehler:
        raise
    except Exception:
        raise Fehler(422, "unlesbar", "Die Aufnahme konnte nicht gelesen werden.") from None
    if anzahl == 0:
        raise Fehler(422, "leer", "Die Aufnahme ist leer.")
    return (np.concatenate(teile).astype(np.float32) / 32768.0).copy()


def audio_aus_anfrage(typ: str, koerper: bytes) -> bytes:
    """Audiodaten aus multipart (Feld "audio") oder aus dem rohen Körper."""
    if typ.lower().startswith("multipart/form-data"):
        nachricht = BytesParser(policy=HTTP).parsebytes(
            b"Content-Type: " + typ.encode("latin-1") + b"\r\n\r\n" + koerper
        )
        if not nachricht.is_multipart():
            raise Fehler(422, "unlesbar", "Ungültige Anfrage.")
        for teil in nachricht.iter_parts():
            if teil.get_param("name", header="content-disposition") == "audio":
                return teil.get_payload(decode=True) or b""
        raise Fehler(422, "leer", "Feld „audio“ fehlt.")
    return koerper


class Bearbeiter(BaseHTTPRequestHandler):
    server_version = "crm-stt"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):  # noqa: A002 – nur Methode, Pfad, Status (nie Inhalte)
        pass

    def _json(self, status: int, wert: dict):
        daten = json.dumps(wert, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(daten)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(daten)

    def do_GET(self):
        if self.path == "/gesund":
            self._json(200, {"ok": True, "modell": self.server.transkribierer.modell_name})
        else:
            self._json(404, {"fehler": "Nicht gefunden."})

    def do_POST(self):
        if self.path != "/transkribiere":
            self.close_connection = True
            self._json(404, {"fehler": "Nicht gefunden."})
            return
        try:
            laenge_text = self.headers.get("Content-Length")
            if laenge_text is None or not laenge_text.isdigit():
                self.close_connection = True
                raise Fehler(411, "laenge", "Content-Length fehlt.")
            laenge = int(laenge_text)
            if laenge > MAX_KOERPER:
                # Körper verwerfen (bis 32 MB lesen, damit der Client die Antwort sicher bekommt), Verbindung schließen.
                self.close_connection = True
                rest = min(laenge, 32 * 1024 * 1024)
                while rest > 0:
                    stueck = self.rfile.read(min(rest, 256 * 1024))
                    if not stueck:
                        break
                    rest -= len(stueck)
                raise Fehler(413, "zu_gross", "Die Aufnahme ist zu groß (höchstens 5 MB).")
            koerper = self.rfile.read(laenge)
            audio_bytes = audio_aus_anfrage(self.headers.get("Content-Type", ""), koerper)
            del koerper
            if len(audio_bytes) > MAX_BYTES:
                raise Fehler(413, "zu_gross", "Die Aufnahme ist zu groß (höchstens 5 MB).")
            audio = dekodiere(audio_bytes)
            del audio_bytes
            dauer = audio.shape[0] / RATE
            text, rechenzeit = self.server.transkribierer.transkribiere(audio)
            del audio
            self._json(
                200,
                {"text": text, "dauer_s": round(dauer, 2), "sprache": "de", "rechenzeit_s": round(rechenzeit, 2)},
            )
        except Fehler as f:
            self._json(f.status, {"fehler": f.meldung, "grund": f.grund})
        except Exception as e:  # nie Inhalte loggen, nur die Art des Fehlers
            print(f"Interner Fehler: {type(e).__name__}", flush=True)
            self._json(500, {"fehler": "Interner Fehler der Spracherkennung.", "grund": "intern"})


def erstelle_server(host: str = "0.0.0.0", port: int = 8080, transkribierer: Transkribierer | None = None):
    srv = ThreadingHTTPServer((host, port), Bearbeiter)
    srv.daemon_threads = True
    srv.transkribierer = transkribierer or Transkribierer()
    return srv


if __name__ == "__main__":
    port = int(os.environ.get("STT_PORT", "8080"))
    srv = erstelle_server("0.0.0.0", port)
    srv.transkribierer.modell()  # beim Start laden, nicht bei der ersten Anfrage
    print(f"crm-stt bereit auf Port {port} (Modell {srv.transkribierer.modell_name}, int8)", flush=True)
    srv.serve_forever()
