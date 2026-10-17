/**
 * Testhilfe: Text aus einem UNKOMPRIMIERTEN PDF von pdfkit lesen. pdfkit schreibt Text eingebetteter Schriften als
 * Glyphen-Nummern (`<0012 0034> Tj` bzw. `[...] TJ`); die Zuordnung zu Unicode steht in der ToUnicode-CMap der
 * Schrift. Reicht für Prüfungen wie „enthält ‚Angebot AN-2026-0001‘“ – kein allgemeiner PDF-Leser.
 */
export function pdfText(pdf: Uint8Array): string {
	const roh = Buffer.from(pdf).toString('latin1');
	const objekte = new Map<string, string>();
	for (const m of roh.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) objekte.set(m[1], m[2]);

	// Schrift-Objekt → Code → Text
	const cmaps = new Map<string, Map<number, string>>();
	for (const [nr, inhalt] of objekte) {
		const tu = /\/ToUnicode (\d+) 0 R/.exec(inhalt);
		if (!tu) continue;
		const cmap = objekte.get(tu[1]) ?? '';
		const karte = new Map<number, string>();
		for (const r of cmap.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
			const start = parseInt(r[1], 16);
			const eintraege = [...r[3].matchAll(/<([0-9a-fA-F ]*)>/g)].map((e) =>
				e[1]
					.trim()
					.split(/\s+/)
					.filter(Boolean)
					.map((h) => String.fromCharCode(parseInt(h, 16)))
					.join('')
			);
			eintraege.forEach((t, i) => karte.set(start + i, t));
		}
		cmaps.set(nr, karte);
	}
	// Ressourcen-Name (/F1) → Schrift-Objekt
	const namen = new Map<string, string>();
	for (const inhalt of objekte.values()) {
		for (const m of inhalt.matchAll(/\/(F\d+) (\d+) 0 R/g)) namen.set(m[1], m[2]);
	}
	const dekodiere = (hex: string, schrift: string | null) => {
		const karte = schrift ? cmaps.get(namen.get(schrift) ?? '') : undefined;
		if (!karte) return '';
		let s = '';
		for (let i = 0; i + 4 <= hex.length; i += 4) s += karte.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
		return s;
	};
	const zeilen: string[] = [];
	for (const inhalt of objekte.values()) {
		const strom = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(inhalt)?.[1];
		if (!istInhalt(strom)) continue;
		let schrift: string | null = null;
		for (const m of strom.matchAll(/\/(F\d+) [\d.]+ Tf|\[([^\]]*)\] TJ|<([0-9a-fA-F]*)> Tj/g)) {
			if (m[1]) schrift = m[1];
			else if (m[2] !== undefined) zeilen.push([...m[2].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => dekodiere(h[1], schrift)).join(''));
			else if (m[3] !== undefined) zeilen.push(dekodiere(m[3], schrift));
		}
	}
	return zeilen.join('\n');
}

/** Seiteninhalt (Textbefehle, reines ASCII) – nicht etwa ein binärer Schrift- oder Bildstrom. */
function istInhalt(strom: string | undefined): strom is string {
	return !!strom && / Tf/.test(strom) && /(^|\n)BT\b/.test(strom) && /^[\t\n\r\x20-\x7e]*$/.test(strom);
}

/** Anzahl der Seiten (`/Type /Page`, nicht `/Pages`). */
export function pdfSeiten(pdf: Uint8Array): number {
	return (Buffer.from(pdf).toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
}

/** Text je Seite (Inhaltsströme in Reihenfolge der Objekte – bei pdfkit = Seitenreihenfolge). */
export function pdfTextSeiten(pdf: Uint8Array): string[] {
	const roh = Buffer.from(pdf).toString('latin1');
	const seiten: string[] = [];
	for (const m of roh.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) {
		const strom = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(m[2])?.[1];
		if (!istInhalt(strom)) continue;
		// Rest des Dokuments ohne andere Seiten: nur diesen Strom dekodieren
		const nurDieser = roh.replace(/(\d+) 0 obj([\s\S]*?)endobj/g, (ganz, nr, inhalt) =>
			nr === m[1] || !istInhalt(/stream\r?\n([\s\S]*?)\r?\nendstream/.exec(inhalt)?.[1]) ? ganz : `${nr} 0 obj\nendobj`
		);
		seiten.push(pdfText(new Uint8Array(Buffer.from(nurDieser, 'latin1'))));
	}
	return seiten;
}
