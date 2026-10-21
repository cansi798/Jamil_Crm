<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { tick } from 'svelte';

	/**
	 * Auswahlfeld im App-Stil statt der Browser-Liste (docs/design-regeln.md). Ersetzt <select> 1:1:
	 *   <Auswahl name="art" required onchange={…}> <option …>…</option> </Auswahl>
	 * Darunter liegt weiterhin ein echtes <select> (gleiche Attribute, Formularwert, Beschriftung über <label>,
	 * Tastatur und Screenreader, Tests mit selectOption). Darüber zeigt die App ein eigenes Feld; mit Maus/Stift öffnet
	 * sich eine eigene Liste, am Handy (Touch) die gewohnte Auswahl des Geräts.
	 */
	let {
		value = $bindable(),
		children,
		klein = false,
		...rest
	}: { value?: string | number | null; children: Snippet; klein?: boolean } & Omit<HTMLSelectAttributes, 'value' | 'children'> = $props();

	const id = `aw-${Math.random().toString(36).slice(2, 9)}`;
	let feld = $state<HTMLSelectElement>();
	let wurzel = $state<HTMLSpanElement>();
	let liste = $state<HTMLUListElement>();
	let offen = $state(false);
	let aktiv = $state(0);
	let optionen = $state<{ wert: string; text: string; aus: boolean; gruppe: string | null }[]>([]);
	let text = $state('');
	let leer = $state(true);

	function lesen() {
		if (!feld) return;
		optionen = [...feld.options].map((o) => ({
			wert: o.value,
			text: o.text,
			aus: o.disabled,
			gruppe: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : null
		}));
		const o = feld.selectedOptions[0];
		text = o?.text ?? '';
		leer = !o || o.value === '';
	}
	$effect(() => {
		if (!feld) return;
		lesen();
		// Optionen können sich ändern ({#each}); die Anzeige folgt
		const beobachter = new MutationObserver(lesen);
		beobachter.observe(feld, { childList: true, subtree: true, attributes: true, characterData: true });
		const aufAenderung = () => lesen();
		feld.addEventListener('change', aufAenderung);
		feld.addEventListener('input', aufAenderung);
		feld.form?.addEventListener('reset', () => setTimeout(lesen));
		return () => {
			beobachter.disconnect();
			feld?.removeEventListener('change', aufAenderung);
			feld?.removeEventListener('input', aufAenderung);
		};
	});
	$effect(() => {
		void value;
		tick().then(lesen);
	});

	const istTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

	async function oeffnen() {
		if (!feld || feld.disabled) return;
		if (istTouch()) {
			try {
				feld.showPicker();
			} catch {
				feld.focus();
			}
			return;
		}
		lesen();
		offen = true;
		aktiv = Math.max(0, feld.selectedIndex);
		await tick();
		zeigeListe();
		liste?.focus();
		liste?.querySelector(`#${id}-${aktiv}`)?.scrollIntoView({ block: 'nearest' });
	}

	/**
	 * Die Liste liegt als Overlay in der obersten Ebene (Popover-API, sonst position: fixed) – nie im Fluss des
	 * Formulars: sie verzieht keinen Dialog und schiebt nichts (Jamil msgs 3065/3067). Sie öffnet sich nach unten,
	 * wenn dort genug Platz ist, sonst nach oben; die Höhe ist auf den freien Platz begrenzt (darin scrollt sie).
	 */
	const RAND = 8;
	let lage = $state<{ links: number; breite: number; oben: number | null; unten: number | null; maxHoehe: number }>({ links: 0, breite: 0, oben: 0, unten: null, maxHoehe: 320 });
	function platziere() {
		if (!wurzel || !liste) return;
		const r = wurzel.getBoundingClientRect();
		const vh = window.innerHeight;
		const vw = document.documentElement.clientWidth;
		const unten = vh - r.bottom - RAND - 4;
		const oben = r.top - RAND - 4;
		const gewuenscht = Math.min(liste.scrollHeight, 320);
		const nachOben = unten < gewuenscht && oben > unten;
		const breite = Math.min(Math.max(r.width, 192), vw - 2 * RAND);
		const links = Math.min(Math.max(RAND, r.left), vw - RAND - breite);
		lage = nachOben
			? { links, breite, oben: null, unten: vh - r.top + 4, maxHoehe: Math.max(120, Math.min(320, oben)) }
			: { links, breite, oben: r.bottom + 4, unten: null, maxHoehe: Math.max(120, Math.min(320, unten)) };
	}
	function zeigeListe() {
		if (!liste) return;
		try {
			if (typeof liste.showPopover === 'function' && !liste.matches(':popover-open')) liste.showPopover();
		} catch {
			/* ohne Popover-API: position: fixed mit hohem z-index */
		}
		platziere();
	}
	// Scrollen (außerhalb der Liste) oder Größenänderung schließen die Liste – sie würde sonst vom Feld wegrutschen
	$effect(() => {
		if (!offen) return;
		const zu = (ev: Event) => {
			if (ev.type === 'scroll' && liste && ev.target instanceof Node && liste.contains(ev.target)) return;
			offen = false;
		};
		window.addEventListener('scroll', zu, true);
		window.addEventListener('resize', zu);
		return () => {
			window.removeEventListener('scroll', zu, true);
			window.removeEventListener('resize', zu);
		};
	});
	function waehle(i: number) {
		if (!feld || optionen[i]?.aus) return;
		feld.selectedIndex = i;
		value = feld.value;
		feld.dispatchEvent(new Event('input', { bubbles: true }));
		feld.dispatchEvent(new Event('change', { bubbles: true }));
		lesen();
		offen = false;
		feld.focus();
	}
	function taste(ev: KeyboardEvent) {
		if (ev.key === 'ArrowDown') aktiv = Math.min(optionen.length - 1, aktiv + 1);
		else if (ev.key === 'ArrowUp') aktiv = Math.max(0, aktiv - 1);
		else if (ev.key === 'Home') aktiv = 0;
		else if (ev.key === 'End') aktiv = optionen.length - 1;
		else if (ev.key === 'Enter' || ev.key === ' ') waehle(aktiv);
		else if (ev.key === 'Escape' || ev.key === 'Tab') {
			offen = false;
			if (ev.key === 'Escape') feld?.focus();
			return;
		} else return;
		ev.preventDefault();
		liste?.querySelector(`#${id}-${aktiv}`)?.scrollIntoView({ block: 'nearest' });
	}
	function draussen(ev: FocusEvent) {
		const ziel = ev.relatedTarget as Node | null;
		if (!ziel || !(ev.currentTarget as HTMLElement).contains(ziel)) offen = false;
	}
	// Mausklick aufs Feld: eigene Liste statt Browser-Liste (Tastatur bleibt beim echten <select>)
	function maus(ev: MouseEvent) {
		if (istTouch()) return;
		ev.preventDefault();
		if (offen) offen = false;
		else oeffnen();
	}
