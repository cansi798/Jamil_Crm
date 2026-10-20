<script lang="ts" module>
	const FARBEN = ['#3b7ff5', '#1f9d63', '#e8912d', '#8a4fd1', '#d9488f', '#0e9aa7', '#6366f1', '#c2410c'];
	/** Feste Farbe je Name (gleicher Name → gleiche Farbe). */
	export function avatarFarbe(name: string): string {
		const person = /^Ich \((.+)\)$/.exec(name.trim());
		if (person) name = person[1];
		let h = 0;
		for (const z of name) h = (h * 31 + z.charCodeAt(0)) >>> 0;
		return FARBEN[h % FARBEN.length];
	}
	/** Initialen: „Sabine Schäfer“ → „SS“, „Jamil (Test) – Chef“ → „JC“. */
	export function initialen(name: string): string {
		// „Ich (Jamil Iqbal)“ → Initialen der Person, nicht von „Ich“
		const person = /^Ich \((.+)\)$/.exec(name.trim());
		if (person) name = person[1];
		const teile = name
			.replace(/\(.*?\)/g, ' ')
			.split(/[\s–-]+/)
			.filter((t) => /^\p{L}/u.test(t));
		if (teile.length === 0) return '?';
		const erste = teile[0][0];
		const letzte = teile.length > 1 ? teile[teile.length - 1][0] : '';
		return (erste + letzte).toUpperCase();
	}
</script>

<script lang="ts">
	/** Runder Personen-Avatar mit Initialen (ohne Bild). `name` leer → gestrichelter Platzhalter. */
	let { name = '', groesse = 24 }: { name?: string | null; groesse?: number } = $props();
</script>

{#if name}
	<span class="avatar" style:width="{groesse}px" style:height="{groesse}px" style:font-size="{Math.round(groesse * 0.42)}px" style:background={avatarFarbe(name)} aria-hidden="true"
		>{initialen(name)}</span
	>
{:else}
	<span class="avatar leer" style:width="{groesse}px" style:height="{groesse}px" aria-hidden="true">
		<svg viewBox="0 0 16 16"><circle cx="8" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M3.2 13.2c.9-2.2 2.7-3.3 4.8-3.3s3.9 1.1 4.8 3.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
	</span>
{/if}

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		border-radius: 999px;
		color: #fff;
		font-weight: 600;
		letter-spacing: 0.02em;
		line-height: 1;
		user-select: none;
	}
	.leer {
		border: 1.5px dashed var(--ui-rand-stark);
		background: var(--ui-flaeche);
		color: var(--ui-text-leise);
	}
	.leer svg {
		width: 62%;
		height: 62%;
	}
</style>
