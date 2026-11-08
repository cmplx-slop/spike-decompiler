// Archive side: an inline classic Web Worker that parses the jar's zip
// central directory and inflates a single entry on demand (never the whole
// jar). Guards against zip bombs and unsupported methods.

import { makeInlineWorker, rpcify } from "../../utils/worker-rpc";

export interface ZipEntry {
	name: string;
	method: number;
	crc: number;
	compSize: number;
	uncompSize: number;
	localOffset: number;
}

export interface Archive {
	load(arrayBuffer: ArrayBuffer): Promise<{ entries: ZipEntry[]; warnings: string[] }>;
	extract(name: string): Promise<Uint8Array<ArrayBuffer>>;
	terminate(): void;
}

// Exported for the bun smoke test (test/zip.test.ts); the app uses it only
// through makeInlineWorker().
export function archiveWorkerBody(): void {
	(self as any).importScripts("https://cdn.jsdelivr.net/npm/fflate@0.8.3/umd/index.js");

	const MAX_ENTRIES = 300_000;
	const MAX_ENTRY_SIZE = 64 * 1024 * 1024; // per entry (zip-bomb guard)
	const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024; // total uncompressed (soft cap)

	let view: DataView | null = null;
	let bytes: Uint8Array | null = null;
	let entries: ZipEntry[] | null = null;

	function findEOCD(): number {
		// End Of Central Directory record ("PK\x05\x06"); comment up to 64 KiB.
		const min = Math.max(0, bytes!.length - 22 - 65_535);
		for (let i = bytes!.length - 22; i >= min; i--) {
			if (view!.getUint32(i, true) === 0x06054b50) return i;
		}
		throw new Error("not a zip/jar file (no end-of-central-directory record)");
	}

	function decodeName(p: number, len: number): string {
		return new TextDecoder("utf-8", { fatal: false }).decode(bytes!.subarray(p, p + len));
	}

	function parseCentralDirectory(): { entries: ZipEntry[]; warnings: string[] } {
		const eocd = findEOCD();
		let count = view!.getUint16(eocd + 10, true);
		let offset = view!.getUint32(eocd + 16, true);

		// ZIP64 (jar > 4 GiB or > 65535 entries).
		if (count === 0xffff || offset === 0xffffffff) {
			const loc = eocd - 20;
			if (loc >= 0 && view!.getUint32(loc, true) === 0x07064b50) {
				const eocd64 = Number(view!.getBigUint64(loc + 8, true));
				if (view!.getUint32(eocd64, true) !== 0x06064b50) throw new Error("broken ZIP64 record");
				count = Number(view!.getBigUint64(eocd64 + 32, true));
				offset = Number(view!.getBigUint64(eocd64 + 48, true));
			}
		}
		if (count > MAX_ENTRIES) throw new Error(`too many entries (${count})`);

		const out: ZipEntry[] = [];
		const warnings: string[] = [];
		let p = offset;
		for (let i = 0; i < count; i++) {
			if (view!.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt central directory");
			const method = view!.getUint16(p + 10, true);
			const crc = view!.getUint32(p + 16, true);
			let compSize = view!.getUint32(p + 20, true);
			let uncompSize = view!.getUint32(p + 24, true);
			const nameLen = view!.getUint16(p + 28, true);
			const extraLen = view!.getUint16(p + 30, true);
			const commentLen = view!.getUint16(p + 32, true);
			let localOffset = view!.getUint32(p + 42, true);
			const name = decodeName(p + 46, nameLen);

			// ZIP64 extra field (0x0001) overrides 0xFFFFFFFF placeholders.
			if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
				let q = p + 46 + nameLen;
				const extraEnd = q + extraLen;
				while (q + 4 <= extraEnd) {
					const id = view!.getUint16(q, true);
					const sz = view!.getUint16(q + 2, true);
					if (id === 0x0001) {
						let r = q + 4;
						if (uncompSize === 0xffffffff) { uncompSize = Number(view!.getBigUint64(r, true)); r += 8; }
						if (compSize === 0xffffffff) { compSize = Number(view!.getBigUint64(r, true)); r += 8; }
						if (localOffset === 0xffffffff) { localOffset = Number(view!.getBigUint64(r, true)); r += 8; }
						break;
					}
					q += 4 + sz;
				}
			}
			if (uncompSize > MAX_ENTRY_SIZE) warnings.push(`skipped (too large): ${name}`);
			else out.push({ name, method, crc, compSize, uncompSize, localOffset });
			p += 46 + nameLen + extraLen + commentLen;
		}

		const total = out.reduce((s, e) => s + e.uncompSize, 0);
		if (total > MAX_TOTAL_SIZE) {
			warnings.push(`archive claims ${Math.round(total / 1e6)} MB uncompressed — extraction may be slow`);
		}
		return { entries: out, warnings };
	}

	function extract(name: string): Uint8Array {
		const rec = entries!.find((e) => e.name === name);
		if (!rec) throw new Error(`entry not found: ${name}`);
		if (rec.method !== 0 && rec.method !== 8) {
			throw new Error(`unsupported zip method ${rec.method} for ${name}`);
		}

		const off = rec.localOffset;
		if (view!.getUint32(off, true) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
		// Local headers can have different name/extra lengths than the central one.
		const nameLen = view!.getUint16(off + 26, true);
		const extraLen = view!.getUint16(off + 28, true);
		const start = off + 30 + nameLen + extraLen;
		const data = bytes!.subarray(start, start + rec.compSize);

		if (rec.method === 0) return new Uint8Array(data); // stored
		// zip stores raw DEFLATE; fflate's raw-sync inflate is decompressSync
		// (inflateSync would expect a zlib wrapper).
		return (self as any).fflate.decompressSync(data);
	}

	(self as any).onmessage = async (e: MessageEvent) => {
		const { id, type } = e.data;
		const post = (msg: any, transfer?: Transferable[]) => (self as any).postMessage(msg, transfer);
		try {
			if (type === "load") {
				bytes = new Uint8Array(e.data.buffer);
				view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
				const result = parseCentralDirectory();
				entries = result.entries;
				post({ id, ok: true, entries: result.entries, warnings: result.warnings });
			} else if (type === "extract") {
				const out = extract(e.data.name);
				post({ id, ok: true, bytes: out }, [out.buffer]);
			} else {
				throw new Error(`unknown message type: ${type}`);
			}
		} catch (err: any) {
			entries = null;
			post({ id, ok: false, error: String(err?.stack || err) });
		}
	};
}

export function createArchive(): Archive {
	const call = rpcify(() => makeInlineWorker(archiveWorkerBody));
	return {
		async load(arrayBuffer) {
			const { entries, warnings } = await call("load", { buffer: arrayBuffer }, [arrayBuffer]);
			return { entries, warnings };
		},
		extract(name) {
			return call("extract", { name }).then((r) => r.bytes as Uint8Array<ArrayBuffer>);
		},
		terminate() {
			call.terminate();
		},
	};
}
