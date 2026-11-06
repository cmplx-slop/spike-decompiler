// App state (@preact/signals) and the actions that wire the two workers
// together: open jar → index tree → click class → extract → decompile → tab.

import { signal, computed, batch, effect } from "@preact/signals";
import { createArchive } from "./archive";
import { createEngine, type EngineStatus } from "./engine";
import { kindOf, type EntryKind } from "./format";

export interface JarInfo { name: string; bytes: number; shown: number; hidden: number }
export interface Entry { path: string; size: number; kind: EntryKind }
export interface Tab {
	id: number;
	path: string;
	kind: EntryKind;
	status: "loading" | "ready" | "error";
	text?: string;
	blobUrl?: string;
	size?: number;
	error?: string;
	ms?: number;
}

// ---- state --------------------------------------------------------------

export const jarInfo = signal<JarInfo | null>(null);
export const entries = signal<Entry[]>([]);
export const archiveWarnings = signal<string[]>([]);
export const query = signal(""); // tree filter
export const tabs = signal<Tab[]>([]);
export const activeTabId = signal<number | null>(null);
export const engineStatus = signal<EngineStatus>({ state: "booting", detail: "" });
export const status = signal("idle");
export const dragDepth = signal(0);
export const engineOptions = signal<Record<string, boolean>>({ "dgs=1": false, "dy=1": false, "lit=1": false });
export type Theme = "dark" | "light";

// Theme: persisted choice, falling back to the OS preference. One signal
// drives Bootstrap (data-bs-theme below) and Monaco (see Editor.tsx).
const THEME_KEY = "spike-theme";
function initialTheme(): Theme {
	let saved: string | null = null;
	try { saved = localStorage.getItem(THEME_KEY); } catch {}
	if (saved === "light" || saved === "dark") return saved;
	return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
export const theme = signal<Theme>(initialTheme());

effect(() => {
	document.documentElement.dataset.bsTheme = theme.value;
	try { localStorage.setItem(THEME_KEY, theme.value); } catch {}
});

export function toggleTheme(): void {
	theme.value = theme.value === "dark" ? "light" : "dark";
}

effect(() => {
	if (jarInfo.value) {
		document.title = `spike - ${jarInfo.value.name}`;
	}
})

export const OPTION_LABELS: Record<string, string> = {
	"dgs=1": "Bytecode comments (dgs)",
	"dy=1": "Dynamic members (dy)",
	"lit=1": "Hardcode literals (lit)",
};

let idSeq = 0;
let archive = createArchive();
const engine = createEngine((s) => { engineStatus.value = s; });
engine.boot(); // eager: runtime download + JIT warmup while the user reads the UI

export const filtered = computed(() => {
	const q = query.value.trim().toLowerCase();
	if (!q) return null;
	return entries.value.filter((e) => e.path.toLowerCase().includes(q)).slice(0, 1000);
});

export const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null);

export const tree = computed(() => buildTree(entries.value));

// ---- helpers ------------------------------------------------------------

// A dropped jar is hostile input: reject path traversal / absolute paths /
// control chars outright (ARCHITECTURE.md §7).
function isSafePath(path: string): boolean {
	if (!path || path.startsWith("/") || path.startsWith("\\") || path.includes("\\")) return false;
	if (/[\x00-\x1f]/.test(path)) return false; // control characters
	return !path.split("/").some((seg) => seg === ".." || /^[a-zA-Z]:/.test(seg));
}

export interface TreeNode {
	name: string;
	path: string;
	dirs: Map<string, TreeNode>;
	files: Entry[];
}

function buildTree(list: Entry[]): TreeNode {
	const root: TreeNode = { name: jarInfo.value?.name ?? "", path: "", dirs: new Map(), files: [] };
	for (const e of list) {
		const parts = e.path.split("/");
		let node = root;
		for (let i = 0; i < parts.length - 1; i++) {
			const seg = parts[i];
			let child = node.dirs.get(seg);
			if (!child) {
				child = { name: seg, path: parts.slice(0, i + 1).join("/") + "/", dirs: new Map(), files: [] };
				node.dirs.set(seg, child);
			}
			node = child;
		}
		node.files.push(e);
	}
	return root;
}

