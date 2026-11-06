import { useState } from "preact/hooks";
import { tree, filtered, query, openEntry, tabs, activeTabId, type Entry, type TreeNode } from "../state";
import { iconFor, formatBytes, baseName } from "../format";

export function TreeRoot() {
	if (query.value.trim()) {
		const list = filtered.value || [];
		if (list.length === 0) return <div class="text-body-tertiary small p-3">no matches</div>;
		return (
			<>
				{list.map((e) => <FileRow key={e.path} entry={e} depth={0} />)}
				{list.length >= 1000 && <div class="text-body-tertiary small p-2">…first 1000 matches</div>}
			</>
		);
	}
	return <TreeFolder node={tree.value} depth={0} />;
}

function TreeFolder({ node, depth }: { node: TreeNode; depth: number }) {
	const [open, setOpen] = useState(depth < 1);
	const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
	const files = [...node.files].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)));

	return (
		<>
			<button class="tree-row" style={`padding-left: ${depth * 14 + 6}px`} onClick={() => setOpen(!open)}>
				<span class={`tree-chevron ${open ? "open" : ""}`}><i class="fa-solid fa-chevron-right" /></span>
				<i class={`${iconFor("folder", open)} text-warning`} />
				<span>{node.name}</span>
			</button>
			{open && (
				<>
					{dirs.map((d) => <TreeFolder key={d.path} node={d} depth={depth + 1} />)}
					{files.map((f) => <FileRow key={f.path} entry={f} depth={depth + 1} />)}
				</>
			)}
		</>
	);
}

function FileRow({ entry, depth }: { entry: Entry; depth: number }) {
	const active = tabs.value.some((t) => t.id === activeTabId.value && t.path === entry.path);
	return (
		<button
			class={`tree-row ${active ? "active" : ""}`}
			style={`padding-left: ${depth * 14 + 26}px`}
			onClick={() => openEntry(entry.path)}
		>
			<i class={`${iconFor(entry.kind)} ${entry.kind === "class" ? "text-info" : "text-body-secondary"}`} />
			<span>{baseName(entry.path)}</span>
			<span class="tree-size">{formatBytes(entry.size)}</span>
		</button>
	);
}
