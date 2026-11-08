// Java backend: zip container reader (archive.ts) + one CheerpJ JVM hosting
// the FernFlower jar (engine.ts), glued together behind the DecompilerEngine
// contract. This folder is the entire Java side of the app; a future backend
// (other language / other decompiler) follows the same shape: its own
// container reader + runtime adapter + a class like this one.

import { createArchive, type Archive } from "./archive";
import { createEngine } from "./engine";
import type {
	Attribution, Container, Content, DecompilerEngine, EngineOption, EngineStatus,
} from "../interface";

const OPTIONS: EngineOption[] = [
	{ id: "dgs=1", label: "Bytecode comments (dgs)" },
	{ id: "dy=1", label: "Dynamic members (dy)" },
	{ id: "lit=1", label: "Hardcode literals (lit)" },
];

export class Fernflower implements DecompilerEngine {
	readonly id = "fernflower";
	readonly name = "FernFlower";

	private archive: Archive | null = null;
	private jvm: ReturnType<typeof createEngine> | null = null;
	private preparePromise: Promise<void> | null = null;

	containerExtensions(): string[] { return [".jar", ".zip", ".war", ".ear"]; }
	supportedExtensions(): string[] { return [".class"]; }
	options(): EngineOption[] { return OPTIONS; }

	poweredBy(): Attribution[] {
		return [
			{ name: "FernFlower", url: "https://github.com/jetBrains/fernflower", role: "decompiler" },
			{ name: "CheerpJ", url: "https://cheerpj.com/", role: "JVM runtime" },
		];
	}

	iconFor(path: string): string | undefined {
		const p = path.toLowerCase();
		if (p.endsWith(".class")) return "fa-solid fa-file-code text-info";
		if (p.endsWith(".java")) return "fa-solid fa-file-code";
		if (this.containerExtensions().some((ext) => p.endsWith(ext))) return "fa-solid fa-file-zipper text-primary";
		return undefined;
	}

	languageFor(path: string): string | undefined {
		return path.toLowerCase().endsWith(".java") ? "java" : undefined;
	}

	async openFile(buffer: ArrayBuffer): Promise<Container> {
		this.archive ??= createArchive(); // one worker across files: load swaps the buffer
		const archive = this.archive;
		const { entries, warnings } = await archive.load(buffer);
		return {
			entries,
			warnings,
			extract: (path) => archive.extract(path),
		};
	}

	async prepare(onStatus: (s: EngineStatus) => void): Promise<void> {
		// boot() never rejects (fetch/boot failures land in onStatus), so a
		// cached promise is safe; restart() re-arms it.
		this.jvm ??= createEngine(onStatus);
		this.preparePromise ??= this.jvm.boot();
		await this.preparePromise;
	}

	async decompile(path: string, bytes: Uint8Array, options: string[]): Promise<Content> {
		if (!this.jvm) throw new Error(`${this.name}: prepare() must complete before decompile`);
		const text = await this.jvm.decompileClass(path, bytes, options);
		return { kind: "source", text, language: "java" };
	}

	outputName(path: string): string {
		return path.replace(/\.class$/, ".java");
	}

	async restart(): Promise<void> {
		if (!this.jvm) return;
		this.preparePromise = null;
		await this.jvm.restart();
	}
}
