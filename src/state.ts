// App state (@preact/signals) and the actions that wire the engine layer
// together: open file → pick engine → index container → click entry →
// extract → decompile → tab. Talks to backends only through
// src/engine/interface.ts + the registry — never a backend folder.

import { signal, computed, batch, effect } from "@preact/signals";
import { defaultEngine, engineFor, engines } from "./engine";
import type { Container, DecompilerEngine, EngineStatus } from "./engine/interface";
import { kindOf, type EntryKind } from "./format";
import { appName } from "./utils";

export interface FileInfo { name: string; bytes: number; shown: number; hidden: number }
export interface Entry { path: string; size: number; kind: EntryKind }
export interface Tab {
	id: number;
	path: string;
	kind: EntryKind;
	status: "loading" | "ready" | "error";
	text?: string;
	language?: string; // Monaco language id, from engine Content when decompiled
	blobUrl?: string;
	size?: number;
	error?: string;
	ms?: number;
}

// ---- state --------------------------------------------------------------

export const fileInfo = signal<FileInfo | null>(null);
export const entries = signal<Entry[]>([]);
export const containerWarnings = signal<string[]>([]);
export const query = signal(""); // tree filter
export const tabs = signal<Tab[]>([]);
export const activeTabId = signal<number | null>(null);
export const engineStatus = signal<EngineStatus>({ state: "booting", detail: "" });
export const status = signal("idle");
export const dragDepth = signal(0);
export const activeEngine = signal<DecompilerEngine | null>(null);
export const engineOptions = signal<Record<string, boolean>>({}); // seeded from engine.options()
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
	if (fileInfo.value) {
		document.title = `${appName} - ${fileInfo.value.name}`;
	}
})

// Option metadata for the Options menu: engine-specific, resolved live
// (falls back to the default engine before any file is open).
export const optionDefs = computed(() => (activeEngine.value ?? defaultEngine).options());
export const poweredBy = computed(() => (activeEngine.value ?? defaultEngine).poweredBy());
export const defaultEngineName = defaultEngine.name; // display label for the pre-open status line

// File types the app accepts (union of all engines' containerExtensions()):
// drives the <input accept> list and the drop-zone copy.
export const supportedContainerExtensions = [...new Set(engines.flatMap((e) => e.containerExtensions()))];

let idSeq = 0;
let container: Container | null = null;
const reportStatus = (s: EngineStatus) => { engineStatus.value = s; };
defaultEngine.prepare(reportStatus); // eager: runtime download + JIT warmup while the user reads the UI

export const filtered = computed(() => {
	const q = query.value.trim().toLowerCase();
	if (!q) return null;
	return entries.value.filter((e) => e.path.toLowerCase().includes(q)).slice(0, 1000);
});

export const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null);

export const tree = computed(() => buildTree(entries.value));

// ---- helpers ------------------------------------------------------------

// A dropped file is hostile input: reject path traversal / absolute paths /
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
	const root: TreeNode = { name: fileInfo.value?.name ?? "", path: "", dirs: new Map(), files: [] };
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

export async function openFile(file: File): Promise<void> {
	const engine = engineFor(file.name);
	if (!engine) {
		status.value = `no engine handles ${file.name}`;
		return;
	}
	try {
		activeEngine.value = engine;
		await engine.prepare(reportStatus); // idempotent (default engine is already warm)
		// Make sure the Options menu knows this engine's flags.
		engineOptions.value = Object.fromEntries(engine.options().map((o) => [o.id, engineOptions.value[o.id] ?? false]));

		status.value = `Reading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`;
		const buffer = await file.arrayBuffer();
		const t0 = performance.now();
		const opened = await engine.openFile(buffer);
		container = opened;

		const safe: Entry[] = [];
		let hidden = 0;
		for (const e of opened.entries) {
			if (e.name.endsWith("/")) continue; // directory entry
			if (!isSafePath(e.name)) { hidden++; continue; }
			safe.push({ path: e.name, size: e.uncompSize, kind: kindOf(e.name, e.uncompSize, engine.supportedExtensions()) });
		}
		safe.sort((a, b) => a.path.localeCompare(b.path));

		batch(() => {
			for (const t of tabs.value) if (t.blobUrl) URL.revokeObjectURL(t.blobUrl);
			fileInfo.value = { name: file.name, bytes: file.size, shown: safe.length, hidden };
			entries.value = safe;
			containerWarnings.value = opened.warnings;
			tabs.value = [];
			activeTabId.value = null;
			query.value = "";
		});
		status.value = `${safe.length} entries in ${file.name} (${Math.round(performance.now() - t0)} ms)`
			+ (hidden ? ` — ${hidden} rejected (unsafe paths)` : "");
	} catch (err: any) {
		container = null;
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
	// Engine-agnostic: entries whose extension the active engine handles get
	// decompiled; everything else is shown as-is. "bytecode" = "will be
	// decompiled" (drives the tree highlight + loading copy).
	const engine = activeEngine.value;
	const decompilable = engine != null &&
		engine.supportedExtensions().some((ext) => path.toLowerCase().endsWith(ext));
	const kind0 = decompilable ? "bytecode" : kindOf(path, 0, engine?.supportedExtensions() ?? []);
	tabs.value = [...tabs.value, { id, path, kind: kind0, status: "loading" }];
	activeTabId.value = id;

	try {
		if (!container) throw new Error("no file open");
		const bytes = await container.extract(path);

		if (decompilable && engine) {
			const options = Object.entries(engineOptions.value).filter(([, on]) => on).map(([f]) => f);
			const t0 = performance.now();
			const content = await engine.decompile(path, bytes, options);
			const ms = Math.round(performance.now() - t0);
			patchTab(id, { status: "ready", kind: "source", text: content.text, language: content.language, ms });
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
	const engine = activeEngine.value ?? defaultEngine;
	status.value = `restarting ${engine.name}…`;
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
