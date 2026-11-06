// Smoke test: run the real archive worker body under bun with a mocked
// `self`, then index and extract from the vendored FernFlower jar.
// Run: bun test (from web/)

import { test, expect } from "bun:test";
import * as fflate from "fflate";
import { archiveWorkerBody } from "../src/archive";

type Msg = { id: number; ok: boolean; entries?: any[]; warnings?: string[]; bytes?: Uint8Array; error?: string };

test("archive worker indexes and extracts a real jar", async () => {
	const messages: Msg[] = [];
	const fakeSelf: any = {
		postMessage: (m: Msg) => messages.push(m),
		importScripts: () => { /* CDN fflate replaced by the npm copy below */ },
	};
	(fakeSelf as any).fflate = fflate; // the worker body reaches fflate via self.fflate (UMD)
	(globalThis as any).self = fakeSelf;

	archiveWorkerBody();
	expect(typeof fakeSelf.onmessage).toBe("function");

	const jar = Bun.file(new URL("./fixtures/java-decompiler.jar", import.meta.url));
	const buffer = await jar.arrayBuffer();

	await fakeSelf.onmessage({ data: { id: 1, type: "load", buffer } });
	const loaded = messages.find((m) => m.id === 1)!;
	expect(loaded.ok).toBe(true);
	expect(loaded.entries!.length).toBeGreaterThan(300);

	const target = "org/jetbrains/java/decompiler/main/decompiler/ConsoleDecompiler.class";
	expect(loaded.entries!.some((e) => e.name === target)).toBe(true);

	await fakeSelf.onmessage({ data: { id: 2, type: "extract", name: target } });
	const extracted = messages.find((m) => m.id === 2)!;
	expect(extracted.ok).toBe(true);
	const bytes = extracted.bytes!;
	expect(bytes.length).toBeGreaterThan(4000);
	// class file magic: CAFEBABE
	expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0xca, 0xfe, 0xba, 0xbe]);
});

test("archive worker rejects non-zip input", async () => {
	const messages: Msg[] = [];
	const fakeSelf: any = { postMessage: (m: Msg) => messages.push(m), importScripts: () => {} };
	fakeSelf.fflate = fflate;
	(globalThis as any).self = fakeSelf;
	archiveWorkerBody();

	await fakeSelf.onmessage({ data: { id: 1, type: "load", buffer: new TextEncoder().encode("this is not a zip").buffer } });
	const loaded = messages.find((m) => m.id === 1)!;
	expect(loaded.ok).toBe(false);
	expect(loaded.error).toInclude("end-of-central-directory");
});
