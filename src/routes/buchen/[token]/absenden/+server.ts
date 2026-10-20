import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { bucheTermin, type Foto } from '$lib/server/buchung-oeffentlich';
import { buchenGrenzeLink, honigtopfLeer, pruefeStempel } from '$lib/server/buchung-schutz';
import { begrenzeAenderung, ipVon, jsonAntwort } from '$lib/server/buchung-anfrage';
import { BUCHUNG_GRENZEN } from '$lib/buchung';

const MAX_BYTES = BUCHUNG_GRENZEN.fotos * BUCHUNG_GRENZEN.fotoBytes + 384 * 1024;

/**
 * Buchung absenden (multipart/form-data: Feld `daten` als JSON, Fotos als `foto:<Frage-ID>:<temporäre ID>`).
 * Schutz: Begrenzung je IP und Link, Honigtopf, signierter Zeitstempel (nicht schneller als 3 s). SvelteKit prüft bei
 * Formular-Anfragen den Ursprung (ORIGIN) – fremde Seiten können nicht direkt absenden.
 */
export const POST: RequestHandler = async (event) => {
	try {
		begrenzeAenderung(ipVon(event));
		if (!buchenGrenzeLink.pruefeVersuch(`link:${event.params.token}`).erlaubt) throw new ApiFehler(429, 'Zu viele Buchungen – bitte später erneut versuchen.');
		if (!/^multipart\/form-data/i.test(event.request.headers.get('content-type') ?? '')) throw new ApiFehler(415, 'Ungültige Anfrage.');
		if (Number(event.request.headers.get('content-length') ?? '0') > MAX_BYTES) throw new ApiFehler(413, 'Die Fotos sind zusammen zu groß.');
		let form: FormData;
		try {
			form = await event.request.formData();
		} catch {
			throw new ApiFehler(400, 'Ungültige Anfrage.');
		}
		let daten: Record<string, unknown>;
		try {
			const roh = form.get('daten');
			daten = typeof roh === 'string' && roh.length <= 512 * 1024 ? JSON.parse(roh) : null;
		} catch {
			daten = null as never;
		}
		if (!daten || typeof daten !== 'object' || Array.isArray(daten)) throw new ApiFehler(400, 'Ungültige Anfrage.');
		// Honigtopf und Zeitstempel: Bots bekommen dieselbe neutrale Meldung
		if (!honigtopfLeer(daten.website)) throw new ApiFehler(400, 'Die Anfrage konnte nicht verarbeitet werden.');
		const stempel = pruefeStempel(daten.stempel);
		if (stempel === 'zu_schnell') throw new ApiFehler(400, 'Bitte prüfen Sie Ihre Angaben und senden Sie dann erneut.');
		if (stempel !== 'ok') throw new ApiFehler(400, 'Die Seite ist abgelaufen – bitte neu laden und erneut buchen.');
		const fotos: Foto[] = [];
		for (const [name, wert] of form.entries()) {
			if (!name.startsWith('foto:')) continue;
			if (typeof wert === 'string') throw new ApiFehler(400, 'Ungültiges Foto.');
			const [, feldId, tempId] = name.split(':');
			if (fotos.length >= BUCHUNG_GRENZEN.fotos) throw new ApiFehler(400, `Höchstens ${BUCHUNG_GRENZEN.fotos} Fotos.`);
			if (wert.size > BUCHUNG_GRENZEN.fotoBytes) throw new ApiFehler(400, 'Ein Foto ist zu groß – bitte ein kleineres wählen.');
			fotos.push({ feldId: feldId ?? '', tempId: tempId ?? '', bytes: new Uint8Array(await wert.arrayBuffer()) });
		}
		const ergebnis = await bucheTermin(
			event.params.token,
			{ beginn: daten.beginn, kontakt: daten.kontakt, antworten: daten.antworten, datenschutz: daten.datenschutz, fotos },
			{ basisUrl: event.url.origin }
		);
		return jsonAntwort(ergebnis, 201);
	} catch (e) {
		return alsAntwort(e);
	}
};
