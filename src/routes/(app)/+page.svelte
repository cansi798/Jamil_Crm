<script lang="ts">
	import FilterLeiste from '$lib/components/ui/FilterLeiste.svelte';
	import KundeWahl from '$lib/components/ui/KundeWahl.svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { flip } from 'svelte/animate';
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import NavSymbol from '$lib/components/NavSymbol.svelte';
	import HeuteListe from '$lib/components/HeuteListe.svelte';
	import ZeitKnoepfe from '$lib/components/zeit/ZeitKnoepfe.svelte';
	import { loesche, speichere } from '$lib/heute-kopie';
	import { berlinTag, berlinUhrzeit, tagDeutsch, tagKurz } from '$lib/zeit';
	import { kennzahlText } from '$lib/kennzahlen';
	import { euro } from '$lib/geld';
	import { GROESSEN, GROESSE_NAMEN, SPALTEN, kachelArt, verschiebe, zieheAuf, type Groesse, type StartLayout } from '$lib/start-kacheln';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Kopie für schlechtes Netz (nur auf diesem Gerät, bis zum Abmelden bzw. bis morgen)
	$effect(() => {
		if (data.heute && data.benutzerId) speichere(data.benutzerId, data.heuteTag, data.heute, new Date());
		else loesche(); // kein Zugriff auf Einsätze → auch keine (alte) Kopie auf diesem Gerät
	});

	// Frei zusammenstellbarer Start (Jamil msg 2942): Bearbeiten-Modus mit Entwurf; „Fertig“ speichert serverseitig
	let bearbeiten = $state(false);
	let entwurf = $state<StartLayout>([]);
	let katalogOffen = $state(false);
	let speichert = $state(false);
	let zieht = $state<string | null>(null);
	const anzeige = $derived(bearbeiten ? entwurf : data.layout);
	const geladen = $derived(new Set(data.layout.map((e) => e.id)));
	const frei = $derived(data.katalog.filter((a) => !entwurf.some((e) => e.id === a.id)));
	const titel = (id: string) => kachelArt(id)?.titel ?? id;

	function starten() {
		entwurf = data.layout.map((e) => ({ ...e }));
		katalogOffen = false;
		bearbeiten = true;
	}
	function abbrechen() {
		bearbeiten = false;
		katalogOffen = false;
	}
	function hinzufuegen(id: string) {
		const a = kachelArt(id);
		if (a) entwurf = [...entwurf, { id, groesse: a.groesse, hoehe: a.hoehe }];
	}
	const entfernen = (id: string) => (entwurf = entwurf.filter((e) => e.id !== id));
	const setzeGroesse = (id: string, groesse: Groesse) => (entwurf = entwurf.map((e) => (e.id === id ? { ...e, groesse } : e)));
	const setzeHoehe = (id: string) => (entwurf = entwurf.map((e) => (e.id === id ? { ...e, hoehe: e.hoehe === 2 ? 1 : 2 } : e)));
	const schiebe = (i: number, r: -1 | 1) => (entwurf = verschiebe(entwurf, i, r));

	// Ziehen am Griff – Maus, Stift und Finger gleich (Pointer-Events statt HTML-Drag&Drop, das am Handy nicht geht)
	function griffRunter(ev: PointerEvent, id: string) {
		zieht = id;
		(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
		ev.preventDefault();
	}
	function griffBewegt(ev: PointerEvent) {
		if (!zieht) return;
		if (ev.clientY < 70) window.scrollBy(0, -14);
		else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
		const ziel = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-kachel]') as HTMLElement | null)?.dataset.kachel;
		if (ziel && ziel !== zieht) entwurf = zieheAuf(entwurf, zieht, ziel);
	}
	const griffHoch = () => (zieht = null);

	const prozentBreite = (p: number) => `${Math.min(100, Math.max(2, p))}%`;
	const maxUmsatz = $derived(Math.max(1, ...(data.cockpit?.quellen ?? []).map((q) => q.umsatzCent)));
	const bereiche = $derived((data.navigation?.haupt ?? []).filter((e) => e.symbol !== 'start'));
	const kennzahl = (id: string) => data.cockpit?.kennzahlen.find((k) => `kz-${k.id}` === id) ?? null;
	const nachfassen = $derived(data.cockpit?.handlung.find((h) => h.id === 'nachfassen') ?? null);
	const stil = (e: { groesse: Groesse }) => `--sp: ${SPALTEN[e.groesse]}; --sp-t: ${e.groesse === 's' || e.groesse === 'm' ? 6 : 12}`;
