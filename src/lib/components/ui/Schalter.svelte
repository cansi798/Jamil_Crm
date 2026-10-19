<script lang="ts">
	/** Kippschalter (role="switch") statt Häkchen – z. B. „Wiederkehrend“. Optional mit `name` im Formular. */
	let {
		an = $bindable(false),
		label,
		name,
		hinweis,
		klasse = ''
	}: { an?: boolean; label: string; name?: string; hinweis?: string; klasse?: string } = $props();
</script>

<label class={`sch ${klasse}`}>
	<input type="checkbox" {name} bind:checked={an} />
	<span class="sch-bahn" aria-hidden="true"><span class="sch-knopf"></span></span>
	<span class="sch-text">{label}{#if hinweis}<small>{hinweis}</small>{/if}</span>
</label>

<style>
	.sch {
		position: relative;
		display: inline-flex !important;
		align-items: center;
		gap: 0.6rem;
		min-height: var(--ui-feld-hoehe);
		color: var(--ui-text) !important;
		font-size: var(--ui-schrift-m) !important;
		font-weight: 500 !important;
		cursor: pointer;
		user-select: none;
	}
	/* Das echte Kästchen liegt unsichtbar über dem Schalter (Tastatur, Screenreader, Tests) */
	.sch input {
		position: absolute;
		left: 0;
		top: 50%;
		width: 1.75rem !important;
		min-width: 0 !important;
		height: 1.375rem !important;
		min-height: 0 !important;
		margin: -0.6875rem 0 0 !important;
		opacity: 0;
		z-index: 1;
		cursor: pointer;
	}
	.sch-bahn {
		position: relative;
		flex: none;
		width: 2.25rem;
		height: 1.375rem;
		border-radius: 999px;
		background: var(--ui-rand-stark);
		transition: background 150ms;
	}
	.sch-knopf {
		position: absolute;
		top: 3px;
		left: 3px;
		width: calc(1.375rem - 6px);
		height: calc(1.375rem - 6px);
		border-radius: 999px;
		background: #fff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		transition: transform 150ms;
	}
	.sch input:checked + .sch-bahn {
		background: var(--ui-akzent);
	}
	.sch input:checked + .sch-bahn .sch-knopf {
		transform: translateX(0.875rem);
	}
	.sch input:focus-visible + .sch-bahn {
		box-shadow: var(--ui-fokus-ring);
	}
	.sch-text {
		display: grid;
		line-height: 1.25;
	}
	.sch-text small {
		color: var(--ui-text-leise);
		font-weight: 400;
		font-size: var(--ui-schrift-xs);
	}
</style>
