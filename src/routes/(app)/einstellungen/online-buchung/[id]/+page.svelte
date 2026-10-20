<script lang="ts">
	/**
	 * Dienst der Online-Buchung bearbeiten (Wunsch Jamil msgs 2684/2686): Angaben (Dauer, Puffer, Vorlauf, Horizont,
	 * Tagesgrenze, Ort, Farbe), Mitarbeiter (fest/abwechselnd), eigene Fragen an den Kunden (gleicher Baukasten wie bei
	 * den Protokoll-Vorlagen), Buchungslinks mit Einbett-Code für die Website.
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import FormularBaukasten from '$lib/components/protokoll/FormularBaukasten.svelte';
	import { ADRESSE_ARTEN, FRAGE_TYPEN, MODI, MODUS_NAMEN, ORT_ARTEN, ORT_NAMEN, type AdresseArt } from '$lib/buchung';
	import { EINSATZ_ARTEN, EINSATZ_ART_NAMEN } from '$lib/einsatz-art';
	import { neueId, pruefeSchema, SchemaFehler, type Schema } from '$lib/protokoll-formular';
	import { berlinTag, berlinUhrzeit, tagKurz } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const d = $derived(data.dienst);

	const ADRESSE_NAMEN: Record<AdresseArt, string> = { pflicht: 'abfragen (Pflicht)', optional: 'abfragen (freiwillig)', aus: 'nicht abfragen' };
	const VORLAUF = [
		[0, 'keiner'],
		[120, '2 Stunden'],
		[240, '4 Stunden'],
		[1440, '1 Tag'],
		[2880, '2 Tage'],
		[4320, '3 Tage'],
		[10080, '1 Woche']
	] as const;

	const mitSchritt = (s: Schema): Schema =>
		s.seiten.length > 0 ? structuredClone(s) : { seiten: [{ id: neueId('s'), titel: 'Fragen', abschnitte: [{ id: neueId('a'), felder: [] }] }] };
	let fragen = $state(untrack(() => mitSchritt(data.dienst.fragen)));
	let gewaehlt = $state<string[]>(untrack(() => data.dienst.mitarbeiter.map((m) => m.id)));
	let modus = $state(untrack(() => data.dienst.modus));
	const fragenFehler = $derived.by(() => {
		try {
			pruefeSchema($state.snapshot(fragen), { typen: FRAGE_TYPEN, maxSeiten: 1, leerErlaubt: true });
			return null;
		} catch (e) {
			return e instanceof SchemaFehler ? e.message : 'Ungültige Fragen';
		}
	});

	const fehlerIn = (b: string) => (form && form.bereich === b && 'fehler' in form ? (form.fehler as string) : null);
	const okIn = (b: string) => !!(form && form.bereich === b && 'ergebnis' in form && !('fehler' in form));

	const linkUrl = (token: string) => `${data.basis}/buchen/${token}`;
	const einbettCode = (token: string) =>
		`<iframe src="${linkUrl(token)}" id="crm-buchung-${token.slice(0, 8)}" title="Termin buchen" loading="lazy" style="width:100%;min-height:720px;border:0"></iframe>\n` +
		`<script>window.addEventListener('message',function(e){if(e.origin!=='${data.basis}')return;var d=e.data;if(d&&d.typ==='crm-buchung-hoehe'){var f=document.getElementById('crm-buchung-${token.slice(0, 8)}');if(f)f.style.height=d.hoehe+'px';}});<\/script>`;

	let kopiert = $state<string | null>(null);
	async function kopiere(text: string, schluessel: string) {
		try {
			await navigator.clipboard.writeText(text);
			kopiert = schluessel;
			setTimeout(() => kopiert === schluessel && (kopiert = null), 2500);
		} catch {
			kopiert = null;
			prompt('Bitte kopieren:', text);
		}
	}

	const ohneLink = $derived(d.mitarbeiter.filter((m) => !d.links.some((l) => l.benutzerId === m.id)));
	const wann = (iso: string) => `${tagKurz(berlinTag(new Date(iso)))} ${berlinUhrzeit(new Date(iso))}`;
	const nachSpeichern = () => async ({ update, result }: { update: (o?: { reset?: boolean }) => Promise<void>; result: { type: string } }) => {
		await update({ reset: false });
		if (result.type === 'success') {
			fragen = mitSchritt(data.dienst.fragen);
			gewaehlt = data.dienst.mitarbeiter.map((m) => m.id);
		}
	};
	const sofort = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head>
	<title>{d.name} – Online-Buchung</title>
</svelte:head>

<main class="kd-seite breit ob-seite">
	<a href="/einstellungen/online-buchung" class="kd-zurueck">← Online-Buchung</a>
	<h1><span class="ob-farbe" style={`background:${d.farbe}`} aria-hidden="true"></span>{d.name}</h1>

	<form method="POST" action="?/speichern" use:enhance={nachSpeichern} class="ob-form" id="dienst-form">
		<Abschnitt titel="Angaben">
			<div class="kd-formular">
				<label>Name <input type="text" name="name" maxlength="100" required value={d.name} /></label>
				<label>Beschreibung für den Kunden (optional) <textarea name="beschreibung" rows="3" maxlength="2000">{d.beschreibung ?? ''}</textarea></label>
				<div class="ob-raster">
					<label>Dauer (Minuten) <input type="number" name="dauerMin" min="5" max="720" step="5" required value={d.dauerMin} /></label>
					<label>Puffer davor (Min.) <input type="number" name="pufferVorMin" min="0" max="240" step="5" value={d.pufferVorMin} /></label>
					<label>Puffer danach (Min.) <input type="number" name="pufferNachMin" min="0" max="240" step="5" value={d.pufferNachMin} /></label>
					<label>
						Mindestvorlauf
						<select name="vorlaufMin">
							{#each VORLAUF as [min, text] (min)}<option value={min} selected={d.vorlaufMin === min}>{text}</option>{/each}
							{#if !VORLAUF.some(([m]) => m === d.vorlaufMin)}<option value={d.vorlaufMin} selected>{d.vorlaufMin} Minuten</option>{/if}
						</select>
					</label>
					<label>Buchbar bis (Tage im Voraus) <input type="number" name="horizontTage" min="1" max="365" value={d.horizontTage} /></label>
					<label>Höchstens je Tag und Mitarbeiter <input type="number" name="maxProTag" min="1" max="50" placeholder="ohne Grenze" value={d.maxProTag ?? ''} /></label>
				</div>
				<div class="ob-raster">
					<label>
						Ort
						<select name="ortArt">{#each ORT_ARTEN as o (o)}<option value={o} selected={d.ortArt === o}>{ORT_NAMEN[o]}</option>{/each}</select>
					</label>
					<label>
						Adresse des Kunden
						<select name="adresse">{#each ADRESSE_ARTEN as a (a)}<option value={a} selected={d.adresse === a}>{ADRESSE_NAMEN[a]}</option>{/each}</select>
					</label>
					<label>
						Art in der Plantafel
						<select name="einsatzArt">{#each EINSATZ_ARTEN as a (a)}<option value={a} selected={d.einsatzArt === a}>{EINSATZ_ART_NAMEN[a]}</option>{/each}</select>
					</label>
					<label>
						Auftragsquelle
						<select name="quelleId">
							<option value="" selected={!d.quelleId}>Online-Buchung (Standard)</option>
							{#each data.quellen as q (q.id)}<option value={q.id} selected={d.quelleId === q.id}>{q.name}</option>{/each}
						</select>
					</label>
					<label class="ob-farbwahl">Farbe <input type="color" name="farbe" value={d.farbe} /></label>
				</div>
				<Schalter name="aktiv" an={d.aktiv} label="Buchbar (aktiv)" hinweis="ausgeschaltet: Links zeigen „nicht gültig“" />
			</div>
		</Abschnitt>

		<Abschnitt titel="Mitarbeiter">
			<fieldset class="ob-wahl">
				<legend>Wer wird gebucht?</legend>
				{#each MODI as m (m)}
					<label class="kd-haken"><input type="radio" name="modus" value={m} bind:group={modus} /> {MODUS_NAMEN[m]}</label>
				{/each}
			</fieldset>
			<input type="hidden" name="mitarbeiterGesendet" value="1" />
			<div class="ob-personen" role="group" aria-label="Mitarbeiter">
				{#each data.mitarbeiter as m (m.id)}
					<label class="kd-haken ob-person">
						<input
							type={modus === 'fest' ? 'radio' : 'checkbox'}
							name="mitarbeiter"
							value={m.id}
							checked={gewaehlt.includes(m.id)}
							onchange={(e) => (gewaehlt = modus === 'fest' ? [m.id] : e.currentTarget.checked ? [...gewaehlt, m.id] : gewaehlt.filter((x) => x !== m.id))}
						/>
						<Avatar name={m.name} groesse={24} />
						{m.name}
					</label>
				{/each}
			</div>
			<p class="kd-info">
				Bucht ein Kunde, bekommt er nur einen dieser Mitarbeiter – bei „abwechselnd“ den, der am wenigsten Buchungen hat. Freie Zeiten kommen aus den
				<a href="/einstellungen/online-buchung/zeiten">Arbeitszeiten</a>.
			</p>
		</Abschnitt>

		<Abschnitt titel="Fragen an den Kunden">
			<p class="kd-info ob-intro">
				Immer abgefragt: Vorname, Name, E-Mail, Telefon und (je nach Einstellung) die Adresse. Dazu eigene Fragen – Text, Auswahl, Ja/Nein, Zahl, Datum,
				Foto – auch mit Bedingung („nur zeigen, wenn …“).
			</p>
			<FormularBaukasten bind:schema={fragen} typen={FRAGE_TYPEN} mehrereSchritte={false} hinweisVorgabe="Text für den Kunden" />
			<input type="hidden" name="fragen" value={JSON.stringify(fragen)} />
		</Abschnitt>

		<div class="ob-leiste" role="region" aria-label="Speichern">
			{#if fragenFehler}<p class="kd-fehler">{fragenFehler}</p>{:else if fehlerIn('dienst')}<p class="kd-fehler" role="alert">{fehlerIn('dienst')}</p>{:else if okIn('dienst')}<p class="ob-ok" role="status">Gespeichert.</p>{/if}
			<button type="submit" class="kd-knopf" disabled={!!fragenFehler} data-testid="dienst-speichern">Speichern</button>
		</div>
	</form>

	<Abschnitt titel="Buchungslinks" anzahl={d.links.length}>
		{#if fehlerIn('links')}<p class="kd-fehler" role="alert">{fehlerIn('links')}</p>{/if}
		<ul class="ob-links">
			{#each d.links as l (l.id)}
				<li class:aus={!l.aktiv}>
					<div class="ob-link-kopf">
						<strong>{l.benutzerId ? `Nur ${l.benutzerName}` : 'Alle Mitarbeiter des Dienstes'}</strong>
						{#if !l.aktiv}<span class="badge badge-rot">aus</span>{/if}
					</div>
					<div class="ob-link-zeile">
						<input type="text" readonly value={linkUrl(l.token)} aria-label="Buchungslink" onfocus={(e) => e.currentTarget.select()} data-testid="buchungslink" />
						<button type="button" class="kd-knopf" onclick={() => kopiere(linkUrl(l.token), l.id)}>{kopiert === l.id ? 'Kopiert ✓' : 'Kopieren'}</button>
						<a class="kd-knopf hell" href={linkUrl(l.token)} target="_blank" rel="noopener">Öffnen</a>
					</div>
					<div class="ob-link-zeile">
						<form method="POST" action="?/linkAendern" use:enhance={sofort} class="ob-inline">
							<input type="hidden" name="id" value={l.id} />
							<input type="hidden" name="aktivGesendet" value="1" />
							<label>
								Auftragsquelle
								<select name="quelleId" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
									<option value="" selected={!l.quelleId}>wie Dienst</option>
									{#each data.quellen as q (q.id)}<option value={q.id} selected={l.quelleId === q.id}>{q.name}</option>{/each}
								</select>
							</label>
							<label class="kd-haken"><input type="checkbox" name="aktiv" checked={l.aktiv} onchange={(e) => e.currentTarget.form?.requestSubmit()} /> aktiv</label>
						</form>
						<form method="POST" action="?/linkNeu" use:enhance={sofort} onsubmit={(e) => !confirm('Neuen Link erzeugen? Der bisherige Link funktioniert dann nicht mehr.') && e.preventDefault()}>
							<input type="hidden" name="id" value={l.id} />
							<button type="submit" class="knopf-subtil klein">Neuer Link</button>
						</form>
						{#if l.benutzerId}
							<form method="POST" action="?/linkLoeschen" use:enhance={sofort}>
								<input type="hidden" name="id" value={l.id} />
								<button type="submit" class="knopf-subtil klein">Entfernen</button>
							</form>
						{/if}
					</div>
					<details class="ob-einbetten">
						<summary>Auf der Website einbetten</summary>
						<textarea readonly rows="5" value={einbettCode(l.token)} aria-label="Einbett-Code" onfocus={(e) => e.currentTarget.select()}></textarea>
						<button type="button" class="kd-knopf hell" onclick={() => kopiere(einbettCode(l.token), `code-${l.id}`)}>{kopiert === `code-${l.id}` ? 'Kopiert ✓' : 'Code kopieren'}</button>
						<p class="kd-info">
							{#if data.einstellungen.einbettenDomains.length === 0}
								Achtung: Es ist noch keine Website zum Einbetten eingetragen (<a href="/einstellungen/online-buchung">Online-Buchung → Datenschutz und Website</a>). Bis dahin nur den Link verwenden.
							{:else}
								Erlaubt auf: {data.einstellungen.einbettenDomains.join(', ')}
							{/if}
						</p>
					</details>
				</li>
			{/each}
		</ul>
		{#if ohneLink.length > 0}
			<form method="POST" action="?/linkAnlegen" use:enhance={sofort} class="ob-inline">
				<label>
					Eigener Link für einen Mitarbeiter
					<select name="benutzerId">{#each ohneLink as m (m.id)}<option value={m.id}>{m.name}</option>{/each}</select>
				</label>
				<button type="submit" class="kd-knopf hell">Link anlegen</button>
			</form>
		{/if}
	</Abschnitt>

	<Abschnitt titel="Kommende Buchungen" anzahl={data.buchungen.filter((b) => b.status === 'aktiv').length}>
		{#if data.buchungen.length === 0}
			<p class="kd-leer">Noch keine Buchungen für diesen Dienst.</p>
		{:else}
			<ul class="kd-liste">
				{#each data.buchungen as b (b.id)}
					<li class:ob-abgesagt={b.status !== 'aktiv'}>
						<strong>{wann(b.beginn)}</strong> – {b.kundeName} · {b.mitarbeiterName}
						{#if b.auftragId}<a href={`/auftraege/${b.auftragId}`}>Auftrag</a>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Abschnitt>

	<form method="POST" action="?/loeschen" use:enhance={sofort} onsubmit={(e) => !confirm(`Dienst „${d.name}“ löschen?`) && e.preventDefault()}>
		{#if fehlerIn('loeschen')}<p class="kd-fehler" role="alert">{fehlerIn('loeschen')}</p>{/if}
		{#if form?.bereich === 'loeschen' && 'ergebnis' in form && form.ergebnis === 'deaktiviert'}
			<p class="kt-hinweis" role="status">Der Dienst hat Buchungen und wurde deshalb nur ausgeschaltet.</p>
		{/if}
		<button type="submit" class="kd-knopf gefahr">Dienst löschen</button>
	</form>
</main>

<style>
	.ob-seite {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	h1 {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.ob-farbe {
		width: 1rem;
		height: 1rem;
		border-radius: 999px;
		flex: none;
	}
	.ob-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.ob-intro {
		line-height: 1.7;
		margin-top: 0;
	}
	.ob-raster {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.75rem;
	}
	.ob-farbwahl input {
		width: 4rem !important;
		height: 2.5rem;
		padding: 0.15rem !important;
	}
	.ob-wahl {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0 0 0.75rem;
		padding: 0.5rem 0.75rem 0.75rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
	}
	.ob-wahl legend {
		font-weight: 600;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.ob-personen {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 0.35rem 1rem;
	}
	.ob-person {
		display: flex !important;
		align-items: center;
		gap: 0.5rem;
	}
	.ob-leiste {
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom, 0px));
		background: linear-gradient(to bottom, transparent, var(--ui-hintergrund) 25%);
	}
	.ob-leiste p {
		margin: 0;
	}
	.ob-ok {
		color: var(--ui-gruen);
		font-weight: 600;
	}
	.ob-links {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.ob-links > li {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
	}
	.ob-links > li.aus {
		background: var(--ui-grau-hell);
	}
	.ob-link-kopf {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.ob-link-zeile {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem;
	}
	.ob-link-zeile input[type='text'] {
		flex: 1 1 16rem;
		width: auto !important;
		font-family: ui-monospace, monospace;
		font-size: var(--ui-schrift-s);
	}
	.ob-inline {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
	}
	.ob-inline label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: var(--ui-schrift-s);
		font-weight: 600;
		color: var(--ui-text-leise);
	}
	.ob-einbetten textarea {
		width: 100%;
		font-family: ui-monospace, monospace;
		font-size: var(--ui-schrift-xs);
		margin: 0.5rem 0;
	}
	.ob-einbetten summary {
		cursor: pointer;
		color: var(--ui-akzent-text);
		font-weight: 600;
	}
	.ob-abgesagt {
		text-decoration: line-through;
		color: var(--ui-text-leise);
	}
</style>
