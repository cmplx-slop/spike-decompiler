// Resolves the FernFlower engine from JetBrains' official IntelliJ Community
// repository at build time (server-side fetch — browser CORS does not apply),
// pins it with a SHA-256 manifest, and drops it into web/engine/ for the
// runtime to serve same-origin and verify at load.
//
//   bun scripts/fetch-engine.ts            # pinned default version
//   bun scripts/fetch-engine.ts 261.27258.136
//
// The artifact is NOT vendored in the repo; web/engine/ is generated output.
//
// Version guidance: CheerpJ 5 ships OpenJDK 21 (Java 25 is preview), so pin
// an IntelliJ line whose class files are Java 21 or older. Verified:
//   261.27258.136 -> major 65 (Java 21)   262.11879.100 -> major 69 (Java 25, skip)

const REPO = "https://www.jetbrains.com/intellij-repository/releases/com/jetbrains/intellij/java/java-decompiler-engine";
const DEFAULT_VERSION = "261.27258.136";

interface EngineManifest {
	engine: "com.jetbrains.intellij.java:java-decompiler-engine";
	version: string;
	url: string;
	sha256: string;
	fetchedAt: string;
}

const engineDir = new URL("../engine/", import.meta.url);
const jarPath = new URL("java-decompiler.jar", engineDir);
const manifestPath = new URL("engine.json", engineDir);

const sha256hex = async (data: ArrayBuffer): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const version = process.argv[2] ?? DEFAULT_VERSION;
const url = `${REPO}/${version}/java-decompiler-engine-${version}.jar`;

// Idempotent: same version with matching digest on disk => no network.
const existing = await Bun.file(manifestPath).json().catch(() => null as EngineManifest | null);
if (existing?.version === version) {
	const onDisk = await Bun.file(jarPath).arrayBuffer().catch(() => null);
	if (onDisk && (await sha256hex(onDisk)) === existing.sha256) {
		console.log(`engine ${version} already present (${existing.sha256.slice(0, 12)}…) — nothing to do`);
		process.exit(0);
	}
}

console.log(`fetching ${url}`);
const res = await fetch(url);
if (!res.ok) {
	console.error(`FAILED ${res.status} ${res.statusText}\n  ${url}`);
	process.exit(1);
}
const bytes = await res.arrayBuffer();

// sanity: PK zip magic + a plausible size
const head = new Uint8Array(bytes, 0, 4);
if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) {
	console.error("downloaded payload is not a zip/jar (bad PK magic) — refusing");
	process.exit(1);
}

const sha = await sha256hex(bytes);
await Bun.write(jarPath, bytes);
const manifest: EngineManifest = {
	engine: "com.jetbrains.intellij.java:java-decompiler-engine",
	version,
	url,
	sha256: sha,
	fetchedAt: new Date().toISOString(),
};
await Bun.write(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

console.log(`ok: engine/java-decompiler.jar (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
console.log(`    sha256 ${sha}`);
console.log(`    wrote  engine/engine.json`);
