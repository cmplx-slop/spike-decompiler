import { query, jarInfo, archiveWarnings } from "../state";
import { TreeRoot } from "./Tree";

export function Sidebar() {
	if (!jarInfo.value) return null;
	return (
		<aside class="app-side bg-body">
			<div class="p-2 border-bottom border-secondary-subtle">
				<div class="input-group input-group-sm">
					<span class="input-group-text"><i class="fa-solid fa-magnifying-glass" /></span>
					<input
						class="form-control" placeholder="filter classes…"
						value={query.value}
						onInput={(e) => { query.value = (e.target as HTMLInputElement).value; }}
					/>
					{query.value && (
						<button class="btn btn-outline-secondary" onClick={() => { query.value = ""; }}>
							<i class="fa-solid fa-xmark" />
						</button>
					)}
				</div>
				{archiveWarnings.value.length > 0 && (
					<div class="small text-warning mt-2">
						<i class="fa-solid fa-triangle-exclamation me-1" />
						{archiveWarnings.value[0]}
						{archiveWarnings.value.length > 1 && ` (+${archiveWarnings.value.length - 1} more)`}
					</div>
				)}
			</div>
			<div class="app-tree">
				<TreeRoot />
			</div>
		</aside>
	);
}
