<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	/**
	 * Baukasten für Formulare (gemeinsam: Protokoll-Vorlagen, Wunsch Jamil msg 2649, und Fragen der Online-Buchung,
	 * msgs 2684/2686): Schritte (Seiten) → Abschnitte → Felder. Felder per Ziehen und Ablegen oder ↑/↓ sortieren, je
	 * Feld Typ, Beschriftung, Hinweis, Pflicht und eine Bedingung („nur zeigen, wenn …“ bzw. „Pflicht, wenn …“).
	 * Bearbeitet `schema` direkt (bindbar). Prüfung und Speichern macht die Seite (`pruefeSchema` in
	 * `$lib/protokoll-formular`).
	 */
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import {
		BEDINGUNG_OP_NAMEN,
		FELD_TYPEN,
		FELD_TYP_NAMEN,
		alleFelder,
		bedingungText,
		neueId,
		opsFuer,
		type Feld,
		type FeldTyp,
		type Schema
	} from '$lib/protokoll-formular';

	let {
		schema = $bindable(),
		typen = FELD_TYPEN,
		mehrereSchritte = true,
		hinweisVorgabe = 'Text für den Monteur'
	}: {
		schema: Schema;
		/** wählbare Feldtypen */
		typen?: readonly FeldTyp[];
		/** false: genau ein Schritt (z. B. Fragen der Online-Buchung) */
		mehrereSchritte?: boolean;
		/** Vorgabe für neue Hinweistexte */
		hinweisVorgabe?: string;
	} = $props();

	let offenId = $state<string | null>(null);

	// ---------- Bearbeiten ----------
	type Ort = { s: number; a: number; f: number };
	const felderVon = (s: number, a: number) => schema.seiten[s].abschnitte[a].felder;

	function standardFeld(typ: FeldTyp): Feld {
		const f: Feld = { id: neueId('f'), typ, label: FELD_TYP_NAMEN[typ] };
		if (typ === 'auswahl' || typ === 'mehrfach') f.optionen = ['Option 1', 'Option 2'];
		if (typ === 'checkliste') f.optionen = ['Punkt 1', 'Punkt 2'];
		if (typ === 'messwert') f.einheit = 'mm';
		if (typ === 'unterschrift') ((f.wer = 'kunde'), (f.label = 'Unterschrift Kunde'), (f.pflicht = true));
		if (typ === 'foto') ((f.label = 'Foto'), (f.pflicht = true));
		if (typ === 'hinweis') ((f.label = 'Hinweis'), (f.hilfe = hinweisVorgabe));
		return f;
	}
	function feldDazu(s: number, a: number, typ: FeldTyp) {
		const f = standardFeld(typ);
		felderVon(s, a).push(f);
		offenId = f.id;
	}
	function feldWeg(o: Ort) {
		const f = felderVon(o.s, o.a)[o.f];
		const abhaengig = alleFelder(schema).filter((x) => x.feld.bedingung?.feld === f.id);
		if (abhaengig.length > 0 && !confirm(`„${f.label}“ steuert ${abhaengig.length} Bedingung(en). Trotzdem löschen? Die Bedingungen werden entfernt.`)) return;
		for (const x of abhaengig) delete x.feld.bedingung;
		felderVon(o.s, o.a).splice(o.f, 1);
	}
	function feldKopie(o: Ort) {
		const f = structuredClone($state.snapshot(felderVon(o.s, o.a)[o.f])) as Feld;
		f.id = neueId('f');
		f.label = `${f.label} (Kopie)`;
		felderVon(o.s, o.a).splice(o.f + 1, 0, f);
		offenId = f.id;
	}
	/** Feld verschieben – auch über Abschnitts- und Seitengrenzen (Bedingungen auf spätere Felder werden entfernt). */
	function verschiebe(von: Ort, nach: { s: number; a: number; f: number }) {
		const [f] = felderVon(von.s, von.a).splice(von.f, 1);
		const ziel = felderVon(nach.s, nach.a);
		ziel.splice(Math.min(nach.f, ziel.length), 0, f);
		bereinigeBedingungen();
	}
	function hoch(o: Ort) {
		if (o.f > 0) verschiebe(o, { ...o, f: o.f - 1 });
		else if (o.a > 0) verschiebe(o, { s: o.s, a: o.a - 1, f: felderVon(o.s, o.a - 1).length });
		else if (o.s > 0) {
			const as = schema.seiten[o.s - 1].abschnitte.length - 1;
			verschiebe(o, { s: o.s - 1, a: as, f: felderVon(o.s - 1, as).length });
		}
	}
	function runter(o: Ort) {
		if (o.f < felderVon(o.s, o.a).length - 1) verschiebe(o, { ...o, f: o.f + 1 });
		else if (o.a < schema.seiten[o.s].abschnitte.length - 1) verschiebe(o, { s: o.s, a: o.a + 1, f: 0 });
		else if (o.s < schema.seiten.length - 1) verschiebe(o, { s: o.s + 1, a: 0, f: 0 });
	}
	/** Bedingungen, deren Quelle nicht mehr davor liegt, entfernen (keine Kreise). */
	function bereinigeBedingungen() {
		const davor = new Set<string>();
		for (const { feld } of alleFelder(schema)) {
			if (feld.bedingung && !davor.has(feld.bedingung.feld)) delete feld.bedingung;
			davor.add(feld.id);
		}
	}
	function typAendern(f: Feld, typ: FeldTyp) {
		const neu = standardFeld(typ);
		f.typ = typ;
		for (const k of ['optionen', 'minFotos', 'einheit', 'min', 'max', 'wer'] as const) {
			if (neu[k] === undefined) delete f[k];
			else if (f[k] === undefined) (f as Record<string, unknown>)[k] = neu[k];
		}
		if (typ === 'hinweis') delete f.pflicht;
		// Bedingungen anderer Felder auf dieses Feld passen evtl. nicht mehr
		for (const { feld } of alleFelder(schema)) {
			if (feld.bedingung?.feld === f.id && !opsFuer(typ).includes(feld.bedingung.op)) delete feld.bedingung;
		}
	}
	function seiteDazu() {
		if (!mehrereSchritte) return;
		schema.seiten.push({ id: neueId('s'), titel: `Schritt ${schema.seiten.length + 1}`, abschnitte: [{ id: neueId('a'), felder: [] }] });
	}
	function seiteWeg(s: number) {
		if (schema.seiten.length === 1) return;
		if (schema.seiten[s].abschnitte.some((a) => a.felder.length > 0) && !confirm('Schritt mit allen Feldern löschen?')) return;
		schema.seiten.splice(s, 1);
		bereinigeBedingungen();
	}
	function seiteSchieben(s: number, d: -1 | 1) {
		const z = s + d;
		if (z < 0 || z >= schema.seiten.length) return;
		const [x] = schema.seiten.splice(s, 1);
		schema.seiten.splice(z, 0, x);
		bereinigeBedingungen();
	}
	function abschnittDazu(s: number) {
		schema.seiten[s].abschnitte.push({ id: neueId('a'), titel: 'Neuer Abschnitt', felder: [] });
	}
	function abschnittWeg(s: number, a: number) {
		const seite = schema.seiten[s];
		if (seite.abschnitte.length === 1) return;
		if (seite.abschnitte[a].felder.length > 0 && !confirm('Abschnitt mit allen Feldern löschen?')) return;
		seite.abschnitte.splice(a, 1);
		bereinigeBedingungen();
	}

	// ---------- Ziehen und Ablegen ----------
	let ziehe = $state<Ort | null>(null);
	let ueber = $state<string | null>(null);
	function ablegen(ziel: { s: number; a: number; f: number }) {
		if (!ziehe) return;
		const von = ziehe;
		ziehe = null;
		ueber = null;
		let f = ziel.f;
		if (von.s === ziel.s && von.a === ziel.a && von.f < f) f--;
		verschiebe(von, { ...ziel, f });
	}

	// ---------- Bedingung ----------
	function quellenFuer(f: Feld): Feld[] {
		const aus: Feld[] = [];
		for (const { feld } of alleFelder(schema)) {
			if (feld.id === f.id) break;
			if (opsFuer(feld.typ).length > 0) aus.push(feld);
		}
		return aus;
	}
	const feldNach = (id: string) => alleFelder(schema).find((x) => x.feld.id === id)?.feld;
	function bedingungSetzen(f: Feld, wirkung: string) {
		if (wirkung === '') {
			delete f.bedingung;
			return;
		}
		const quelle = quellenFuer(f).at(-1);
		if (!quelle) return;
		const op = opsFuer(quelle.typ)[0];
		f.bedingung = { feld: quelle.id, op, wirkung: wirkung as 'zeigen' | 'pflicht', wert: standardWert(quelle) };
	}
	function standardWert(q: Feld | undefined): string | undefined {
		if (!q) return undefined;
		if (q.typ === 'janein') return 'ja';
		if (q.optionen) return q.optionen[0];
		return '';
	}
	const brauchtWert = (op: string) => op === 'gleich' || op === 'ungleich' || op === 'groesser' || op === 'kleiner';

	// ---------- Optionen ----------
	const optionenText = (f: Feld) => (f.optionen ?? []).join('\n');
	function optionenSetzen(f: Feld, text: string) {
		f.optionen = text.split('\n').map((o) => o.trim()).filter((o, i, alle) => o !== '' && alle.indexOf(o) === i);
	}
	const zahlOder = (t: string) => (t.trim() === '' ? undefined : Number(t.replace(',', '.')));

