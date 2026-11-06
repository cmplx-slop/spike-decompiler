import { useEffect, useRef } from "preact/hooks";
import loader from "@monaco-editor/loader";
import { theme } from "../state";

// Monaco itself is fetched from the CDN by @monaco-editor/loader at first use
// (it is *not* bundled — keeps the app payload tiny).
loader.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs" } });

function monacoTheme(): string { return theme.value === "dark" ? "vs-dark" : "vs"; }

// The editor + text models are module singletons: they survive tab switches
// (cursor/scroll state per file is kept in the model) and are disposed when
// the last source tab closes (component unmount).
let monacoPromise: Promise<any> | null = null;
let monacoInstance: any = null; // resolved instance, so theme flips can reach it
let editor: any = null;
const models = new Map<string, any>();

export function Editor({ path, text, language }: { path: string; text: string; language: string }) {
	const host = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			monacoPromise ??= loader.init().then((m) => (monacoInstance = m, m));
			const monaco = await monacoPromise;
			if (cancelled || !host.current) return;

			if (!editor) {
				editor = monaco.editor.create(host.current, {
					readOnly: true,
					automaticLayout: true,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					renderValidationDecorations: "off",
					fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
					fontSize: 13,
					padding: { top: 12 },
					theme: monacoTheme(),
				});
			}

			let model = models.get(path);
			if (!model) {
				model = monaco.editor.createModel(
					text,
					language,
					monaco.Uri.parse(`inmemory://jd/${encodeURIComponent(path)}`),
				);
				models.set(path, model);
			} else if (model.getValue() !== text) {
				model.setValue(text); // re-decompiled with different options
			}
			if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
			editor.setModel(model);
		})();
		return () => { cancelled = true; };
	}, [path, text, language]);

	// Live theme flip: setTheme is global (affects all editors), and a model
	// swap never resets it — but covers the editor created before this mount.
	useEffect(() => {
		monacoInstance?.editor.setTheme(monacoTheme());
	}, [theme.value]);

	// Dispose the editor widget only when the component goes away entirely
	// (all source tabs closed); models stay cheap and reusable.
	useEffect(() => () => {
		if (editor) { editor.dispose(); editor = null; }
	}, []);

	return <div class="editor-host" ref={host} />;
}
