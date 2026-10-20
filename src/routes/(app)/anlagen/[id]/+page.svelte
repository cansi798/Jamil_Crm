<script lang="ts">
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import AnlageFormular from '$lib/components/AnlageFormular.svelte';
	import { extraAnzeige } from '$lib/anlagen-typen';
	import { berlinTag } from '$lib/zeit';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const a = $derived(data.anlage);
	const v = $derived(data.verlauf);
	const deutsch = (tag: string | null) => (tag ? `${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)}` : '');
	const datumZeit = (iso: string) =>
		new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(iso));
	const groesse = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
	const heute = berlinTag(new Date());
	const garantieAbgelaufen = $derived(!!a.garantieBis && a.garantieBis < heute);
	const zusatz = $derived(extraAnzeige(a.typ, a.extra));
	const fehlerVon = (aktion: string) => (form && 'aktion' in form && form.aktion === aktion ? ((form as { fehler?: string }).fehler ?? null) : null);

	const bearbeitenWerte = $derived(
		form && 'aktion' in form && form.aktion === 'speichern' && 'werte' in form && form.werte
			? (form.werte as Record<string, string>)
			: {
					typ: a.typ,
					bezeichnung: a.bezeichnung,
					hersteller: a.hersteller ?? '',
					modell: a.modell ?? '',
					seriennummer: a.seriennummer ?? '',
					baujahr: a.baujahr ? String(a.baujahr) : '',
					einbaudatum: a.einbaudatum ?? '',
					standort: a.standort ?? '',
					garantieBis: a.garantieBis ?? '',
					wartungRegel: a.wartungRegel ?? '',
					wartungIntervall: a.wartungIntervall ? String(a.wartungIntervall) : '',
					notiz: a.notiz ?? '',
					...Object.fromEntries(Object.entries(a.extra).map(([k, w]) => [`extra_${k}`, String(w)]))
				}
	);
	const auftragLink = $derived(`/auftraege/neu?kunde=${a.kundeId}&objektId=${a.objektId}&anlageId=${a.id}&titel=${encodeURIComponent(`${a.bezeichnung}: `)}`);
	let bearbeitenOffen = $state(false);
	$effect(() => {
		if (form && 'aktion' in form && form.aktion === 'speichern') bearbeitenOffen = !('gespeichert' in form);
	});
</script>

<svelte:head>
	<title>{a.bezeichnung}</title>
</svelte:head>

