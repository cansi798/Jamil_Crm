<script lang="ts">
	/**
	 * Baukasten einer Protokoll-Vorlage (Wunsch Jamil, msg 2649): Schritte (Seiten) → Abschnitte → Felder. Felder per
	 * Ziehen und Ablegen oder ↑/↓ sortieren, je Feld Typ, Beschriftung, Hinweis, Pflicht und eine Bedingung („nur
	 * zeigen, wenn …“ bzw. „Pflicht, wenn …“). Rechts die Live-Vorschau (auf dem Handy über „Vorschau“), in der man den
	 * Assistenten samt gesperrtem „Weiter“ ausprobieren kann. Speichern legt eine neue Version an.
	 */
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import '$lib/stil/kunden.css';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import Assistent from '$lib/components/protokoll/Assistent.svelte';
	import {
		BEDINGUNG_OP_NAMEN,
		FELD_TYPEN,
		FELD_TYP_NAMEN,
		alleFelder,
		bedingungText,
		neueId,
		opsFuer,
		pruefeSchema,
		SchemaFehler,
		type Antworten,
		type Feld,
		type FeldTyp,
		type Schema
	} from '$lib/protokoll-formular';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const kopie = (v: PageData['vorlage']) => ({ name: v.name, beschreibung: v.beschreibung ?? '', schema: structuredClone(v.schema) as Schema });
	let entwurf = $state(untrack(() => kopie(data.vorlage)));
	let gespeichertStand = $state(untrack(() => JSON.stringify(kopie(data.vorlage))));
	const geaendert = $derived(JSON.stringify(entwurf) !== gespeichertStand);

	let offenId = $state<string | null>(null);
	let meldung = $state<string | null>(null);
	let fehler = $state<string | null>(null);
	let speichert = $state(false);
	let vorschauMobil = $state(false);

	// Vorschau: eigene Antworten, Fotos/Unterschrift nur als Platzhalter
	let vorschauAntworten = $state<Antworten>({});
	let vorschauSchritt = $state(0);
	let platzhalter = 0;

	const pruefung = $derived.by(() => {
		try {
			pruefeSchema($state.snapshot(entwurf.schema));
			return null;
		} catch (e) {
			return e instanceof SchemaFehler ? e.message : 'Ungültige Vorlage';
		}
	});

	// ---------- Bearbeiten ----------
	type Ort = { s: number; a: number; f: number };
	const felderVon = (s: number, a: number) => entwurf.schema.seiten[s].abschnitte[a].felder;

	function standardFeld(typ: FeldTyp): Feld {
		const f: Feld = { id: neueId('f'), typ, label: FELD_TYP_NAMEN[typ] };
		if (typ === 'auswahl' || typ === 'mehrfach') f.optionen = ['Option 1', 'Option 2'];
		if (typ === 'checkliste') f.optionen = ['Punkt 1', 'Punkt 2'];
		if (typ === 'messwert') f.einheit = 'mm';
		if (typ === 'unterschrift') ((f.wer = 'kunde'), (f.label = 'Unterschrift Kunde'), (f.pflicht = true));
		if (typ === 'foto') ((f.label = 'Foto'), (f.pflicht = true));
		if (typ === 'hinweis') ((f.label = 'Hinweis'), (f.hilfe = 'Text für den Monteur'));
		return f;
	}
	function feldDazu(s: number, a: number, typ: FeldTyp) {
		const f = standardFeld(typ);
		felderVon(s, a).push(f);
		offenId = f.id;
	}
	function feldWeg(o: Ort) {
		const f = felderVon(o.s, o.a)[o.f];
		const abhaengig = alleFelder(entwurf.schema).filter((x) => x.feld.bedingung?.feld === f.id);
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
			const as = entwurf.schema.seiten[o.s - 1].abschnitte.length - 1;
			verschiebe(o, { s: o.s - 1, a: as, f: felderVon(o.s - 1, as).length });
		}
	}
	function runter(o: Ort) {
		if (o.f < felderVon(o.s, o.a).length - 1) verschiebe(o, { ...o, f: o.f + 1 });
		else if (o.a < entwurf.schema.seiten[o.s].abschnitte.length - 1) verschiebe(o, { s: o.s, a: o.a + 1, f: 0 });
		else if (o.s < entwurf.schema.seiten.length - 1) verschiebe(o, { s: o.s + 1, a: 0, f: 0 });
	}
	/** Bedingungen, deren Quelle nicht mehr davor liegt, entfernen (keine Kreise). */
	function bereinigeBedingungen() {
		const davor = new Set<string>();
		for (const { feld } of alleFelder(entwurf.schema)) {
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
		for (const { feld } of alleFelder(entwurf.schema)) {
			if (feld.bedingung?.feld === f.id && !opsFuer(typ).includes(feld.bedingung.op)) delete feld.bedingung;
		}
	}
	function seiteDazu() {
		entwurf.schema.seiten.push({ id: neueId('s'), titel: `Schritt ${entwurf.schema.seiten.length + 1}`, abschnitte: [{ id: neueId('a'), felder: [] }] });
	}
	function seiteWeg(s: number) {
		if (entwurf.schema.seiten.length === 1) return;
		if (entwurf.schema.seiten[s].abschnitte.some((a) => a.felder.length > 0) && !confirm('Schritt mit allen Feldern löschen?')) return;
		entwurf.schema.seiten.splice(s, 1);
		bereinigeBedingungen();
	}
	function seiteSchieben(s: number, d: -1 | 1) {
		const z = s + d;
		if (z < 0 || z >= entwurf.schema.seiten.length) return;
		const [x] = entwurf.schema.seiten.splice(s, 1);
		entwurf.schema.seiten.splice(z, 0, x);
		bereinigeBedingungen();
	}
	function abschnittDazu(s: number) {
		entwurf.schema.seiten[s].abschnitte.push({ id: neueId('a'), titel: 'Neuer Abschnitt', felder: [] });
	}
	function abschnittWeg(s: number, a: number) {
		const seite = entwurf.schema.seiten[s];
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
		for (const { feld } of alleFelder(entwurf.schema)) {
			if (feld.id === f.id) break;
			if (opsFuer(feld.typ).length > 0) aus.push(feld);
		}
		return aus;
	}
	const feldNach = (id: string) => alleFelder(entwurf.schema).find((x) => x.feld.id === id)?.feld;
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

	// ---------- Speichern ----------
	async function speichern() {
		fehler = null;
		meldung = null;
		if (pruefung) {
			fehler = pruefung;
			return;
		}
		speichert = true;
		try {
			const res = await fetch(`/api/protokoll-vorlagen/${data.vorlage.id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: entwurf.name, beschreibung: entwurf.beschreibung, schema: $state.snapshot(entwurf.schema) })
			});
			const b = await res.json();
			if (!res.ok) {
				fehler = b.fehler ?? 'Speichern fehlgeschlagen.';
				return;
			}
			gespeichertStand = JSON.stringify(kopie(b));
			entwurf = kopie(b);
			meldung = b.version === data.vorlage.version ? 'Keine Änderungen.' : `Gespeichert als Version ${b.version}.`;
			if (b.id !== data.vorlage.id) await goto(`/einstellungen/protokoll-vorlagen/${b.id}`, { replaceState: true, noScroll: true, keepFocus: true });
		} catch {
			fehler = 'Keine Verbindung – bitte erneut versuchen.';
		} finally {
			speichert = false;
		}
	}

	beforeNavigate((n) => {
		if (geaendert && n.type !== 'goto' && !confirm('Ungespeicherte Änderungen verwerfen?')) n.cancel();
	});
</script>

<svelte:head>
	<title>{entwurf.name} – Protokoll-Vorlage</title>
</svelte:head>
<svelte:window onbeforeunload={(e) => geaendert && e.preventDefault()} />

<main class="kd-seite breit pb-seite">
	<a href="/einstellungen/protokoll-vorlagen" class="kd-zurueck">← Protokoll-Vorlagen</a>
	<header class="pb-kopf">
		<div class="pb-namen">
			<label>Name der Vorlage<input type="text" bind:value={entwurf.name} maxlength="200" data-testid="vorlage-name" /></label>
			<label>Beschreibung (optional)<input type="text" bind:value={entwurf.beschreibung} maxlength="1000" /></label>
			<p class="kd-info">
				Version {data.vorlage.version}{data.vorlage.archiviert ? ' · archiviert' : ''}{data.vorlage.protokolle > 0
					? ` · ${data.vorlage.protokolle} ausgefüllte Protokolle behalten ihre Version`
					: ''}
			</p>
		</div>
	</header>

	<button type="button" class="kd-knopf hell pb-vorschau-knopf" onclick={() => (vorschauMobil = !vorschauMobil)}>
		{vorschauMobil ? 'Zurück zum Bearbeiten' : 'Vorschau'}
	</button>

	<div class="pb-raster" class:zeige-vorschau={vorschauMobil}>
		<div class="pb-editor">
			{#each entwurf.schema.seiten as seite, s (seite.id)}
				<section class="pb-seite" aria-label={`Schritt ${s + 1}`}>
					<div class="pb-seite-kopf">
						<span class="pb-nr">{s + 1}</span>
						<input type="text" class="pb-titel" bind:value={seite.titel} maxlength="200" aria-label={`Titel Schritt ${s + 1}`} />
						<div class="pb-mini">
							<button type="button" title="Schritt nach oben" aria-label="Schritt nach oben" disabled={s === 0} onclick={() => seiteSchieben(s, -1)}>↑</button>
							<button type="button" title="Schritt nach unten" aria-label="Schritt nach unten" disabled={s === entwurf.schema.seiten.length - 1} onclick={() => seiteSchieben(s, 1)}>↓</button>
							<button type="button" title="Schritt löschen" aria-label="Schritt löschen" disabled={entwurf.schema.seiten.length === 1} onclick={() => seiteWeg(s)}>✕</button>
						</div>
					</div>
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
												<button type="button" aria-label="Nach oben" onclick={() => hoch(ort)}>↑</button>
												<button type="button" aria-label="Nach unten" onclick={() => runter(ort)}>↓</button>
												<button type="button" aria-label="Duplizieren" onclick={() => feldKopie(ort)}>⧉</button>
												<button type="button" aria-label="Feld löschen" onclick={() => feldWeg(ort)}>✕</button>
											</div>
										</div>
										{#if offenId === f.id}
											{@const quellen = quellenFuer(f)}
											<div class="pb-feld-form">
												<label>
													Feldtyp
													<select value={f.typ} onchange={(e) => typAendern(f, e.currentTarget.value as FeldTyp)}>
														{#each FELD_TYPEN as t (t)}<option value={t}>{FELD_TYP_NAMEN[t]}</option>{/each}
													</select>
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
														<select bind:value={f.wer}><option value="kunde">Kunde</option><option value="monteur">Monteur</option></select>
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
														<select value={f.bedingung?.wirkung ?? ''} onchange={(e) => bedingungSetzen(f, e.currentTarget.value)} aria-label="Art der Bedingung">
															<option value="">immer zeigen</option>
															<option value="zeigen">nur zeigen, wenn …</option>
															{#if f.typ !== 'hinweis'}<option value="pflicht">Pflicht nur, wenn …</option>{/if}
														</select>
														{#if f.bedingung}
															{@const b = f.bedingung}
															{@const q = feldNach(b.feld)}
															<div class="pb-reihe">
																<select
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
																</select>
																<select bind:value={b.op} aria-label="Vergleich">
																	{#each opsFuer(q?.typ ?? 'text') as op (op)}<option value={op}>{BEDINGUNG_OP_NAMEN[op]}</option>{/each}
																</select>
																{#if brauchtWert(b.op)}
																	{#if q?.typ === 'janein'}
																		<select bind:value={b.wert} aria-label="Wert"><option value="ja">ja</option><option value="nein">nein</option></select>
																	{:else if q?.optionen}
																		<select bind:value={b.wert} aria-label="Wert">{#each q.optionen as o (o)}<option value={o}>{o}</option>{/each}</select>
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
									<select
										class="pb-neu"
										aria-label="Feld hinzufügen"
										data-testid="feld-dazu"
										onchange={(e) => {
											if (e.currentTarget.value) feldDazu(s, a, e.currentTarget.value as FeldTyp);
											e.currentTarget.value = '';
										}}
									>
										<option value="">+ Feld hinzufügen …</option>
										{#each FELD_TYPEN as t (t)}<option value={t}>{FELD_TYP_NAMEN[t]}</option>{/each}
									</select>
								</li>
							</ol>
						</div>
					{/each}
					<button type="button" class="knopf-subtil klein" onclick={() => abschnittDazu(s)}>+ Abschnitt</button>
				</section>
			{/each}
			<button type="button" class="kd-knopf hell" onclick={seiteDazu} data-testid="schritt-dazu">+ Schritt</button>
		</div>

		<aside class="pb-vorschau" aria-label="Live-Vorschau">
			<div class="pb-handy">
				<p class="pb-vorschau-titel">Vorschau – so sieht es der Monteur</p>
				{#if pruefung}
					<p class="kd-fehler">{pruefung}</p>
				{:else}
					<Assistent
						schema={entwurf.schema}
						antworten={vorschauAntworten}
						bind:schritt={vorschauSchritt}
						onwert={(id, w) => (w === undefined || w === '' || (Array.isArray(w) && w.length === 0) ? delete vorschauAntworten[id] : (vorschauAntworten[id] = w))}
						fotoUrl={() => null}
						onfoto={async (id) => {
							vorschauAntworten[id] = [...((vorschauAntworten[id] as string[]) ?? []), `vorschau-${++platzhalter}`];
						}}
						onfotoLoeschen={async (id, d) => {
							vorschauAntworten[id] = ((vorschauAntworten[id] as string[]) ?? []).filter((x) => x !== d);
						}}
						onunterschrift={async (id, _png, name) => {
							vorschauAntworten[id] = { dateiId: 'vorschau', name, zeit: new Date().toISOString() };
						}}
						onabschliessen={async () => {
							alert('Vorschau: Hier würde das Protokoll abgeschlossen.');
						}}
					/>
					<button type="button" class="knopf-subtil klein" onclick={() => ((vorschauAntworten = {}), (vorschauSchritt = 0))}>Vorschau zurücksetzen</button>
				{/if}
			</div>
		</aside>
	</div>

	<div class="pb-leiste" role="region" aria-label="Speichern">
		{#if fehler}<p class="kd-fehler" role="alert">{fehler}</p>{:else if meldung}<p class="pb-ok" role="status">{meldung}</p>{:else if geaendert}<p class="kd-info">Ungespeicherte Änderungen</p>{/if}
		<button type="button" class="kd-knopf" disabled={speichert || !geaendert} onclick={speichern} data-testid="vorlage-speichern">
			{speichert ? 'Speichert …' : 'Speichern (neue Version)'}
		</button>
	</div>
</main>

<style>
	.pb-seite-kopf,
	.pb-abschnitt-kopf,
	.pb-feld-kopf,
	.pb-reihe {
		display: flex;
		align-items: center;
		gap: var(--ui-a2);
	}
	.pb-namen {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: var(--ui-a2) var(--ui-a3);
		width: 100%;
	}
	.pb-namen label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: var(--ui-schrift-s);
		font-weight: 600;
		color: var(--ui-text-leise);
	}
	.pb-namen p {
		grid-column: 1 / -1;
		margin: 0;
	}
	.pb-raster {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(20rem, 1fr);
		gap: var(--ui-a5);
		align-items: start;
		margin-top: var(--ui-a4);
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
		color: #fff;
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
		color: var(--ui-akzent);
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
		color: var(--ui-akzent) !important;
		font-weight: 600 !important;
		background: transparent !important;
	}
	.pb-vorschau {
		position: sticky;
		top: var(--ui-a4);
	}
	.pb-handy {
		max-height: calc(100vh - 8rem);
		overflow: auto;
		padding: var(--ui-a4);
		border: 8px solid #1f2430;
		border-radius: 28px;
		background: var(--ui-hintergrund);
		box-shadow: var(--ui-schatten-hoch);
	}
	.pb-vorschau-titel {
		margin: 0 0 var(--ui-a3);
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ui-text-leise);
	}
	.pb-vorschau-knopf {
		display: none;
	}
	.pb-leiste {
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--ui-a3);
		margin-top: var(--ui-a4);
		padding: var(--ui-a3) 0 calc(var(--ui-a3) + env(safe-area-inset-bottom, 0px));
		background: linear-gradient(to bottom, transparent, var(--ui-hintergrund) 25%);
	}
	.pb-leiste p {
		margin: 0;
	}
	.pb-ok {
		color: #17603f;
		font-weight: 600;
	}
	@media (max-width: 960px) {
		.pb-raster {
			grid-template-columns: minmax(0, 1fr);
		}
		.pb-vorschau {
			display: none;
			position: static;
		}
		.pb-raster.zeige-vorschau .pb-vorschau {
			display: block;
		}
		.pb-raster.zeige-vorschau .pb-editor {
			display: none;
		}
		.pb-vorschau-knopf {
			display: inline-flex;
			margin-top: var(--ui-a2);
		}
		.pb-handy {
			max-height: none;
			border-width: 0;
			border-radius: var(--ui-radius-karte);
			padding: var(--ui-a2);
		}
		.pb-namen {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
