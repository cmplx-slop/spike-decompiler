import { query, fileInfo, containerWarnings } from "../state";
import { TreeRoot } from "./Tree";

export function Sidebar() {
	if (!fileInfo.value) return null;
	return (
		<aside class="app-side bg-body">
			<div class="p-2 border-bottom border-secondary-subtle">
				<div class="input-group input-group-sm">
					<span class="input-group-text"><i class="fa-solid fa-magnifying-glass" /></span>
					<input
						class="form-control" placeholder="filter entries…"
						value={query.value}
						onInput={(e) => { query.value = (e.target as HTMLInputElement).value; }}
					/>
					{query.value && (
						<button class="btn btn-outline-secondary" onClick={() => { query.value = ""; }}>
							<i class="fa-solid fa-xmark" />
						</button>
					)}
				</div>
				{containerWarnings.value.length > 0 && (
					<div class="small text-warning mt-2">
						<i class="fa-solid fa-triangle-exclamation me-1" />
						{containerWarnings.value[0]}
						{containerWarnings.value.length > 1 && ` (+${containerWarnings.value.length - 1} more)`}
					</div>
				)}
			</div>
			<div class="app-tree">
				<TreeRoot />
			</div>
		</aside>
	);
}
