<script lang="ts">
	/**
	 * Öffentliche Buchungsseite (Online-Buchung, Wunsch Jamil msgs 2684/2686): 1. Termin wählen, 2. Angaben und Fragen,
	 * 3. verbindlich buchen → Bestätigung (/buchung/<Token>) mit Kalenderdatei und Link zum Absagen/Verschieben.
	 * Mobil zuerst, in der Hausfarbe, ohne fremde Quellen. Alle Inhalte als Text (kein {@html}).
	 */
	import { goto } from '$app/navigation';
	import Rahmen from '$lib/components/buchung/Rahmen.svelte';
	import TerminWahl from '$lib/components/buchung/TerminWahl.svelte';
	import FeldEingabe from '$lib/components/protokoll/FeldEingabe.svelte';
	import { verkleinereFoto } from '$lib/bild-verkleinern';
	import { auswerten, alleFelder, fehlendeFelder, feldProblem, type Antworten } from '$lib/protokoll-formular';
	import { BUCHUNG_GRENZEN } from '$lib/buchung';
	import { berlinTag, berlinUhrzeit, tagDeutsch } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const s = $derived(data.seite);
	const basis = $derived(`/buchen/${data.token}`);

	let gewaehlt = $state<string | null>(null);
	let kontakt = $state({ vorname: '', nachname: '', email: '', telefon: '', strasse: '', plz: '', ort: '' });
	let antworten = $state<Antworten>({});
	let fotos = $state<Record<string, { feldId: string; blob: Blob; url: string }>>({});
	let datenschutz = $state(false);
	let website = $state('');
	let sendet = $state(false);
	let fehler = $state<string | null>(null);
	let feldFehler = $state<Record<string, string>>({});
	let zeigeFehler = $state(false);
	let terminWahl = $state<{ neuLaden: () => Promise<void> }>();
	let formularAnker = $state<HTMLElement>();

	const zustand = $derived(auswerten(s.dienst.fragen, antworten));
	const fragen = $derived(alleFelder(s.dienst.fragen).map((x) => x.feld));
	const offen = $derived(fehlendeFelder(s.dienst.fragen, antworten));
	const mitAdresse = $derived(s.dienst.adresse !== 'aus');
	const anzahlFotos = $derived(Object.keys(fotos).length);

	const terminText = (iso: string) => {
		const d = new Date(iso);
		return `${tagDeutsch(berlinTag(d))}, ${berlinUhrzeit(d)} Uhr`;
	};

	function setzeWert(id: string, w: unknown) {
		if (w === undefined || w === '' || (Array.isArray(w) && w.length === 0)) delete antworten[id];
		else antworten[id] = w;
	}

	async function fotoDazu(feldId: string, datei: File) {
		if (anzahlFotos >= BUCHUNG_GRENZEN.fotos) throw new Error(`Höchstens ${BUCHUNG_GRENZEN.fotos} Fotos.`);
		const { blob } = await verkleinereFoto(datei);
		if (blob.size > BUCHUNG_GRENZEN.fotoBytes) throw new Error('Das Foto ist zu groß.');
		const id = crypto.randomUUID();
		fotos[id] = { feldId, blob, url: URL.createObjectURL(blob) };
		antworten[feldId] = [...((antworten[feldId] as string[]) ?? []), id];
	}
	async function fotoWeg(feldId: string, id: string) {
		if (fotos[id]) URL.revokeObjectURL(fotos[id].url);
		delete fotos[id];
		setzeWert(feldId, ((antworten[feldId] as string[]) ?? []).filter((x) => x !== id));
	}

	async function buchen(ev: SubmitEvent) {
		ev.preventDefault();
		fehler = null;
		feldFehler = {};
		zeigeFehler = true;
		if (!gewaehlt) {
			fehler = 'Bitte zuerst einen Termin wählen.';
			return;
		}
		if (offen.length > 0) {
			fehler = `Bitte noch ausfüllen: ${offen.map((f) => f.label).join(', ')}.`;
			document.querySelector<HTMLElement>(`[data-feld="${offen[0].feldId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
		if (!datenschutz) {
			fehler = 'Bitte stimmen Sie der Verarbeitung Ihrer Angaben zu.';
			return;
		}
		sendet = true;
		try {
			const form = new FormData();
			// Nur Fotos, die noch zu einer sichtbaren Frage gehören
			const sichtbar = Object.fromEntries(Object.entries(antworten).filter(([id]) => zustand.get(id)?.sichtbar));
			form.set('daten', JSON.stringify({ beginn: gewaehlt, kontakt, antworten: sichtbar, datenschutz, website, stempel: data.stempel }));
			for (const [id, f] of Object.entries(fotos)) {
				if ((sichtbar[f.feldId] as string[] | undefined)?.includes(id)) form.append(`foto:${f.feldId}:${id}`, f.blob, `${id}.jpg`);
			}
			const r = await fetch(`${basis}/absenden`, { method: 'POST', body: form });
			const b = await r.json().catch(() => ({}));
			if (!r.ok) {
				fehler = b.fehler ?? 'Die Buchung hat nicht geklappt. Bitte erneut versuchen.';
				if (b.felder) feldFehler = b.felder;
				if (r.status === 409) {
					gewaehlt = null;
					await terminWahl?.neuLaden();
				}
				return;
			}
			await goto(`/buchung/${b.verwaltungToken}?neu=1`);
		} catch {
			fehler = 'Keine Verbindung – bitte erneut versuchen.';
		} finally {
			sendet = false;
		}
	}

	$effect(() => {
		if (gewaehlt && formularAnker && window.matchMedia('(max-width: 720px)').matches) {
			formularAnker.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	});
</script>

<svelte:head>
	<title>{s.dienst.name} buchen – {s.betrieb.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Rahmen betrieb={s.betrieb} farben={data.farben} logoUrl={`${basis}/logo?v=${s.betrieb.logoStand}`} datenschutzUrl={s.datenschutzUrl}>
	<section class="bu-dienst" aria-labelledby="dienst-titel">
		<span class="bu-punkt" style={`background:${s.dienst.farbe}`} aria-hidden="true"></span>
		<div>
			<h1 id="dienst-titel">{s.dienst.name}</h1>
			<p class="bu-eckdaten">
				<span>{s.dienst.dauerText}</span>
				<span>{s.dienst.ortName}</span>
				{#if s.mitarbeiterVorname}<span>mit {s.mitarbeiterVorname}</span>{/if}
			</p>
			{#if s.dienst.beschreibung}<p class="bu-beschreibung">{s.dienst.beschreibung}</p>{/if}
		</div>
	</section>

	<section class="bu-karte" aria-labelledby="schritt-1">
		<h2 id="schritt-1"><span class="bu-nr">1</span> Termin wählen</h2>
		<TerminWahl url={`${basis}/termine`} bind:gewaehlt bind:this={terminWahl} />
		{#if gewaehlt}<p class="bu-gewaehlt" role="status">Gewählt: <strong>{terminText(gewaehlt)}</strong></p>{/if}
	</section>

	<form class="bu-karte" aria-labelledby="schritt-2" onsubmit={buchen} novalidate bind:this={formularAnker}>
		<h2 id="schritt-2"><span class="bu-nr">2</span> Ihre Angaben</h2>
		<div class="bu-felder">
			<div class="bu-zwei">
				<label>Vorname *<input type="text" bind:value={kontakt.vorname} autocomplete="given-name" maxlength="100" required aria-invalid={!!feldFehler.vorname} /></label>
				<label>Name *<input type="text" bind:value={kontakt.nachname} autocomplete="family-name" maxlength="100" required aria-invalid={!!feldFehler.nachname} /></label>
			</div>
			<label>E-Mail *<input type="email" bind:value={kontakt.email} autocomplete="email" maxlength="200" required aria-invalid={!!feldFehler.email} /></label>
			{#if feldFehler.email}<p class="kd-fehler">{feldFehler.email}</p>{/if}
			<label>Telefon *<input type="tel" bind:value={kontakt.telefon} autocomplete="tel" maxlength="30" required aria-invalid={!!feldFehler.telefon} /></label>
			{#if feldFehler.telefon}<p class="kd-fehler">{feldFehler.telefon}</p>{/if}
			{#if mitAdresse}
				<label>Straße und Hausnummer{s.dienst.adresse === 'pflicht' ? ' *' : ''}<input type="text" bind:value={kontakt.strasse} autocomplete="street-address" maxlength="200" aria-invalid={!!feldFehler.strasse} /></label>
				<div class="bu-plz">
					<label>PLZ{s.dienst.adresse === 'pflicht' ? ' *' : ''}<input type="text" bind:value={kontakt.plz} autocomplete="postal-code" inputmode="numeric" maxlength="10" aria-invalid={!!feldFehler.plz} /></label>
					<label>Ort{s.dienst.adresse === 'pflicht' ? ' *' : ''}<input type="text" bind:value={kontakt.ort} autocomplete="address-level2" maxlength="100" aria-invalid={!!feldFehler.ort} /></label>
				</div>
			{/if}
		</div>

		{#if fragen.length > 0}
			<div class="bu-fragen">
				{#each fragen as f (f.id)}
					{@const z = zustand.get(f.id)}
					{#if z?.sichtbar}
						<FeldEingabe
							feld={f}
							wert={antworten[f.id]}
							pflicht={z.pflicht}
							problem={feldProblem(f, antworten[f.id], z.pflicht)}
							{zeigeFehler}
							onwert={(w) => setzeWert(f.id, w)}
							fotoUrl={(id) => fotos[id]?.url ?? null}
							onfoto={(d) => fotoDazu(f.id, d)}
							onfotoLoeschen={(id) => fotoWeg(f.id, id)}
							onunterschrift={async () => {}}
						/>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Honigtopf: für Menschen unsichtbar, Bots füllen es aus -->
		<div class="bu-honig" aria-hidden="true">
			<label>Website <input type="text" tabindex="-1" autocomplete="off" bind:value={website} /></label>
		</div>

		<label class="bu-zustimmung">
			<input type="checkbox" bind:checked={datenschutz} required />
			<span>
				Ich bin einverstanden, dass {s.betrieb.name} meine Angaben zur Bearbeitung dieser Terminanfrage speichert und mich dazu kontaktiert.
				{#if s.datenschutzUrl && /^https?:\/\//i.test(s.datenschutzUrl)}
					<a href={s.datenschutzUrl} target="_blank" rel="noopener noreferrer">Datenschutzerklärung</a>
				{/if}
				*
			</span>
		</label>

		{#if fehler}<p class="kd-fehler" role="alert">{fehler}</p>{/if}
		<button type="submit" class="kd-knopf bu-absenden" disabled={sendet} data-testid="buchen">
			{#if sendet}Wird gebucht …{:else if gewaehlt}Termin am {terminText(gewaehlt)} verbindlich buchen{:else}Termin verbindlich buchen{/if}
		</button>
		<p class="bu-klein">* Pflichtangaben</p>
	</form>
</Rahmen>

<style>
	h1 {
		margin: 0 0 0.25rem;
		font-size: var(--ui-schrift-xxl);
		line-height: 1.2;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.75rem;
		font-size: var(--ui-schrift-xl);
	}
	.bu-dienst {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.bu-punkt {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		margin-top: 0.6rem;
		border-radius: 999px;
	}
	.bu-eckdaten {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin: 0;
		color: var(--ui-text-leise);
		font-weight: 500;
	}
	.bu-beschreibung {
		margin: 0.5rem 0 0;
		white-space: pre-line;
		line-height: 1.6;
	}
	.bu-karte {
		margin-bottom: 1rem;
		padding: 1rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten);
	}
	.bu-nr {
		display: inline-grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 999px;
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
		font-size: var(--ui-schrift-m);
	}
	.bu-gewaehlt {
		margin: 0.75rem 0 0;
	}
	.bu-felder,
	.bu-fragen {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.bu-fragen {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--ui-rand);
	}
	.bu-felder label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-weight: 600;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.bu-felder input {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}
	.bu-zwei > *,
	.bu-plz > * {
		min-width: 0;
	}
	.bu-zwei {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.bu-plz {
		display: grid;
		grid-template-columns: 7rem 1fr;
		gap: 0.75rem;
	}
	@media (max-width: 420px) {
		.bu-zwei {
			grid-template-columns: 1fr;
		}
	}
	.bu-honig {
		position: absolute;
		left: -10000px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
	.bu-zustimmung {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		margin: 1.25rem 0 0.75rem;
		line-height: 1.6;
		cursor: pointer;
	}
	.bu-zustimmung input {
		flex: none;
		width: 1.25rem;
		height: 1.25rem;
		margin-top: 0.2rem;
		accent-color: var(--ui-akzent);
	}
	.bu-absenden {
		width: 100%;
		min-height: 3rem;
		font-size: var(--ui-schrift-l) !important;
	}
	.bu-klein {
		margin: 0.5rem 0 0;
		font-size: var(--ui-schrift-xs);
		color: var(--ui-text-leise);
	}
</style>