</script>

<span class="aw" class:klein class:offen class:aus={rest.disabled} onfocusout={draussen} bind:this={wurzel}>
	<!-- Echtes Feld zuerst: <label> um die Auswahl beschriftet das <select> -->
	<select bind:this={feld} bind:value {...rest} class="aw-feld" onmousedown={maus}>
		{@render children()}
	</select>
	<span class="aw-anzeige" class:leer aria-hidden="true">
		<span class="aw-text">{text}</span>
		<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</span>
	{#if offen}
		<ul
			bind:this={liste}
			class="ui-popover aw-liste"
			class:nach-oben={lage.unten !== null}
			popover="manual"
			role="listbox"
			tabindex="-1"
			aria-activedescendant={`${id}-${aktiv}`}
			onkeydown={taste}
			style:left={`${lage.links}px`}
			style:width={`${lage.breite}px`}
			style:top={lage.oben === null ? 'auto' : `${lage.oben}px`}
			style:bottom={lage.unten === null ? 'auto' : `${lage.unten}px`}
			style:max-height={`${lage.maxHoehe}px`}
		>
			{#each optionen as o, i (i)}
				{#if o.gruppe && o.gruppe !== optionen[i - 1]?.gruppe}<li class="aw-gruppe" role="presentation">{o.gruppe}</li>{/if}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={`${id}-${i}`}
					role="option"
					aria-selected={feld?.selectedIndex === i}
					aria-disabled={o.aus || undefined}
					class:aktiv={i === aktiv}
					class:leer={o.wert === ''}
					onmousemove={() => (aktiv = i)}
					onmousedown={(ev) => ev.preventDefault()}
					onclick={() => waehle(i)}
				>
					<span>{o.text}</span>
					{#if feld?.selectedIndex === i}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</span>

<style>
	.aw {
		position: relative;
		display: block;
		width: 100%;
		min-width: 0;
	}
	/* Das echte Feld liegt unsichtbar über der Anzeige (fängt Klick, Fokus, Tastatur) */
	.aw-feld {
		position: absolute !important;
		inset: 0;
		z-index: 1;
		width: 100% !important;
		height: 100% !important;
		min-height: 0 !important;
		margin: 0 !important;
		opacity: 0;
		cursor: pointer;
		appearance: none;
	}
	.aw-anzeige {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--ui-feld-hoehe);
		padding: 0 0.75rem 0 0.85rem;
		border: 1px solid var(--ui-rand-stark);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font-size: var(--ui-schrift-m);
		line-height: 1.3;
		transition: border-color 120ms, box-shadow 120ms;
	}
	.klein .aw-anzeige {
		min-height: 2.25rem;
		border-radius: 999px;
	}
	.aw-anzeige.leer .aw-text {
		color: #9a958c;
	}
	.aw-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.aw-anzeige svg {
		flex: none;
		width: 14px;
		height: 14px;
		color: var(--ui-text-leise);
		transition: transform 150ms;
	}
	.offen .aw-anzeige svg {
		transform: rotate(180deg);
	}
	.aw:hover .aw-anzeige {
		border-color: #b5ad9f;
	}
	.aw:focus-within .aw-anzeige,
	.offen .aw-anzeige {
		border-color: var(--ui-akzent);
		box-shadow: var(--ui-fokus-ring);
	}
	.aus .aw-anzeige {
		background: var(--ui-grau-hell);
		color: var(--ui-text-leise);
	}
	/* Overlay in der obersten Ebene (Popover) bzw. fixed – Lage setzt platziere() */
	.aw-liste {
		position: fixed;
		z-index: 1000;
		inset: auto;
		min-width: 12rem;
		max-height: 20rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		margin: 0;
		padding: 0.3rem;
		list-style: none;
		color: var(--ui-text);
	}
	.aw-liste li[role='option'] {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 2.375rem;
		padding: 0.35rem 0.7rem;
		border-radius: 8px;
		font-size: var(--ui-schrift-m);
		cursor: pointer;
	}
	.aw-liste li.leer {
		color: var(--ui-text-leise);
	}
	.aw-liste li.aktiv {
		background: var(--ui-akzent-zart);
	}
	.aw-liste li[aria-selected='true'] {
		font-weight: 600;
		background: var(--ui-akzent-hell);
	}
	.aw-liste li[aria-disabled='true'] {
		opacity: 0.45;
		cursor: default;
	}
	.aw-liste li svg {
		width: 16px;
		height: 16px;
		flex: none;
		color: var(--ui-akzent-text);
	}
	.aw-gruppe {
		padding: 0.5rem 0.7rem 0.2rem;
		color: var(--ui-akzent-text);
		font-family: var(--ui-schrift-titel);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
</style>