function patchTab(id: number, patch: Partial<Tab>): void {
	tabs.value = tabs.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

function hasNul(bytes: Uint8Array): boolean {
	const n = Math.min(bytes.length, 512);
	for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
	return false;
}

// ---- actions ------------------------------------------------------------

export async function openJarFile(file: File): Promise<void> {
	try {
		status.value = `Reading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`;
		const buffer = await file.arrayBuffer();
		const t0 = performance.now();
		const { entries: raw, warnings } = await archive.load(buffer);

		const safe: Entry[] = [];
		let hidden = 0;
		for (const e of raw) {
			if (e.name.endsWith("/")) continue; // directory entry
			if (!isSafePath(e.name)) { hidden++; continue; }
			safe.push({ path: e.name, size: e.uncompSize, kind: kindOf(e.name, e.uncompSize) });
		}
		safe.sort((a, b) => a.path.localeCompare(b.path));

		batch(() => {
			for (const t of tabs.value) if (t.blobUrl) URL.revokeObjectURL(t.blobUrl);
			jarInfo.value = { name: file.name, bytes: file.size, shown: safe.length, hidden };
			entries.value = safe;
			archiveWarnings.value = warnings;
			tabs.value = [];
			activeTabId.value = null;
			query.value = "";
		});
		status.value = `${safe.length} entries in ${file.name} (${Math.round(performance.now() - t0)} ms)`
			+ (hidden ? ` — ${hidden} rejected (unsafe paths)` : "");
	} catch (err: any) {
		status.value = `Failed to open ${file.name}: ${err.message}`;
	}
}

export function activateTab(id: number): void {
	activeTabId.value = id;
}

export function closeTab(id: number): void {
	const tab = tabs.value.find((t) => t.id === id);
	if (tab?.blobUrl) URL.revokeObjectURL(tab.blobUrl);
	const rest = tabs.value.filter((t) => t.id !== id);
	tabs.value = rest;
	if (activeTabId.value === id) activeTabId.value = rest.length ? rest[rest.length - 1].id : null;
}

export async function openEntry(path: string): Promise<void> {
	const existing = tabs.value.find((t) => t.path === path);
	if (existing) return activateTab(existing.id);

	const id = ++idSeq;
	const kind0 = kindOf(path, 0);
	tabs.value = [...tabs.value, { id, path, kind: kind0, status: "loading" }];
	activeTabId.value = id;

	try {
		const bytes = await archive.extract(path);

		if (kind0 === "class") {
			const options = Object.entries(engineOptions.value).filter(([, on]) => on).map(([f]) => f);
			const t0 = performance.now();
			const source = await engine.decompileClass(path, bytes, options);
			const ms = Math.round(performance.now() - t0);
			patchTab(id, { status: "ready", kind: "source", text: source, ms });
			status.value = `decompiled ${path} in ${ms} ms`;
		} else if (kind0 === "image") {
			patchTab(id, { status: "ready", kind: "image", blobUrl: URL.createObjectURL(new Blob([bytes])) });
		} else if (kind0 === "binary" || hasNul(bytes)) {
			patchTab(id, {
				status: "ready", kind: "binary", size: bytes.byteLength,
				blobUrl: URL.createObjectURL(new Blob([bytes])),
			});
		} else {
			const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
			patchTab(id, { status: "ready", kind: "text", text });
		}
	} catch (err: any) {
		patchTab(id, { status: "error", error: err.message });
		status.value = `error: ${err.message}`;
	}
}

export function retryTab(id: number): void {
	const tab = tabs.value.find((t) => t.id === id);
	if (!tab) return;
	closeTab(id);
	openEntry(tab.path);
}

export function restartEngine(): void {
	status.value = "restarting decompiler engine…";
	engine.restart();
}

export function toggleOption(flag: string): void {
	engineOptions.value = { ...engineOptions.value, [flag]: !engineOptions.value[flag] };
}

// ---- download helpers (toolbar) ------------------------------------------

export function downloadText(filename: string, text: string): void {
	triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

export function downloadBlob(filename: string, blob: Blob): void {
	triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = Object.assign(document.createElement("a"), { href: url, download: filename });
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
