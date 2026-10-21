<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { fertigeMail, mailtoLink } from '$lib/nachfassen';
	import { ZWECK_NAMEN, type MailZweck } from '$lib/mail-vorlagen';

	/**
	 * „Mail an Kunden“ (Jamil msg 2789): Vorlage wählen (Standard vorausgewählt), Platzhalter sind mit den Daten von
	 * Kunde/Auftrag/Angebot gefüllt; Betreff und Text lassen sich vor dem Öffnen anpassen. Geöffnet wird das eigene
	 * Mailprogramm (mailto) – das CRM verschickt hier nichts selbst. „Text kopieren“ für lange Texte.
	 */
	type Vorlage = { id: string; name: string; betreff: string; html: string; text: string | null; zweck: MailZweck; mitSignatur: boolean; istStandard: boolean };
	let {
		vorbereitung,
		extra = {},
		knopf = 'Mail an Kunden',
		titel = 'Mail an Kunden'
	}: {
		vorbereitung: { an: string | null; werte: Record<string, string>; signatur: string | null; vorlagen: Vorlage[] };
		/** Zusätzliche Werte, z. B. der eben erzeugte Portal-Link. */
		extra?: Record<string, string>;
		knopf?: string;
		titel?: string;
	} = $props();

	let offen = $state(false);
	let wahl = $state('');
	let betreff = $state('');
	let text = $state('');
	let kopiert = $state(false);

	const vorlage = $derived(vorbereitung.vorlagen.find((v) => v.id === wahl) ?? vorbereitung.vorlagen[0]);
	function fuellen() {
		if (!vorlage) return;
		const m = fertigeMail(vorlage, { ...vorbereitung.werte, ...extra }, vorlage.mitSignatur ? vorbereitung.signatur : null);
		betreff = m.betreff;
		text = m.text;
		kopiert = false;
	}
	function oeffnen() {
		wahl = vorbereitung.vorlagen[0]?.id ?? '';
		fuellen();
		offen = true;
	}
	async function kopieren() {
		try {
			await navigator.clipboard.writeText(`${betreff}\n\n${text}`);
			kopiert = true;
		} catch {
			kopiert = false;
		}
	}
	const gruppen = $derived([...new Set(vorbereitung.vorlagen.map((v) => v.zweck))].map((z) => ({ zweck: z, liste: vorbereitung.vorlagen.filter((v) => v.zweck === z) })));
</script>

{#if !offen}
	<button type="button" class="kd-knopf hell" onclick={oeffnen} disabled={vorbereitung.vorlagen.length === 0}>{knopf}</button>
{:else}
	<section class="mk" aria-label={titel}>
		<div class="mk-kopf">
			<strong>{titel}</strong>
			<button type="button" class="kd-knopf hell klein" onclick={() => (offen = false)}>Schließen</button>
		</div>
		<label>
			Vorlage
			<Auswahl bind:value={wahl} onchange={fuellen}>
				{#each gruppen as g (g.zweck)}
					<optgroup label={ZWECK_NAMEN[g.zweck]}>
						{#each g.liste as v (v.id)}<option value={v.id}>{v.name}{v.istStandard ? ' (Standard)' : ''}</option>{/each}
					</optgroup>
				{/each}
			</Auswahl>
		</label>
		<p class="kd-info">An: {vorbereitung.an ?? 'keine E-Mail hinterlegt'}</p>
		<label>Betreff <input type="text" bind:value={betreff} maxlength="300" /></label>
		<label>Text <textarea rows="10" bind:value={text}></textarea></label>
		<div class="mk-knoepfe">
			<a class="kd-knopf" href={mailtoLink(vorbereitung.an, betreff, text)}>In Mailprogramm öffnen</a>
			<button type="button" class="kd-knopf hell" onclick={kopieren}>{kopiert ? 'Kopiert ✓' : 'Text kopieren'}</button>
		</div>
		<p class="kd-info">Das CRM verschickt hier nichts selbst – die Mail geht aus Ihrem Mailprogramm.</p>
	</section>
{/if}

<style>
	.mk {
		display: grid;
		gap: 0.75rem;
		padding: var(--ui-a3);
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		min-width: 0;
	}
	.mk label {
		display: grid;
		gap: 0.25rem;
		font-weight: 600;
		font-size: var(--ui-schrift-s);
	}
	.mk textarea {
		font: inherit;
		min-height: 10rem;
	}
	.mk-kopf,
	.mk-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
	}
	.mk-knoepfe {
		justify-content: flex-start;
	}
	.mk p {
		margin: 0;
	}
</style>
