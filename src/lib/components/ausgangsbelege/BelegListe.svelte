<script lang="ts" module>
	/** Belegart als kleines Abzeichen vor der Nummer – nur dort, wo verschiedene Arten gemischt stehen (Auftrag, Jamil msg 3525). */
	export type BelegTyp = 'angebot' | 'ab' | 'rechnung';
	export const BELEG_TYP: Record<BelegTyp, { kurz: string; text: string }> = {
		angebot: { kurz: 'Angebot', text: 'Angebot' },
		ab: { kurz: 'AB', text: 'Auftragsbestätigung' },
		rechnung: { kurz: 'Rechnung', text: 'Rechnung' }
	};

	/** Eine Zeile der Belegliste – für jede Belegart gleich aufgebaut (Jamil msgs 3054–3056). */
	export type BelegZeile = {
		id: string;
		/** Ziel beim Klick auf die Zeile; `null` = ohne Link (Nutzer darf den Beleg nicht öffnen) */
		href: string | null;
		/** Zeile öffnet in neuem Tab (z. B. PDF einer Auftragsbestätigung) */
		neuerTab?: boolean;
		nummer: string;
		/** Kunde – auf der Auftragsseite weggelassen (steht dort schon) */
		kunde?: string | null;
		/** „AU-… · Titel“ oder null (→ „ohne Auftrag“); `undefined` = nicht anzeigen */
		auftrag?: string | null;
		/** Datum (bereits deutsch formatiert) */
		datum: string;
		/** optionaler Zusatz am Ende der Unterzeile (z. B. „versendet 21.10.2026“) */
		zusatz?: string | null;
		status: { text: string; klasse: string };
		/** Betrag rechts in der Unterzeile (nur mit „Preise sehen“) */
		betrag?: string | null;
		/** kleiner Warnhinweis unter der Unterzeile (z. B. „Preis fehlt“) */
		warnung?: string | null;
		/** PDF-Link rechts neben der Zeile */
		pdf?: string | null;
		/** Belegart-Abzeichen (gemischte Liste) */
		typ?: BelegTyp;
	};
</script>

<script lang="ts">
	/**
	 * EINE Belegliste für die Seite „Ausgangsbelege“ und die Karte „Ausgangsbelege“ am Auftrag (Jamil msgs 3054–3056, 3525):
	 * gleiche Zeile – Nummer (· Kunde), Status-Pill rechts, darunter Auftrag/Datum/Zusatz und Betrag, PDF-Knopf rechts.
	 * In gemischten Listen steht vor der Nummer die Belegart als Abzeichen (Angebot · AB · Rechnung), jede mit eigener Farbe.
	 */
	let { zeilen, leerText, kompakt = false, label }: { zeilen: BelegZeile[]; leerText: string; kompakt?: boolean; label?: string } = $props();
	const unterzeile = (z: BelegZeile) =>
		[z.auftrag === undefined ? null : (z.auftrag ?? 'ohne Auftrag'), z.datum, z.zusatz].filter(Boolean).join(' · ');
</script>

<ul class="kd-liste beleg-liste" class:kompakt aria-label={label}>
	{#each zeilen as z (z.id)}
		<li data-beleg={z.nummer} data-typ={z.typ}>
			<svelte:element this={z.href ? 'a' : 'div'} class="beleg-zeile" class:kd-kein-link={!z.href} href={z.href ?? undefined} target={z.href && z.neuerTab ? '_blank' : undefined} rel={z.href && z.neuerTab ? 'noopener' : undefined}>
				<span class="af-kopfzeile">
					<strong class="beleg-titel">
						{#if z.typ}<span class={`beleg-typ t-${z.typ}`} title={BELEG_TYP[z.typ].text}>{BELEG_TYP[z.typ].kurz}</span>{/if}
						{z.nummer}{#if z.kunde} · {z.kunde}{/if}
					</strong>
					<span class={`an-status ${z.status.klasse}`}>{z.status.text}</span>
				</span>
				<span class="af-kopfzeile">
					<span class="kd-info">{unterzeile(z)}</span>
					{#if z.betrag}<span class="kt-preis">{z.betrag}</span>{/if}
				</span>
				{#if z.warnung}<span class="kt-preis-fehlt">{z.warnung}</span>{/if}
			</svelte:element>
			{#if z.pdf}
				<a class="kd-knopf hell klein beleg-pdf" href={z.pdf} target="_blank" rel="noopener" aria-label={`PDF ${z.nummer} öffnen`}>PDF</a>
			{/if}
		</li>
	{:else}
		<li class="kd-leer">{leerText}</li>
	{/each}
</ul>

<style>
	.beleg-liste li:not(.kd-leer) {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.beleg-zeile {
		flex: 1;
		min-width: 0;
		border-bottom: 0 !important;
	}
	div.beleg-zeile {
		display: grid;
		gap: 0.15rem;
		padding: 0.75rem 1rem;
	}
	/* Trennlinie über die ganze Zeile (auch unter dem PDF-Knopf) */
	.beleg-liste li:not(.kd-leer) + li {
		border-top: 1px solid var(--ui-rand);
	}
	.beleg-titel {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.beleg-pdf {
		flex: none;
		margin-right: 8px;
	}
	.kompakt {
		margin: 0;
		box-shadow: none;
	}
	/* Belegart: ruhiges Abzeichen mit farbigem Rand – Angebot lila, AB blau, Rechnung grün (Statusfarben der App) */
	.beleg-typ {
		display: inline-flex;
		align-items: center;
		margin-right: 0.35rem;
		padding: 0 0.4rem;
		border: 1px solid currentColor;
		border-radius: 0.35rem;
		font-family: var(--ui-schrift-titel);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.15rem;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		vertical-align: 0.1em;
	}
	.t-angebot {
		color: var(--ui-lila);
	}
	.t-ab {
		color: var(--ui-blau);
	}
	.t-rechnung {
		color: var(--ui-gruen);
	}
</style>