</script>

<div class="pb-editor">
	{#each schema.seiten as seite, s (seite.id)}
		<section class="pb-seite" aria-label={`Schritt ${s + 1}`}>
			{#if mehrereSchritte}
			<div class="pb-seite-kopf">
				<span class="pb-nr">{s + 1}</span>
				<input type="text" class="pb-titel" bind:value={seite.titel} maxlength="200" aria-label={`Titel Schritt ${s + 1}`} />
				<div class="pb-mini">
					<button type="button" class="knopf-ghost klein" title="Schritt nach oben" aria-label="Schritt nach oben" disabled={s === 0} onclick={() => seiteSchieben(s, -1)}>↑</button>
					<button type="button" class="knopf-ghost klein" title="Schritt nach unten" aria-label="Schritt nach unten" disabled={s === schema.seiten.length - 1} onclick={() => seiteSchieben(s, 1)}>↓</button>
					<button type="button" class="kd-knopf gefahr klein" title="Schritt löschen" aria-label="Schritt löschen" disabled={schema.seiten.length === 1} onclick={() => seiteWeg(s)}>✕</button>
				</div>
			</div>
			{/if}
			{#each seite.abschnitte as abschnitt, a (abschnitt.id)}
				<div class="pb-abschnitt">
					<div class="pb-abschnitt-kopf">
						<input type="text" bind:value={abschnitt.titel} maxlength="200" placeholder="Abschnitt (Überschrift, optional)" aria-label="Abschnitt-Überschrift" />
						{#if seite.abschnitte.length > 1}
							<button type="button" class="pb-x" aria-label="Abschnitt löschen" onclick={() => abschnittWeg(s, a)}>✕</button>
						{/if}
					</div>
					<ol class="pb-felder">
						{#each abschnitt.felder as f, i (f.id)}
							{@const ort = { s, a, f: i }}
							<li
								class="pb-feld"
								class:offen={offenId === f.id}
								class:ueber={ueber === f.id}
								ondragover={(e) => {
									if (ziehe) ((ueber = f.id), e.preventDefault());
								}}
								ondragleave={() => ueber === f.id && (ueber = null)}
								ondrop={(e) => (e.preventDefault(), ablegen(ort))}
							>
								<div class="pb-feld-kopf">
									<span
										class="pb-griff"
										draggable="true"
										role="button"
										tabindex="-1"
										aria-label="Ziehen zum Verschieben"
										ondragstart={(e) => {
											ziehe = ort;
											e.dataTransfer?.setData('text/plain', f.id);
										}}
										ondragend={() => ((ziehe = null), (ueber = null))}>⋮⋮</span
									>
									<button type="button" class="pb-feld-text" onclick={() => (offenId = offenId === f.id ? null : f.id)} aria-expanded={offenId === f.id}>
										<span class="pb-typ">{FELD_TYP_NAMEN[f.typ]}</span>
										<span class="pb-label">{f.label}</span>
										<span class="pb-marken">
											{#if f.pflicht}<span class="badge badge-rot">Pflicht</span>{/if}
											{#if f.bedingung}<span class="badge badge-blau" title={bedingungText(f.bedingung, feldNach(f.bedingung.feld))}>Bedingung</span>{/if}
										</span>
									</button>
									<div class="pb-mini">
										<button type="button" class="knopf-ghost klein" aria-label="Nach oben" onclick={() => hoch(ort)}>↑</button>
										<button type="button" class="knopf-ghost klein" aria-label="Nach unten" onclick={() => runter(ort)}>↓</button>
										<button type="button" class="knopf-ghost klein" aria-label="Duplizieren" onclick={() => feldKopie(ort)}>⧉</button>
										<button type="button" class="kd-knopf gefahr klein" aria-label="Feld löschen" onclick={() => feldWeg(ort)}>✕</button>
									</div>
								</div>
								{#if offenId === f.id}
									{@const quellen = quellenFuer(f)}
									<div class="pb-feld-form">
										<label>
											Feldtyp
											<Auswahl value={f.typ} onchange={(e) => typAendern(f, e.currentTarget.value as FeldTyp)}>
												{#each typen as t (t)}<option value={t}>{FELD_TYP_NAMEN[t]}</option>{/each}
											</Auswahl>
										</label>
										<label>{f.typ === 'hinweis' ? 'Überschrift' : 'Beschriftung / Frage'}<input type="text" bind:value={f.label} maxlength="300" /></label>
										<label>
											{f.typ === 'hinweis' ? 'Hinweistext' : 'Hilfetext (optional)'}
											<textarea rows="2" maxlength="2000" value={f.hilfe ?? ''} oninput={(e) => (e.currentTarget.value ? (f.hilfe = e.currentTarget.value) : delete f.hilfe)}></textarea>
										</label>
										{#if f.typ === 'auswahl' || f.typ === 'mehrfach' || f.typ === 'checkliste'}
											<label>
												{f.typ === 'checkliste' ? 'Punkte (einer je Zeile)' : 'Optionen (eine je Zeile)'}
												<textarea rows="4" value={optionenText(f)} onchange={(e) => optionenSetzen(f, e.currentTarget.value)}></textarea>
											</label>
										{/if}
										{#if f.typ === 'foto'}
											<label class="pb-kurz">Mindestanzahl Fotos<input type="number" min="1" max="20" value={f.minFotos ?? 1} oninput={(e) => (f.minFotos = Math.max(1, Number(e.currentTarget.value) || 1))} /></label>
										{/if}
										{#if f.typ === 'messwert'}
											<label class="pb-kurz">Einheit<input type="text" bind:value={f.einheit} maxlength="20" placeholder="z. B. mm, bar, °C" /></label>
										{/if}
										{#if f.typ === 'zahl' || f.typ === 'messwert'}
											<div class="pb-reihe">
												<label class="pb-kurz">Minimum<input type="number" step="any" value={f.min ?? ''} oninput={(e) => ((f.min = zahlOder(e.currentTarget.value)), f.min === undefined && delete f.min)} /></label>
												<label class="pb-kurz">Maximum<input type="number" step="any" value={f.max ?? ''} oninput={(e) => ((f.max = zahlOder(e.currentTarget.value)), f.max === undefined && delete f.max)} /></label>
											</div>
										{/if}
										{#if f.typ === 'unterschrift'}
											<label class="pb-kurz">
												Wer unterschreibt?
												<Auswahl bind:value={f.wer}><option value="kunde">Kunde</option><option value="monteur">Monteur</option></Auswahl>
											</label>
										{/if}
										{#if f.typ !== 'hinweis'}
											<Schalter
												bind:an={() => !!f.pflicht, (v) => (v ? (f.pflicht = true) : delete f.pflicht)}
												label="Pflichtfeld"
												hinweis={f.typ === 'checkliste' ? 'alle Punkte abhaken' : f.typ === 'foto' ? '„Weiter“ erst mit Foto' : 'ohne Angabe kein „Weiter“'}
											/>
										{/if}
										<fieldset class="pb-bedingung">
											<legend>Bedingung</legend>
											{#if quellen.length === 0}
												<p class="kd-info">Bedingungen beziehen sich auf ein Feld davor – dieses ist das erste.</p>
											{:else}
												<Auswahl value={f.bedingung?.wirkung ?? ''} onchange={(e) => bedingungSetzen(f, e.currentTarget.value)} aria-label="Art der Bedingung">
													<option value="">immer zeigen</option>
													<option value="zeigen">nur zeigen, wenn …</option>
													{#if f.typ !== 'hinweis'}<option value="pflicht">Pflicht nur, wenn …</option>{/if}
												</Auswahl>
												{#if f.bedingung}
													{@const b = f.bedingung}
													{@const q = feldNach(b.feld)}
													<div class="pb-reihe">
														<Auswahl
															value={b.feld}
															aria-label="Feld"
															onchange={(e) => {
																const neu = feldNach(e.currentTarget.value);
																b.feld = e.currentTarget.value;
																if (neu && !opsFuer(neu.typ).includes(b.op)) b.op = opsFuer(neu.typ)[0];
																b.wert = standardWert(neu);
															}}
														>
															{#each quellen as qf (qf.id)}<option value={qf.id}>{qf.label}</option>{/each}
														</Auswahl>
														<Auswahl bind:value={b.op} aria-label="Vergleich">
															{#each opsFuer(q?.typ ?? 'text') as op (op)}<option value={op}>{BEDINGUNG_OP_NAMEN[op]}</option>{/each}
														</Auswahl>
														{#if brauchtWert(b.op)}
															{#if q?.typ === 'janein'}
																<Auswahl bind:value={b.wert} aria-label="Wert"><option value="ja">ja</option><option value="nein">nein</option></Auswahl>
															{:else if q?.optionen}
																<Auswahl bind:value={b.wert} aria-label="Wert">{#each q.optionen as o (o)}<option value={o}>{o}</option>{/each}</Auswahl>
															{:else}
																<input type="text" bind:value={b.wert} aria-label="Wert" maxlength="200" />
															{/if}
														{/if}
													</div>
													<p class="kd-info">{bedingungText(b, q)}</p>
												{/if}
											{/if}
										</fieldset>
									</div>
								{/if}
							</li>
						{/each}
						<li
							class="pb-ablage"
							class:ueber={ueber === `ende-${abschnitt.id}`}
							ondragover={(e) => {
								if (ziehe) ((ueber = `ende-${abschnitt.id}`), e.preventDefault());
							}}
							ondrop={(e) => (e.preventDefault(), ablegen({ s, a, f: abschnitt.felder.length }))}
						>
							<Auswahl
								class="pb-neu"
								aria-label="Feld hinzufügen"
								data-testid="feld-dazu"
								onchange={(e) => {
									if (e.currentTarget.value) feldDazu(s, a, e.currentTarget.value as FeldTyp);
									e.currentTarget.value = '';
								}}
							>
								<option value="">+ Feld hinzufügen …</option>
								{#each typen as t (t)}<option value={t}>{FELD_TYP_NAMEN[t]}</option>{/each}
							</Auswahl>
						</li>
					</ol>
				</div>
			{/each}
			<button type="button" class="knopf-subtil klein" onclick={() => abschnittDazu(s)}>+ Abschnitt</button>
		</section>
	{/each}
	{#if mehrereSchritte}
		<button type="button" class="kd-knopf hell" onclick={seiteDazu} data-testid="schritt-dazu">+ Schritt</button>
	{/if}
</div>

<style>
	.pb-seite-kopf,
	.pb-abschnitt-kopf,
	.pb-feld-kopf,
	.pb-reihe {
		display: flex;
		align-items: center;
		gap: var(--ui-a2);
	}
	.pb-editor {
		display: flex;
		flex-direction: column;
		gap: var(--ui-a4);
	}
	.pb-seite {
		display: flex;
		flex-direction: column;
		gap: var(--ui-a3);
		padding: var(--ui-a3);
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten);
	}
	.pb-nr {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 999px;
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
		font-weight: 700;
	}
	.pb-titel {
		font-weight: 600;
		font-size: var(--ui-schrift-l) !important;
	}
	.pb-abschnitt {
		padding: var(--ui-a2) var(--ui-a3) var(--ui-a3);
		border-radius: var(--ui-radius);
		background: var(--ui-band);
	}
	.pb-abschnitt-kopf input {
		background: transparent !important;
		border-style: dashed !important;
	}
	.pb-felder {
		list-style: none;
		margin: var(--ui-a2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.pb-feld {
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
	}
	.pb-feld.offen {
		border-color: var(--ui-akzent);
		box-shadow: var(--ui-fokus-ring);
	}
	.pb-feld.ueber,
	.pb-ablage.ueber {
		border-top: 3px solid var(--ui-akzent);
	}
	.pb-feld-kopf {
		padding: 2px 4px 2px 0;
	}
	.pb-griff {
		flex: none;
		padding: 0.5rem 0.35rem 0.5rem 0.6rem;
		color: var(--ui-grau);
		cursor: grab;
		user-select: none;
		letter-spacing: -0.2em;
	}
	.pb-feld-text {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.15rem 0.6rem;
		flex: 1;
		min-width: 0;
		min-height: 44px;
		padding: 0.3rem 0;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ui-text);
		cursor: pointer;
	}
	.pb-typ {
		font-size: var(--ui-schrift-xs);
		color: var(--ui-text-leise);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		flex-basis: 100%;
	}
	.pb-label {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pb-marken {
		display: inline-flex;
		gap: 4px;
	}
	.pb-mini {
		display: flex;
		flex: none;
	}
	.pb-mini button,
	.pb-x {
		width: 36px;
		height: 36px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--ui-text-leise);
		font-size: 1rem;
		cursor: pointer;
	}
	.pb-mini button:hover:not(:disabled),
	.pb-x:hover {
		background: var(--ui-akzent-hell);
		color: var(--ui-akzent-text);
	}
	.pb-mini button:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.pb-feld-form {
		display: flex;
		flex-direction: column;
		gap: var(--ui-a3);
		padding: var(--ui-a2) var(--ui-a3) var(--ui-a3);
		border-top: 1px solid var(--ui-rand);
	}
	.pb-feld-form label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: var(--ui-schrift-s);
		font-weight: 600;
		color: var(--ui-text-leise);
	}
	.pb-kurz {
		max-width: 14rem;
	}
	.pb-bedingung {
		display: flex;
		flex-direction: column;
		gap: var(--ui-a2);
		margin: 0;
		padding: var(--ui-a2) var(--ui-a3) var(--ui-a3);
		border: 1px dashed var(--ui-rand-stark);
		border-radius: var(--ui-radius);
	}
	.pb-bedingung legend {
		padding: 0 0.3rem;
		font-size: var(--ui-schrift-s);
		font-weight: 600;
		color: var(--ui-text-leise);
	}
	.pb-bedingung .pb-reihe {
		flex-wrap: wrap;
	}
	.pb-bedingung .pb-reihe > * {
		flex: 1 1 9rem;
		width: auto;
	}
	.pb-ablage {
		padding-top: 4px;
	}
	.pb-neu {
		border-style: dashed !important;
		color: var(--ui-akzent-text) !important;
		font-weight: 600 !important;
		background: transparent !important;
	}
</style>
