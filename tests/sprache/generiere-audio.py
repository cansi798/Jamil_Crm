#!/usr/bin/env python3
"""Erzeugt die synthetischen Audiodateien des Sprach-Testsatzes per Piper-TTS (de_DE-thorsten-medium).
Ausgabe: 16 kHz mono WAV, resampled mit ffmpeg. Nur für tests/sprache/audio/."""
import json, subprocess, sys, tempfile, os
from pathlib import Path

MODELL = "/work/crm/.venv-tts/models/de_DE-thorsten-medium.onnx"
PIPER = "/work/crm/.venv-tts/bin/piper"
BASE = Path(__file__).parent
BEFEHLE = BASE / "befehle.json"
AUDIO = BASE / "audio"

def main():
    satz = json.loads(BEFEHLE.read_text(encoding="utf8"))
    AUDIO.mkdir(exist_ok=True)
    fehler = 0
    for b in satz["befehle"]:
        ziel = BASE / b["audio"]
        if ziel.exists() and ziel.stat().st_size > 0:
            print(f"  {b['nr']:02d} vorhanden")
            continue
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_pfad = tmp.name
        try:
            r = subprocess.run(
                [PIPER, "-m", MODELL, "-f", tmp_pfad],
                input=b["text"].encode("utf8"),
                capture_output=True, timeout=30
            )
            if r.returncode != 0:
                print(f"  {b['nr']:02d} FEHLER piper: {r.stderr.decode()[:100]}")
                fehler += 1
                continue
            # Resample auf 16 kHz mono
            r2 = subprocess.run(
                ["ffmpeg", "-y", "-i", tmp_pfad, "-ar", "16000", "-ac", "1", str(ziel)],
                capture_output=True, timeout=15
            )
            if r2.returncode != 0:
                print(f"  {b['nr']:02d} FEHLER ffmpeg: {r2.stderr.decode()[:100]}")
                fehler += 1
                continue
            groesse = ziel.stat().st_size
            print(f"  {b['nr']:02d} ok ({groesse//1024} KB)")
        finally:
            os.unlink(tmp_pfad)
    print(f"\n{'FERTIG' if fehler == 0 else f'{fehler} Fehler'}")
    return 1 if fehler else 0

if __name__ == "__main__":
    sys.exit(main())
