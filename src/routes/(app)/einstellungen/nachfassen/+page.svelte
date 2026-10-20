<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Karte from '$lib/components/Karte.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import {
		BEISPIEL_WERTE,
		fuelle,
		htmlZuText,
		mitSignatur,
		NACHFASS_ART_NAMEN,
		NACHFASS_ARTEN,
		PLATZHALTER,
		ZUWEISUNG_NAMEN,
		ZUWEISUNGEN,
		type NachfassArt
	} from '$lib/nachfassen';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Stufe = PageData['stufen'][number];
	const fehlerIn = (bereich: string) => (form && 'bereich' in form && form.bereich === bereich && 'fehler' in form ? (form.fehler as string) : null);
	const wert = (bereich: string, feld: string, gespeichert: string) =>
		form && 'bereich' in form && form.bereich === bereich && 'werte' in form && form.werte && 'fehler' in form
			? ((form.werte as Record<string, string>)[feld] ?? '')
			: gespeichert;
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });

	const vorlageName = (id: string | null) => data.vorlagen.find((v) => v.id === id)?.name ?? '–';
	const wer = (s: Stufe) =>
		s.zuweisung === 'fest'
			? (data.mitarbeiter.find((m) => m.id === s.benutzerId)?.name ?? 'Mitarbeiter fehlt')
			: s.zuweisung === 'rolle'
				? `Rolle ${data.rollen.find((r) => r.id === s.rolleId)?.name ?? '–'}`
				: 'Zuständiger des Auftrags';
	const stufenVon = (art: NachfassArt) => data.stufen.filter((s) => s.art === art);

	// Vorschau mit Beispieldaten (im abgeschotteten iframe, ohne Skripte)
	let signatur = $state('');
	$effect.pre(() => {
		signatur = data.signatur ?? '';
	});
	const vorschau = (html: string) =>
		`<!doctype html><meta charset="utf-8"><body style="font:15px/1.6 system-ui,sans-serif;margin:12px;color:#1c1f23">${mitSignatur(
			fuelle(html, BEISPIEL_WERTE, true),
			signatur || null
		)}</body>`;
	let neuHtml = $state('<p>{{kunde.anrede}},</p>\n<p>…</p>\n<p>Mit freundlichen Grüßen</p>\n{{signatur}}');
	let entwuerfe = $state<Record<string, string>>({});
	const html = (id: string, gespeichert: string) => entwuerfe[id] ?? gespeichert;
</script>

<svelte:head>
	<title>Nachfassen</title>
</svelte:head>

