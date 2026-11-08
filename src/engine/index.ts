// Engine registry: the single place that knows which backends exist.
// Adding a language = new folder implementing interface.ts + one line below.

import type { DecompilerEngine } from "./interface";
import { Fernflower } from "./fernflower";

export const engines: DecompilerEngine[] = [
	new Fernflower(),
	// future: new GoReSym(), new WasmDecompiler(), ...
];

// Eagerly prepared at startup (runtime download / JIT warmup overlaps with
// the user reading the drop-zone screen). Non-default engines prepare on
// first file open.
export const defaultEngine = engines[0];

export function engineFor(filename: string): DecompilerEngine | null {
	const lower = filename.toLowerCase();
	return engines.find((e) => e.containerExtensions().some((ext) => lower.endsWith(ext))) ?? null;
}
