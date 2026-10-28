<script lang="ts">
	import InfoFeld from '$lib/components/ui/InfoFeld.svelte';
	import InfoFenster from '$lib/components/ui/InfoFenster.svelte';
	/**
	 * Leistungen für Bestandskunden (Jamil, Talk msgs 3408, 3534): Karte im Kundenportal – steht seit msg 3534 als Abschnitt in
	 * den Kundenportal-Einstellungen (kein eigener Menüpunkt mehr). Alles in EINEM Formular mit „Speichern“ (Aktion `aktion`);
	 * rechts bzw. darunter die Vorschau – genau die Karte des Portals.
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import FormFuss from '$lib/components/ui/FormFuss.svelte';
	import Schalter from '$lib/components/ui/Schalter.svelte';
	import BestandskundenKarte from '$lib/components/portal/BestandskundenKarte.svelte';
	import { BESTAND_AB_WAHL, BESTAND_GRENZEN as G, BESTAND_SYMBOLE, BESTAND_SYMBOL_SCHLUESSEL, bestandStandard, type BestandAb, type BestandKnopf, type BestandLeistung } from '$lib/bestandskunden';
	import { portalMarkeStil } from '$lib/portal-marke';
	import { rueckfrage } from '$lib/rueckfrage';
	import type { BestandEinstellung } from '$lib/bestandskunden';
	import type { PortalMarke } from '$lib/portal-marke';

	let {
		data,
		form,
		aktion
	}: {
		data: { e: BestandEinstellung; marke: PortalMarke; portalModul: boolean };
		form: { fehler?: string; bestandGespeichert?: boolean; bestandFehler?: boolean } | null | undefined;
		aktion: string;
	} = $props();

	// Arbeitskopie – wird erst mit „Speichern“ übernommen. Nach dem Speichern lädt SvelteKit `data` neu; dann übernimmt
	// die Arbeitskopie die gespeicherten (vom Server bereinigten) Werte, z. B. „tel:+49 40 …“ → „tel:+4940…“.
	let geladen = untrack(() => data.e);
	let aktiv = $state(untrack(() => data.e.aktiv));
	let ab = $state<BestandAb>(untrack(() => data.e.ab));
	let titel = $state(untrack(() => data.e.titel));
	let text = $state(untrack(() => data.e.text));
	let leistungen = $state<BestandLeistung[]>(untrack(() => data.e.leistungen.map((l) => ({ ...l }))));
	let knoepfe = $state<BestandKnopf[]>(untrack(() => data.e.knoepfe.map((k) => ({ ...k }))));
	$effect(() => {
		const e = data.e;
		if (e === geladen) return;
		geladen = e;
		aktiv = e.aktiv;
		ab = e.ab;
		titel = e.titel;
		text = e.text;
		leistungen = e.leistungen.map((l) => ({ ...l }));
		knoepfe = e.knoepfe.map((k) => ({ ...k }));
	});

	const daten = $derived(JSON.stringify({ aktiv, ab, titel, text, leistungen, knoepfe }));
	const vorschauStil = $derived(portalMarkeStil(data.marke).join('; '));
	const karte = $derived({ titel: titel.trim() || bestandStandard().titel, text: text.trim(), leistungen, knoepfe });

	function verschiebe<T>(liste: T[], i: number, richtung: -1 | 1) {
		const j = i + richtung;
		if (j < 0 || j >= liste.length) return;
		[liste[i], liste[j]] = [liste[j], liste[i]];
	}
	const neueLeistung = () => leistungen.push({ titel: '', text: '', symbol: 'stern' });
	const neuerKnopf = () => knoepfe.push({ text: '', url: '' });
	function zuruecksetzen() {
		const s = bestandStandard();
		ab = s.ab;
		titel = s.titel;
		text = s.text;
		leistungen = s.leistungen;
		knoepfe = [];
	}
	const ohneReset = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<section class="bk-bereich" id="bestandskunden" aria-labelledby="bestandskunden-titel">
	<header class="bk-kopf">
		<h2 id="bestandskunden-titel">Leistungen für Bestandskunden</h2>
		<p class="kd-info">Was Kunden im Kundenportal nach dem Auftrag sehen – ab einem Auftragsstatus oder immer.</p>
	</header>
	{#if form?.bestandFehler && form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	{#if form?.bestandGespeichert}<p role="status" class="kd-info">Gespeichert.</p>{/if}
	{#if !data.portalModul}<p class="kd-info">Das Kundenportal ist im aktuellen Tarif nicht enthalten – die Karte erscheint erst mit dem Modul.</p>{/if}

	<form method="POST" action={aktion} use:enhance={ohneReset} class="kd-formular bk-formular">
		<input type="hidden" name="daten" value={daten} />
		<div class="bk-spalten">
			<div class="bk-eingabe">
				<Abschnitt titel="Anzeige im Portal" info="bestand.seite">
					<Schalter bind:an={aktiv} info="bestand.aktiv" label="Karte im Kundenportal anzeigen" hinweis="Sie erscheint klein und dezent am Ende des Portals. Beim einzelnen Kunden abschaltbar (Kundenakte → Kundenportal)." />
					<InfoFeld id="bestand.ab"><label>Wann erscheint die Karte?
						<Auswahl bind:value={ab} name="ab">
							{#each BESTAND_AB_WAHL as w (w.wert)}<option value={w.wert} selected={ab === w.wert}>{w.text}</option>{/each}
						</Auswahl>
					</label></InfoFeld>
					<InfoFeld id="bestand.titel"><label>Überschrift
						<input type="text" bind:value={titel} maxlength={G.titel} placeholder="Auch nach Abschluss für Sie da" />
					</label></InfoFeld>
					<InfoFeld id="bestand.text"><label>Kleiner Text darunter (optional)
						<textarea bind:value={text} rows="3" maxlength={G.text} placeholder="Gerne unterstützen wir Sie auch künftig …"></textarea>
					</label></InfoFeld>
					<p class="kd-info">Die Überschrift muss das Wort „Bestandskunde“ nicht enthalten – Sie bestimmen die Wortwahl. Farben und Schrift übernimmt das Portal von Ihrem Briefkopf.</p>
				</Abschnitt>

				<Abschnitt titel="Leistungen" anzahl={leistungen.length} info="bestand.leistungen">
					{#if leistungen.length === 0}<p class="kd-leer">Keine Leistungen – im Portal erscheint dann nur der Text und die Knöpfe.</p>{/if}
					<ol class="bk-zeilen" aria-label="Leistungen">
						{#each leistungen as l, i (i)}
							<li data-testid="bestand-leistung">
								<div class="bk-felder">
									<label>Titel *
										<input type="text" bind:value={l.titel} maxlength={G.leistungTitel} required placeholder="z. B. Winterdienst" />
									</label>
									<label>Kurzer Text (optional)
										<input type="text" bind:value={l.text} maxlength={G.leistungText} placeholder="z. B. Räumen und Streuen ab 6 Uhr" />
									</label>
									<label class="bk-symbolwahl">Symbol
										<Auswahl bind:value={l.symbol}>
											{#each BESTAND_SYMBOL_SCHLUESSEL as s (s)}<option value={s} selected={l.symbol === s}>{BESTAND_SYMBOLE[s].name}</option>{/each}
										</Auswahl>
									</label>
								</div>
								<div class="bk-aktionen">
									<button type="button" class="kd-knopf hell klein" disabled={i === 0} aria-label={`Leistung ${i + 1} nach oben`} onclick={() => verschiebe(leistungen, i, -1)}>↑</button>
									<button type="button" class="kd-knopf hell klein" disabled={i === leistungen.length - 1} aria-label={`Leistung ${i + 1} nach unten`} onclick={() => verschiebe(leistungen, i, 1)}>↓</button>
									<button type="button" class="kd-knopf gefahr klein" use:rueckfrage={{ frage: `Leistung „${l.titel || i + 1}“ wirklich entfernen?`, ja: 'Entfernen' }} onclick={() => leistungen.splice(i, 1)}>Entfernen</button>
								</div>
							</li>
						{/each}
					</ol>
					<div>
						<button type="button" class="kd-knopf hell" disabled={leistungen.length >= G.leistungen} onclick={neueLeistung}>+ Leistung hinzufügen</button>
						{#if leistungen.length >= G.leistungen}<span class="kd-info"> Höchstens {G.leistungen} Leistungen.</span>{/if}
					</div>
				</Abschnitt>

				<Abschnitt titel="Knöpfe mit Link" anzahl={knoepfe.length} info="bestand.knoepfe">
					<p class="kd-info">Zum Beispiel „Termin anfragen“ mit Ihrer Anfrageseite oder „Anrufen“ mit <code>tel:+49…</code>. Erlaubt sind Adressen mit <code>https://</code>, <code>mailto:</code> und <code>tel:</code>. Internetadressen öffnen sich für den Kunden in einem neuen Tab.</p>
					{#if knoepfe.length === 0}<p class="kd-leer">Noch kein Knopf.</p>{/if}
					<ol class="bk-zeilen" aria-label="Knöpfe">
						{#each knoepfe as k, i (i)}
							<li data-testid="bestand-knopf">
								<div class="bk-felder">
									<label>Beschriftung *
										<input type="text" bind:value={k.text} maxlength={G.knopfText} required placeholder="z. B. Termin anfragen" />
									</label>
									<label class="bk-url">Link *
										<input type="text" inputmode="url" bind:value={k.url} maxlength={G.url} required placeholder="https://www.ihre-firma.de/anfrage" autocomplete="off" />
									</label>
								</div>
								<div class="bk-aktionen">
									<button type="button" class="kd-knopf hell klein" disabled={i === 0} aria-label={`Knopf ${i + 1} nach oben`} onclick={() => verschiebe(knoepfe, i, -1)}>↑</button>
									<button type="button" class="kd-knopf hell klein" disabled={i === knoepfe.length - 1} aria-label={`Knopf ${i + 1} nach unten`} onclick={() => verschiebe(knoepfe, i, 1)}>↓</button>
									<button type="button" class="kd-knopf gefahr klein" use:rueckfrage={{ frage: `Knopf „${k.text || i + 1}“ wirklich entfernen?`, ja: 'Entfernen' }} onclick={() => knoepfe.splice(i, 1)}>Entfernen</button>
								</div>
							</li>
						{/each}
					</ol>
					<div>
						<button type="button" class="kd-knopf hell" disabled={knoepfe.length >= G.knoepfe} onclick={neuerKnopf}>+ Knopf hinzufügen</button>
						{#if knoepfe.length >= G.knoepfe}<span class="kd-info"> Höchstens {G.knoepfe} Knöpfe.</span>{/if}
					</div>
				</Abschnitt>
			</div>

			<aside class="bk-vorschau" aria-label="Vorschau">
				<Abschnitt titel="Vorschau – so sieht der Kunde es">
					{#if !aktiv}<p class="kt-hinweis warnung" role="note">Ausgeschaltet – Kunden sehen die Karte nicht.</p>{/if}
					<div class="bk-bild" class:aus={!aktiv} style={vorschauStil} data-testid="bestand-vorschau">
						<BestandskundenKarte {karte} vorschau />
					</div>
				</Abschnitt>
			</aside>
		</div>

		<FormFuss>
			{#snippet links()}
				<button type="button" class="kd-knopf hell" use:rueckfrage={{ frage: 'Alle Angaben auf die Standardtexte zurücksetzen? (Gespeichert wird erst mit „Speichern“.)', ja: 'Zurücksetzen' }} onclick={zuruecksetzen}>Standard wiederherstellen</button>
			{/snippet}
			<button type="submit" class="kd-knopf">Speichern</button>
		</FormFuss>
	</form>
</section>

<style>
	.bk-bereich {
		display: grid;
		gap: 0.75rem;
		margin-top: 1.5rem;
		scroll-margin-top: 5rem;
	}
	.bk-kopf h2 {
		margin: 0;
		font-family: var(--ui-schrift-titel);
		font-size: 1.25rem;
	}
	.bk-kopf p {
		margin: 0.15rem 0 0;
	}
	.bk-spalten {
		display: grid;
		gap: 1rem;
		align-items: start;
	}
	@media (min-width: 1100px) {
		.bk-spalten {
			grid-template-columns: minmax(0, 1fr) 24rem;
		}
		.bk-vorschau {
			position: sticky;
			top: 1rem;
		}
	}
	.bk-eingabe {
		display: grid;
		gap: 1rem;
		min-width: 0;
	}
	.bk-zeilen {
		display: grid;
		gap: 0.6rem;
		margin: 0 0 0.6rem;
		padding: 0;
		list-style: none;
	}
	.bk-zeilen li {
		display: grid;
		gap: 0.5rem;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
	}
	.bk-felder {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.5rem 0.75rem;
	}
	.bk-url {
		grid-column: span 2;
	}
	@media (max-width: 640px) {
		.bk-url {
			grid-column: auto;
		}
	}
	.bk-aktionen {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.4rem;
	}
	.bk-bild {
		padding: 0.9rem;
		border-radius: var(--ui-radius);
		background: var(--pt-grund);
	}
	.bk-bild.aus {
		opacity: 0.5;
	}
</style>