<main class="kd-seite nf-seite">
	<h1>Automatisch nachfassen</h1>
	<p class="kd-info">
		Nach einer festen Zahl von Tagen legt das CRM ein To-do an und/oder bereitet eine Mail vor – fertig zum Kopieren oder zum Öffnen im
		Mailprogramm. Es stoppt von selbst, sobald das Angebot angenommen oder abgelehnt ist. Pausieren geht am Angebot, „kein Nachfassen“ beim
		Kunden. Automatisch versendet wird noch nichts (Mail-Anbindung offen).
	</p>

	{#each NACHFASS_ARTEN as art (art)}
		<Karte>
			{#snippet titel()}{art === 'angebot' ? 'Angebote' : 'Rechnungen'}{/snippet}
			{#if art === 'rechnung'}
				<p class="kt-hinweis" role="note">Rechnungen gibt es im CRM noch nicht – die Stufen (Zahlungserinnerung, Mahnstufe 1–3) lassen sich schon einstellen und greifen, sobald Rechnungen da sind.</p>
			{/if}
			{#if art === 'angebot' && stufenVon('angebot').length === 0}
				<form method="POST" action="?/standard" use:enhance class="nf-standard">
					{#if fehlerIn('standard')}<p role="alert" class="kd-fehler">{fehlerIn('standard')}</p>{/if}
					<p class="kd-info">Vorschlag: Tag 3 freundliche Mail, Tag 7 „Kunde anrufen“, Tag 14 Erinnerungs-Mail und To-do für den Chef.</p>
					<button type="submit" class="kd-knopf hell">Vorschlag übernehmen</button>
				</form>
			{/if}
			<ol class="nf-stufen" aria-label={`Stufen ${NACHFASS_ART_NAMEN[art]}`}>
				{#each stufenVon(art) as s, i (s.id)}
					<li class:aus={!s.aktiv}>
						<details open={!!fehlerIn(`stufe-${s.id}`)}>
							<summary>
								<span class="nf-nr">{i + 1}</span>
								<span class="nf-tag">nach {s.tage} Tag{s.tage === 1 ? '' : 'en'}</span>
								<span class="nf-was">
									{#if s.mail}Mail „{vorlageName(s.mailVorlageId)}“{/if}{#if s.mail && s.todo}{' + '}{/if}{#if s.todo}To-do{s.todoTitel ? ` „${s.todoTitel}“` : ''}{/if}
									<span class="kd-info"> · {wer(s)}{s.mahnstufe !== null ? ` · ${s.mahnstufe === 0 ? 'Zahlungserinnerung' : `Mahnstufe ${s.mahnstufe}`}` : ''}{s.aktiv ? '' : ' · aus'}</span>
								</span>
							</summary>
							{@render stufenFormular(art, s)}
							<form method="POST" action="?/stufeLoeschen" use:enhance class="nf-loeschen">
								<input type="hidden" name="id" value={s.id} />
								<button type="submit" class="kd-knopf hell">Stufe löschen</button>
							</form>
						</details>
					</li>
				{/each}
			</ol>
			<AddPanel label="Stufe hinzufügen" offen={!!fehlerIn(`stufe-neu-${art}`)}>
				{#snippet children(schliessen)}{@render stufenFormular(art, null, schliessen)}{/snippet}
			</AddPanel>
		</Karte>
	{/each}

	<Karte>
		{#snippet titel()}Mail-Vorlagen{/snippet}
		<details class="nf-platzhalter">
			<summary>Platzhalter</summary>
			<ul>
				{#each PLATZHALTER as [p, text] (p)}<li><code>{`{{${p}}}`}</code> – {text}</li>{/each}
			</ul>
		</details>
		<ul class="nf-stufen" aria-label="Mail-Vorlagen">
			{#each data.vorlagen as v (v.id)}
				<li>
					<details open={!!fehlerIn(`vorlage-${v.id}`)}>
						<summary><span class="nf-was"><strong>{v.name}</strong> <span class="kd-info">· {v.betreff}</span></span></summary>
						{@render vorlageFormular(v.id, v.name, v.betreff, v.html, v.text ?? '')}
						<form method="POST" action="?/vorlageLoeschen" use:enhance class="nf-loeschen">
							{#if fehlerIn(`vorlage-${v.id}`)}<p role="alert" class="kd-fehler">{fehlerIn(`vorlage-${v.id}`)}</p>{/if}
							<input type="hidden" name="id" value={v.id} />
							<button type="submit" class="kd-knopf hell">Vorlage löschen</button>
						</form>
					</details>
				</li>
			{:else}
				<li class="kd-leer">Noch keine Vorlagen.</li>
			{/each}
		</ul>
		<AddPanel label="Vorlage hinzufügen" offen={!!fehlerIn('vorlage-neu')}>
			{#snippet children(schliessen)}{@render vorlageFormular(null, '', '', neuHtml, '', schliessen)}{/snippet}
		</AddPanel>
	</Karte>

	<Karte>
		{#snippet titel()}Firmensignatur{/snippet}
		<form method="POST" action="?/signatur" use:enhance={ohneReset} class="kd-formular">
			{#if fehlerIn('signatur')}<p role="alert" class="kd-fehler">{fehlerIn('signatur')}</p>{/if}
			<label>
				Signatur (HTML) – wird in jede Mail eingesetzt
				<textarea name="signatur" rows="5" maxlength="20000" bind:value={signatur} placeholder="<p>Viele Grüße<br>Ihr Team von …</p>"></textarea>
			</label>
			<div class="nf-vorschau">
				<span class="kd-info">Vorschau</span>
				<iframe title="Vorschau Signatur" sandbox="" srcdoc={vorschau('{{signatur}}')}></iframe>
			</div>
			<button type="submit" class="kd-knopf">Signatur speichern</button>
		</form>
	</Karte>
</main>

{#snippet stufenFormular(art: NachfassArt, s: Stufe | null, schliessen?: () => void)}
	{@const b = s ? `stufe-${s.id}` : `stufe-neu-${art}`}
	{@const zuweisung = wert(b, 'zuweisung', s?.zuweisung ?? 'zustaendig')}
	<form method="POST" action="?/stufe" use:enhance={ohneReset} class="kd-formular nf-formular">
		{#if fehlerIn(b)}<p role="alert" class="kd-fehler">{fehlerIn(b)}</p>{/if}
		<input type="hidden" name="art" value={art} />
		{#if s}<input type="hidden" name="id" value={s.id} />{/if}
		<div class="nf-raster">
			<label>
				Nach Tagen ({art === 'angebot' ? 'ab Versand' : 'ab Fälligkeit'})
				<input type="number" name="tage" min="0" max="365" required value={wert(b, 'tage', s ? String(s.tage) : '')} />
			</label>
			<label>
				To-do fällig nach (Tagen)
				<input type="number" name="faelligVersatz" min="0" max="60" value={wert(b, 'faelligVersatz', s ? String(s.faelligVersatz) : '0')} />
			</label>
			{#if art === 'rechnung'}
				<label>
					Stufe
					<select name="mahnstufe">
						<option value="0" selected={wert(b, 'mahnstufe', String(s?.mahnstufe ?? 0)) === '0'}>Zahlungserinnerung</option>
						{#each [1, 2, 3] as m (m)}<option value={String(m)} selected={wert(b, 'mahnstufe', String(s?.mahnstufe ?? 0)) === String(m)}>Mahnstufe {m}</option>{/each}
					</select>
				</label>
			{/if}
		</div>
		<div class="nf-aktionen">
			<label class="kd-haken"><input type="checkbox" name="mail" checked={wert(b, 'mail', s?.mail ? 'on' : '') !== ''} /><span>Mail vorbereiten</span></label>
			<label>
				Mail-Vorlage
				<select name="mailVorlageId">
					<option value="">– keine –</option>
					{#each data.vorlagen as v (v.id)}<option value={v.id} selected={wert(b, 'mailVorlageId', s?.mailVorlageId ?? '') === v.id}>{v.name}</option>{/each}
				</select>
			</label>
			<label class="kd-haken"><input type="checkbox" name="todo" checked={wert(b, 'todo', s ? (s.todo ? 'on' : '') : 'on') !== ''} /><span>To-do anlegen</span></label>
			<label>
				To-do-Titel (Platzhalter erlaubt)
				<input type="text" name="todoTitel" maxlength="300" value={wert(b, 'todoTitel', s?.todoTitel ?? '')} placeholder={'z. B. Kunde anrufen: {{kunde.name}} – Angebot {{angebot.nummer}}'} />
			</label>
		</div>
		<div class="nf-raster">
			<label>
				Zuständig
				<select name="zuweisung">
					{#each ZUWEISUNGEN as z (z)}<option value={z} selected={zuweisung === z}>{ZUWEISUNG_NAMEN[z]}</option>{/each}
				</select>
			</label>
			<label>
				Mitarbeiter (bei „fest“)
				<select name="benutzerId">
					<option value="">–</option>
					{#each data.mitarbeiter as m (m.id)}<option value={m.id} selected={wert(b, 'benutzerId', s?.benutzerId ?? '') === m.id}>{m.name}</option>{/each}
				</select>
			</label>
			<label>
				Rolle (bei „Rolle“)
				<select name="rolleId">
					<option value="">–</option>
					{#each data.rollen as r (r.id)}<option value={r.id} selected={wert(b, 'rolleId', s?.rolleId ?? '') === r.id}>{r.name}</option>{/each}
				</select>
			</label>
		</div>
		{#if s}
			<label class="kd-haken"><input type="checkbox" name="aktiv" value="true" checked={s.aktiv} /><span>Stufe aktiv</span></label>
			<input type="hidden" name="aktiv" value="false" />
		{/if}
		<div class="nf-knoepfe">
			<button type="submit" class="kd-knopf">{s ? 'Speichern' : 'Stufe hinzufügen'}</button>
			{#if schliessen}<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>{/if}
		</div>
	</form>
{/snippet}

{#snippet vorlageFormular(id: string | null, name: string, betreff: string, start: string, text: string, schliessen?: () => void)}
	{@const b = id ? `vorlage-${id}` : 'vorlage-neu'}
	{@const schluessel = id ?? 'neu'}
	<form method="POST" action="?/vorlage" use:enhance={ohneReset} class="kd-formular nf-formular">
		{#if fehlerIn(b)}<p role="alert" class="kd-fehler">{fehlerIn(b)}</p>{/if}
		{#if id}<input type="hidden" name="id" value={id} />{/if}
		<div class="nf-raster">
			<label>Name <input type="text" name="name" maxlength="200" required value={wert(b, 'name', name)} /></label>
			<label>Betreff <input type="text" name="betreff" maxlength="300" required value={wert(b, 'betreff', betreff)} /></label>
		</div>
		<label>
			Text (HTML)
			<textarea
				name="html"
				rows="8"
				maxlength="50000"
				required
				value={html(schluessel, wert(b, 'html', start))}
				oninput={(ev) => (entwuerfe = { ...entwuerfe, [schluessel]: ev.currentTarget.value })}
			></textarea>
		</label>
		<div class="nf-vorschau">
			<span class="kd-info">Vorschau mit Beispieldaten</span>
			<iframe title={`Vorschau ${name || 'neue Vorlage'}`} sandbox="" srcdoc={vorschau(html(schluessel, wert(b, 'html', start)))}></iframe>
			<details>
				<summary class="kd-info">Klartext-Fassung (automatisch)</summary>
				<pre>{htmlZuText(mitSignatur(fuelle(html(schluessel, wert(b, 'html', start)), BEISPIEL_WERTE, true), signatur || null))}</pre>
			</details>
		</div>
		<label>
			Eigene Klartext-Fassung (optional)
			<textarea name="text" rows="3" maxlength="50000" value={wert(b, 'text', text)}></textarea>
		</label>
		<div class="nf-knoepfe">
			<button type="submit" class="kd-knopf">{id ? 'Speichern' : 'Vorlage anlegen'}</button>
			{#if schliessen}<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>{/if}
		</div>
	</form>
{/snippet}

<style>
	.nf-seite {
		max-width: 64rem;
	}
	.nf-stufen {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
	}
	.nf-stufen:empty {
		display: none;
	}
	.nf-stufen > li + li {
		border-top: 1px solid var(--m365-rand);
	}
	.nf-stufen summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		min-height: 2.75rem;
		padding: 0.4rem 0.75rem;
		cursor: pointer;
		list-style: none;
	}
	.nf-stufen summary::-webkit-details-marker {
		display: none;
	}
	.nf-stufen summary:hover {
		background: var(--m365-flaeche-hover);
	}
	.nf-stufen details[open] {
		padding-bottom: 0.75rem;
	}
	.nf-stufen details[open] > form {
		padding: 0.5rem 0.75rem 0;
	}
	.nf-stufen li.aus .nf-was {
		color: var(--m365-text-leise);
	}
	.nf-nr {
		display: inline-grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--m365-primaer);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 700;
	}
	.nf-tag {
		font-weight: 600;
		white-space: nowrap;
	}
	.nf-was {
		flex: 1 1 14rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.nf-raster,
	.nf-aktionen {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		align-items: end;
	}
	.nf-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.nf-loeschen {
		padding: 0.5rem 0.75rem 0;
	}
	.nf-standard {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
		margin-bottom: 0.75rem;
	}
	.nf-standard p {
		margin: 0;
	}
	.nf-vorschau {
		display: grid;
		gap: 0.3rem;
	}
	.nf-vorschau iframe {
		width: 100%;
		min-height: 11rem;
		border: 1px solid var(--m365-rand);
		border-radius: var(--m365-radius);
		background: #fff;
	}
	.nf-vorschau pre {
		white-space: pre-wrap;
		font: inherit;
		font-size: 0.875rem;
		margin: 0.4rem 0 0;
	}
	.nf-platzhalter {
		margin-bottom: 0.75rem;
	}
	.nf-platzhalter summary {
		cursor: pointer;
		color: var(--m365-primaer);
		font-weight: 600;
	}
	.nf-platzhalter ul {
		margin: 0.5rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.875rem;
		display: grid;
		gap: 0.2rem;
	}
</style>
