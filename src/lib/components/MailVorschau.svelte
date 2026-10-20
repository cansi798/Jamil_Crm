<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	/**
	 * Live-Vorschau einer Mail (Wunsch Jamil msg 2670): fertige HTML-Mail mit Beispieldaten (Beispiel oder echtes Angebot
	 * wählbar) und Signatur, Breite Desktop/Handy, Klartext-Ansicht. Sicherheit: Die Vorlage läuft nur im iframe mit
	 * `sandbox=""` (keine Skripte, kein Zugriff auf die App) und `srcdoc`; zusätzlich verbietet ein CSP-Meta im
	 * Dokument Skripte und Nachladen außer Bildern.
	 */
	import { fertigeMail, vorschauDokument, type MailBeispiel } from '$lib/nachfassen';

	let {
		html,
		betreff = null,
		text = null,
		signatur,
		beispiele,
		titel = 'Vorschau'
	}: {
		html: string;
		betreff?: string | null;
		text?: string | null;
		signatur: string | null;
		beispiele: MailBeispiel[];
		titel?: string;
	} = $props();

	let beispielId = $state('beispiel');
	let breite = $state<'desktop' | 'mobil'>('desktop');
	let ansicht = $state<'html' | 'text'>('html');
	const werte = $derived((beispiele.find((b) => b.id === beispielId) ?? beispiele[0])?.werte ?? {});
	const mail = $derived(fertigeMail({ betreff: betreff ?? '', html, text }, werte, signatur || null));
	const an = $derived(werte['kunde.email'] || 'kunde@example.org');
</script>

<section class="mv" aria-label={titel}>
	<div class="mv-leiste">
		<strong class="mv-titel">{titel}</strong>
		<label class="mv-wahl">
			<span>Daten</span>
			<Auswahl bind:value={beispielId} aria-label="Beispieldaten für die Vorschau">
				{#each beispiele as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
			</Auswahl>
		</label>
		<div class="mv-schalter" role="group" aria-label="Ansicht">
			<button type="button" aria-pressed={ansicht === 'html'} onclick={() => (ansicht = 'html')}>HTML</button>
			<button type="button" aria-pressed={ansicht === 'text'} onclick={() => (ansicht = 'text')}>Klartext</button>
		</div>
		<div class="mv-schalter" role="group" aria-label="Breite">
			<button type="button" aria-pressed={breite === 'desktop'} onclick={() => (breite = 'desktop')}>Desktop</button>
			<button type="button" aria-pressed={breite === 'mobil'} onclick={() => (breite = 'mobil')}>Handy</button>
		</div>
	</div>
	<div class="mv-buehne">
		<div class="mv-mail" class:mobil={breite === 'mobil'}>
			{#if betreff !== null}
				<dl class="mv-kopf">
					<div><dt>An</dt><dd>{an}</dd></div>
					<div><dt>Betreff</dt><dd class="mv-betreff">{mail.betreff || '(ohne Betreff)'}</dd></div>
				</dl>
			{/if}
			{#if ansicht === 'html'}
				<iframe title={`${titel} (HTML)`} sandbox="" referrerpolicy="no-referrer" srcdoc={vorschauDokument(mail.html)}></iframe>
			{:else}
				<pre class="mv-text" aria-label={`${titel} (Klartext)`}>{mail.text}</pre>
			{/if}
		</div>
	</div>
</section>

<style>
	.mv {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}
	.mv-leiste {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}
	.mv-titel {
		font-size: 0.875rem;
		margin-right: auto;
	}
	.mv-wahl {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8125rem;
		min-width: 0;
	}
	.mv-wahl select {
		max-width: 15rem;
		min-height: 2rem;
		font: inherit;
	}
	.mv-schalter {
		display: inline-flex;
		border: 1px solid var(--m365-rand-stark, #8a8886);
		border-radius: var(--m365-radius, 4px);
		overflow: hidden;
	}
	.mv-schalter button {
		min-height: 2rem;
		padding: 0.15rem 0.6rem;
		border: 0;
		background: var(--m365-flaeche, #fff);
		font: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
	}
	.mv-schalter button + button {
		border-left: 1px solid var(--m365-rand-stark, #8a8886);
	}
	.mv-schalter button[aria-pressed='true'] {
		background: var(--m365-primaer);
		color: var(--ui-akzent-auf);
	}
	.mv-buehne {
		padding: 0.75rem;
		border-radius: var(--m365-radius, 4px);
		background: var(--m365-flaeche-hover, #f3f2f1);
		overflow-x: auto;
	}
	.mv-mail {
		width: 100%;
		max-width: 640px;
		margin: 0 auto;
		border: 1px solid var(--m365-rand, #e1dfdd);
		border-radius: var(--m365-radius, 4px);
		background: #fff;
		transition: max-width 0.15s ease;
	}
	.mv-mail.mobil {
		max-width: 375px;
	}
	.mv-kopf {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--m365-rand, #e1dfdd);
		font-size: 0.8125rem;
		display: grid;
		gap: 0.15rem;
	}
	.mv-kopf div {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr);
	}
	.mv-kopf dt {
		color: var(--m365-text-leise, #616161);
	}
	.mv-kopf dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.mv-betreff {
		font-weight: 600;
	}
	.mv-mail iframe {
		display: block;
		width: 100%;
		height: 26rem;
		border: 0;
	}
	.mv-text {
		margin: 0;
		padding: 0.75rem 1rem;
		min-height: 12rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font: 0.875rem/1.6 ui-monospace, Menlo, Consolas, monospace;
	}
</style>
