# STT-Dienst crm-stt (Stufe 1d): faster-whisper auf CPU, nur im internen Netz crm-intern.
# Das Modell wird beim Bauen geladen (Bauphase hat Netz) und liegt im Image – zur Laufzeit braucht der Dienst
# kein Internet (HF_HUB_OFFLINE=1).
#
# Bauen/Starten (auf dem Host): cd /opt/crm-sandbox && sudo docker compose up -d --build crm-stt
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
	PYTHONUNBUFFERED=1 \
	PIP_DISABLE_PIP_VERSION_CHECK=1 \
	HF_HUB_DISABLE_TELEMETRY=1

# pytest nur für stt/test_server.py (läuft im selben Image, ohne Netz)
RUN pip install --no-cache-dir faster-whisper==1.2.1 pytest==8.3.3

ARG STT_MODELL=small
ENV STT_MODELL=${STT_MODELL} \
	STT_MODELL_PFAD=/modelle/${STT_MODELL}
RUN python -c "import os; from faster_whisper import download_model; download_model(os.environ['STT_MODELL'], output_dir=os.environ['STT_MODELL_PFAD'])" \
	&& chmod -R a+rX /modelle

COPY server.py /app/server.py

ENV HF_HUB_OFFLINE=1 \
	STT_PORT=8080
USER 1001:1001
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
	CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/gesund', timeout=4)"
CMD ["python", "/app/server.py"]
