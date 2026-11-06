import { engineStatus, status, jarInfo } from "../state";

export function StatusBar() {
	const es = engineStatus.value;
	return (
		<footer class="statusbar">
			<span title="decompiler JVM (CheerpJ) state">
				<span class={`dot ${es.state}`} />
				{es.state === "ready" ? "engine ready"
					: es.state === "booting" ? "engine booting…"
						: "engine error"}
				{es.state !== "ready" && es.detail ? ` — ${es.detail}` : ""}
			</span>
			<span class="text-truncate flex-grow-1">{status.value}</span>
			{jarInfo.value && (
				<span class="text-body-tertiary text-truncate">
					{jarInfo.value.name} · {(jarInfo.value.bytes / 1e6).toFixed(1)} MB
				</span>
			)}
			<span class="badge text-bg-warning fw-normal">
				powered by <a class="text-dark" target="_blank" href="https://github.com/jetBrains/fernflower">FernFlower</a> · <a class="text-dark" target="_blank" href="https://cheerpj.com/">CheerpJ</a>
			</span>
		</footer>
	);
}
