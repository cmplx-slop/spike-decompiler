import { dragDepth } from "../state";

export function DragDropZone() {
	if (!dragDepth.value) return null;
	return (
		<div class="drop-overlay">
			<div class="drop-card">
				<i class="fa-solid fa-box-open fa-2xl text-info d-block mb-3" />
				drop the jar to open it
			</div>
		</div>
	);
}
