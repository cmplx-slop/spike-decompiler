// FernFlower JVM host (backend-internal, not the UI contract): a Web Worker
// hosting CheerpJ 5 (OpenJDK-as-WASM) plus the FernFlower jar (resolved from
// JetBrains' repo at build time — see scripts/fetch-engine.ts). One JVM for
// the app's lifetime; per-class decompilation. If the worker dies (OOM/
// crash), rpcify respawns it on the next call, so UI state survives.
// The UI-facing shape is Fernflower implements in ../interface.ts.

import type { EngineStatus } from "../interface";
import { makeInlineWorker, rpcify } from "../../utils/worker-rpc";
import engineManifest from '../../../engine/engine.json';

//@ts-expect-error
import engine from '../../../engine/java-decompiler.jar' with { type: 'file' };

// Not the UI contract (that is DecompilerEngine) — this is just the raw
// JVM host behind it; Fernflower adapts it in ./index.ts.
export interface JvmHost {
	boot(): Promise<void>;
	decompileClass(entryName: string, bytes: Uint8Array, options?: string[]): Promise<string>;
	restart(): Promise<void>;
}

// ---- engine jar acquisition (MAIN thread, on purpose) --------------------
//
// Why here and not in the worker: the worker runs from a blob: URL, and blob
// URLs are not a valid base for resolving relative URLs — fetch() in the
// worker throws "Failed to parse URL". (CheerpJ also patches fetch() once
// initialized, which adds noise to worker-side networking.)
//
// Why same-origin and not straight from JetBrains: the IntelliJ Community
// Maven repo (www.jetbrains.com/intellij-repository/releases, where
// com.jetbrains.intellij.java:java-decompiler-engine lives) does not send
// Access-Control-Allow-Origin, so a serverless app cannot read it from the
// browser. Instead, scripts/fetch-engine.ts resolves the official JetBrains
// artifact at BUILD time (build tooling is not subject to CORS), and pins it
// via engine/engine.json (SHA-256), which we verify here at load time.
//
// Escape hatch: set globalThis.JD_ENGINE_URL = "<absolute https url>" on a
// mirror that sends CORS headers (e.g. your own S3/CloudFront/Worker).

const ENGINE_CACHE = "fernflower-engine-v2"; // v1 may hold poisoned HTML fallbacks
let jarCache: ArrayBuffer | null = null;

// Dev/static servers (bun dev server included!) answer unknown paths with
// index.html at HTTP 200 — res.ok proves nothing. Always validate the jar
// magic, never cache a bad payload, and evict poisoned cache entries.
const isJar = (bytes: ArrayBuffer): boolean => {
	const h = new Uint8Array(bytes, 0, 4);
	return h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04;
};

const sniff = (bytes: ArrayBuffer): string => {
	const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 60));
	return new TextDecoder("utf-8", { fatal: false }).decode(head).replace(/\s+/g, " ").trim();
};

async function cacheLookup(url: string): Promise<ArrayBuffer | null> {
	try {
		const hit = await (await caches.open(ENGINE_CACHE)).match(url);
		return hit ? await hit.arrayBuffer() : null;
	} catch { return null; }
}

async function cacheEvict(url: string): Promise<void> {
	try { await (await caches.open(ENGINE_CACHE)).delete(url); } catch {}
}

async function cacheStore(url: string, bytes: ArrayBuffer): Promise<void> {
	try {
		await (await caches.open(ENGINE_CACHE)).put(
			url,
			new Response(bytes, { headers: { "content-type": "application/java-archive" } }),
		);
	} catch {}
}

