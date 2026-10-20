<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import '$lib/stil/kunden.css';
	import Assistent from '$lib/components/protokoll/Assistent.svelte';
	import { verkleinereFoto } from '$lib/bild-verkleinern';
	import { DATEI_TYPEN, alleFelder, type Antworten } from '$lib/protokoll-formular';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const p = $derived(data.protokoll);
	const id = untrack(() => data.protokoll.id);
	const SPEICHER = `crm-protokoll-entwurf:${id}`;
	const gesperrt = $derived(p.status === 'abgeschlossen' || !data.darfAusfuellen);

	let antworten = $state<Antworten>(untrack(() => structuredClone(data.protokoll.antworten)));
	let schritt = $state(untrack(() => data.protokoll.schritt));
	let stand = $state<'gespeichert' | 'speichert' | 'offline' | 'fehler'>('gespeichert');
	let fehlerText = $state<string | null>(null);
	let zeitgeber: ReturnType<typeof setTimeout> | undefined;
	let laufend: Promise<void> | null = null;
	let offen = false; // ungespeicherte Änderungen

	const dateiFelder = $derived(new Set(alleFelder(p.schema).filter((x) => DATEI_TYPEN.includes(x.feld.typ)).map((x) => x.feld.id)));

	function lokalSichern() {
		try {
			localStorage.setItem(SPEICHER, JSON.stringify({ antworten, schritt, zeit: Date.now() }));
		} catch {
			/* kein Speicher (privat) – nur online */
		}
	}
	function lokalLoeschen() {
		try {
			localStorage.removeItem(SPEICHER);
		} catch {
			/* egal */
		}
	}

	async function senden(): Promise<void> {
		if (gesperrt) return;
		offen = false;
		stand = 'speichert';
		const nurWerte = Object.fromEntries(Object.entries(antworten).filter(([k]) => !dateiFelder.has(k)));
		try {
			const res = await fetch(`/api/protokoll-formulare/${id}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ antworten: nurWerte, schritt })
			});
			if (!res.ok) {
				const b = await res.json().catch(() => ({}));
				stand = 'fehler';
				fehlerText = b.fehler ?? 'Speichern fehlgeschlagen.';
				offen = true;
				return;
			}
			fehlerText = null;
			if (!offen) {
				stand = 'gespeichert';
				lokalLoeschen();
			}
		} catch {
			// kein Netz: lokal gesichert, später erneut
			stand = 'offline';
			offen = true;
		}
	}

	function speichernSpaeter() {
		offen = true;
		lokalSichern();
		clearTimeout(zeitgeber);
		zeitgeber = setTimeout(() => (laufend = senden()), 700);
	}
	async function jetztSpeichern() {
		clearTimeout(zeitgeber);
		if (laufend) await laufend;
		if (offen) await (laufend = senden());
	}

	function onwert(feldId: string, w: unknown) {
		if (w === undefined || w === '' || (Array.isArray(w) && w.length === 0)) delete antworten[feldId];
		else antworten[feldId] = w;
		speichernSpaeter();
	}
	/** Antworten des Servers für die Dateifelder übernehmen (Fotos/Unterschrift setzt nur der Server). */
	function dateienVomServer(server: Antworten) {
		for (const f of dateiFelder) {
			if (server[f] === undefined) delete antworten[f];
			else antworten[f] = server[f];
		}
	}
	async function antwortOderFehler(res: Response) {
		const b = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(b.fehler ?? 'Das hat nicht geklappt.');
		return b;
	}
	async function onfoto(feldId: string, datei: File) {
		if (!navigator.onLine) throw new Error('Kein Netz – Foto bitte aufnehmen, sobald wieder Netz da ist.');
		const { blob, typ } = await verkleinereFoto(datei);
		const name = (datei.name || 'foto').replace(/\.[^.]+$/, '') + (typ === 'image/png' ? '.png' : '.jpg');
		const res = await fetch(`/api/protokoll-formulare/${id}/foto?feld=${encodeURIComponent(feldId)}&name=${encodeURIComponent(name)}`, {
			method: 'POST',
			headers: { 'content-type': typ },
			body: blob
		});
		dateienVomServer((await antwortOderFehler(res)).antworten);
	}
	async function onfotoLoeschen(_feldId: string, dateiId: string) {
		const res = await fetch(`/api/protokoll-formulare/${id}/dateien/${dateiId}`, { method: 'DELETE' });
		dateienVomServer((await antwortOderFehler(res)).antworten);
	}
	async function onunterschrift(feldId: string, png: Uint8Array, name: string) {
		const res = await fetch(`/api/protokoll-formulare/${id}/unterschrift?feld=${encodeURIComponent(feldId)}&name=${encodeURIComponent(name)}`, {
			method: 'POST',
			headers: { 'content-type': 'image/png' },
			body: new Blob([new Uint8Array(png)], { type: 'image/png' })
		});
		dateienVomServer((await antwortOderFehler(res)).antworten);
	}
	async function abschliessen() {
		await jetztSpeichern();
		if (stand === 'offline') throw new Error('Kein Netz – Abschließen geht erst, wenn wieder Netz da ist. Alles ist lokal gesichert.');
		const res = await fetch(`/api/protokoll-formulare/${id}/abschliessen`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		await antwortOderFehler(res);
		lokalLoeschen();
		await invalidateAll();
		antworten = structuredClone(data.protokoll.antworten);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}
	async function verwerfen() {
		if (!confirm('Diesen Entwurf wirklich löschen? Fotos und Angaben gehen verloren.')) return;
		clearTimeout(zeitgeber);
		const res = await fetch(`/api/protokoll-formulare/${id}`, { method: 'DELETE' });
		const b = await antwortOderFehler(res).catch((e) => ((fehlerText = e.message), null));
		if (!b) return;
		lokalLoeschen();
		await goto(b.auftragId ? `/auftraege/${b.auftragId}` : '/');
	}

	// Schrittwechsel ebenfalls merken (weiter machen, wo man aufgehört hat)
	let ersterSchritt = true;
	$effect(() => {
		void schritt;
		if (ersterSchritt) {
			ersterSchritt = false;
			return;
		}
		untrack(() => !gesperrt && speichernSpaeter());
	});

	onMount(() => {
		// Offline gesicherte Änderungen von diesem Gerät nachholen
		if (!gesperrt) {
			try {
				const roh = localStorage.getItem(SPEICHER);
				if (roh) {
					const lokal = JSON.parse(roh) as { antworten: Antworten; schritt: number; zeit: number };
					if (lokal.zeit > Date.parse(data.protokoll.geaendert)) {
						for (const [k, v] of Object.entries(lokal.antworten)) if (!dateiFelder.has(k)) antworten[k] = v;
						schritt = lokal.schritt;
						speichernSpaeter();
					} else lokalLoeschen();
				}
			} catch {
				/* kaputter Eintrag */
			}
		} else lokalLoeschen();
		const online = () => offen && (laufend = senden());
		const weg = (e: BeforeUnloadEvent) => {
			if (offen) {
				lokalSichern();
				e.preventDefault();
			}
		};
		window.addEventListener('online', online);
		window.addEventListener('beforeunload', weg);
		return () => {
			window.removeEventListener('online', online);
			window.removeEventListener('beforeunload', weg);
		};
	});

	const fotoUrl = (dateiId: string) => `/api/protokoll-formulare/${id}/dateien/${dateiId}`;
	const zeit = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }) : '';
</script>

<svelte:head>
	<title>{p.titel} – Protokoll</title>
</svelte:head>

<main class="kd-seite pw-seite">
	{#if p.auftrag}<a href={`/auftraege/${p.auftrag.id}`} class="kd-zurueck">← {p.auftrag.nummer} {p.auftrag.titel}</a>{/if}
	<header class="pw-kopf">
		<div>
			<h1>{p.titel}</h1>
			<p class="kd-info">
				{#if p.auftrag}{p.auftrag.kundeName} · {/if}Vorlage Version {p.version}
			</p>
		</div>
		{#if p.status === 'entwurf' && !gesperrt}
			<span class={`pw-stand s-${stand}`} role="status" data-testid="speicher-stand">
				{stand === 'gespeichert' ? 'Gespeichert' : stand === 'speichert' ? 'Speichert …' : stand === 'offline' ? 'Offline – auf dem Gerät gesichert' : 'Nicht gespeichert'}
			</span>
		{/if}
	</header>
	{#if fehlerText}<p class="kd-fehler" role="alert">{fehlerText}</p>{/if}

	{#if p.status === 'abgeschlossen'}
		<div class="pw-fertig" role="status" data-testid="protokoll-abgeschlossen">
			<strong>Abgeschlossen</strong>
			<span>
				am {zeit(p.abgeschlossen)}{p.abgeschlossenVonName ? ` von ${p.abgeschlossenVonName}` : ''}{p.unterschriebenVon
					? ` · unterschrieben von ${p.unterschriebenVon}`
					: ''}
			</span>
			<span class="kd-info">Gesperrt – Änderungen sind nicht mehr möglich.{p.pdfDateiId ? ' Das PDF liegt in den Dokumenten des Auftrags.' : ''}</span>
			<div class="pw-knoepfe">
				<a class="kd-knopf" href={`/api/protokoll-formulare/${id}/pdf`} target="_blank" rel="noopener" data-testid="pdf-link">PDF ansehen</a>
				{#if p.auftrag}<a class="kd-knopf hell" href={`/auftraege/${p.auftrag.id}`}>Zum Auftrag</a>{/if}
			</div>
		</div>
		<Assistent schema={p.schema} antworten={p.antworten} gesperrt alles {onwert} {fotoUrl} {onfoto} {onfotoLoeschen} {onunterschrift} />
	{:else}
		<Assistent
			schema={p.schema}
			{antworten}
			bind:schritt
			{gesperrt}
			{onwert}
			{fotoUrl}
			{onfoto}
			{onfotoLoeschen}
			{onunterschrift}
			onabschliessen={data.darfAusfuellen ? abschliessen : undefined}
			abschliessenText="Abschließen und sperren"
		/>
		{#if data.darfAusfuellen}
			<div class="pw-unten">
				<a class="knopf-subtil klein" href={`/api/protokoll-formulare/${id}/pdf`} target="_blank" rel="noopener">PDF-Vorschau</a>
				<button type="button" class="knopf-gefahr klein" onclick={verwerfen}>Entwurf löschen</button>
			</div>
		{/if}
	{/if}
</main>

<style>
	.pw-seite {
		max-width: 46rem;
	}
	.pw-kopf {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--ui-a3);
		margin-bottom: var(--ui-a3);
	}
	.pw-kopf h1 {
		margin: 0;
	}
	.pw-kopf p {
		margin: 0.2rem 0 0;
	}
	.pw-stand {
		flex: none;
		padding: 0.25rem 0.7rem;
		border-radius: var(--ui-chip-radius);
		font-size: var(--ui-schrift-xs);
		font-weight: 600;
		background: var(--ui-gruen-hell);
		color: #17603f;
	}
	.pw-stand.s-speichert {
		background: var(--ui-grau-hell);
		color: var(--ui-text-leise);
	}
	.pw-stand.s-offline,
	.pw-stand.s-fehler {
		background: var(--ui-orange-hell);
		color: #8a4b06;
	}
	.pw-fertig {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin-bottom: var(--ui-a4);
		padding: var(--ui-a3) var(--ui-a4);
		border: 1px solid #b7e4cc;
		border-radius: var(--ui-radius-karte);
		background: var(--ui-gruen-hell);
	}
	.pw-knoepfe,
	.pw-unten {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		margin-top: var(--ui-a2);
	}
	.pw-unten {
		justify-content: space-between;
		margin-top: var(--ui-a5);
	}
</style>
