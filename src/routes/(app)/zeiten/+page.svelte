<script lang="ts">
	import PersonWahl from '$lib/components/ui/PersonWahl.svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import '$lib/stil/kunden.css';
	import { enhance } from '$app/forms';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import { stundenText, wochenSummen, ZEIT_ART_NAMEN, type ZeitEintrag } from '$lib/zeiterfassung';
	import { berlinTag, berlinUhrzeit, kalenderwoche, tagDeutsch, tagKurz } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const n = $derived(data.n);
	const eintraege = $derived(data.auftragFilter ? n.eintraege.filter((e) => e.auftragId === data.auftragFilter) : n.eintraege);
	const link = (o: Record<string, string>) => {
		const p = new URLSearchParams({ ansicht: data.ansicht, tag: data.tag, ...(data.ansicht === 'monat' ? { monat: data.monat } : {}), ...(data.verwalten && n.person.id !== data.ichId ? { person: n.person.id } : {}), ...o });
		return `/zeiten?${p}`;
	};
	const exportLink = (format: string) => `/zeiten/export?${new URLSearchParams({ format, von: n.von, bis: n.bis, ...(data.verwalten ? { person: n.person.id } : {}) })}`;
	const km = (w: number | null) => (w === null ? '' : String(w).replace('.', ','));
	const wasText = (e: ZeitEintrag) => `${e.auftragNummer ?? ''} ${e.auftragTitel ?? ''}`.trim();
	const dauer = (e: ZeitEintrag) => (e.ende ? stundenText((Date.parse(e.ende) - Date.parse(e.beginn)) / 60000 - e.pauseMin) : 'läuft');
	let offen = $state<string | null>(null);
	const wochen = $derived(data.ansicht === 'monat' ? wochenSummen(n.tage, kalenderwoche) : []);
	const saldo = $derived(n.sollMin === null ? null : n.summe.arbeitMin - n.sollMin);
	const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
	const monatText = (m: string) => `${MONATE[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
</script>

<svelte:head><title>Arbeitszeitnachweis – CRM System</title></svelte:head>

<main class="kd-seite zt">
	<header class="seiten-kopf">
		<div>
			<h1>Zeiten</h1>
			<p class="seiten-meta">Arbeitszeitnachweis {n.person.name} · {data.ansicht === 'tag' ? tagDeutsch(n.von) : data.ansicht === 'monat' ? monatText(data.monat) : `${tagDeutsch(n.von)} – ${tagDeutsch(n.bis)}`}</p>
		</div>

	</header>

	<form method="GET" class="zt-filter filter-leiste" aria-label="Zeiten filtern">
		{#if data.verwalten}
			<PersonWahl
					name="person"
					label="Person"
					klein
					required
					personen={data.personen.map((p) => ({ id: p.id, name: p.id === data.ichId ? `Ich (${p.name})` : p.name }))}
					wert={n.person.id}
					absenden
				/>
		{/if}
		<input type="hidden" name="tag" value={data.tag} />
		<div class="zt-reiter ui-umschalter" role="group" aria-label="Ansicht">
			<button name="ansicht" value="tag" class:aktiv={data.ansicht === 'tag'} aria-pressed={data.ansicht === 'tag'}>Tag</button>
			<button name="ansicht" value="woche" class:aktiv={data.ansicht === 'woche'} aria-pressed={data.ansicht === 'woche'}>Woche</button>
			<button name="ansicht" value="monat" class:aktiv={data.ansicht === 'monat'} aria-pressed={data.ansicht === 'monat'}>Monat</button>
		</div>
		{#if data.ansicht === 'monat'}
			<label>Monat <input type="month" name="monat" value={data.monat} onchange={(ev) => ev.currentTarget.form?.requestSubmit()} /></label>
			<nav class="zt-blaettern" aria-label="Monat">
				<a href={link({ monat: data.vorherMonat, tag: data.vorher })} class="kd-knopf hell" aria-label="Vormonat">‹</a>
				<a href={link({ monat: data.heute.slice(0, 7), tag: data.heute })} class="kd-knopf hell">Dieser Monat</a>
				<a href={link({ monat: data.nachherMonat, tag: data.nachher })} class="kd-knopf hell" aria-label="Nächster Monat">›</a>
			</nav>
		{:else}
			<nav class="zt-blaettern" aria-label="Zeitraum">
				<a href={link({ tag: data.vorher })} class="kd-knopf hell" aria-label="Zurück">‹</a>
				<a href={link({ tag: data.heute })} class="kd-knopf hell">Heute</a>
				<a href={link({ tag: data.nachher })} class="kd-knopf hell" aria-label="Weiter">›</a>
			</nav>
		{/if}
		<div class="fl-rechts zt-export">
			<a class="kd-knopf hell" href={exportLink('csv')} download>CSV</a>
			<a class="kd-knopf hell" href={exportLink('pdf')} download>PDF</a>
			{#if data.team}<a class="kd-knopf hell" href={`/zeiten/export?${new URLSearchParams({ format: 'csv', team: '1', von: n.von, bis: n.bis })}`} download>Team-CSV</a>{/if}
		</div>
	</form>

	{#if form?.erfolg}<p role="status" class="kd-info zt-ok">{form.erfolg}</p>{/if}
	{#if form?.freigabeFehler}<p role="alert" class="kd-fehler">{form.freigabeFehler}</p>{/if}

	<ul class="zt-summen" aria-label="Summen">
		<li><span>Arbeit</span><strong data-testid="summe-arbeit">{stundenText(n.summe.arbeitMin)}</strong></li>
		<li><span>Pausen</span><strong>{stundenText(n.summe.pauseMin)}</strong></li>
		<li><span>Fahrt</span><strong>{stundenText(n.summe.fahrtMin)}</strong></li>
		<li><span>Kilometer</span><strong>{km(n.summe.km) || '0'}</strong></li>
		{#if n.sollMin !== null && data.ansicht !== 'tag'}
			<li><span>Soll (Kalkulation)</span><strong>{stundenText(n.sollMin)}</strong></li>
			<li class:minus={saldo !== null && saldo < 0}><span>Überstunden-Saldo</span><strong data-testid="saldo">{saldo !== null && saldo > 0 ? '+' : ''}{stundenText(saldo ?? 0)}</strong></li>
		{/if}
	</ul>

	{#if data.verwalten && n.offenFreigabe > 0}
		<form method="POST" action="?/freigeben" use:enhance class="zt-freigabe">
			<input type="hidden" name="person" value={n.person.id} /><input type="hidden" name="von" value={n.von} /><input type="hidden" name="bis" value={n.bis} />
			<span>{n.offenFreigabe} Einträge noch nicht freigegeben.</span>
			<button type="submit" class="kd-knopf">{data.ansicht === 'tag' ? 'Tag' : data.ansicht === 'monat' ? 'Monat' : 'Woche'} freigeben</button>
		</form>
	{/if}

	{#if data.team}
		<Abschnitt titel="Team im {monatText(data.monat)}" anzahl={data.team.length}>
			<div class="zt-tabelle-huelle">
				<table class="zt-tabelle" data-testid="team">
					<thead><tr><th>Mitarbeiter</th><th>Arbeit</th><th>Fahrt</th><th>km</th><th>Soll</th><th>Saldo</th><th>offen</th></tr></thead>
					<tbody>
						{#each data.team as t (t.benutzerId)}
							<tr>
								<th scope="row"><a href={link({ person: t.benutzerId })}>{t.name}</a></th>
								<td>{stundenText(t.arbeitMin)}</td><td>{stundenText(t.fahrtMin)}</td><td>{km(t.km) || '0'}</td>
								<td>{t.sollMin === null ? '–' : stundenText(t.sollMin)}</td>
								<td class:minus={t.sollMin !== null && t.arbeitMin < t.sollMin}>{t.sollMin === null ? '–' : `${t.arbeitMin - t.sollMin > 0 ? '+' : ''}${stundenText(t.arbeitMin - t.sollMin)}`}</td>
								<td>{t.offenFreigabe || ''}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="kd-info">Soll = Arbeitstage (Mo–Fr) ohne Urlaub/Krankheit × Stunden pro Tag aus der Kalkulation; ohne Eintrag in der Kalkulation kein Soll.</p>
		</Abschnitt>
	{/if}

	{#if data.ansicht !== 'tag'}
		<Abschnitt titel="Tage">
			<div class="zt-tabelle-huelle">
				<table class="zt-tabelle">
					<thead><tr><th>Tag</th><th>Beginn</th><th>Ende</th><th>Arbeit</th><th>Pausen</th><th>Fahrt</th><th>km</th></tr></thead>
					<tbody>
						{#each n.tage as t, i (t.tag)}
							{#if data.ansicht === 'monat' && i > 0 && kalenderwoche(t.tag) !== kalenderwoche(n.tage[i - 1].tag)}
								{@const w = wochen.find((x) => x.kw === kalenderwoche(n.tage[i - 1].tag))}
								{#if w}<tr class="zt-woche"><th scope="row">KW {w.kw}</th><td></td><td></td><td>{stundenText(w.arbeitMin)}</td><td>{stundenText(w.pauseMin)}</td><td>{stundenText(w.fahrtMin)}</td><td>{km(w.km)}</td></tr>{/if}
							{/if}
							<tr class:leer={t.eintraege === 0}>
								<th scope="row"><a href={link({ ansicht: 'tag', tag: t.tag })}>{tagKurz(t.tag)}</a></th>
								<td>{t.beginn ?? '–'}</td><td>{t.ende ?? '–'}</td>
								<td>{t.eintraege ? stundenText(t.arbeitMin) : '–'}</td>
								<td>{t.eintraege ? stundenText(t.pauseMin) : '–'}</td>
								<td>{t.eintraege ? stundenText(t.fahrtMin) : '–'}</td>
								<td>{km(t.km)}</td>
							</tr>
							{#each t.hinweise as h (h)}<tr class="zt-hinweis"><td colspan="7">⚠ {h}</td></tr>{/each}
						{/each}
						{#if data.ansicht === 'monat' && wochen.length > 0}
							{@const w = wochen.at(-1)!}
							<tr class="zt-woche"><th scope="row">KW {w.kw}</th><td></td><td></td><td>{stundenText(w.arbeitMin)}</td><td>{stundenText(w.pauseMin)}</td><td>{stundenText(w.fahrtMin)}</td><td>{km(w.km)}</td></tr>
							<tr class="zt-woche gesamt"><th scope="row">Monat</th><td></td><td></td><td>{stundenText(n.summe.arbeitMin)}</td><td>{stundenText(n.summe.pauseMin)}</td><td>{stundenText(n.summe.fahrtMin)}</td><td>{km(n.summe.km)}</td></tr>
						{/if}
					</tbody>
				</table>
			</div>
		</Abschnitt>
	{:else}
		{#each n.tage[0]?.hinweise ?? [] as h (h)}<p class="zt-warnung">⚠ {h}</p>{/each}
	{/if}

	<Abschnitt titel="Einträge" anzahl={eintraege.length}>
		{#if data.auftragFilter}<p class="kd-info">Gefiltert auf einen Auftrag · <a href={link({})}>alle zeigen</a></p>{/if}
		<ul class="zt-eintraege">
			{#each eintraege as e (e.id)}
				<li class={`zt-e ${e.art}`}>
					<div class="zt-e-kopf">
						<span class="zt-e-zeit">{tagKurz(berlinTag(new Date(e.beginn)))} {berlinUhrzeit(new Date(e.beginn))}–{e.ende ? berlinUhrzeit(new Date(e.ende)) : 'läuft'}</span>
						<span class="zt-e-art">{ZEIT_ART_NAMEN[e.art]}</span>
						<span class="zt-e-dauer">{dauer(e)}{#if e.pauseMin} <small>({e.pauseMin} Min. Pause)</small>{/if}</span>
					</div>
					<div class="zt-e-was">
						<a href={`/auftraege/${e.auftragId}`}>{wasText(e)}</a>
						{#if e.art === 'fahrt'}<span> · {e.km === null ? 'km offen' : `${km(e.km)} km`}{#if e.kmQuelle === 'luftlinie'} <small>(Luftlinie × Faktor)</small>{:else if e.kmQuelle === 'route'} <small>(Route)</small>{:else if e.kmQuelle === 'manuell'} <small>(von Hand)</small>{/if}</span>{/if}
						{#if e.manuell}<span class="zt-abzeichen" title={e.korrekturGrund ?? ''}>korrigiert</span>{/if}
						{#if e.freigegeben}<span class="zt-abzeichen gruen">freigegeben</span>{/if}
					</div>
					{#if e.notiz}<p class="zt-e-notiz">{e.notiz}</p>{/if}
					{#if (data.verwalten || !e.freigegeben) && (data.verwalten || e.benutzerId === data.ichId)}
						{#if offen === e.id}
							<form method="POST" action="?/korrigieren" use:enhance={() => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success') offen = null; }} class="kd-formular zt-form">
								<input type="hidden" name="id" value={e.id} />
								<div class="zt-reihe">
									<label>Art <Auswahl name="art" value={e.art}><option value="arbeit">Arbeit</option><option value="pause">Pause</option><option value="fahrt">Fahrt</option></Auswahl></label>
									<label>Tag <input type="date" name="tag" value={berlinTag(new Date(e.beginn))} required /></label>
									<label>Von <input type="time" name="von" value={berlinUhrzeit(new Date(e.beginn))} required /></label>
									<label>Bis <input type="time" name="bis" value={e.ende ? berlinUhrzeit(new Date(e.ende)) : ''} /></label>
									<label>Pause (Min.) <input type="number" name="pauseMin" min="0" max="720" value={e.pauseMin} /></label>
									<label>km <input name="km" inputmode="decimal" value={km(e.km)} /></label>
								</div>
								<label>Auftrag
									<Auswahl name="auftragId" value={e.auftragId} required>
										{#if !data.auftraege.some((a) => a.id === e.auftragId)}<option value={e.auftragId}>{wasText(e)}</option>{/if}
										{#each data.auftraege as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
									</Auswahl>
								</label>
								<label>Notiz <input name="notiz" value={e.notiz ?? ''} maxlength="500" /></label>
								<label>Grund der Korrektur (Pflicht) <input name="grund" required minlength="3" maxlength="300" placeholder="z. B. Start vergessen" /></label>
								{#if form?.korrekturFehler && form?.korrekturId === e.id}<p role="alert" class="kd-fehler">{form.korrekturFehler}</p>{/if}
								<div class="zt-knoepfe">
									<button type="button" class="kd-knopf hell" onclick={() => (offen = null)}>Abbrechen</button>
									<button type="submit" class="kd-knopf">Speichern</button>
									<button type="submit" formaction="?/loeschen" class="kd-knopf hell gefahr">Löschen</button>
								</div>
							</form>
						{:else}
							<button type="button" class="knopf-subtil" onclick={() => (offen = e.id)}>Korrigieren</button>
						{/if}
					{/if}
				</li>
			{:else}
				<li class="kd-leer">Keine Zeiten in diesem Zeitraum.</li>
			{/each}
		</ul>
	</Abschnitt>

	<AddPanel label="Zeit nachtragen" offen={!!form?.nachtragenFehler}>
		{#snippet children(schliessen)}
			<form method="POST" action="?/nachtragen" use:enhance class="kd-formular zt-form">
				{#if data.verwalten}<input type="hidden" name="benutzerId" value={n.person.id} />{/if}
				<div class="zt-reihe">
					<label>Art <Auswahl name="art"><option value="arbeit">Arbeit</option><option value="pause">Pause</option><option value="fahrt">Fahrt</option></Auswahl></label>
					<label>Tag <input type="date" name="tag" value={data.tag} required /></label>
					<label>Von <input type="time" name="von" required /></label>
					<label>Bis <input type="time" name="bis" required /></label>
					<label>Pause (Min.) <input type="number" name="pauseMin" min="0" max="720" value="0" /></label>
					<label>km (Fahrt) <input name="km" inputmode="decimal" /></label>
				</div>
				<label>Auftrag
					<Auswahl name="auftragId" required><option value="">Bitte wählen …</option>{#each data.auftraege as a (a.id)}<option value={a.id}>{a.label}</option>{/each}</Auswahl>
				</label>
				<label>Notiz <input name="notiz" maxlength="500" /></label>
				<label>Grund (Pflicht) <input name="grund" required minlength="3" maxlength="300" placeholder="z. B. Handy war leer" /></label>
				{#if form?.nachtragenFehler}<p role="alert" class="kd-fehler">{form.nachtragenFehler}</p>{/if}
				<div class="zt-knoepfe">
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					<button type="submit" class="kd-knopf">Nachtragen</button>
				</div>
			</form>
		{/snippet}
	</AddPanel>
	<p class="zt-recht">Hinweis: Arbeitgeber müssen Beginn, Ende und Dauer der täglichen Arbeitszeit aufzeichnen (BAG, 13.09.2022). Diese Aufzeichnung erfüllt das – Standortdaten werden nicht erfasst.</p>
</main>

<style>
	.zt-filter {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		align-items: center;
	}
	.zt-filter label {
		display: grid;
		gap: var(--ui-a1);
		font-size: var(--ui-schrift-s);
	}
	.zt-reiter {
		display: inline-flex;
		border: 1px solid var(--ui-rand-stark);
		border-radius: var(--ui-chip-radius);
		overflow: hidden;
	}
	.zt-reiter button {
		min-height: var(--ui-feld-hoehe);
		padding: 0 var(--ui-a4);
		border: 0;
		background: var(--ui-flaeche);
		font: inherit;
		cursor: pointer;
	}
	.zt-reiter button.aktiv {
		background: var(--ui-akzent);
		color: var(--ui-akzent-auf);
	}
	.zt-blaettern {
		display: flex;
		gap: var(--ui-a1);
	}
	.zt-summen {
		list-style: none;
		margin: 0 0 var(--ui-a4);
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
		gap: var(--ui-a2);
	}
	.zt-summen li {
		display: grid;
		gap: var(--ui-a1);
		padding: var(--ui-a3);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-flaeche);
		box-shadow: var(--ui-schatten);
	}
	.zt-summen span {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.zt-summen strong {
		font-size: var(--ui-schrift-xl);
	}
	.zt-freigabe {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		align-items: center;
		justify-content: space-between;
		padding: var(--ui-a3);
		margin-bottom: var(--ui-a4);
		border-radius: var(--ui-radius-karte);
		background: var(--ui-akzent-zart);
		border: 1px solid var(--ui-akzent-hell);
	}
	.zt-tabelle-huelle {
		overflow-x: auto;
	}
	.zt-tabelle {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--ui-schrift-m);
	}
	.zt-tabelle th,
	.zt-tabelle td {
		padding: var(--ui-a2);
		text-align: left;
		border-bottom: 1px solid var(--ui-rand);
		white-space: nowrap;
	}
	.zt-woche th, .zt-woche td {
		background: var(--ui-band);
		font-weight: 600;
	}
	.zt-woche.gesamt th, .zt-woche.gesamt td {
		background: var(--ui-akzent-hell);
	}
	.minus strong, td.minus {
		color: var(--ui-gefahr);
	}
	.zt-tabelle tr.leer {
		color: var(--ui-text-leise);
	}
	.zt-hinweis td,
	.zt-warnung {
		color: #8a5300;
		font-size: var(--ui-schrift-s);
		white-space: normal;
	}
	.zt-eintraege {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--ui-a2);
	}
	.zt-e {
		display: grid;
		gap: var(--ui-a1);
		padding: var(--ui-a3);
		border: 1px solid var(--ui-rand);
		border-left: 4px solid var(--ui-gruen);
		border-radius: var(--ui-radius);
		background: var(--ui-flaeche);
	}
	.zt-e.pause {
		border-left-color: var(--ui-orange);
	}
	.zt-e.fahrt {
		border-left-color: var(--ui-blau);
	}
	.zt-e-kopf {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		align-items: baseline;
	}
	.zt-e-zeit {
		font-weight: 700;
	}
	.zt-e-art {
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.zt-e-dauer {
		margin-left: auto;
		font-weight: 600;
	}
	.zt-e-was {
		font-size: var(--ui-schrift-m);
	}
	.zt-e-notiz {
		margin: 0;
		font-size: var(--ui-schrift-s);
		color: var(--ui-text-leise);
	}
	.zt-abzeichen {
		display: inline-block;
		margin-left: var(--ui-a1);
		padding: 0 var(--ui-a2);
		border-radius: var(--ui-chip-radius);
		background: var(--ui-orange-hell);
		font-size: var(--ui-schrift-xs);
	}
	.zt-abzeichen.gruen {
		background: var(--ui-gruen-hell);
	}
	.zt-reihe {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: var(--ui-a2);
	}
	.zt-knoepfe {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
	}
	.gefahr {
		color: var(--ui-gefahr) !important;
	}
	.zt-recht {
		font-size: var(--ui-schrift-xs);
		color: var(--ui-text-leise);
		margin-top: var(--ui-a5);
	}
</style>
