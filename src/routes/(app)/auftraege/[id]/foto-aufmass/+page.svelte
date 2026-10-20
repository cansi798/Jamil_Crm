<script lang="ts">
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import '$lib/stil/kunden.css';
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import { OBJEKTE, OBJEKT_NAMEN, RAUMARTEN, RAUMART_NAMEN } from '$lib/foto-aufmass';
	import { tagDeutsch, berlinTag } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = $derived(data.schaetzung);
	let laeuft = $state(false);
	const w = (n: string) => (form?.werte as Record<string, string> | undefined)?.[n] ?? '';
	const z = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));
</script>

<svelte:head><title>Foto-Aufmaß – {data.auftrag.nummer}</title></svelte:head>

<main class="kd-seite fa">
	<a href={`/auftraege/${data.auftrag.id}`} class="kd-zurueck">← {data.auftrag.nummer} {data.auftrag.titel}</a>
	<header class="seiten-kopf">
		<div>
			<h1>Foto-Aufmaß</h1>
			<p class="seiten-meta">Sie geben die bekannten Flächen ein, die KI schätzt den Rest aus Fotos und Angaben.</p>
		</div>
	</header>

	{#if !s}
		<form method="POST" action="?/schaetzen" enctype="multipart/form-data" class="kd-formular" use:enhance={() => { laeuft = true; return async ({ update }) => { await update({ reset: false }); laeuft = false; }; }}>
			{#if form?.schaetzFehler}<p role="alert" class="kd-fehler">{form.schaetzFehler}</p>{/if}
			<Abschnitt titel="1. Bekannte Werte">
				<div class="fa-raster">
					<label>Raum
						<Auswahl name="raumart">{#each RAUMARTEN as r (r)}<option value={r} selected={w('raumart') === r}>{RAUMART_NAMEN[r]}</option>{/each}</Auswahl>
					</label>
					<label>Wandfläche (m²) <input name="wandM2" inputmode="decimal" required value={w('wandM2')} placeholder="z. B. 22,5" /></label>
					<label>Bodenfläche (m²) <input name="bodenM2" inputmode="decimal" required value={w('bodenM2')} placeholder="z. B. 6,2" /></label>
					<label>Raumhöhe (m, optional) <input name="hoeheM" inputmode="decimal" value={w('hoeheM')} placeholder="2,50" /></label>
				</div>
				<p class="fa-titel">Anzahl im Raum</p>
				<div class="fa-raster klein">
					{#each OBJEKTE as o (o)}<label>{OBJEKT_NAMEN[o]} <input name={o} type="number" min="0" max="50" value={w(o) || '0'} /></label>{/each}
				</div>
			</Abschnitt>
			<Abschnitt titel="2. Fotos (optional, bis zu 4)">
				<label>Fotos vom Raum <input type="file" name="fotos" accept="image/jpeg,image/png" multiple capture="environment" /></label>
				<label>Maßstab im Bild (optional) <input name="referenz" maxlength="120" value={w('referenz')} placeholder="z. B. Türhöhe 2,00 m" /></label>
				<label class="fa-zustimmung"><input type="checkbox" name="zustimmung" value="ja" /> Die Fotos dürfen zur Auswertung an die KI gesendet werden (nur Fotos und Zahlen, keine Kundendaten).</label>
			</Abschnitt>
			<button type="submit" class="kd-knopf" disabled={laeuft}>{laeuft ? 'KI schätzt … (bis zu 1 Minute)' : 'Rest schätzen lassen'}</button>
		</form>
		{#if data.fruehere.length > 0}
			<Abschnitt titel="Frühere Schätzungen">
				<ul class="fa-liste">
					{#each data.fruehere as f (f.id)}
						<li><a href={`?schaetzung=${f.id}`}>{RAUMART_NAMEN[f.raumart as keyof typeof RAUMART_NAMEN] ?? f.raumart} vom {tagDeutsch(berlinTag(new Date(f.angelegt)))}</a> · {f.status === 'uebernommen' ? 'übernommen' : f.status}</li>
					{/each}
				</ul>
			</Abschnitt>
		{/if}
	{:else}
		<p class="fa-warnung" role="note"><strong>Schätzung – vor Ort prüfen.</strong> {s.basisN > 0 ? `Basiert auf ${s.basisN} früheren Aufträgen.` : 'Noch keine früheren Aufträge zum Lernen – die Werte sind reine KI-Schätzung.'}
			{#if s.konfidenz !== null} Sicherheit der KI: {Math.round(s.konfidenz * 100)} %.{/if}</p>
		<p class="seiten-meta">{RAUMART_NAMEN[s.eingaben.raumart]} · Wand {z(s.eingaben.wandM2)} m² · Boden {z(s.eingaben.bodenM2)} m²{s.eingaben.hoeheM ? ` · Höhe ${z(s.eingaben.hoeheM)} m` : ''} · {s.fotos} Foto(s){s.erkannt ? ` · erkannt: ${s.erkannt}` : ''}</p>
		<form method="POST" action="?/uebernehmen" class="kd-formular" use:enhance>
			<input type="hidden" name="id" value={s.id} />
			{#if form?.uebernehmenFehler}<p role="alert" class="kd-fehler">{form.uebernehmenFehler}</p>{/if}
			<Abschnitt titel="Geschätzte Mengen">
				<div class="fa-tabelle-huelle">
					<table class="fa-tabelle">
						<thead><tr><th>Menge</th><th>KI</th><th>Faustwert</th><th>Ihr Wert</th></tr></thead>
						<tbody>
							{#each s.mengen as m (m.schluessel)}
								<tr>
									<th scope="row">{m.name}{#if m.faktor}<small>Faktor {z(m.faktor.faktor)} aus {m.faktor.n} Aufträgen</small>{/if}</th>
									<td>{m.ki === null ? '–' : `${z(m.ki)} ${m.einheit}`}</td>
									<td>{z(m.regel)} {m.einheit}</td>
									<td><label class="fa-wert"><input name={`m_${m.schluessel}`} inputmode="decimal" value={z(m.vorschlag)} disabled={s.status !== 'entwurf'} aria-label={`${m.name} (${m.einheit})`} /> {m.einheit}</label></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</Abschnitt>
			{#if s.annahmen.length > 0}
				<Abschnitt titel="Annahmen der KI">
					<ul class="fa-liste">{#each s.annahmen as a, i (i)}<li>{a}</li>{/each}</ul>
				</Abschnitt>
			{/if}
			<Abschnitt titel="Vorgeschlagene Positionen (Katalog)">
				{#if s.positionen.length === 0}
					<p class="kd-info">Keine passenden Katalogpositionen gefunden.</p>
				{:else}
					<ul class="fa-liste">
						{#each s.positionen as p (p.katalogPositionId)}
							<li class="fa-pos">
								<input type="hidden" name="pos" value={p.katalogPositionId} />
								<label class="fa-nehmen"><input type="checkbox" name={`nehmen_${p.katalogPositionId}`} value="ja" checked disabled={s.status !== 'entwurf'} /> {p.bezeichnung}</label>
								<label class="fa-wert"><input name={`menge_${p.katalogPositionId}`} inputmode="decimal" value={z(p.vorschlag)} disabled={s.status !== 'entwurf'} aria-label={`Menge ${p.bezeichnung}`} /> {p.einheit}</label>
								{#if p.faktor}<small>KI {z(p.ki)} × {z(p.faktor.faktor)} (n = {p.faktor.n})</small>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</Abschnitt>
			{#if s.status === 'entwurf'}
				<div class="fa-knoepfe">
					<button type="submit" class="kd-knopf">Als Angebotsentwurf übernehmen</button>
					<button type="submit" formaction="?/verwerfen" class="kd-knopf hell">Verwerfen</button>
				</div>
				<p class="kd-info">Ihre Werte werden gespeichert und machen künftige Schätzungen genauer (ohne Kundendaten). Positionen kommen mit „Schätzung – vor Ort prüfen“ ins Angebot.</p>
			{:else}
				<p class="kd-info">{s.status === 'uebernommen' ? 'Übernommen.' : 'Verworfen.'} {#if s.angebotId}<a href={`/angebote/${s.angebotId}`}>Zum Angebotsentwurf</a>{/if} · <a href="?">Neue Schätzung</a></p>
			{/if}
		</form>
	{/if}
</main>

<style>
	.fa-raster { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--ui-a3); }
	.fa-raster.klein { grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); }
	.fa-titel { margin: var(--ui-a3) 0 var(--ui-a2); font-weight: 600; font-size: var(--ui-schrift-s); }
	.fa-zustimmung { display: flex !important; gap: var(--ui-a2); align-items: flex-start; font-weight: 400 !important; }
	.fa-warnung { padding: var(--ui-a3); border-radius: var(--ui-radius); background: var(--m365-warnung-hell); border: 1px solid #f5d27a; }
	.fa-tabelle-huelle { overflow-x: auto; }
	.fa-tabelle { width: 100%; border-collapse: collapse; font-size: var(--ui-schrift-m); }
	.fa-tabelle th, .fa-tabelle td { padding: var(--ui-a2); text-align: left; border-bottom: 1px solid var(--ui-rand); vertical-align: middle; }
	.fa-tabelle th small { display: block; font-weight: 400; color: var(--ui-text-leise); font-size: var(--ui-schrift-xs); }
	.fa-wert { display: inline-flex !important; align-items: center; gap: var(--ui-a1); white-space: nowrap; }
	.fa-wert input { width: 6rem; min-height: var(--ui-feld-hoehe); text-align: right; }
	.fa-liste { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ui-a2); }
	.fa-pos { display: flex; flex-wrap: wrap; gap: var(--ui-a2); align-items: center; padding-bottom: var(--ui-a2); border-bottom: 1px solid var(--ui-rand); }
	.fa-pos small { color: var(--ui-text-leise); }
	.fa-nehmen { display: flex !important; gap: var(--ui-a2); align-items: center; flex: 1 1 12rem; font-weight: 500 !important; }
	.fa-knoepfe { display: flex; flex-wrap: wrap; gap: var(--ui-a2); }
</style>
