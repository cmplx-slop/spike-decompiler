// Small presentation helpers: byte formatting, icons (Font Awesome free),
// entry classification, and Monaco language ids by extension.

export type EntryKind = "bytecode" | "source" | "text" | "image" | "binary";

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const extOf = (path: string): string => {
	const base = path.slice(path.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
};

export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

// bytecodeExts = the active engine's supportedExtensions(); entries matching
// them are "bytecode" (decompilable), regardless of language.
export function kindOf(path: string, size: number, bytecodeExts: string[] = []): EntryKind {
	if (bytecodeExts.some((ext) => path.toLowerCase().endsWith(ext))) return "bytecode";
	const ext = extOf(path);
	if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext)) return "image";
	const texty = ["java", "txt", "properties", "json", "xml", "html", "htm", "css", "js", "yaml",
		"yml", "md", "sh", "bat", "sql", "mf", "gradle", "cfg", "conf", "ini", "toml", "dtd", "csv"];
	if (texty.includes(ext)) return "text";
	return size < 256 * 1024 ? "text" : "binary"; // small unknowns: try as text, NUL-sniff fixes the rest
}

export function iconFor(kind: string, isOpen = false): string {
	switch (kind) {
		case "folder": return isOpen ? "fa-solid fa-folder-open text-warning" : "fa-solid fa-folder text-warning";
		case "bytecode":
		case "source":
		case "java": return "fa-solid fa-file-code";
		case "image": return "fa-solid fa-file-image";
		case "archive": return "fa-solid fa-file-zipper text-primary"; // opened container (root node)
		case "text": return "fa-solid fa-file-lines";
		default: return "fa-solid fa-file";
	}
}

export function languageFor(path: string, kind: EntryKind): string {
	if (kind === "source") return "java";
	const map: Record<string, string> = {
		json: "json", xml: "xml", html: "html", htm: "html", css: "css",
		js: "javascript", yaml: "yaml", yml: "yaml", md: "markdown", sql: "sql",
		bat: "bat", sh: "shell",
	};
	return map[extOf(path)] || "plaintext";
}
