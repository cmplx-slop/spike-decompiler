import { engineStatus, status, fileInfo, activeEngine, defaultEngineName, poweredBy } from "../state";

export function StatusBar() {
	const es = engineStatus.value;
	return (
		<footer class="statusbar">
			<span title={`decompiler engine state (${activeEngine.value?.name ?? defaultEngineName})`}>
				<span class={`dot ${es.state}`} />
				{es.state === "ready" ? "engine ready"
					: es.state === "booting" ? "engine booting…"
						: "engine error"}
				{es.state !== "ready" && es.detail ? ` — ${es.detail}` : ""}
			</span>
			<span class="text-truncate flex-grow-1">{status.value}</span>
			{fileInfo.value && (
				<span class="text-body-tertiary text-truncate">
					{fileInfo.value.name} · {(fileInfo.value.bytes / 1e6).toFixed(1)} MB
				</span>
			)}
			<span class="badge text-bg-warning fw-normal">
				powered by{" "}
				{poweredBy.value.map((a, i) => (
					<span key={a.url}>
						{i > 0 && " · "}
						<a class="text-dark" target="_blank" title={a.role} href={a.url}>{a.name}</a>
					</span>
				))}
			</span>
		</footer>
	);
}
