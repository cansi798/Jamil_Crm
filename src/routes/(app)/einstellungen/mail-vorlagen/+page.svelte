<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import Karte from '$lib/components/Karte.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import MailVorschau from '$lib/components/MailVorschau.svelte';
	import {
		MAIL_ZWECKE,
		PLATZHALTER_JE_ZWECK,
		PLATZHALTER_TEXTE,
		ZWECK_HINWEIS,
		ZWECK_NAMEN,
		istMailZweck,
		unbekanntePlatzhalter,
		type MailZweck
	} from '$lib/mail-vorlagen';
	import type { ActionData, PageData } from './$types';

	/**
	 * E-Mail-Vorlagen an einem Ort (Jamil msg 2789): je Zweck eine Liste, Standard markiert; Bearbeiten links, Live-Vorschau
	 * rechts (abgeschottetes iframe). Unbekannte Platzhalter werden sofort markiert; Klick auf einen Platzhalter fügt ihn ein.
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Vorlage = PageData['vorlagen'][number];

	const fehlerIn = (bereich: string) => (form && 'bereich' in form && form.bereich === bereich && 'fehler' in form ? (form.fehler as string) : null);
	const gespeichertIn = (bereich: string) => !!(form && 'bereich' in form && form.bereich === bereich && 'gespeichert' in form);
	const wert = (bereich: string, feld: string, gespeichert: string) =>
		form && 'bereich' in form && form.bereich === bereich && 'werte' in form && form.werte && 'fehler' in form
			? ((form.werte as Record<string, string>)[feld] ?? '')
			: gespeichert;
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });

	let signatur = $state('');
	$effect.pre(() => {
		signatur = data.signatur ?? '';
	});

	// Entwürfe je Vorlage (für Vorschau und Platzhalter-Prüfung)
	type Entwurf = { betreff?: string; html?: string; text?: string; zweck?: MailZweck };
	let entwuerfe = $state<Record<string, Entwurf>>({});
	const setze = (id: string, feld: keyof Entwurf, w: string) => (entwuerfe = { ...entwuerfe, [id]: { ...entwuerfe[id], [feld]: w } });
	const aktuell = <K extends keyof Entwurf>(id: string, feld: K, gespeichert: NonNullable<Entwurf[K]>): NonNullable<Entwurf[K]> =>
		(entwuerfe[id]?.[feld] as NonNullable<Entwurf[K]> | undefined) ?? gespeichert;

	// Platzhalter einfügen: ins zuletzt benutzte Feld (Betreff oder Text) an der Cursorstelle
	let letztesFeld = $state<{ id: string; el: HTMLInputElement | HTMLTextAreaElement; feld: 'betreff' | 'html' | 'text' } | null>(null);
	function einfuegen(id: string, p: string) {
		const ziel = letztesFeld?.id === id ? letztesFeld : null;
		if (!ziel) return;
		const el = ziel.el;
		const start = el.selectionStart ?? el.value.length;
		const ende = el.selectionEnd ?? start;
		const neu = `${el.value.slice(0, start)}{{${p}}}${el.value.slice(ende)}`;
		el.value = neu;
		setze(id, ziel.feld, neu);
		el.focus();
		const pos = start + p.length + 4;
		el.setSelectionRange(pos, pos);
	}

	let filter = $state<MailZweck | 'alle'>('alle');
	const gruppen = $derived(
		MAIL_ZWECKE.filter((z) => filter === 'alle' || filter === z).map((z) => ({ zweck: z, liste: data.vorlagen.filter((v) => v.zweck === z) }))
	);
	const signaturMail = $derived(data.vorlagen.find((v) => v.zweck === 'allgemein' && v.istStandard) ?? data.vorlagen[0]);
	const neuHtml = '<p>{{kunde.anrede}},</p>\n<p>…</p>\n<p>Mit freundlichen Grüßen</p>\n{{signatur}}';
</script>

<svelte:head>
	<title>E-Mail-Vorlagen</title>
</svelte:head>

<main class="kd-seite mv-seite">
	<h1>E-Mail-Vorlagen</h1>
	<p class="kd-info">
		Alle Texte für Mails an Kunden an einem Ort. Je Zweck ist eine Vorlage der Standard – sie ist überall vorausgewählt, wo eine Mail
		vorbereitet wird, und lässt sich dort gegen eine andere tauschen.
	</p>

	<div class="mvl-filter" role="group" aria-label="Zweck">
		<button type="button" class="pill" class:aktiv={filter === 'alle'} aria-pressed={filter === 'alle'} onclick={() => (filter = 'alle')}>Alle</button>
		{#each MAIL_ZWECKE as z (z)}
			<button type="button" class="pill" class:aktiv={filter === z} aria-pressed={filter === z} onclick={() => (filter = z)}>{ZWECK_NAMEN[z]}</button>
		{/each}
	</div>

	{#each gruppen as g (g.zweck)}
		<Karte>
			{#snippet titel()}{ZWECK_NAMEN[g.zweck]}{/snippet}
			<p class="kd-info">{ZWECK_HINWEIS[g.zweck]}</p>
			<ul class="mvl-liste" aria-label={`Vorlagen ${ZWECK_NAMEN[g.zweck]}`}>
				{#each g.liste as v (v.id)}
					<li>
						<details open={!!fehlerIn(`vorlage-${v.id}`) || gespeichertIn(`vorlage-${v.id}`)}>
							<summary>
								<span class="mvl-name"><strong>{v.name}</strong>{#if v.istStandard}<span class="mvl-standard">Standard</span>{/if}</span>
								<span class="kd-info mvl-betreff">{v.betreff}</span>
							</summary>
							{@render editor(v)}
							<div class="mvl-aktionen">
								{#if !v.istStandard}
									<form method="POST" action="?/standard" use:enhance={ohneReset}>
										<input type="hidden" name="id" value={v.id} />
										<button type="submit" class="kd-knopf hell">Als Standard</button>
									</form>
								{/if}
								<form method="POST" action="?/kopieren" use:enhance={ohneReset}>
									<input type="hidden" name="id" value={v.id} />
									<button type="submit" class="kd-knopf hell">Kopieren</button>
								</form>
								<form method="POST" action="?/loeschen" use:enhance={ohneReset}>
									<input type="hidden" name="id" value={v.id} />
									<button type="submit" class="kd-knopf hell" onclick={(e) => { if (!confirm(`Vorlage „${v.name}“ löschen?`)) e.preventDefault(); }}>Löschen</button>
								</form>
							</div>
						</details>
					</li>
				{:else}
					<li class="kd-leer">Noch keine Vorlage für diesen Zweck.</li>
				{/each}
			</ul>
		</Karte>
	{/each}

	<Karte>
		{#snippet titel()}Neue Vorlage{/snippet}
		<AddPanel label="Vorlage hinzufügen" offen={!!fehlerIn('vorlage-neu')}>
			{#snippet children(schliessen)}{@render editor(null, schliessen)}{/snippet}
		</AddPanel>
	</Karte>

	<Karte>
		{#snippet titel()}Firmensignatur{/snippet}
		<form method="POST" action="?/signatur" use:enhance={ohneReset} class="kd-formular mvl-editor">
			<div class="mvl-eingabe">
				{#if fehlerIn('signatur')}<p role="alert" class="kd-fehler">{fehlerIn('signatur')}</p>{/if}
				{#if gespeichertIn('signatur')}<p role="status" class="mvl-ok">Signatur gespeichert.</p>{/if}
				<label>
					Signatur (HTML) – in jede Vorlage mit „Signatur anhängen“
					<textarea name="signatur" rows="10" maxlength="20000" bind:value={signatur} placeholder="<p>Viele Grüße<br>Ihr Team von …</p>"></textarea>
				</label>
				<button type="submit" class="kd-knopf">Signatur speichern</button>
			</div>
			{#if signaturMail}
				<MailVorschau titel="Vorschau Signatur" html={signaturMail.html} betreff={signaturMail.betreff} text={signaturMail.text} {signatur} beispiele={data.beispiele} />
			{/if}
		</form>
	</Karte>
</main>

{#snippet editor(v: Vorlage | null, schliessen?: () => void)}
	{@const b = v ? `vorlage-${v.id}` : 'vorlage-neu'}
	{@const id = v?.id ?? 'neu'}
	{@const zweckRoh = aktuell(id, 'zweck', (wert(b, 'zweck', v?.zweck ?? (filter === 'alle' ? 'allgemein' : filter)) as MailZweck))}
	{@const zweck = istMailZweck(zweckRoh) ? zweckRoh : 'allgemein'}
	{@const betreff = aktuell(id, 'betreff', wert(b, 'betreff', v?.betreff ?? ''))}
	{@const html = aktuell(id, 'html', wert(b, 'html', v?.html ?? neuHtml))}
	{@const text = aktuell(id, 'text', wert(b, 'text', v?.text ?? ''))}
	{@const unbekannt = unbekanntePlatzhalter([betreff, html, text], zweck)}
	{@const mitSig = wert(b, 'mitSignatur', v ? (v.mitSignatur ? 'on' : '') : 'on') !== ''}
	<form method="POST" action="?/vorlage" use:enhance={ohneReset} class="kd-formular mvl-editor">
		<div class="mvl-eingabe">
			{#if fehlerIn(b)}<p role="alert" class="kd-fehler">{fehlerIn(b)}</p>{/if}
			{#if gespeichertIn(b)}<p role="status" class="mvl-ok">Gespeichert.</p>{/if}
			{#if v}<input type="hidden" name="id" value={v.id} />{/if}
			<label>Name <input type="text" name="name" maxlength="200" required value={wert(b, 'name', v?.name ?? '')} /></label>
			<label>
				Zweck
				<Auswahl name="zweck" value={zweck} onchange={(ev) => setze(id, 'zweck', (ev.currentTarget as HTMLSelectElement).value)}>
					{#each MAIL_ZWECKE as z (z)}<option value={z}>{ZWECK_NAMEN[z]}</option>{/each}
				</Auswahl>
			</label>
			<label>
				Betreff
				<input type="text" name="betreff" maxlength="300" required value={betreff}
					onfocus={(ev) => (letztesFeld = { id, el: ev.currentTarget, feld: 'betreff' })}
					oninput={(ev) => setze(id, 'betreff', ev.currentTarget.value)} />
			</label>
			<label>
				Text (HTML)
				<textarea name="html" rows="12" maxlength="50000" required value={html}
					onfocus={(ev) => (letztesFeld = { id, el: ev.currentTarget, feld: 'html' })}
					oninput={(ev) => setze(id, 'html', ev.currentTarget.value)}></textarea>
			</label>
			<div class="mvl-platzhalter" aria-label="Platzhalter einfügen">
				<span class="kd-info">Platzhalter (Klick fügt ein):</span>
				{#each PLATZHALTER_JE_ZWECK[zweck] as p (p)}
					<button type="button" class="mvl-chip" title={PLATZHALTER_TEXTE[p]} onmousedown={(e) => e.preventDefault()} onclick={() => einfuegen(id, p)}>{`{{${p}}}`}</button>
				{/each}
			</div>
			{#if unbekannt.length}
				<p class="mvl-warnung" role="alert">
					Unbekannte Platzhalter für „{ZWECK_NAMEN[zweck]}“: {unbekannt.map((p) => `{{${p}}}`).join(', ')} – sie bleiben in der Mail leer.
				</p>
			{/if}
			<Schalter name="mitSignatur" label="Signatur anhängen" an={mitSig} hinweis="an der Stelle {'{{signatur}}'}, sonst am Ende" />
			<details>
				<summary>Eigene Klartext-Fassung (optional)</summary>
				<label>
					Klartext – sonst automatisch aus dem HTML
					<textarea name="text" rows="4" maxlength="50000" value={text}
						onfocus={(ev) => (letztesFeld = { id, el: ev.currentTarget, feld: 'text' })}
						oninput={(ev) => setze(id, 'text', ev.currentTarget.value)}></textarea>
				</label>
			</details>
			<div class="mvl-knoepfe">
				{#if schliessen}<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>{/if}
				<button type="submit" class="kd-knopf">{v ? 'Speichern' : 'Vorlage anlegen'}</button>
			</div>
		</div>
		<MailVorschau titel={`Vorschau ${v?.name || 'neue Vorlage'}`} {html} {betreff} {text} signatur={mitSig ? signatur : null} beispiele={data.beispiele} />
	</form>
{/snippet}

<style>
	.mv-seite {
		max-width: none;
	}
	.mvl-filter {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		margin: 0 0 var(--ui-a3);
	}
	.mvl-editor {
		display: grid;
		gap: 1rem;
		align-items: start;
	}
	@media (min-width: 64rem) {
		.mvl-editor {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
		}
	}
	.mvl-eingabe {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	.mvl-eingabe textarea {
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 0.8125rem;
	}
	.mvl-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
	}
	.mvl-liste > li + li {
		border-top: 1px solid var(--ui-rand);
	}
	.mvl-liste summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		min-height: 2.75rem;
		padding: 0.4rem 0.75rem;
		cursor: pointer;
		list-style: none;
	}
	.mvl-liste summary::-webkit-details-marker {
		display: none;
	}
	.mvl-liste details[open] {
		padding: 0 0.75rem 0.75rem;
	}
	.mvl-liste details[open] > summary {
		margin: 0 -0.75rem 0.5rem;
	}
	.mvl-name {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.mvl-standard {
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
		padding: 0.1rem 0.5rem;
		border-radius: var(--ui-chip-radius);
		background: var(--ui-akzent-zart);
		color: var(--ui-akzent-text);
	}
	.mvl-betreff {
		flex: 1 1 14rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.mvl-platzhalter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	.mvl-chip {
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 0.75rem;
		min-height: 2rem;
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-chip-radius);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		cursor: pointer;
	}
	.mvl-chip:hover {
		border-color: var(--ui-akzent);
	}
	.mvl-aktionen,
	.mvl-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.mvl-ok {
		margin: 0;
		color: var(--ui-gruen);
		font-weight: 600;
	}
	.mvl-warnung {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--ui-radius);
		background: var(--ui-orange-hell);
		color: var(--ui-text);
		font-size: var(--ui-schrift-s);
	}
	.mvl-aktionen form {
		margin: 0;
	}
</style>
