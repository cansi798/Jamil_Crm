<script lang="ts">
	/**
	 * Hinweis bei Nur-Lesezugriff (Abo abgelaufen): Der Hook beantwortet Formular-Aktionen dann mit `{ nurLesen: true }`.
	 * Steht im (app)-Layout, damit er auf jeder Seite erscheint – auch dort, wo Fehler sonst nur je Aktion angezeigt werden.
	 */
	let { form }: { form: unknown } = $props();

	const sichtbar = $derived(
		typeof form === 'object' && form !== null && (form as { nurLesen?: unknown }).nurLesen === true
	);
</script>

{#if sichtbar}
	<p role="alert" class="nur-lesen">
		<strong>Nur Lesezugriff</strong> – Ihr Abo ist abgelaufen. Änderungen sind derzeit nicht möglich.
	</p>
{/if}

<style>
	.nur-lesen {
		max-width: 40rem;
		margin: 1rem auto 0;
		padding: 0.75rem 1rem;
		border: 1px solid #e0b252;
		border-radius: 0.5rem;
		background: #fff6e0;
		color: #4a3500;
	}
	@media (max-width: 42rem) {
		.nur-lesen {
			margin: 1rem 1rem 0;
		}
	}
</style>
