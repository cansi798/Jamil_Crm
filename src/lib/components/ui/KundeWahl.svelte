<script lang="ts" module>
	export type KundeTreffer = { id: string; name: string; adresse: string | null; info: string };
</script>

<script lang="ts">
	import Avatar from './Avatar.svelte';

	/**
	 * Kundenauswahl mit Live-Suche (docs/design-regeln.md: Suchfelder ohne „Suchen“-Knopf). Tippen sucht nach kurzer
	 * Pause in der Kundendatenbank (`/api/kunden?suche=`), die Treffer erscheinen als Liste darunter; Pfeiltasten +
	 * Enter oder Klick wählen. `onwaehle` bekommt den Kunden.
	 */
	let {
		onwaehle,
		label = 'Kunden suchen',
		placeholder = 'Name, Ort oder Telefon eintippen …',
		autofocus = false
	}: { onwaehle: (k: KundeTreffer) => void; label?: string; placeholder?: string; autofocus?: boolean } = $props();

	const id = `kw-${Math.random().toString(36).slice(2, 9)}`;
	let text = $state('');
	let treffer = $state<KundeTreffer[]>([]);
	let meldung = $state<string | null>(null);
	let laedt = $state(false);
	let offen = $state(false);
	let aktiv = $state(0);
	let zeit: ReturnType<typeof setTimeout> | undefined;
	let lauf = 0;

	const adresse = (o: { strasse?: string | null; plz?: string | null; ort?: string | null }) =>
		[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');

	async function suchen() {
		const q = text.trim();
		const nr = ++lauf;
		if (q.length === 0) {
			treffer = [];
			meldung = null;
			offen = false;
			return;
		}
		laedt = true;
		try {
			const r = await fetch(`/api/kunden?suche=${encodeURIComponent(q)}`);
			if (nr !== lauf) return;
			if (!r.ok) {
				treffer = [];
				meldung = r.status === 403 ? 'Die Kundensuche ist für Ihr Konto nicht freigegeben.' : 'Die Suche hat nicht geklappt.';
			} else {
				const liste: { id: string; name: string; strasse?: string | null; plz?: string | null; ort: string | null; telefon: string | null }[] = await r.json();
				treffer = liste.slice(0, 12).map((k) => ({
					id: k.id,
					name: k.name,
					adresse: adresse(k) || null,
					info: [k.ort, k.telefon].filter(Boolean).join(' · ')
				}));
				meldung = treffer.length === 0 ? 'Keine Kunden gefunden.' : null;
			}
			offen = true;
			aktiv = 0;
		} catch {
			if (nr === lauf) meldung = 'Keine Verbindung. Bitte erneut versuchen.';
		} finally {
			if (nr === lauf) laedt = false;
		}
	}
	function eingabe() {
		clearTimeout(zeit);
		zeit = setTimeout(suchen, 220);
	}
	function waehle(k: KundeTreffer) {
		offen = false;
		text = '';
		treffer = [];
		onwaehle(k);
	}
	function taste(ev: KeyboardEvent) {
		if (ev.key === 'Enter') {
			// Enter wählt den markierten Treffer – nie das umgebende Formular abschicken
			ev.preventDefault();
			if (offen && treffer[aktiv]) waehle(treffer[aktiv]);
			else {
				clearTimeout(zeit);
				void suchen();
			}
		} else if (ev.key === 'ArrowDown') {
			ev.preventDefault();
			if (!offen && treffer.length) offen = true;
			aktiv = Math.min(treffer.length - 1, aktiv + 1);
		} else if (ev.key === 'ArrowUp') {
			ev.preventDefault();
			aktiv = Math.max(0, aktiv - 1);
		} else if (ev.key === 'Escape') offen = false;
	}
</script>

<div class="kw" onfocusout={(ev) => { if (!(ev.currentTarget as HTMLElement).contains(ev.relatedTarget as Node)) offen = false; }}>
	<div class="kw-feld">
		<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="search"
			role="combobox"
			aria-label={label}
			aria-expanded={offen}
			aria-controls={`${id}-liste`}
			aria-autocomplete="list"
			aria-activedescendant={offen && treffer[aktiv] ? `${id}-${aktiv}` : undefined}
			bind:value={text}
			oninput={eingabe}
			onkeydown={taste}
			onfocus={() => { if (treffer.length) offen = true; }}
			{placeholder}
			{autofocus}
			autocomplete="off"
			enterkeyhint="search"
		/>
		{#if laedt}<span class="kw-laedt" aria-hidden="true"></span>{/if}
	</div>
	{#if offen && (treffer.length > 0 || meldung)}
		<ul id={`${id}-liste`} class="ui-popover kw-liste" role="listbox" aria-label="Gefundene Kunden">
			{#each treffer as t, i (t.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={`${id}-${i}`}
					role="option"
					aria-selected={i === aktiv}
					class:aktiv={i === aktiv}
					onmousemove={() => (aktiv = i)}
					onmousedown={(ev) => ev.preventDefault()}
					onclick={() => waehle(t)}
				>
					<Avatar name={t.name} groesse={30} />
					<span class="kw-text"><strong>{t.name}</strong>{#if t.info}<span class="kd-info">{t.info}</span>{/if}</span>
				</li>
			{/each}
			{#if meldung}<li class="kw-meldung" role="status">{meldung}</li>{/if}
		</ul>
	{/if}
</div>

<style>
	.kw {
		position: relative;
		width: 100%;
	}
	.kw-feld {
		position: relative;
	}
	.kw-feld svg {
		position: absolute;
		left: 0.85rem;
		top: 50%;
		width: 16px;
		height: 16px;
		margin-top: -8px;
		color: var(--ui-text-leise);
		pointer-events: none;
	}
	.kw-feld input {
		width: 100%;
		padding-left: 2.4rem !important;
	}
	.kw-laedt {
		position: absolute;
		right: 0.85rem;
		top: 50%;
		width: 14px;
		height: 14px;
		margin-top: -7px;
		border: 2px solid var(--ui-akzent-rand);
		border-top-color: var(--ui-akzent);
		border-radius: 50%;
		animation: kw-dreh 700ms linear infinite;
	}
	@keyframes kw-dreh {
		to {
			transform: rotate(360deg);
		}
	}
	.kw-liste {
		position: absolute;
		z-index: 30;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 20rem;
		overflow-y: auto;
		margin: 0;
		padding: 0.3rem;
		list-style: none;
	}
	.kw-liste li[role='option'] {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-height: 2.75rem;
		padding: 0.35rem 0.6rem;
		border-radius: 8px;
		cursor: pointer;
	}
	.kw-liste li.aktiv {
		background: var(--ui-akzent-hell);
	}
	.kw-text {
		display: grid;
		min-width: 0;
		line-height: 1.3;
	}
	.kw-meldung {
		padding: 0.6rem 0.75rem;
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-m);
	}
</style>
