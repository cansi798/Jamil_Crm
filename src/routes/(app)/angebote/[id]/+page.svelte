<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import KatalogSuche, { type KatalogTreffer } from '$lib/components/KatalogSuche.svelte';
	import PositionenEditor, { neuerSchluessel, type EditorZeile } from '$lib/components/PositionenEditor.svelte';
	import Summenblock from '$lib/components/Summenblock.svelte';
	import { ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { centAlsEingabe, euro, leseEuroInCent, leseMenge, mengeText, summen, type MwstSatz } from '$lib/geld';
	import { bewerteAngebot } from '$lib/kalkulation';
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
			einzelpreis: centAlsEingabe(p.einzelpreisCent),
			arbeitMinuten: p.arbeitMinuten === null ? '' : String(p.arbeitMinuten).replace('.', ','),
			materialCent: p.materialCent
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
	let vorlageOffen = $state(false);
	let vorlageWahl = $state('');
	let zuletztHinzu = $state<string | null>(null);

	// Ampel und erwarteter Gewinn (Wunsch Jamil, msg 2476): Arbeitszeit × Kosten-Stundensatz + Material gegen den Erlös
	const zahlOderNull = (t: string | undefined) => {
		const x = (t ?? '').trim().replace(',', '.');
		return x === '' || Number.isNaN(Number(x)) ? null : Number(x);
	};
	const bewertung = $derived(
		bewerteAngebot(
			zeilen.map((z) => {
				let menge = 0;
				let preis = 0;
				try {
					menge = leseMenge(z.menge);
					preis = z.einzelpreis.trim() === '' ? 0 : leseEuroInCent(z.einzelpreis);
				} catch {
					/* ungültige Zeile zählt nicht */
				}
				return { menge, einzelpreisCent: preis, einheit: z.einheit, arbeitMinuten: zahlOderNull(z.arbeitMinuten), materialCent: z.materialCent ?? null };
			}),
			data.satz
		)
	);

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

	/** Kopf und Positionen in EINER Anfrage (eine Transaktion auf dem Server). */
	async function speichernIntern() {
		const a = await api('PUT', `/api/angebote/${angebot.id}`, {
			datum: kopf.datum,
			gueltigBis: kopf.gueltigBis,
			mwstSatz: kopf.mwstSatz,
			einleitung: kopf.einleitung,
			schluss: kopf.schluss,
			positionen: zeilen.map((z) => ({
				katalogPositionId: z.katalogPositionId,
				bezeichnung: z.bezeichnung,
				beschreibung: z.beschreibung,
				menge: z.menge,
				einheit: z.einheit,
				einzelpreis: z.einzelpreis,
				arbeitMinuten: z.arbeitMinuten ?? '',
				materialCent: z.materialCent ?? null
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
			const a = await api('POST', `/api/angebote/${angebot.id}/status`, { status: nach });
			uebernehme(a);
			meldung = a.hinweis ? `${text} ${a.hinweis}` : text;
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
				einzelpreis: centAlsEingabe(t.einzelpreisCent ?? 0),
				arbeitMinuten: t.arbeitMinuten === null || t.arbeitMinuten === undefined ? '' : String(t.arbeitMinuten).replace('.', ','),
				materialCent: t.materialCent ?? null
			}
		];
		zuletztHinzu = t.bezeichnung;
	}

	/** Angebots-Vorlage einfügen: erst ungespeicherte Änderungen sichern, dann hängt der Server die Positionen an
	 * (Katalogpreise von heute) und übernimmt Einleitung/Schluss der Vorlage, falls sie welche hat. */
	const ausVorlage = () =>
		aktion(async () => {
			const v = data.vorlagen.find((x) => x.id === vorlageWahl);
			if (!v) return;
			if (geaendert) await speichernIntern();
			const vorher = angebot.positionen.length;
			const a = await api('POST', `/api/angebote/${angebot.id}/vorlage`, { vorlageId: v.id });
			uebernehme(a);
			const neu = a.positionen.length - vorher;
			meldung = `Vorlage „${v.name}“ eingefügt (${neu === 1 ? '1 Position' : `${neu} Positionen`}). Alles bleibt änderbar.`;
			vorlageOffen = false;
			vorlageWahl = '';
		});

	// ── Zuordnen (nur Angebote ohne Auftrag): Kunde oder Auftrag suchen und wählen ──
	let zuordnenArt = $state<'auftrag' | 'kunde'>('auftrag');
	let zuordnenSuche = $state('');
	let zuordnenTreffer = $state<{ id: string; text: string }[]>([]);
	let zuordnenMeldung = $state<string | null>(null);

	async function zuordnenSuchen() {
		zuordnenMeldung = null;
		try {
			const q = encodeURIComponent(zuordnenSuche);
			if (zuordnenArt === 'kunde') {
				const liste: { id: string; name: string; ort: string | null }[] = await api('GET', `/api/kunden?suche=${q}`);
				zuordnenTreffer = liste.map((k) => ({ id: k.id, text: [k.name, k.ort].filter(Boolean).join(' · ') }));
			} else {
				const liste: { id: string; nummer: string; titel: string; kundeName: string }[] = await api('GET', `/api/auftraege?suche=${q}&offen=1`);
				zuordnenTreffer = liste.map((a) => ({ id: a.id, text: `${a.nummer} · ${a.titel} · ${a.kundeName}` }));
			}
			if (zuordnenTreffer.length === 0) zuordnenMeldung = 'Nichts gefunden.';
		} catch (e) {
			zuordnenMeldung = (e as Error).message;
		}
	}

	const zuordnen = (id: string, text: string) =>
		aktion(async () => {
			if (geaendert) await speichernIntern();
			const a = await api('POST', `/api/angebote/${angebot.id}/zuordnen`, zuordnenArt === 'kunde' ? { kundeId: id } : { auftragId: id });
			uebernehme(a);
			zuordnenTreffer = [];
			zuordnenSuche = '';
			meldung = a.hinweis ? `Zugeordnet: ${text}. ${a.hinweis}` : `Zugeordnet: ${text}.`;
			await invalidateAll();
		});

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
	{#if angebot.auftragId}
		<a href={`/auftraege/${angebot.auftragId}`} class="kd-zurueck">← Auftrag {angebot.auftragNummer}</a>
	{:else}
		<a href="/angebote" class="kd-zurueck">← Angebote</a>
	{/if}
	<div class="af-kopfzeile">
		<h1>Angebot {angebot.nummer}</h1>
		<span class={`an-status s-${angebot.status}`} data-testid="angebot-status">{ANGEBOT_STATUS_NAMEN[angebot.status]}</span>
	</div>
	<p class="kd-info">{angebot.kundeName} · {angebot.auftragTitel ?? 'ohne Auftrag'}{angebot.vorgaengerId ? ' · neue Version' : ''}</p>

	{#if !angebot.auftragId}
		<section class="an-katalog an-zuordnen" aria-label="Angebot zuordnen">
			<h3>Zuordnen</h3>
			<p class="kd-info">
				{angebot.kundeId ? `Kunde: ${angebot.kundeName}. ` : 'Noch keinem Kunden zugeordnet. '}Einem Auftrag zuordnen – dann gilt dessen
				Kunde – oder nur einem Kunden.
			</p>
			<div class="an-zuordnen-art" role="radiogroup" aria-label="Zuordnen zu">
				<label><input type="radio" bind:group={zuordnenArt} value="auftrag" onchange={() => (zuordnenTreffer = [])} /> Auftrag</label>
				<label><input type="radio" bind:group={zuordnenArt} value="kunde" onchange={() => (zuordnenTreffer = [])} /> Kunde</label>
			</div>
			<div class="kd-suche">
				<input
					type="search"
					bind:value={zuordnenSuche}
					placeholder={zuordnenArt === 'kunde' ? 'Name, Ort oder Telefon' : 'Nummer, Titel oder Kunde'}
					aria-label="Zum Zuordnen suchen"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void zuordnenSuchen();
						}
					}}
				/>
				<button type="button" class="kd-knopf" onclick={zuordnenSuchen}>Suchen</button>
			</div>
			{#if zuordnenMeldung}<p class="kd-info" role="status">{zuordnenMeldung}</p>{/if}
			{#if zuordnenTreffer.length > 0}
				<ul class="kd-liste" aria-label="Treffer zum Zuordnen">
					{#each zuordnenTreffer as t (t.id)}
						<li><button type="button" class="an-treffer" onclick={() => zuordnen(t.id, t.text)} disabled={arbeitet}>{t.text}</button></li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

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
	<PositionenEditor bind:zeilen nurLesen={!entwurf} mitArbeitszeit />

	{#if entwurf}
		<div class="an-hinzu">
			<button type="button" class="kd-knopf hell" onclick={() => (katalogOffen = !katalogOffen)} aria-expanded={katalogOffen}>+ Aus Katalog</button>
			<button type="button" class="kd-knopf hell" onclick={freiePosition}>+ Freie Position</button>
			{#if data.vorlagen.length > 0}
				<button type="button" class="kd-knopf hell" onclick={() => (vorlageOffen = !vorlageOffen)} aria-expanded={vorlageOffen}>
					+ Aus Vorlage
				</button>
			{/if}
		</div>
		{#if vorlageOffen}
			<section class="an-katalog an-vorlage" aria-label="Aus Vorlage einfügen">
				<h3>Aus Vorlage einfügen</h3>
				<p class="kd-info">Die Positionen kommen ans Ende; Katalogpositionen mit dem heutigen Katalogpreis.</p>
				<div class="an-vorlage-wahl">
					<select bind:value={vorlageWahl} aria-label="Angebots-Vorlage">
						<option value="">– Vorlage wählen –</option>
						{#each data.vorlagen as v (v.id)}
							<option value={v.id}>{v.name} ({v.anzahlPositionen === 1 ? '1 Position' : `${v.anzahlPositionen} Positionen`})</option>
						{/each}
					</select>
					<button type="button" class="kd-knopf" onclick={ausVorlage} disabled={arbeitet || !vorlageWahl}>Einfügen</button>
				</div>
			</section>
		{/if}
		{#if katalogOffen}
			<section class="an-katalog" aria-label="Aus Katalog wählen">
				<h3>Aus Katalog wählen</h3>
				{#if zuletztHinzu}<p role="status" class="kd-info">Hinzugefügt: {zuletztHinzu}</p>{/if}
				<KatalogSuche onwaehle={ausKatalog} onschliessen={() => (katalogOffen = false)} />
			</section>
		{/if}
	{/if}

	<Summenblock nettoCent={live.nettoCent} mwstCent={live.mwstCent} bruttoCent={live.bruttoCent} mwstSatz={kopf.mwstSatz} />

	{#if data.satz}
		<section class={`an-ampel ampel-${bewertung.ampel ?? 'leer'}`} aria-label="Wirtschaftlichkeit">
			<div class="an-ampel-kopf">
				<span class="an-ampel-punkt" aria-hidden="true"></span>
				<strong>
					{#if bewertung.ampel === 'gruen'}Mit Gewinn
					{:else if bewertung.ampel === 'gelb'}Deckt die Kosten, aber wenig Gewinn
					{:else if bewertung.ampel === 'rot'}Verlust – unter kostendeckend
					{:else}Noch keine Bewertung – Arbeitszeit je Position fehlt{/if}
				</strong>
			</div>
			<dl>
				<div><dt>Arbeitszeit</dt><dd>{bewertung.arbeitsstunden.toLocaleString('de-DE')} h</dd></div>
				<div><dt>Erlös je Arbeitsstunde</dt><dd>{bewertung.effektiverSatzCent === null ? '–' : `${euro(bewertung.effektiverSatzCent)}/h`}</dd></div>
				<div><dt>Kosten (Arbeit × {euro(data.satz.kostendeckendCent)}/h + Material)</dt><dd>{bewertung.kostenCent === null ? '–' : euro(bewertung.kostenCent)}</dd></div>
				<div>
					<dt>Erwarteter Gewinn</dt>
					<dd class:minus={(bewertung.gewinnCent ?? 0) < 0}>{bewertung.gewinnCent === null ? '–' : euro(bewertung.gewinnCent)}</dd>
				</div>
			</dl>
			<p class="kd-info">
				Grün ab Verrechnungssatz {euro(data.satz.empfohlenCent)}/h, rot unter dem Kosten-Stundensatz {euro(data.satz.kostendeckendCent)}/h (aus der
				Kalkulation).{#if bewertung.ohneArbeitszeit > 0} {bewertung.ohneArbeitszeit} Position{bewertung.ohneArbeitszeit === 1 ? '' : 'en'} ohne Arbeitszeit
					zählen nur mit Erlös und Material.{/if}
			</p>
		</section>
	{/if}
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
	.an-ampel {
		margin: 1rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--m365-rand);
		border-left: 6px solid var(--ampel, var(--m365-rand-stark));
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
	}
	.ampel-gruen {
		--ampel: var(--m365-erfolg);
	}
	.ampel-gelb {
		--ampel: #e0a800;
	}
	.ampel-rot {
		--ampel: var(--m365-fehler);
	}
	.an-ampel-kopf {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.an-ampel-punkt {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		background: var(--ampel, var(--m365-rand-stark));
	}
	.an-ampel dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.5rem 1rem;
		margin: 0.6rem 0;
	}
	.an-ampel dt {
		font-size: 0.8125rem;
		color: var(--m365-text-leise);
	}
	.an-ampel dd {
		margin: 0;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.an-ampel dd.minus {
		color: var(--m365-fehler);
	}
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
	.an-zuordnen {
		margin: 0.75rem 0;
	}
	.an-zuordnen-art {
		display: flex;
		gap: 1.25rem;
		margin-bottom: 0.5rem;
	}
	.an-zuordnen-art label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: var(--tippziel, 44px);
	}
	.an-treffer {
		width: 100%;
		min-height: var(--tippziel, 44px);
		text-align: left;
		background: none;
		border: none;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		font: inherit;
	}
	.an-vorlage-wahl {
		display: grid;
		gap: 0.5rem;
	}
	.an-vorlage-wahl select {
		min-height: var(--tippziel, 44px);
	}
	@media (min-width: 700px) {
		.an-vorlage-wahl {
			grid-template-columns: minmax(0, 1fr) auto;
		}
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