</script>

<svelte:head>
	<title>Start – CRM System</title>
</svelte:head>

{#snippet leer(text: string)}
	<div class="heute-karte st-leer"><p class="leise">{text}</p></div>
{/snippet}

{#snippet kachel(id: string)}
	{#if bearbeiten && !geladen.has(id)}
		<div class="heute-karte st-platzhalter"><h2>{titel(id)}</h2><p class="leise">Inhalt erscheint nach „Fertig“.</p></div>
	{:else if id === 'zeiterfassung'}
		{#if data.zeit}
			<section aria-labelledby="zeit-titel" class="heute-karte zeit-karte" data-testid="heute-zeiterfassung">
				<div class="plan-kopf">
					<h2 id="zeit-titel">Zeiterfassung</h2>
					<a href="/zeiten" class="zeit-link">Meine Zeiten</a>
				</div>
				{#each data.zeit.auftraege as a (a.id)}
					<div class="zeit-auftrag">
						<p class="zeit-auftrag-titel"><a href={`/auftraege/${a.id}`}>{a.nummer} · {a.titel}</a>{#if a.kunde}<small>{a.kunde}</small>{/if}</p>
						<ZeitKnoepfe auftragId={a.id} titel={`${a.nummer} ${a.titel}`} laufend={data.zeit.laufend} kompakt />
					</div>
				{:else}
					<p class="leise">Heute keine Aufträge eingeplant – Zeiten starten Sie im Auftrag selbst.</p>
				{/each}
			</section>
		{:else}{@render leer('Zeiterfassung ist hier nicht verfügbar.')}{/if}
	{:else if id === 'monat'}
		{#if data.monat}
			<a href={data.monat.link} class="heute-karte monat-kachel" class:erreicht={data.monat.erreicht} aria-label={`Diesen Monat: ${data.monat.satz} – Auslastung öffnen`}>
				<span class="monat-titel">Diesen Monat</span>
				<span class="monat-satz">{data.monat.satz}</span>
				{#if data.monat.kalkulationFehlt}<small>Kalkulation unvollständig – Kosten und freie Stunden fehlen.</small>{/if}
			</a>
		{:else}{@render leer('Diesen Monat: keine Daten.')}{/if}
	{:else if id === 'heute'}
		{#if data.plan}
			<section aria-labelledby="heute-titel" class="heute-karte plan">
				<div class="plan-kopf">
					<h2 id="heute-titel">Heute <small>{tagKurz(data.heuteTag)}</small></h2>
					{#if data.personen.length > 0}
						<form method="GET" class="plan-person">
							<PersonWahl
								name="person"
								label="Person"
								klein
								required
								personen={data.personen.map((p) => ({ id: p.id, name: p.id === data.benutzerId ? `Ich (${p.name})` : p.name }))}
								wert={data.plan.person.id}
								absenden
							/>
							<noscript><button type="submit" class="kd-knopf hell">Zeigen</button></noscript>
						</form>
					{/if}
				</div>
				<p class="plan-text">{data.plan.text}</p>
				{#each [{ titel: 'Termine', liste: data.plan.termine }, { titel: 'Aufgaben', liste: data.plan.todos }, { titel: 'Nachfassen', liste: data.plan.nachfassen }] as ab (ab.titel)}
					{#if ab.liste.length > 0}
						<h3>{ab.titel}</h3>
						<ul class="plan-liste">
							{#each ab.liste as e, i (i)}
								<li class:ueberfaellig={e.ueberfaellig}>
									<span class="plan-zeit">{e.zeit}</span>
									<span class="plan-was"><a href={e.link}>{e.titel}</a>{#if e.ort}<small>{e.ort}</small>{/if}</span>
								</li>
							{/each}
						</ul>
					{/if}
				{/each}
			</section>
		{:else if data.heute}
			<section aria-labelledby="heute-titel" class="heute-karte">
				<h2 id="heute-titel">Meine Einsätze heute <small>{tagKurz(data.heuteTag)}</small></h2>
				<HeuteListe einsaetze={data.heute} />
			</section>
		{:else}{@render leer('Heute: keine Daten.')}{/if}
	{:else if id === 'kennzahlen' && data.cockpit}
		<section class="heute-karte" aria-labelledby="st-kz">
			<div class="plan-kopf">
				<h2 id="st-kz">Kennzahlen <small>Dieser Monat</small></h2>
				<a href="/auswertung/kennzahlen" class="zeit-link">Alle Kennzahlen</a>
			</div>
			<ul class="st-kz-liste">
				{#each data.cockpit.kennzahlen as kz (kz.id)}
					<li class={`st-kz ampel-${kz.ampel ?? 'keine'}`} title={kz.info.formel}>
						<strong>{kz.fehlt ? '–' : kennzahlText(kz.info.einheit, kz.wert)}</strong>
						<span class="st-kz-titel">{kz.info.titel}</span>
						<small>{kz.fehlt ?? kz.ampelText ?? kz.info.richtwert ?? ''}</small>
					</li>
				{/each}
			</ul>
		</section>
	{:else if id.startsWith('kz-') && kennzahl(id)}
		{@const kz = kennzahl(id)!}
		<a href="/auswertung/kennzahlen" class={`heute-karte st-kz einzeln ampel-${kz.ampel ?? 'keine'}`} title={kz.info.formel}>
			<strong>{kz.fehlt ? '–' : kennzahlText(kz.info.einheit, kz.wert)}</strong>
			<span class="st-kz-titel">{kz.info.titel}</span>
			<small>{kz.fehlt ?? kz.ampelText ?? 'Dieser Monat'}</small>
		</a>
	{:else if id === 'handlung' && data.cockpit}
		<section class="heute-karte" aria-labelledby="st-hb">
			<div class="plan-kopf"><h2 id="st-hb">Handlungsbedarf</h2></div>
			<ul class="st-handlung">
				{#each data.cockpit.handlung as h (h.id)}
					<li>
						<a href={h.href} class={`st-h ton-${h.ton}`} class:null={h.anzahl === 0}>
							<strong>{h.anzahl}</strong><span>{h.titel}</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{:else if id === 'nachfassen' && nachfassen}
		<a href={nachfassen.href} class="heute-karte st-kz einzeln ampel-{nachfassen.anzahl > 0 ? 'rot' : 'gruen'}">
			<strong>{nachfassen.anzahl}</strong>
			<span class="st-kz-titel">Nachfassen fällig</span>
			<small>{nachfassen.anzahl > 0 ? 'Aufträge ansehen' : 'Alles erledigt'}</small>
		</a>
	{:else if id === 'auslastung' && data.cockpit}
		<section class="heute-karte" aria-labelledby="st-al">
			<div class="plan-kopf">
				<h2 id="st-al">Auslastung <small>nächste 2 Wochen</small></h2>
				<a href="/plantafel?ansicht=team" class="zeit-link">Plantafel</a>
			</div>
			<ul class="st-balken">
				{#each data.cockpit.auslastung.zeilen as z (z.id)}
					<li>
						<span class="st-name">{z.name}</span>
						<span class="st-bahn" aria-hidden="true"><span class:voll={z.prozent > 100} style:width={prozentBreite(z.prozent)}></span></span>
						<span class="st-wert">{z.prozent} %</span>
					</li>
				{:else}
					<li class="kd-info">Keine aktiven Mitarbeiter.</li>
				{/each}
			</ul>
		</section>
	{:else if id === 'quellen' && data.cockpit?.quellen}
		<section class="heute-karte" aria-labelledby="st-q">
			<div class="plan-kopf">
				<h2 id="st-q">Umsatz nach Auftragsquelle <small>dieses Jahr</small></h2>
				<a href="/auswertung/quellen" class="zeit-link">Auswertung</a>
			</div>
			<ul class="st-balken">
				{#each data.cockpit.quellen as q (q.name)}
					<li>
						<span class="st-name">{q.name}</span>
						<span class="st-bahn" aria-hidden="true"><span style:width={prozentBreite((q.umsatzCent / maxUmsatz) * 100)}></span></span>
						<span class="st-wert">{euro(q.umsatzCent)}</span>
					</li>
				{:else}
					<li class="kd-info">Noch keine Aufträge mit Quelle in diesem Jahr.</li>
				{/each}
			</ul>
		</section>
	{:else if id === 'buchungen' && data.buchungen}
		<section class="heute-karte" aria-labelledby="st-bu">
			<div class="plan-kopf">
				<h2 id="st-bu">Neue Online-Buchungen <small>7 Tage</small></h2>
				<strong class="st-zahl">{data.buchungen.anzahl}</strong>
			</div>
			<ul class="plan-liste">
				{#each data.buchungen.liste as b (b.id)}
					<li>
						<span class="plan-zeit">{tagKurz(berlinTag(new Date(b.beginn)))} {berlinUhrzeit(new Date(b.beginn))}</span>
						<span class="plan-was"><a href={b.auftragId ? `/auftraege/${b.auftragId}` : '/plantafel'}>{b.name}</a></span>
					</li>
				{:else}
					<li class="leise">Keine neuen Buchungen.</li>
				{/each}
			</ul>
		</section>
	{:else if id === 'nachweise' && data.nachweise}
		<section class="heute-karte" aria-labelledby="st-nw">
			<div class="plan-kopf">
				<h2 id="st-nw">Partner-Nachweise</h2>
				<a href="/partner" class="zeit-link">Partner</a>
			</div>
			<ul class="plan-liste">
				{#each data.nachweise as n (n.partnerId + n.art + n.gueltigBis)}
					<li class:ueberfaellig={n.abgelaufen}>
						<span class="plan-zeit">{n.abgelaufen ? 'abgelaufen' : 'bis'} {tagDeutsch(n.gueltigBis)}</span>
						<span class="plan-was"><a href={`/partner/${n.partnerId}`}>{n.partner}</a><small>{n.art}</small></span>
					</li>
				{:else}
					<li class="leise">Alle Nachweise gültig.</li>
				{/each}
			</ul>
		</section>
	{:else if id === 'bereiche'}
		<section class="heute-karte" aria-labelledby="st-be">
			<h2 id="st-be">Bereiche</h2>
			{#if bereiche.length > 0}
				<ul class="kacheln">
					{#each bereiche as e (e.name)}
						<li>
							{#if e.href}
								<a href={e.href} class="kachel"><NavSymbol symbol={e.symbol} /><span>{e.name}</span></a>
							{:else}
								<span class="kachel aus" aria-disabled="true"><NavSymbol symbol={e.symbol} /><span>{e.name}</span>{#if e.hinweis}<small>{e.hinweis}</small>{/if}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="leise">Für Ihr Konto sind noch keine Bereiche freigeschaltet.</p>
			{/if}
		</section>
	{:else}
		{@render leer(`${titel(id)}: keine Daten.`)}
	{/if}
{/snippet}

<main class="start kd-seite breit">
	<header class="seiten-kopf">
		<div><h1>Start</h1></div>
		{#if data.darfKundeAnlegen}
			<div class="seiten-aktionen"><a href="/kunden/neu" class="kd-knopf">+ Kunde</a></div>
		{/if}
	</header>

	<FilterLeiste form={false} label="Kunden suchen">
		{#snippet suche()}
			{#if data.kunden}
				<div class="suche">
					<KundeWahl label="Kunden suchen" placeholder="Kunden suchen – Name, Ort oder Telefon" onwaehle={(k) => goto(`/kunden/${k.id}`)} />
				</div>
			{/if}
		{/snippet}
		{#snippet rechts()}
			{#if !bearbeiten}<button type="button" class="knopf-ghost" onclick={starten}>Start anpassen</button>{/if}
		{/snippet}
	</FilterLeiste>

	{#if bearbeiten}
		<section class="st-leiste" aria-label="Start anpassen">
			<p class="kd-info">Ziehen am Griff <span aria-hidden="true">⠿</span> oder mit ↑ ↓ verschieben, Größe S/M/L/Breit und Höhe wählen. Gilt für Sie auf allen Geräten.</p>
			{#if form?.layoutFehler}<p role="alert" class="kd-fehler">{form.layoutFehler}</p>{/if}
			<div class="st-leiste-knoepfe">
				<button type="button" class="knopf-ghost" aria-expanded={katalogOffen} onclick={() => (katalogOffen = !katalogOffen)}>+ Kachel hinzufügen</button>
				<form method="POST" action="?/standard" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') abbrechen(); }}>
					<button type="submit" class="knopf-ghost">Standard wiederherstellen</button>
				</form>
				<span class="st-rechts">
					<button type="button" class="kd-knopf hell" onclick={abbrechen}>Abbrechen</button>
					<form method="POST" action="?/layout" use:enhance={() => { speichert = true; return async ({ result, update }) => { await update(); speichert = false; if (result.type === 'success') abbrechen(); }; }}>
						<input type="hidden" name="layout" value={JSON.stringify(entwurf)} />
						<button type="submit" class="kd-knopf" disabled={speichert}>Fertig</button>
					</form>
				</span>
			</div>
			{#if katalogOffen}
				<div class="st-katalog" role="group" aria-label="Kachel hinzufügen">
					{#each frei as a (a.id)}
						<button type="button" class="st-katalog-eintrag" onclick={() => hinzufuegen(a.id)}>
							<strong>+ {a.titel}</strong><small>{a.gruppe} · {a.beschreibung}</small>
						</button>
					{:else}
						<p class="leise">Alle verfügbaren Kacheln sind schon auf Ihrem Start.</p>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	{#if anzeige.length === 0}
		<p class="leise st-ganz-leer">Ihr Start ist leer – über „Start anpassen“ fügen Sie Kacheln hinzu.</p>
	{/if}
	<div class="st-raster" class:bearbeiten>
		{#each anzeige as e, i (e.id)}
			<div class="st-k" class:hoch={e.hoehe === 2} class:zieht={zieht === e.id} data-kachel={e.id} data-groesse={e.groesse} style={stil(e)} animate:flip={{ duration: 180 }}>
				{#if bearbeiten}
					<div class="st-werkzeug" role="group" aria-label={`Kachel ${titel(e.id)}`}>
						<button type="button" class="st-griff" aria-label={`${titel(e.id)} ziehen`} title="Ziehen zum Verschieben" onpointerdown={(ev) => griffRunter(ev, e.id)} onpointermove={griffBewegt} onpointerup={griffHoch} onpointercancel={griffHoch}>⠿</button>
						<span class="st-wz-titel">{titel(e.id)}</span>
						<button type="button" aria-label={`${titel(e.id)} nach oben`} disabled={i === 0} onclick={() => schiebe(i, -1)}>↑</button>
						<button type="button" aria-label={`${titel(e.id)} nach unten`} disabled={i === anzeige.length - 1} onclick={() => schiebe(i, 1)}>↓</button>
						<span class="st-groessen" role="group" aria-label="Größe">
							{#each GROESSEN as g (g)}
								<button type="button" aria-pressed={e.groesse === g} aria-label={`Größe ${GROESSE_NAMEN[g]}`} onclick={() => setzeGroesse(e.id, g)}>{GROESSE_NAMEN[g]}</button>
							{/each}
						</span>
						<button type="button" aria-pressed={e.hoehe === 2} aria-label="Zwei Zeilen hoch" title="Höhe: 1 oder 2 Zeilen" onclick={() => setzeHoehe(e.id)}>↕</button>
						<button type="button" class="st-weg" aria-label={`${titel(e.id)} entfernen`} onclick={() => entfernen(e.id)}>✕</button>
					</div>
				{/if}
				<div class="st-inhalt" inert={bearbeiten}>{@render kachel(e.id)}</div>
			</div>
		{/each}
	</div>
</main>

<style>
	/* Frei zusammenstellbarer Start (msg 2942): 12er-Raster, S=3 M=4 L=6 Breit=12, Höhe 1–2 Zeilen */
	.st-raster {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		grid-auto-rows: minmax(5.5rem, auto);
		gap: 0.75rem;
	}
	.st-k {
		grid-column: span var(--sp);
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.st-k.hoch {
		grid-row: span 2;
	}
	.st-inhalt {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.st-inhalt > :global(*) {
		flex: 1;
		margin: 0 !important;
	}
	@media (max-width: 1099px) {
		.st-k {
			grid-column: span var(--sp-t);
		}
	}
	@media (max-width: 699px) {
		.st-raster {
			grid-template-columns: minmax(0, 1fr);
			grid-auto-rows: auto;
		}
		.st-k,
		.st-k.hoch {
			grid-column: auto;
			grid-row: auto;
		}
	}
	/* Bearbeiten */
	.st-leiste {
		display: grid;
		gap: 0.5rem;
		margin: 0 0 0.75rem;
		padding: 0.6rem 0.8rem;
		border: 1px dashed var(--ui-akzent-rand);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-akzent-zart);
	}
	.st-leiste .kd-info {
		margin: 0;
	}
	.st-leiste-knoepfe {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.st-leiste-knoepfe form {
		margin: 0;
	}
	.st-rechts {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}
	.st-katalog {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
		gap: 0.4rem;
	}
	.st-katalog-eintrag {
		display: grid;
		gap: 0.1rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--ui-rand);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.st-katalog-eintrag:hover {
		border-color: var(--ui-akzent);
	}
	.st-katalog-eintrag small {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
	}
	.st-werkzeug {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem;
		padding: 0.25rem;
		border: 1px solid var(--ui-akzent-rand);
		border-bottom: 0;
		border-radius: var(--ui-radius-karte) var(--ui-radius-karte) 0 0;
		background: var(--ui-akzent-hell);
	}
	.st-werkzeug button {
		min-width: 2rem;
		min-height: 2rem;
		padding: 0 0.4rem;
		border: 1px solid var(--ui-rand);
		border-radius: 8px;
		background: var(--ui-flaeche);
		color: var(--ui-text);
		font: inherit;
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
		cursor: pointer;
	}
	@media (pointer: coarse) {
		.st-werkzeug button {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}
	}
	.st-werkzeug button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.st-werkzeug button[aria-pressed='true'] {
		border-color: var(--ui-akzent);
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
	}
	.st-werkzeug button:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
	.st-griff {
		cursor: grab !important;
		touch-action: none;
		font-size: 1rem !important;
	}
	.zieht .st-griff {
		cursor: grabbing !important;
	}
	.st-wz-titel {
		flex: 1 1 6rem;
		min-width: 0;
		overflow: hidden;
		padding: 0 0.25rem;
		font-size: var(--ui-schrift-xs);
		font-weight: 700;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.st-groessen {
		display: inline-flex;
		gap: 2px;
	}
	.st-weg {
		color: var(--ui-gefahr) !important;
	}
	.bearbeiten .st-inhalt {
		opacity: 0.85;
	}
	.bearbeiten .st-inhalt > :global(*) {
		border-top-left-radius: 0 !important;
		border-top-right-radius: 0 !important;
	}
	.st-k.zieht {
		z-index: 2;
		opacity: 0.7;
	}
	.st-platzhalter,
	.st-leer {
		border: 1px dashed var(--ui-rand-stark);
		box-shadow: none !important;
	}
	.st-ganz-leer {
		margin: 0 0 0.75rem;
	}
	.st-zahl {
		font-family: var(--ui-schrift-titel);
		font-size: 1.375rem;
	}
	.st-kz.einzeln {
		display: grid;
		align-content: center;
		gap: 0.05rem;
		color: var(--ui-text);
		text-decoration: none;
	}
	.st-kz.einzeln strong {
		font-size: 1.375rem;
	}
	.st-kz-liste {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 9rem), 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.st-kz {
		display: grid;
		gap: 0.05rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--ui-rand);
		border-left: 4px solid var(--ui-grau);
		border-radius: var(--ui-radius);
	}
	.st-kz.ampel-gruen { border-left-color: var(--ui-gruen); }
	.st-kz.ampel-gelb { border-left-color: var(--ui-orange); }
	.st-kz.ampel-rot { border-left-color: var(--ui-rot); }
	.st-kz-titel {
		color: var(--ui-text-leise);
		font-size: var(--ui-schrift-xs);
		font-weight: 600;
	}
	.st-kz strong {
		font-family: var(--ui-schrift-titel);
		font-size: 1.2rem;
		line-height: 1.15;
	}
	.st-kz small {
		color: var(--ui-text-leise);
		font-size: 0.6875rem;
		line-height: 1.3;
	}
	.st-handlung {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 8rem), 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.st-h {
		display: grid;
		gap: 0.05rem;
		padding: 0.4rem 0.6rem;
		border-radius: var(--ui-radius);
		background: var(--ui-band);
		border-left: 4px solid var(--st-ton);
		color: var(--ui-text);
		text-decoration: none;
	}
	.st-h:hover {
		background: var(--ui-akzent-zart);
	}
	.st-h strong {
		font-family: var(--ui-schrift-titel);
		font-size: 1.2rem;
		line-height: 1.15;
	}
	.st-h span {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.st-h.null {
		opacity: 0.55;
	}
	.ton-rot { --st-ton: var(--ui-rot); }
	.ton-orange { --st-ton: var(--ui-orange); }
	.ton-blau { --st-ton: var(--ui-blau); }
	.ton-grau { --st-ton: var(--ui-grau); }
	.st-balken {
		display: grid;
		gap: 0.4rem;
		margin: 0 0 0.4rem;
		padding: 0;
		list-style: none;
	}
	.st-balken li {
		display: grid;
		grid-template-columns: minmax(6rem, 30%) minmax(0, 1fr) 4.5rem;
		align-items: center;
		gap: 0.6rem;
		font-size: var(--ui-schrift-s);
	}
	.st-name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.st-bahn {
		height: 0.6rem;
		border-radius: 999px;
		background: var(--ui-grau-hell);
		overflow: hidden;
	}
	.st-bahn span {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--ui-akzent);
	}
	.st-bahn span.voll {
		background: var(--ui-rot);
	}
	.st-wert {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	/* Suche wie M365-CommandBar */
	.suche {
		flex: 1 1 18rem;
		max-width: 32rem;
	}

	/* Kachel „Diesen Monat“ (Gewinn verplant, Stunden frei) */
	.monat-kachel {
		display: grid;
		align-content: start;
		gap: 0.2rem;
		color: inherit;
		text-decoration: none;
		border-left: 6px solid var(--m365-fehler);
	}
	.monat-kachel.erreicht {
		border-left-color: #107c10;
	}
	.monat-kachel:hover .monat-satz,
	.monat-kachel:focus-visible .monat-satz {
		text-decoration: underline;
	}
	.monat-titel {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--m365-text-leise);
	}
	.monat-satz {
		font-size: 1.15rem;
		font-weight: 700;
		line-height: 1.5;
	}
	.monat-kachel small {
		color: var(--m365-text-leise);
	}

	/* Kachel „Heute“ (Tagesplan) */
	.plan-kopf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.plan-kopf h2 {
		margin: 0;
	}
	.plan-person select {
		min-height: 2.25rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--m365-rand-stark);
		border-radius: var(--m365-radius);
		background: var(--m365-flaeche);
		font: inherit;
		font-size: 0.875rem;
	}
	.plan-text {
		margin: 0.5rem 0;
		color: var(--m365-text-leise);
		font-size: 0.875rem;
		line-height: 1.6;
	}
	.plan h3 {
		margin: 0.75rem 0 0.35rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.plan-liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	.plan-liste li {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr);
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.plan-liste li.ueberfaellig .plan-zeit {
		color: var(--m365-fehler);
		font-weight: 600;
	}
	.plan-was {
		display: grid;
		overflow-wrap: anywhere;
	}
	.plan-was small {
		color: var(--m365-text-leise);
	}

	/* Einsätze als Karte */
	.heute-karte {
		background: var(--m365-flaeche);
		border-radius: var(--m365-radius-karte);
		box-shadow: var(--m365-schatten);
		padding: 0.8rem 1rem;
		margin-bottom: 0;
	}
	.heute-karte h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0 0 0.5rem;
		color: var(--m365-text);
	}
	.heute-karte h2 small {
		color: var(--m365-text-leise);
		font-weight: 400;
	}

	/* Bereiche-Kacheln (wie M365 App-Launcher) */
	.kacheln {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
		gap: 0.5rem;
	}
	.kachel {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		min-height: 4rem;
		padding: 0.7rem 0.8rem;
		border-radius: var(--m365-radius-karte);
		background: var(--m365-flaeche);
		box-shadow: var(--m365-schatten);
		color: var(--m365-text);
		font-family: var(--m365-schrift);
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: none;
		transition: box-shadow 150ms, transform 150ms;
	}
	a.kachel:hover {
		box-shadow: var(--m365-schatten-hoch);
		transform: translateY(-1px);
	}
	.kachel :global(.nav-symbol) {
		color: var(--ui-akzent-text);
	}
	.kachel.aus {
		color: var(--m365-text-leicht);
		font-weight: 400;
		box-shadow: none;
		border: 1px dashed var(--m365-rand);
		background: transparent;
	}
	.kachel.aus :global(.nav-symbol) {
		color: inherit;
	}
	.leise {
		color: var(--m365-text-leise);
		font-size: 0.875rem;
	}
	.zeit-karte {
		display: grid;
		align-content: start;
		gap: 0.6rem;
	}
	.zeit-auftrag {
		display: grid;
		gap: 0.4rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--ui-rand);
	}
	.zeit-auftrag-titel {
		margin: 0;
		display: grid;
		font-weight: 600;
	}
	.zeit-auftrag-titel small {
		font-weight: 400;
		color: var(--ui-text-leise);
	}
	.zeit-link {
		font-size: var(--ui-schrift-s);
	}
</style>
