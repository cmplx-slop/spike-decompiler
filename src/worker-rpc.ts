// Tiny inline-worker + promise-RPC helpers shared by the archive and engine
// workers. Workers are built from a function's source via a blob URL: this
// keeps them bundler-agnostic (the same file works under bun dev server and
// `bun build` output) and lets classic workers use importScripts() for CDN
// code (CheerpJ loader, fflate UMD).
//
// Note: everything inside a worker function body must be self-contained —
// fn.toString() captures only the body, so no outer-module references are
// allowed there (globals are reached via `self` / `globalThis`).

export function makeInlineWorker(fn: () => void): Worker {
	const url = URL.createObjectURL(new Blob([`(${fn.toString()})()`], { type: "text/javascript" }));
	return new Worker(url);
}

export interface Rpc {
	(type: string, data?: Record<string, unknown>, transfer?: Transferable[]): Promise<any>;
	terminate(): void;
}

/**
 * Lazily creates a worker and exposes it as a promise RPC. Resolves with the
 * worker's `{ id, ok: true, ... }` payload minus id/ok; rejects on
 * `{ ok: false, error }`. If the worker crashes, in-flight calls reject and
 * the next call respawns a fresh worker (the JVM restarts transparently).
 * `onPush(msg)` receives unsolicited worker messages (messages without `id`).
 */
export function rpcify(createWorker: () => Worker, onPush?: (msg: any) => void): Rpc {
	let worker: Worker | null = null;
	let seq = 0;
	const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

	function ensure(): Worker {
		if (worker) return worker;
		worker = createWorker();
		worker.onmessage = (e: MessageEvent) => {
			const data = e.data || {};
			if (data.id == null) {
				if (onPush) onPush(data);
				return;
			}
			const p = pending.get(data.id);
			if (!p) return;
			pending.delete(data.id);
			if (data.ok) p.resolve(data);
			else p.reject(new Error(data.error || "worker error"));
		};
		worker.onerror = (e: ErrorEvent) => {
			const err = new Error(`worker crashed: ${e.message || "unknown error"}`);
			for (const p of pending.values()) p.reject(err);
			pending.clear();
			try { worker?.terminate(); } catch {}
			worker = null; // next call respawns
		};
		return worker;
	}

	const call = ((type: string, data: Record<string, unknown> = {}, transfer: Transferable[] = []) =>
		new Promise<any>((resolve, reject) => {
			const id = ++seq;
			pending.set(id, { resolve, reject });
			try {
				ensure().postMessage({ id, type, ...data }, transfer);
			} catch (err) {
				pending.delete(id);
				reject(err);
			}
		})) as Rpc;

	call.terminate = () => {
		if (worker) {
			try { worker.terminate(); } catch {}
			worker = null;
		}
	};
	return call;
}
