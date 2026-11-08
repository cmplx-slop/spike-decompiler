import {
	tabs, activeTab, activateTab, closeTab, retryTab,
	fileInfo, engineStatus, engineOptions, activeEngine, defaultEngineName,
	supportedContainerExtensions,
	downloadText, downloadBlob,
	type Tab,
} from "../state";
import { languageFor, iconFor, formatBytes } from "../format";
import { Editor } from "./Editor";

export function Content() {
	const list = tabs.value;
	if (!list.length) return <Welcome />;
	const active = activeTab.value ?? list[list.length - 1];

	return (
		<section class="app-main">
			<div class="tab-strip" role="tablist">
				{list.map((t) => (
					<div key={t.id} class={`tab-btn ${t.id === active.id ? "active" : ""}`}>
						<button
							class="btn btn-sm border-0 p-0 text-inherit" style="font: inherit"
							onClick={() => activateTab(t.id)} role="tab"
						>
							<i class={`${activeEngine.value?.iconFor?.(t.path) ?? iconFor(t.kind)} me-1`} />
							{t.path.slice(t.path.lastIndexOf("/") + 1)}
							{t.status === "loading" && (
								<span class="spinner-border spinner-border-sm ms-2" />
							)}
						</button>
						<button
							class="btn btn-sm border-0 p-0"
							onClick={() => closeTab(t.id)} title="close" aria-label="close tab"
						>
							<span class="btn-close" />
						</button>
					</div>
				))}
			</div>

			{active.status === "ready" && <Toolbar tab={active} />}
			<div class="viewer-pane">
				{active.status === "loading" && <Loading tab={active} />}
				{active.status === "error" && <ErrorPane tab={active} />}
				{active.status === "ready" && active.kind === "image" && (
					<div class="d-flex justify-content-center p-3">
						<img src={active.blobUrl} class="img-fluid" style="max-height: 70vh; image-rendering: pixelated;" alt={active.path} />
					</div>
				)}
				{active.status === "ready" && active.kind === "binary" && <BinaryPane tab={active} />}
				{active.status === "ready" && (active.kind === "source" || active.kind === "text") && (
					<Editor
						path={active.path}
						text={active.text ?? ""}
						language={active.language ?? activeEngine.value?.languageFor?.(active.path) ?? languageFor(active.path, active.kind)}
					/>
				)}
			</div>
		</section>
	);
}

function Toolbar({ tab }: { tab: Tab }) {
	const isSource = tab.kind === "source";
	// Output name is an engine convention (fernflower: Foo.class → Foo.java),
	// not something the UI should hardcode.
	const outName = (isSource ? activeEngine.value?.outputName?.(tab.path) : undefined)
		?? tab.path.slice(tab.path.lastIndexOf("/") + 1);

	const copy = () => navigator.clipboard?.writeText(tab.text ?? "");
	const download = async () => {
		if (tab.text != null) return downloadText(outName, tab.text);
		if (tab.blobUrl) downloadBlob(outName, await fetch(tab.blobUrl).then((r) => r.blob()));
	};
	const anyOptions = Object.values(engineOptions.value).some(Boolean);

	return (
		<div class="toolbar">
			<span class="text-body-secondary text-truncate flex-grow-1">{tab.path}</span>
			{tab.ms != null && <span class="badge text-bg-success fw-normal">{tab.ms} ms</span>}
			{isSource && anyOptions && (
				<span class="badge text-bg-info fw-normal">options active</span>
			)}
			{tab.text != null && (
				<button class="btn btn-outline-secondary btn-sm" onClick={copy} title="copy to clipboard">
					<i class="fa-regular fa-copy" />
				</button>
			)}
			<button class="btn btn-outline-secondary btn-sm" onClick={download} title={`download ${outName}`}>
				<i class="fa-solid fa-download" />
			</button>
		</div>
	);
}

function Loading({ tab }: { tab: Tab }) {
	const what = tab.kind === "bytecode"
		? `Decompiling with ${activeEngine.value?.name ?? "engine"}…`
		: "Reading…";
	return (
		<div class="welcome">
			<div class="text-center text-body-secondary">
				<div class="spinner-border mb-3" role="status" />
				<div class="font-monospace small">{what}</div>
				<div class="font-monospace small text-body-tertiary mt-1">{tab.path}</div>
			</div>
		</div>
	);
}

function ErrorPane({ tab }: { tab: Tab }) {
	return (
		<div class="p-3">
			<div class="alert alert-danger">
				<div class="d-flex align-items-center gap-2 mb-2">
					<i class="fa-solid fa-circle-exclamation" />
					<strong>Could not open {tab.path}</strong>
					<button class="btn btn-sm btn-outline-dark ms-auto" onClick={() => retryTab(tab.id)}>
						<i class="fa-solid fa-rotate-right me-1" />Retry
					</button>
				</div>
				<pre class="small mb-0 text-wrap" style="white-space: pre-wrap">{tab.error}</pre>
			</div>
		</div>
	);
}

function BinaryPane({ tab }: { tab: Tab }) {
	return (
		<div class="welcome">
			<div class="card bg-body-secondary border-0 p-4 text-center">
				<i class="fa-solid fa-file fa-3x text-body-secondary mb-3" />
				<div class="fs-6">{tab.path}</div>
				<div class="text-body-secondary small mt-1">
					binary resource · {formatBytes(tab.size ?? 0)} · use the download button in the toolbar
				</div>
			</div>
		</div>
	);
}

function Welcome() {
	const es = engineStatus.value;
	return (
		<section class="app-main">
			<div class="welcome">
				<div class="text-center">
					{fileInfo.value ? (
						<>
							<i class="fa-solid fa-arrow-pointer fa-3x text-body-secondary mb-3" />
							<div class="fs-6 text-body-secondary">pick an entry from the tree to open it</div>
						</>
					) : (
						<>
							<i class="fa-solid fa-box-open fa-3x text-info mb-3" />
							<div class="fs-5">drop a <code>{supportedContainerExtensions.join(" / ")}</code> file anywhere on this page</div>
							<div class="text-body-secondary small mt-1">
								or use the <strong>Open file</strong> button — nothing is uploaded, all work happens in this tab
							</div>
						</>
					)}
					<div class="mt-3 small font-monospace">
						<span class={`dot ${es.state}`} />
						{es.state === "ready" ? `decompiler engine ready (${activeEngine.value?.name ?? defaultEngineName})`
							: es.state === "booting" ? `engine: ${es.detail || "booting…"}`
							: `engine error: ${es.detail}`}
					</div>
				</div>
			</div>
		</section>
	);
}
