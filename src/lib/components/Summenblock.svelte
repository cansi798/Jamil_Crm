<script lang="ts">
	import { euro } from '$lib/geld';

	/** Netto, MwSt und Gesamtbetrag eines Angebots (Beträge in Cent). */
	let { nettoCent, mwstCent, bruttoCent, mwstSatz }: { nettoCent: number; mwstCent: number; bruttoCent: number; mwstSatz: number } =
		$props();
</script>

<dl class="sb" aria-label="Summen">
	<dt>Nettobetrag</dt>
	<dd>{euro(nettoCent)}</dd>
	<dt>zzgl. MwSt {mwstSatz} %</dt>
	<dd>{euro(mwstCent)}</dd>
	<dt class="sb-gesamt">Gesamtbetrag</dt>
	<dd class="sb-gesamt sb-brutto">{euro(bruttoCent)}</dd>
</dl>

<style>
	.sb {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.3rem 1rem;
		max-width: 22rem;
		margin: 1rem 0 1rem auto;
		padding: 0.75rem 1rem;
		border: 1px solid var(--rand);
		border-radius: 0.5rem;
		background: #fff;
	}
	.sb dt,
	.sb dd {
		margin: 0;
	}
	.sb dd {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.sb-gesamt {
		padding-top: 0.35rem;
		border-top: 2px solid var(--text);
		font-weight: 700;
		font-size: 1.1rem;
	}
</style>
