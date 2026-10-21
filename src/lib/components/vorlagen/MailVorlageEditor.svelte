<script lang="ts">
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import FormFuss from '$lib/components/ui/FormFuss.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import MailVorschau from '$lib/components/MailVorschau.svelte';
	import { MAIL_ZWECKE, PLATZHALTER_JE_ZWECK, PLATZHALTER_TEXTE, ZWECK_NAMEN, istMailZweck, unbekanntePlatzhalter, type MailZweck } from '$lib/mail-vorlagen';
	import type { MailBeispiel } from '$lib/nachfassen';

	/**
	 * Bearbeiten einer E-Mail-Vorlage (Jamil msgs 2789, 3086) – gleich für „Neue Vorlage“ und die Detailseite:
	 * links Name, Zweck, Betreff, HTML-Text, Platzhalter (Klick fügt an der Cursorstelle ein), Signatur, Klartext;
	 * rechts die Live-Vorschau (abgeschottetes iframe). Unbekannte Platzhalter werden sofort markiert.
	 */
	type Vorlage = { id: string; name: string; zweck: string; betreff: string; html: string; text: string | null; mitSignatur: boolean };
	let {
		vorlage = null,
		zweckVorgabe = 'allgemein',
		werte = null,
		signatur,
		beispiele,
		abbrechen
	}: {
		vorlage?: Vorlage | null;
		zweckVorgabe?: MailZweck;
		/** Eingaben nach einem Fehler (vom Server zurück) */
		werte?: Record<string, string> | null;
		signatur: string | null;
		beispiele: MailBeispiel[];
		abbrechen: string;
	} = $props();

	const neuHtml = '<p>{{kunde.anrede}},</p>\n<p>…</p>\n<p>Mit freundlichen Grüßen</p>\n{{signatur}}';
	const start = (feld: string, gespeichert: string) => werte?.[feld] ?? gespeichert;
	// Startwerte einmalig; danach gehören sie dem Formular
	const s0 = $state.snapshot({ vorlage, zweckVorgabe, werte });
	let name = $state(s0.werte?.name ?? s0.vorlage?.name ?? '');
	let zweck = $state<string>(start('zweck', s0.vorlage?.zweck ?? s0.zweckVorgabe));
	let betreff = $state(start('betreff', s0.vorlage?.betreff ?? ''));
	let html = $state(start('html', s0.vorlage?.html ?? neuHtml));
	let text = $state(start('text', s0.vorlage?.text ?? ''));
	let mitSig = $state(s0.werte ? s0.werte.mitSignatur === 'on' : (s0.vorlage?.mitSignatur ?? true));
	const z = $derived<MailZweck>(istMailZweck(zweck) ? zweck : 'allgemein');
	const unbekannt = $derived(unbekanntePlatzhalter([betreff, html, text], z));

	// Platzhalter einfügen: ins zuletzt benutzte Feld (Betreff, HTML oder Klartext) an der Cursorstelle
	let letztes = $state<{ el: HTMLInputElement | HTMLTextAreaElement; feld: 'betreff' | 'html' | 'text' } | null>(null);
	function einfuegen(p: string) {
		if (!letztes) return;
		const { el, feld } = letztes;
		const a = el.selectionStart ?? el.value.length;
		const b = el.selectionEnd ?? a;
		const neu = `${el.value.slice(0, a)}{{${p}}}${el.value.slice(b)}`;
		if (feld === 'betreff') betreff = neu;
		else if (feld === 'html') html = neu;
		else text = neu;
		el.value = neu;
		el.focus();
		const pos = a + p.length + 4;
		el.setSelectionRange(pos, pos);
	}
</script>

<form method="POST" action="?/vorlage" use:enhance={() => async ({ update }) => update({ reset: false })} class="mve-form">
	<div class="mve-raster">
		<Abschnitt titel="Vorlage">
			<div class="mve-eingabe">
				{#if vorlage}<input type="hidden" name="id" value={vorlage.id} />{/if}
				<label>Name <input type="text" name="name" maxlength="200" required bind:value={name} /></label>
				<label>
					Zweck
					<Auswahl name="zweck" bind:value={zweck}>
						{#each MAIL_ZWECKE as m (m)}<option value={m}>{ZWECK_NAMEN[m]}</option>{/each}
					</Auswahl>
				</label>
				<label>
					Betreff
					<input type="text" name="betreff" maxlength="300" required bind:value={betreff} onfocus={(ev) => (letztes = { el: ev.currentTarget, feld: 'betreff' })} />
				</label>
				<label>
					Text (HTML)
					<textarea name="html" rows="12" maxlength="50000" required bind:value={html} onfocus={(ev) => (letztes = { el: ev.currentTarget, feld: 'html' })}></textarea>
				</label>
				<div class="mve-platzhalter" aria-label="Platzhalter einfügen">
					<span class="kd-info">Platzhalter (Klick fügt ein):</span>
					{#each PLATZHALTER_JE_ZWECK[z] as p (p)}
						<button type="button" class="mve-chip" title={PLATZHALTER_TEXTE[p]} onmousedown={(e) => e.preventDefault()} onclick={() => einfuegen(p)}>{`{{${p}}}`}</button>
					{/each}
				</div>
				{#if unbekannt.length}
					<p class="mve-warnung" role="alert">
						Unbekannte Platzhalter für „{ZWECK_NAMEN[z]}“: {unbekannt.map((p) => `{{${p}}}`).join(', ')} – sie bleiben in der Mail leer.
					</p>
				{/if}
				<Schalter name="mitSignatur" label="Signatur anhängen" bind:an={mitSig} hinweis="an der Stelle {'{{signatur}}'}, sonst am Ende" />
				<details>
					<summary>Eigene Klartext-Fassung (optional)</summary>
					<label>
						Klartext – sonst automatisch aus dem HTML
						<textarea name="text" rows="4" maxlength="50000" bind:value={text} onfocus={(ev) => (letztes = { el: ev.currentTarget, feld: 'text' })}></textarea>
					</label>
				</details>
			</div>
		</Abschnitt>
		<MailVorschau titel={`Vorschau ${name || 'neue Vorlage'}`} {html} {betreff} {text} signatur={mitSig ? signatur : null} {beispiele} />
	</div>
	<FormFuss>
		<a href={abbrechen} class="kd-knopf hell">{vorlage ? 'Zurück' : 'Abbrechen'}</a>
		<button type="submit" class="kd-knopf">{vorlage ? 'Speichern' : 'Vorlage anlegen'}</button>
	</FormFuss>
</form>

<style>
	.mve-form {
		display: grid;
		gap: var(--ui-abstand-block, var(--ui-a4));
	}
	.mve-raster {
		display: grid;
		gap: var(--ui-a4);
		align-items: start;
	}
	@media (min-width: 64rem) {
		.mve-raster {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
		}
	}
	.mve-eingabe {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	.mve-eingabe label {
		display: grid;
		gap: 0.25rem;
	}
	.mve-eingabe textarea {
		font-family: ui-monospace, Menlo, Consolas, monospace;
		font-size: 0.8125rem;
	}
	.mve-platzhalter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	.mve-chip {
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
	.mve-chip:hover {
		border-color: var(--ui-akzent);
	}
	.mve-warnung {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--ui-radius);
		background: var(--ui-orange-hell);
		color: var(--ui-text);
		font-size: var(--ui-schrift-s);
	}
</style>