async function fetchJarBytes(url: string): Promise<ArrayBuffer> {
	const cached = await cacheLookup(url);
	if (cached != null) {
		if (isJar(cached)) return cached.slice(0);
		await cacheEvict(url); // poisoned entry — refetch below
	}
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} for ${url} — engine jar missing; run: bun run fetch:engine`);
	}
	const bytes = await res.arrayBuffer();
	if (!isJar(bytes)) {
		const ct = res.headers.get("content-type") || "unknown";
		throw new Error(
			`server answered ${url} with ${ct} (${bytes.byteLength} B starting with "${sniff(bytes)}"), not a jar. ` +
			`Missing file most likely — run: bun run fetch:engine, then restart bun index.html`,
		);
	}
	await cacheStore(url, bytes);
	return bytes;
}

async function sha256hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchEngineJar(onStatus: (s: EngineStatus) => void): Promise<ArrayBuffer> {
	if (jarCache) return jarCache.slice(0); // restart reuses the verified bytes

	const override = (globalThis as any).JD_ENGINE_URL as string | undefined;
	let bytes: ArrayBuffer;

	if (override) {
		onStatus({ state: "booting", detail: `fetching engine jar from override URL…` });
		bytes = await fetchJarBytes(override);
	} else {
		const base = location.href; // resolve relative to the page
		const manifest = engineManifest;
		if (!manifest) {
			onStatus({ state: "booting", detail: "engine/engine.json missing — run: bun run fetch:engine (unverified load)" });
		}
		onStatus({ state: "booting", detail: `fetching engine jar${manifest?.version ? ` (${manifest.version})` : ""}…` });
		bytes = await fetchJarBytes(new URL(engine, base).href);
		if (manifest?.sha256) {
			const got = await sha256hex(bytes);
			if (got !== manifest.sha256) {
				throw new Error(`engine jar checksum mismatch (manifest ${manifest.sha256.slice(0, 16)}…, file ${got.slice(0, 16)}…) — rerun: bun run fetch:engine`);
			}
		}
	}

	jarCache = bytes;
	return bytes.slice(0);
}

// ---- worker body (self-contained; runs in the blob-URL worker) -----------

function engineWorkerBody(): void {
	(self as any).importScripts("https://cjrtnc.leaningtech.com/5.0/loader.js");

	let ConsoleDecompiler: any = null;
	let bootPromise: Promise<void> | null = null;
	let seq = 0;
	// Unique per JVM boot: /files/ persists (IndexedDB) and seq restarts on
	// worker respawn, so without this a crash mid-decompile could leave a
	// stale output file that the next boot would read back.
	const bootUid = Math.random().toString(36).slice(2, 8);

	function pushStatus(state: string, detail: string): void {
		(self as any).postMessage({ type: "engine-status", state, detail });
	}

	async function readText(path: string): Promise<string> {
		const blob = await (globalThis as any).cjFileBlob(path);
		return blob.text();
	}

	async function boot(engineJarBytes: ArrayBuffer): Promise<void> {
		if (!engineJarBytes || engineJarBytes.byteLength === 0) {
			throw new Error("boot() requires engine jar bytes from the main thread");
		}
		pushStatus("booting", "Downloading CheerpJ runtime (cached after first run)…");
		await (globalThis as any).cheerpjInit({ version: 21 }); // pinned engine line targets Java 21
		pushStatus("booting", "Loading FernFlower…");
		// The jar arrives as bytes (main thread fetched + verified it), pushed
		// into CheerpJ's in-memory JS→Java mount and loaded from there.
		(globalThis as any).cheerpOSAddStringFile("/str/engine.jar", new Uint8Array(engineJarBytes));
		const lib = await (globalThis as any).cheerpjRunLibrary("/str/engine.jar");
		ConsoleDecompiler = await lib.org.jetbrains.java.decompiler.main.decompiler.ConsoleDecompiler;
		pushStatus("ready", "");
	}

	async function decompile(entry: string, bytes: ArrayBuffer, options: string[]): Promise<string> {
		if (bootPromise) await bootPromise;
		if (!ConsoleDecompiler) throw new Error("engine is not booted (engine jar fetch failed?)");

		// Unique per-call names: the .class basename drives the .java output
		// name, so unique inputs give unique outputs — no stale results from
		// the persistent /files/ mount, and no shared-slot races. The package
		// lives inside the .class file itself, so the VFS path need not mirror it.
		const n = ++seq;
		const inPath = `/str/t${bootUid}${n}.class`;
		const outTag = `t${bootUid}${n}`;
		(globalThis as any).cheerpOSAddStringFile(inPath, new Uint8Array(bytes));

		// ConsoleDecompiler(options…, inputFile, outputDir) — same argument
		// order as the desktop `java -cp fernflower.jar ConsoleDecompiler -dgs=1 in out`.
		await ConsoleDecompiler.main([...options, inPath, "/files/"]);

		// Single-class inputs may emit the .java either flat in the output
		// dir (named after the input) or under its package path; probe both.
		const base = entry.split("/").pop()!.replace(/\.class$/, "");
		const pkg = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/")) : "";
		const candidates = [`/files/${outTag}.java`];
		if (pkg) candidates.push(`/files/${pkg}/${base}.java`);

		let source: string | null = null;
		let used = "";
		for (const path of candidates) {
			try {
				source = await readText(path);
				used = path;
				break;
			} catch {
				/* try next */
			}
		}
		// Best-effort cleanup so the persistent /files/ mount does not grow.
		try { (globalThis as any).cheerpOSRemoveStringFile(inPath); } catch {}
		if (used) { try { (globalThis as any).cheerpOSRemoveStringFile(used); } catch {} }

		if (source == null) {
			throw new Error(`engine produced no .java output (tried: ${candidates.join(", ")})`);
		}
		return source;
	}

	(self as any).onmessage = async (e: MessageEvent) => {
		const { id, type } = e.data;
		try {
			if (type === "boot") {
				bootPromise ??= boot(e.data.engineJar);
				await bootPromise;
				(self as any).postMessage({ id, ok: true });
			} else if (type === "decompile") {
				const source = await decompile(e.data.entry, e.data.bytes, e.data.options || []);
				(self as any).postMessage({ id, ok: true, source });
			} else {
				throw new Error(`unknown message type: ${type}`);
			}
		} catch (err: any) {
			bootPromise = null; // failed boot: next boot message retries
			pushStatus("error", String(err?.message || err));
			(self as any).postMessage({ id, ok: false, error: String(err?.stack || err) });
		}
	};
}

export function createEngine(onStatus: (s: EngineStatus) => void): JvmHost {
	const call = rpcify(() => makeInlineWorker(engineWorkerBody), (msg) => {
		if (msg.type === "engine-status") onStatus({ state: msg.state, detail: msg.detail || "" });
	});

	const engine: JvmHost = {
		// Boot eagerly so the runtime download / JIT warmup overlaps with the
		// user reading the drop-zone screen. Fetch + verify the jar here first.
		async boot() {
			try {
				const jarBytes = await fetchEngineJar(onStatus);
				await call("boot", { engineJar: jarBytes });
			} catch (err: any) {
				onStatus({ state: "error", detail: String(err?.message || err) });
			}
		},
		async decompileClass(entryName, bytes, options = []) {
			const r = await call("decompile", { entry: entryName, bytes, options }, [bytes.buffer]);
			return r.source as string;
		},
		async restart() {
			call.terminate(); // respawned worker reinitializes; the verified jar stays cached
			await engine.boot();
		},
	};
	return engine;
}
