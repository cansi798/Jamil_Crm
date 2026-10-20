/**
 * Fotos vor dem Hochladen im Browser verkleinern (Handy-Fotos sind 3–8 MB): längste Seite höchstens `max` Pixel, JPEG
 * mit Qualität 0,82, Ausrichtung aus den EXIF-Daten. Gelingt das nicht (z. B. HEIC in einem Browser ohne Unterstützung),
 * geht ein JPEG/PNG unverändert hoch; alles andere ist ein Fehler mit verständlicher Meldung.
 */
export async function verkleinereFoto(datei: File, max = 1600): Promise<{ blob: Blob; typ: 'image/jpeg' | 'image/png' }> {
	try {
		const bild = await createImageBitmap(datei, { imageOrientation: 'from-image' });
		const faktor = Math.min(1, max / Math.max(bild.width, bild.height));
		const breite = Math.max(1, Math.round(bild.width * faktor));
		const hoehe = Math.max(1, Math.round(bild.height * faktor));
		const canvas = document.createElement('canvas');
		canvas.width = breite;
		canvas.height = hoehe;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('kein Canvas');
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, breite, hoehe);
		ctx.drawImage(bild, 0, 0, breite, hoehe);
		bild.close();
		const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
		if (blob) return { blob, typ: 'image/jpeg' };
	} catch {
		// unten: Original versuchen
	}
	if (datei.type === 'image/jpeg' || datei.type === 'image/png') return { blob: datei, typ: datei.type };
	throw new Error('Dieses Bildformat wird nicht unterstützt. Bitte als JPEG oder PNG aufnehmen.');
}
