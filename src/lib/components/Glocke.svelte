<script lang="ts">
	/**
	 * Glocke (Wunsch Jamil msg 2679): Zahl der ungelesenen Erinnerungen, Liste zum Aufklappen. Aktualisiert sich jede
	 * Minute (wenn die Seite sichtbar ist) und beim Zurückkehren in die App.
	 */
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';

	type Eintrag = { id: string; titel: string; text: string | null; link: string; zeit: string; gelesen: boolean };
	let { start = 0, schmal = false }: { start?: number; schmal?: boolean } = $props();

	let ungelesen = $state(untrack(() => start));
	let offen = $state(false);
	let liste = $state<Eintrag[] | null>(null);
	let wurzel: HTMLElement | undefined = $state();

	$effect(() => {
		ungelesen = start;
	});

	async function laden() {
		try {
			const r = await fetch('/api/benachrichtigungen');
			if (!r.ok) return;
			const d = await r.json();
			ungelesen = d.ungelesen;
			liste = d.liste;
		} catch {
			/* offline – später erneut */
		}
	}
	async function gelesen(id?: string) {
		const r = await fetch('/api/benachrichtigungen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(id ? { id } : {}) });
		if (r.ok) {
			const d = await r.json();
			ungelesen = d.ungelesen;
			liste = d.liste;
		}
	}
	async function oeffne(e: Eintrag) {
		offen = false;
		if (!e.gelesen) await gelesen(e.id);
		await goto(e.link);
	}
	const zeit = (iso: string) =>
		new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

	onMount(() => {
		const t = setInterval(() => {
			if (document.visibilityState === 'visible') void laden();
		}, 60_000);
		const sichtbar = () => document.visibilityState === 'visible' && laden();
		document.addEventListener('visibilitychange', sichtbar);
		const aussen = (ev: PointerEvent) => {
			if (offen && wurzel && !wurzel.contains(ev.target as Node)) offen = false;
		};
		document.addEventListener('pointerdown', aussen);
		return () => {
			clearInterval(t);
			document.removeEventListener('visibilitychange', sichtbar);
			document.removeEventListener('pointerdown', aussen);
		};
	});
</script>

<div class="gl" class:schmal bind:this={wurzel}>
	<button
		type="button"
		class="gl-knopf"
		aria-expanded={offen}
		aria-label={ungelesen > 0 ? `Benachrichtigungen, ${ungelesen} ungelesen` : 'Benachrichtigungen'}
		onclick={() => {
			offen = !offen;
			if (offen) void laden();
		}}
	>
		<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /><path d="M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" /></svg>
		{#if ungelesen > 0}<span class="gl-zahl" aria-hidden="true">{ungelesen > 99 ? '99+' : ungelesen}</span>{/if}
	</button>
	{#if offen}
		<div class="gl-panel" role="region" aria-label="Benachrichtigungen">
			<header>
				<strong>Benachrichtigungen</strong>
				{#if ungelesen > 0}<button type="button" class="gl-link" onclick={() => gelesen()}>Alle gelesen</button>{/if}
			</header>
			{#if liste === null}
				<p class="gl-leer">Lädt …</p>
			{:else if liste.length === 0}
				<p class="gl-leer">Noch keine Erinnerungen. Beim Anlegen eines To-dos oder Termins „Erinnern“ wählen.</p>
			{:else}
				<ul>
					{#each liste as e (e.id)}
						<li class:neu={!e.gelesen}>
							<button type="button" onclick={() => oeffne(e)}>
								<strong>{e.titel}</strong>
								{#if e.text}<span>{e.text}</span>{/if}
								<small>{zeit(e.zeit)}</small>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<footer><a href="/konto/benachrichtigungen" onclick={() => (offen = false)}>Aufs Handy/PC schicken (Push) …</a></footer>
		</div>
	{/if}
</div>

<style>
	.gl {
		position: relative;
	}
	/* Handy: eigene schmale Zeile oben rechts über dem Inhalt (verdeckt keine Knöpfe der Seite) */
	.gl.schmal {
		display: flex;
		justify-content: flex-end;
		padding: calc(0.4rem + env(safe-area-inset-top)) 0.75rem 0;
		margin-bottom: -0.75rem;
	}
	.schmal .gl-panel {
		right: 0.75rem;
	}
	.gl-knopf {
		position: relative;
		display: inline-grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid transparent;
		border-radius: 50%;
		background: transparent;
		color: var(--ui-text, #1c1f23);
		cursor: pointer;
	}
	.schmal .gl-knopf {
		background: rgb(255 255 255 / 0.92);
		border-color: var(--ui-rand, #e1dfdd);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.08);
	}
	.gl-knopf:hover {
		background: var(--m365-flaeche-hover, #f3f2f1);
	}
	.gl-zahl {
		position: absolute;
		top: 2px;
		right: 0;
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.25rem;
		border-radius: 999px;
		background: #c50f1f;
		color: #fff;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1.15rem;
		text-align: center;
	}
	.gl-panel {
		position: absolute;
		right: 0;
		top: calc(100% + 0.4rem);
		width: min(22rem, calc(100vw - 1.5rem));
		max-height: min(30rem, 70vh);
		overflow: auto;
		border: 1px solid var(--ui-rand, #e1dfdd);
		border-radius: 0.6rem;
		background: #fff;
		box-shadow: 0 8px 28px rgb(0 0 0 / 0.16);
		z-index: 40;
	}
	.gl-panel header,
	.gl-panel footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 0.8rem;
	}
	.gl-panel header {
		border-bottom: 1px solid var(--ui-rand, #e1dfdd);
	}
	.gl-panel footer {
		border-top: 1px solid var(--ui-rand, #e1dfdd);
		font-size: 0.875rem;
	}
	.gl-link {
		border: 0;
		background: none;
		color: var(--m365-primaer, #0f6cbd);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.gl-panel ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.gl-panel li + li {
		border-top: 1px solid var(--ui-rand, #e1dfdd);
	}
	.gl-panel li button {
		display: grid;
		gap: 0.1rem;
		width: 100%;
		min-height: 3rem;
		padding: 0.55rem 0.8rem;
		border: 0;
		background: none;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	.gl-panel li button:hover {
		background: var(--m365-flaeche-hover, #f3f2f1);
	}
	.gl-panel li.neu button {
		background: #eaf2fb;
	}
	.gl-panel li span,
	.gl-panel li small {
		font-size: 0.8125rem;
		color: var(--ui-text-leise, #616161);
	}
	.gl-leer {
		margin: 0;
		padding: 0.8rem;
		font-size: 0.875rem;
		color: var(--ui-text-leise, #616161);
	}
</style>
