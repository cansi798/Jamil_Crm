<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import KatalogSuche, { type KatalogTreffer } from '$lib/components/KatalogSuche.svelte';
	import PositionenEditor, { neuerSchluessel, type EditorZeile } from '$lib/components/PositionenEditor.svelte';
	import Summenblock from '$lib/components/Summenblock.svelte';
	import { ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { centAlsEingabe, leseEuroInCent, leseMenge, mengeText, summen, type MwstSatz } from '$lib/geld';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Angebot = PageData['angebot'];

	type Kopf = { datum: string; gueltigBis: string; mwstSatz: MwstSatz; einleitung: string; schluss: string };

	const zeilenAus = (a: Angebot): EditorZeile[] =>
		a.positionen.map((p) => ({
			schluessel: neuerSchluessel(),
			katalogPositionId: p.katalogPositionId,
			bezeichnung: p.bezeichnung,
			beschreibung: p.beschreibung ?? '',
			menge: mengeText(p.menge).replaceAll('.', ''),
			einheit: p.einheit,
			einzelpreis: centAlsEingabe(p.einzelpreisCent)
		}));
	const kopfAus = (a: Angebot): Kopf => ({
		datum: a.datum,
		gueltigBis: a.gueltigBis,
		mwstSatz: a.mwstSatz,
		einleitung: a.einleitung ?? '',
		schluss: a.schluss ?? ''
	});
	const standVon = (z: EditorZeile[], k: Kopf) => JSON.stringify({ zeilen: z.map(({ schluessel: _s, ...rest }) => rest), kopf: k });

	// Anfangszustand synchron aus den Seitendaten (auch beim Rendern auf dem Server)
	const anfang = untrack(() => data.angebot);
	let geladen = anfang;
	let angebot = $state<Angebot>(anfang);
	let zeilen = $state<EditorZeile[]>(zeilenAus(anfang));
	let kopf = $state<Kopf>(kopfAus(anfang));
	let gespeichertStand = $state(standVon(zeilenAus(anfang), kopfAus(anfang)));
	let fehler = $state<string | null>(null);
	let meldung = $state<string | null>(null);
	let arbeitet = $state(false);
	let katalogOffen = $state(false);
	let zuletztHinzu = $state<string | null>(null);

	function uebernehme(a: Angebot) {
		angebot = a;
		zeilen = zeilenAus(a);
		kopf = kopfAus(a);
		gespeichertStand = standVon(zeilen, kopf);
	}

	// Neue Daten vom Server (neue Version, Statuswechsel mit invalidateAll) übernehmen
	$effect(() => {
		const a = data.angebot;
		if (a !== geladen) {
			geladen = a;
			uebernehme(a);
		}
	});

	const entwurf = $derived(angebot.status === 'entwurf');
	const geaendert = $derived(entwurf && standVon(zeilen, kopf) !== gespeichertStand);
	const live = $derived(
		summen(
			zeilen.map((z) => {
				let menge = 0;
				let einzelpreisCent = 0;
				try {
					menge = leseMenge(z.menge);
				} catch {
					/* ungültig: zählt 0 */
				}
				try {
					einzelpreisCent = z.einzelpreis.trim() === '' ? 0 : leseEuroInCent(z.einzelpreis);
				} catch {
					/* ungültig: zählt 0 */
				}
				return { menge, einzelpreisCent };
			}),
			kopf.mwstSatz
		)
	);
	const ohnePreis = $derived(
		zeilen.filter((z) => {
			try {
				return z.einzelpreis.trim() === '' || leseEuroInCent(z.einzelpreis) === 0;
			} catch {
				return false;
			}
		}).length
	);

	async function api(methode: string, url: string, koerper?: unknown) {
		const r = await fetch(url, {
			method: methode,
			headers: koerper === undefined ? undefined : { 'content-type': 'application/json' },
			body: koerper === undefined ? undefined : JSON.stringify(koerper)
		});
		const text = await r.text();
		const json = text ? JSON.parse(text) : null;
		if (!r.ok) throw new Error(json?.fehler ?? 'Das hat nicht geklappt. Bitte erneut versuchen.');
		return json;
	}

	async function aktion(fn: () => Promise<void>) {
		if (arbeitet) return;
		arbeitet = true;
		fehler = null;
		meldung = null;
		try {
			await fn();
		} catch (e) {
			fehler = (e as Error).message;
		} finally {
			arbeitet = false;
		}
	}

	async function speichernIntern() {
		await api('PATCH', `/api/angebote/${angebot.id}`, {
			datum: kopf.datum,
			gueltigBis: kopf.gueltigBis,
			mwstSatz: kopf.mwstSatz,
			einleitung: kopf.einleitung,
			schluss: kopf.schluss
		});
		const a = await api('PUT', `/api/angebote/${angebot.id}/positionen`, {
			positionen: zeilen.map((z) => ({
				katalogPositionId: z.katalogPositionId,
				bezeichnung: z.bezeichnung,
				beschreibung: z.beschreibung,
				menge: z.menge,
				einheit: z.einheit,
				einzelpreis: z.einzelpreis
			}))
		});
		uebernehme(a);
	}

	const speichern = () =>
		aktion(async () => {
			await speichernIntern();
			meldung = 'Gespeichert.';
		});

	const pdf = () =>
		aktion(async () => {
			if (geaendert) await speichernIntern();
			const n = angebot.positionen.filter((p) => p.einzelpreisCent === 0).length;
			if (n > 0 && !confirm(`${n === 1 ? '1 Position' : `${n} Positionen`} ohne Preis – trotzdem erstellen?`)) return;
			const a = document.createElement('a');
			a.href = `/api/angebote/${angebot.id}/pdf`;
			a.download = `Angebot_${angebot.nummer}.pdf`;
			document.body.appendChild(a);
			a.click();
			a.remove();
		});

	const status = (nach: string, text: string) =>
		aktion(async () => {
			if (geaendert) await speichernIntern();
			uebernehme(await api('POST', `/api/angebote/${angebot.id}/status`, { status: nach }));
			meldung = text;
			await invalidateAll();
		});

	const neueVersion = () =>
		aktion(async () => {
			const neu = await api('POST', `/api/angebote/${angebot.id}/neue-version`);
			await goto(`/angebote/${neu.id}`);
			meldung = `Neue Version ${neu.nummer} angelegt.`;
		});

	const loeschen = () =>
		aktion(async () => {
			if (!confirm(`Angebot ${angebot.nummer} löschen?`)) return;
			await api('DELETE', `/api/angebote/${angebot.id}`);
			await goto(`/auftraege/${angebot.auftragId}`);
		});

	function ausKatalog(t: KatalogTreffer) {
		zeilen = [
			...zeilen,
			{
				schluessel: neuerSchluessel(),
				katalogPositionId: t.id,
				bezeichnung: t.bezeichnung,
				beschreibung: t.beschreibung ?? '',
				menge: '1',
				einheit: t.einheit,
				einzelpreis: centAlsEingabe(t.einzelpreisCent ?? 0)
			}
		];
		zuletztHinzu = t.bezeichnung;
	}

	function freiePosition() {
		zeilen = [
			...zeilen,
			{ schluessel: neuerSchluessel(), katalogPositionId: null, bezeichnung: '', beschreibung: '', menge: '1', einheit: 'Stk', einzelpreis: '' }
		];
	}
</script>

<svelte:head>
	<title>Angebot {angebot.nummer}</title>
</svelte:head>

<main class="kd-seite an-seite">
	<a href={`/auftraege/${angebot.auftragId}`} class="kd-zurueck">← Auftrag {angebot.auftragNummer}</a>
	<div class="af-kopfzeile">
		<h1>Angebot {angebot.nummer}</h1>
		<span class={`an-status s-${angebot.status}`} data-testid="angebot-status">{ANGEBOT_STATUS_NAMEN[angebot.status]}</span>
	</div>
	<p class="kd-info">{angebot.kundeName} · {angebot.auftragTitel}{angebot.vorgaengerId ? ' · neue Version' : ''}</p>

	{#if !entwurf}
		<p class="kt-hinweis">
			Dieses Angebot ist {ANGEBOT_STATUS_NAMEN[angebot.status].toLowerCase()} und kann nicht mehr geändert werden. Für Änderungen
			„Als neue Version bearbeiten“.
		</p>
	{/if}

	<section aria-label="Angaben" class="an-kopf kd-formular">
		<div class="kd-zwei">
			<label>Datum <input type="date" bind:value={kopf.datum} disabled={!entwurf} /></label>
			<label>Gültig bis <input type="date" bind:value={kopf.gueltigBis} disabled={!entwurf} /></label>
		</div>
		<label>
			MwSt-Satz
			<select bind:value={kopf.mwstSatz} disabled={!entwurf}>
				<option value={19}>19 %</option>
				<option value={7}>7 %</option>
				<option value={0}>0 %</option>
			</select>
		</label>
		<label>Einleitung <textarea bind:value={kopf.einleitung} maxlength="2000" rows="2" disabled={!entwurf}></textarea></label>
	</section>

	<h2>Positionen</h2>
	<PositionenEditor bind:zeilen nurLesen={!entwurf} />

	{#if entwurf}
		<div class="an-hinzu">
			<button type="button" class="kd-knopf hell" onclick={() => (katalogOffen = !katalogOffen)} aria-expanded={katalogOffen}>+ Aus Katalog</button>
			<button type="button" class="kd-knopf hell" onclick={freiePosition}>+ Freie Position</button>
		</div>
		{#if katalogOffen}
			<section class="an-katalog" aria-label="Aus Katalog wählen">
				<h3>Aus Katalog wählen</h3>
				{#if zuletztHinzu}<p role="status" class="kd-info">Hinzugefügt: {zuletztHinzu}</p>{/if}
				<KatalogSuche onwaehle={ausKatalog} onschliessen={() => (katalogOffen = false)} />
			</section>
		{/if}
	{/if}

	<Summenblock nettoCent={live.nettoCent} mwstCent={live.mwstCent} bruttoCent={live.bruttoCent} mwstSatz={kopf.mwstSatz} />
	{#if ohnePreis > 0}
		<p class="kt-hinweis warnung">{ohnePreis === 1 ? '1 Position' : `${ohnePreis} Positionen`} ohne Preis.</p>
	{/if}

	<label class="an-schluss">Schlusstext <textarea bind:value={kopf.schluss} maxlength="2000" rows="2" disabled={!entwurf}></textarea></label>

	{#if fehler}<p role="alert" class="kd-fehler">{fehler}</p>{/if}
	{#if meldung}<p role="status" class="kt-hinweis ok">{meldung}</p>{/if}
	{#if geaendert}<p class="kd-info">Ungespeicherte Änderungen.</p>{/if}

	<div class="an-aktionen">
		{#if entwurf}
			<button type="button" class="kd-knopf" onclick={speichern} disabled={arbeitet || !geaendert}>Speichern</button>
		{/if}
		<button type="button" class="kd-knopf hell" onclick={pdf} disabled={arbeitet}>PDF herunterladen</button>
		{#if angebot.status === 'entwurf'}
			<button type="button" class="kd-knopf hell" onclick={() => status('versendet', 'Als versendet markiert.')} disabled={arbeitet || zeilen.length === 0}>
				Als versendet markieren
			</button>
		{:else if angebot.status === 'versendet'}
			<button type="button" class="kd-knopf hell" onclick={() => status('angenommen', 'Angebot angenommen.')} disabled={arbeitet}>Angenommen</button>
			<button type="button" class="kd-knopf hell" onclick={() => status('abgelehnt', 'Angebot abgelehnt.')} disabled={arbeitet}>Abgelehnt</button>
			<button type="button" class="kd-knopf hell" onclick={() => status('entwurf', 'Zurück zum Entwurf.')} disabled={arbeitet}>Zurück zum Entwurf</button>
		{/if}
		{#if !entwurf}
			<button type="button" class="kd-knopf hell" onclick={neueVersion} disabled={arbeitet}>Als neue Version bearbeiten</button>
		{/if}
		{#if entwurf}
			<button type="button" class="kd-knopf gefahr" onclick={loeschen} disabled={arbeitet}>Löschen</button>
		{/if}
	</div>
</main>

<style>
	.an-seite {
		max-width: 64rem;
	}
	.an-kopf {
		margin-bottom: 0.5rem;
	}
	.an-hinzu {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0.75rem 0;
	}
	@media (min-width: 700px) {
		.an-hinzu {
			display: flex;
		}
	}
	.an-katalog {
		padding: 0.75rem;
		border: 1px solid var(--primaer);
		border-radius: 0.5rem;
		background: var(--primaer-hell);
	}
	.an-katalog h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.an-schluss {
		display: grid;
		gap: 0.25rem;
		margin: 0.75rem 0;
	}
	.an-aktionen {
		display: grid;
		gap: 0.5rem;
		margin: 1rem 0 2rem;
	}
	@media (min-width: 700px) {
		.an-aktionen {
			display: flex;
			flex-wrap: wrap;
		}
	}
	.an-aktionen :disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
