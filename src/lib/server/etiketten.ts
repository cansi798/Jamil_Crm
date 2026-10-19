import type { Kontext } from './db';
import type { Anlage } from './anlagen';
import { holeLogo, holeProfil } from './betriebsprofil';
import { etikettenPdf, BOGEN, type EtikettFormat } from './pdf/etiketten-pdf';

/** PDF-Antwort mit QR-Etiketten für Anlagen (Link `<origin>/a/<Kürzel>`, Logo und Telefon aus dem Briefkopf). */
export async function etikettenAntwort(k: Kontext, origin: string, anlagen: Anlage[], format: EtikettFormat, dateiname: string, kopien = 1) {
	const [profil, logo] = await Promise.all([holeProfil(k), holeLogo(k)]);
	const etiketten = anlagen.flatMap((a) =>
		Array.from({ length: kopien }, () => ({ url: `${origin}/a/${a.qrToken}`, bezeichnung: a.bezeichnung, typName: a.typName, seriennummer: a.seriennummer }))
	);
	const pdf = await etikettenPdf({ etiketten, firmenname: profil.firmenname, telefon: profil.telefon, logo }, format);
	return new Response(Buffer.from(pdf), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': `inline; filename="${dateiname}"`,
			'content-length': String(pdf.byteLength),
			'cache-control': 'private, no-store'
		}
	});
}

export const ETIKETTEN_PRO_BOGEN = BOGEN.spalten * BOGEN.zeilen;
