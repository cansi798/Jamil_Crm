<script lang="ts">
	/**
	 * Suchfeld für Listen (docs/design-regeln.md): sucht live beim Tippen (kurze Pause), Enter sofort – ohne
	 * „Suchen“-Knopf. Steht in einem GET-Formular; abgeschickt wird mit requestSubmit (SvelteKit lädt die Liste neu,
	 * Fokus und Text bleiben).
	 */
	let {
		name = 'suche',
		wert = '',
		label,
		placeholder = 'Suchen …'
	}: { name?: string; wert?: string | null; label: string; placeholder?: string } = $props();

	let zeit: ReturnType<typeof setTimeout> | undefined;
	function eingabe(ev: Event) {
		const feld = ev.currentTarget as HTMLInputElement;
		clearTimeout(zeit);
		zeit = setTimeout(() => feld.form?.requestSubmit(), 300);
	}
</script>

<div class="sf">
	<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
	<input type="search" {name} value={wert ?? ''} aria-label={label} {placeholder} autocomplete="off" enterkeyhint="search" oninput={eingabe} />
</div>

<style>
	.sf {
		position: relative;
		flex: 1 1 16rem;
		min-width: 0;
		max-width: 32rem;
	}
	.sf svg {
		position: absolute;
		left: 0.85rem;
		top: 50%;
		width: 16px;
		height: 16px;
		margin-top: -8px;
		color: var(--ui-text-leise);
		pointer-events: none;
	}
	.sf input {
		width: 100%;
		padding-left: 2.4rem !important;
		border-radius: 999px !important;
	}
</style>
