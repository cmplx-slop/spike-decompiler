// Engine contract: everything the UI needs from a language backend.
//
// Layout convention:
//   src/engine/interface.ts   ← this file; the only engine module UI code may import
//   src/engine/index.ts       ← registry (which backends exist, which handles a file)
//   src/engine/<backend>/     ← one folder per language/backend (fernflower/ today)
//
// Adding a language = implement this interface in a new folder + one registry
// line. UI code (state.ts, components/) must never import from a backend folder.

export interface EngineStatus {
	state: "booting" | "ready" | "error";
	detail: string;
}

export interface EngineOption {
	id: string; // passed through to the backend verbatim (fernflower: "dgs=1")
	label: string; // shown in the Options menu
}

export interface Attribution {
	name: string; // e.g. "FernFlower"
	url: string; // upstream project/license link
	role?: string; // tooltip: what this part contributes ("decompiler", "JVM runtime")
}

export interface ContainerEntry {
	name: string; // path inside the container, e.g. "java/lang/String.class"
	uncompSize: number;
}

// An opened container. Entries are listed up front, payloads are extracted
// on demand — jars (and elfs/wasms of the future) are never fully inflated.
export interface Container {
	readonly entries: ContainerEntry[];
	readonly warnings: string[];
	extract(path: string): Promise<Uint8Array<ArrayBuffer>>;
}

export interface Content {
	kind: "source" | "text";
	text: string;
	/** Monaco language id for the result (fernflower: "java"); falls back to extension guessing. */
	language?: string;
}

export interface DecompilerEngine {
	readonly id: string;
	readonly name: string; // human label for status/progress lines

	/** Container types this engine can open; also selects the engine for a dropped file (lowercase, dot-prefixed). */
	containerExtensions(): string[]; // java: [".jar", ".zip", ".war", ".ear"]

	/** Entry types this engine decompiles (lowercase, dot-prefixed). */
	supportedExtensions(): string[]; // java: [".class"]

	/** Backend-specific flags surfaced in the Options menu. */
	options(): EngineOption[];

	/**
	 * "powered by" attribution, shown in the status bar and swapped along
	 * with the active engine. Keep real: some runtimes require visible
	 * credit (CheerpJ's Community license).
	 */
	poweredBy(): Attribution[];

	/** Open one dropped file (parses this engine's container format). */
	openFile(buffer: ArrayBuffer): Promise<Container>;

	/** Start the backend runtime (download + warmup). Idempotent; reports progress via onStatus. */
	prepare(onStatus: (s: EngineStatus) => void): Promise<void>;

	/** Decompile one extracted entry. */
	decompile(path: string, bytes: Uint8Array, options: string[]): Promise<Content>;

	/** Name for the decompiled output of an entry (fernflower: a/b/Foo.class → a/b/Foo.java); falls back to the entry's base name. */
	outputName?(path: string): string;

	/** Restart the runtime (memory pressure / wedged state). */
	restart(): Promise<void>;
}
