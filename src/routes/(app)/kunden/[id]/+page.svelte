<script lang="ts">
	import { enhance } from '$app/forms';
	import { STATUS_NAMEN } from '$lib/auftrag-status';
	import { berlinTag, berlinUhrzeit, tagDeutsch } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const k = $derived(data.kunde);
	const adresse = $derived([k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '));
	const ansprechpartner = $derived([k.anrede, k.vorname, k.nachname].filter(Boolean).join(' '));

	const wann = (iso: string) => {
		const d = new Date(iso);
		return `${tagDeutsch(berlinTag(d))}, ${berlinUhrzeit(d)}`;
	};
	const groesse = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
	let notizText = $state('');
</script>

<svelte:head>
	<title>{k.name}</title>
</svelte:head>

<main class="kd-seite">
	<a href="/kunden" class="kd-zurueck">← Kunden</a>
	<h1>{k.name}</h1>
	<p class="kd-info">{k.art === 'firma' ? 'Firmenkunde' : 'Privatkunde'}</p>

	<dl class="kd-daten">
		{#if k.art === 'firma' && ansprechpartner}
			<dt>Ansprechpartner</dt>
			<dd>{ansprechpartner}</dd>
		{:else if k.art === 'privat' && k.anrede}
			<dt>Anrede</dt>
			<dd>{k.anrede}</dd>
		{/if}
		{#if k.telefon}
			<dt>Telefon</dt>
			<dd><a href={`tel:${k.telefon.replace(/[^0-9+]/g, '')}`}>{k.telefon}</a></dd>
		{/if}
		{#if k.email}
			<dt>E-Mail</dt>
			<dd><a href={`mailto:${k.email}`}>{k.email}</a></dd>
		{/if}
		{#if adresse}
			<dt>Adresse</dt>
			<dd>{adresse}</dd>
		{/if}
		{#if k.notiz}
			<dt>Notiz</dt>
			<dd>{k.notiz}</dd>
		{/if}
	</dl>

	{#if data.darfBearbeiten}
		<a href={`/kunden/${k.id}/bearbeiten`} class="kd-knopf hell">Kunde bearbeiten</a>
	{/if}

	<h2>Objekte</h2>
	<ul class="kd-liste">
		{#each data.objekte as objekt (objekt.id)}
			<li>
				<a href={`/kunden/${k.id}/objekte/${objekt.id}`}>
					<strong>{objekt.bezeichnung}</strong>
					{#if objekt.strasse || objekt.ort}
						<span class="kd-info">
							{[objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
						</span>
					{/if}
				</a>
			</li>
		{:else}
			<li class="kd-leer">Noch keine Objekte (Baustellen) angelegt.</li>
		{/each}
	</ul>
	{#if data.darfBearbeiten}
		<a href={`/kunden/${k.id}/objekte/neu`} class="kd-knopf hell">+ Objekt</a>
	{/if}

	{#if data.auftraege}
		<h2>Aufträge</h2>
		<ul class="kd-liste">
			{#each data.auftraege as auftrag (auftrag.id)}
				<li>
					<a href={`/auftraege/${auftrag.id}`}>
						<strong>{auftrag.titel}</strong>
						<span class="kd-info">{auftrag.nummer} · {STATUS_NAMEN[auftrag.status]}</span>
					</a>
				</li>
			{:else}
				<li class="kd-leer">Noch keine Aufträge.</li>
			{/each}
		</ul>
		{#if data.darfAuftragAnlegen}
			<a href={`/auftraege/neu?kunde=${k.id}`} class="kd-knopf hell">+ Auftrag</a>
		{/if}
	{/if}

	<h2>Notizen</h2>
	{#if data.darfBearbeiten}
		<form
			method="POST"
			action="?/notizAnlegen"
			class="kd-formular ka-notiz-neu"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') notizText = '';
				}}
		>
			{#if form?.notizFehler}<p role="alert" class="kd-fehler">{form.notizFehler}</p>{/if}
			<label>
				Neue Notiz
				<textarea name="text" bind:value={notizText} maxlength="10000" rows="3" required placeholder="z. B. Hund im Garten – bitte klingeln"></textarea>
			</label>
			<button type="submit" class="kd-knopf">Notiz speichern</button>
		</form>
	{/if}
	<ul class="kd-liste ka-notizen" aria-label="Notizen">
		{#each data.notizen as n (n.id)}
			<li>
				<p class="ka-text">{n.text}</p>
				<span class="kd-info">{wann(n.angelegt)}{n.vonName ? ` · ${n.vonName}` : ''}</span>
				{#if data.darfBearbeiten}
					<form method="POST" action="?/notizLoeschen" use:enhance class="ka-loeschen">
						<input type="hidden" name="id" value={n.id} />
						<button type="submit" class="kd-knopf hell" aria-label="Notiz vom {wann(n.angelegt)} löschen">Löschen</button>
					</form>
				{/if}
			</li>
		{:else}
			<li class="kd-leer">Noch keine Notizen.</li>
		{/each}
	</ul>

	<h2>Dokumente</h2>
	{#if data.darfBearbeiten}
		<form method="POST" action="?/dokumentHochladen" enctype="multipart/form-data" use:enhance class="kd-formular ka-dokument-neu">
			{#if form?.dokumentFehler}<p role="alert" class="kd-fehler">{form.dokumentFehler}</p>{/if}
			<label>
				Datei (PDF, Bild, Word, Excel – höchstens 5 MB)
				<input
					type="file"
					name="datei"
					required
					accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx,application/pdf,image/jpeg,image/png,image/webp,image/heic"
				/>
			</label>
			<label>Beschreibung (optional) <input type="text" name="beschreibung" maxlength="500" /></label>
			<button type="submit" class="kd-knopf">Hochladen</button>
		</form>
	{/if}
	<ul class="kd-liste ka-dokumente" aria-label="Dokumente">
		{#each data.dokumente as d (d.id)}
			<li>
				<a href={`/kunden/${k.id}/dokumente/${d.id}`} download={d.name}>
					<strong>{d.name}</strong>
					<span class="kd-info">
						{groesse(d.groesse)} · {wann(d.angelegt)}{d.vonName ? ` · ${d.vonName}` : ''}{d.beschreibung ? ` · ${d.beschreibung}` : ''}
					</span>
				</a>
				{#if data.darfBearbeiten}
					<form method="POST" action="?/dokumentLoeschen" use:enhance class="ka-loeschen">
						<input type="hidden" name="id" value={d.id} />
						<button type="submit" class="kd-knopf hell" aria-label="Dokument {d.name} löschen">Löschen</button>
					</form>
				{/if}
			</li>
		{:else}
			<li class="kd-leer">Noch keine Dokumente.</li>
		{/each}
	</ul>

	<h2>Kundenportal</h2>
	<section class="ka-portal" aria-label="Kundenportal">
		<p class="kd-info">
			Bald: Hier richten Sie das Kundenportal für diesen Kunden ein (Zugang, freigegebene Angebote und Dokumente) und können es
			direkt öffnen.
		</p>
		<button type="button" class="kd-knopf hell" disabled>Kundenportal öffnen (in Vorbereitung)</button>
	</section>

	<h2>Verlauf</h2>
	<ol class="kd-verlauf">
		{#each data.verlauf as eintrag (eintrag.id)}
			<li>
				<strong>{eintrag.titel}</strong> · {eintrag.zeit} · {eintrag.wer}
				{#if eintrag.aenderungen.length > 0}
					<ul>
						{#each eintrag.aenderungen as a (a.feld)}
							<li class="kd-info">{a.feld}: {a.alt} → {a.neu}</li>
						{/each}
					</ul>
				{/if}
			</li>
		{:else}
			<li class="kd-leer">Noch keine Einträge.</li>
		{/each}
	</ol>
	{#if data.verlaufGekuerzt}
		<p class="kd-info">Ältere Einträge werden hier nicht angezeigt.</p>
	{/if}

	{#if data.darfBearbeiten}
		<details class="kd-loeschen">
			<summary>Kunde löschen …</summary>
			<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
				{#if form?.fehler && !form?.notizFehler && !form?.dokumentFehler}
					<p role="alert" class="kd-fehler">{form.fehler}</p>
				{/if}
				<p>
					Der Kunde und alle seine Objekte werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.
				</p>
				<button type="submit" class="kd-knopf gefahr">Endgültig löschen</button>
			</form>
		</details>
	{/if}
</main>

<style>
	.ka-notizen li,
	.ka-dokumente li {
		display: grid;
		gap: 0.25rem;
	}
	.ka-text {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.ka-loeschen {
		justify-self: start;
	}
	.ka-notiz-neu,
	.ka-dokument-neu {
		margin-bottom: 0.75rem;
	}
	.ka-portal {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
	}
	.ka-portal :disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
