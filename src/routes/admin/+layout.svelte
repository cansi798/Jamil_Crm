<script lang="ts">
	import '$lib/stil/admin.css';

	let { children } = $props();
</script>

<header class="ad-kopf">
	<a href="/admin">Plattform-Verwaltung</a>
</header>

{@render children()}