<main class="kd-seite">
	<a href={`/kunden/${a.kundeId}/objekte/${a.objektId}`} class="kd-zurueck">← {a.objektBezeichnung} ({a.kundeName})</a>
	<h1>{a.bezeichnung}</h1>
	<p class="kd-info">{a.typName}{#if a.objektAdresse} · {a.objektAdresse}{/if}</p>

	{#if a.offeneStoerungen > 0}
		<p class="an-stoerung" role="status">{a.offeneStoerungen} offene Störung{a.offeneStoerungen === 1 ? '' : 'en'}</p>
	{/if}

	<div class="kd-aktionen an-schnell">
		<details class="an-neu" open={!!fehlerVon('stoerung')}>
			<summary class="kd-knopf">Störung melden</summary>
			<form method="POST" action="?/stoerung" use:enhance class="kd-formular">
				{#if fehlerVon('stoerung')}<p role="alert" class="kd-fehler">{fehlerVon('stoerung')}</p>{/if}
				<label>
					Was ist gestört? *
					<input type="text" name="titel" maxlength="200" required placeholder="z. B. Fehler E42, läuft nicht an" />
				</label>
				<label>
					Details (optional)
					<textarea name="beschreibung" maxlength="2000" rows="3"></textarea>
				</label>
				<button type="submit" class="kd-knopf">Störung speichern</button>
			</form>
		</details>
		{#if data.darfAuftrag}
			<a class="kd-knopf hell" href={auftragLink}>+ Auftrag zu dieser Anlage</a>
		{/if}
	</div>

	<section class="an-abschnitt" aria-labelledby="daten-titel">
		<h2 id="daten-titel">Daten</h2>
		<dl class="kd-daten">
			<dt>Typ</dt>
			<dd>{a.typName}</dd>
			{#if a.hersteller || a.modell}<dt>Hersteller / Modell</dt><dd>{[a.hersteller, a.modell].filter(Boolean).join(' · ')}</dd>{/if}
			{#if a.seriennummer}<dt>Seriennummer</dt><dd>{a.seriennummer}</dd>{/if}
			{#if a.baujahr}<dt>Baujahr</dt><dd>{a.baujahr}</dd>{/if}
			{#if a.einbaudatum}<dt>Einbaudatum</dt><dd>{deutsch(a.einbaudatum)}</dd>{/if}
			{#if a.standort}<dt>Standort im Objekt</dt><dd>{a.standort}</dd>{/if}
			{#if a.garantieBis}
				<dt>Garantie bis</dt>
				<dd>{deutsch(a.garantieBis)}{#if garantieAbgelaufen} <strong class="td-ueberfaellig">(abgelaufen)</strong>{/if}</dd>
			{/if}
			<dt>Wartung</dt>
			<dd>{a.wartungText ?? 'kein Intervall'}</dd>
			{#each zusatz as z (z.name)}<dt>{z.name}</dt><dd>{z.wert}</dd>{/each}
			{#if a.notiz}<dt>Notiz</dt><dd class="an-notiz">{a.notiz}</dd>{/if}
		</dl>
	</section>

	{#if data.darfWartung && a.wartungRegel}
		<section class="an-abschnitt" aria-labelledby="wartung-titel">
			<h2 id="wartung-titel">Wartung planen</h2>
			<form method="POST" action="?/wartung" use:enhance class="kd-formular">
				{#if fehlerVon('wartung')}<p role="alert" class="kd-fehler">{fehlerVon('wartung')}</p>{/if}
				{#if form && 'aktion' in form && form.aktion === 'wartung' && 'gespeichert' in form}
					<p role="status" class="kd-info">Wartung geplant – die Aufgabe wiederholt sich {a.wartungText}.</p>
				{/if}
				<div class="kd-zwei an-zwei-spalten">
					<label>Erste Wartung <input type="date" name="faellig" value={heute} required /></label>
					<div class="ui-feld">
						Zuständig
						<PersonWahl name="zustaendigId" personen={data.mitarbeiter} />
					</div>
				</div>
				<button type="submit" class="kd-knopf hell">Wartung {a.wartungText} als Aufgabe planen</button>
			</form>
		</section>
	{/if}

	<section class="an-abschnitt" aria-labelledby="qr-titel">
		<h2 id="qr-titel">QR-Code</h2>
		<div class="an-qr">
			<img src={data.qrBild} alt="QR-Code dieser Anlage" width="128" height="128" />
			<div>
				<p class="kd-info">
					Mitarbeiter landen beim Scannen hier. Kunden sehen nur „Störung melden“ mit Ihren Kontaktdaten – keine Kundendaten.
				</p>
				<p class="kd-info">Link: <code class="an-qr-link">{data.qrUrl}</code></p>
				<div class="kd-aktionen">
					<a class="kd-knopf hell" href={`/anlagen/${a.id}/etikett`} target="_blank" rel="noopener">Etikett (PDF)</a>
					<a class="kd-knopf hell" href={`/anlagen/${a.id}/etikett?format=bogen`} target="_blank" rel="noopener">A4-Bogen (24 Etiketten)</a>
				</div>
			</div>
		</div>
	</section>

	<section class="an-abschnitt" aria-labelledby="verlauf-titel">
		<h2 id="verlauf-titel">Verlauf</h2>
		<h3>Störungen ({v.stoerungen.length})</h3>
		{#if v.stoerungen.length === 0}
			<p class="kd-info">Keine Störungen.</p>
		{:else}
			<ul class="an-verlauf">
				{#each v.stoerungen as s (s.id)}
					<li>
						<span class:erledigt={!!s.behobenAm}>
							<strong>{s.titel}</strong>{#if s.beschreibung} – {s.beschreibung}{/if}
						</span>
						<span class="kd-info">
							{datumZeit(s.angelegt)}{#if s.vonName} · {s.vonName}{/if}{#if s.quelle === 'qr'} · per QR-Code{/if}
							{#if s.behobenAm} · behoben {datumZeit(s.behobenAm)}{/if}
							{#if data.darfBearbeiten}
								<form method="POST" action="?/stoerungBehoben" use:enhance class="an-zeile-formular">
									<input type="hidden" name="id" value={s.id} />
									<input type="hidden" name="behoben" value={s.behobenAm ? 'nein' : 'ja'} />
									<button type="submit" class="kd-knopf hell klein">{s.behobenAm ? 'wieder öffnen' : 'behoben'}</button>
								</form>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		<h3>Aufträge ({v.auftraege.length})</h3>
		{#if v.auftraege.length === 0}
			<p class="kd-info">Noch keine Aufträge zu dieser Anlage.</p>
		{:else}
			<ul class="an-verlauf">
				{#each v.auftraege as au (au.id)}
					<li>
						<a href={`/auftraege/${au.id}`}><strong>{au.nummer}</strong> {au.titel}</a>
						<span class="kd-info">{datumZeit(au.angelegt)}</span>
					</li>
				{/each}
			</ul>
		{/if}

		<h3>Aufgaben ({v.todos.length})</h3>
		{#if v.todos.length === 0}
			<p class="kd-info">Keine Aufgaben (Wartung, Garantie-Erinnerung).</p>
		{:else}
			<ul class="an-verlauf">
				{#each v.todos as t (t.id)}
					<li>
						<span class:erledigt={t.erledigt}>{t.titel}</span>
						<span class="kd-info">
							{#if t.faellig}fällig {deutsch(t.faellig)}{/if}{#if t.serieText} · {t.serieAktiv ? 'wiederholt sich' : 'Wiederholung beendet'}: {t.serieText}{/if}
						</span>
					</li>
				{/each}
			</ul>
			<p class="kd-info"><a href="/todos">Zu den Aufgaben</a></p>
		{/if}
	</section>

	<section class="an-abschnitt" aria-labelledby="dateien-titel">
		<h2 id="dateien-titel">Fotos und Dokumente ({data.dateien.length})</h2>
		{#if data.dateien.length > 0}
			<ul class="an-verlauf">
				{#each data.dateien as d (d.id)}
					<li>
						<a href={`/anlagen/${a.id}/dateien/${d.id}`}>{d.name}</a>
						<span class="kd-info">
							{groesse(d.groesse)} · {datumZeit(d.angelegt)}{#if d.beschreibung} · {d.beschreibung}{/if}
							{#if data.darfBearbeiten}
								<form method="POST" action="?/dateiLoeschen" use:enhance class="an-zeile-formular">
									<input type="hidden" name="id" value={d.id} />
									<button type="submit" class="kd-knopf hell klein" aria-label={`${d.name} löschen`}>löschen</button>
								</form>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if data.darfBearbeiten}
			<form method="POST" action="?/datei" enctype="multipart/form-data" use:enhance class="kd-formular an-datei">
				{#if fehlerVon('datei')}<p role="alert" class="kd-fehler">{fehlerVon('datei')}</p>{/if}
				<label>
					Foto oder Dokument (PDF, Bild, Word, Excel – bis 5 MB)
					<input type="file" name="datei" required accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,.docx,.xlsx" />
				</label>
				<label>Beschreibung (optional) <input type="text" name="beschreibung" maxlength="500" placeholder="z. B. Typenschild" /></label>
				<button type="submit" class="kd-knopf hell">Hochladen</button>
			</form>
		{/if}
	</section>

	{#if data.darfBearbeiten}
		<details class="an-neu an-abschnitt" bind:open={bearbeitenOffen}>
			<summary class="kd-knopf hell">Anlage bearbeiten</summary>
			<AnlageFormular aktion="?/speichern" werte={bearbeitenWerte} fehler={fehlerVon('speichern')} />
		</details>
		<details class="kd-loeschen">
			<summary>Anlage löschen …</summary>
			<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
				<p>Die Anlage wird mit Störungen, Fotos und Dokumenten gelöscht. Aufträge und Aufgaben bleiben erhalten.</p>
				<button type="submit" class="kd-knopf gefahr">Endgültig löschen</button>
			</form>
		</details>
	{/if}
</main>
