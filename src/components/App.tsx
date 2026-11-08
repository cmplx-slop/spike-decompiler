import { useEffect } from "preact/hooks";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";
import { Content } from "./Content";
import { StatusBar } from "./StatusBar";
import { DragDropZone } from "./DragDropZone";
import { dragDepth, openFile } from "../state";

export function App() {
	// Whole-window drag & drop: dragenter fires for every element crossed,
	// so keep a depth counter to hide the overlay only on the real dragleave.
	useEffect(() => {
		const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
		const onEnter = (e: DragEvent) => { e.preventDefault(); if (hasFiles(e)) dragDepth.value++; };
		const onOver = (e: DragEvent) => e.preventDefault();
		const onLeave = () => { dragDepth.value = Math.max(0, dragDepth.value - 1); };
		const onDrop = (e: DragEvent) => {
			e.preventDefault();
			dragDepth.value = 0;
			const file = e.dataTransfer?.files?.[0];
			if (file) openFile(file);
		};
		window.addEventListener("dragenter", onEnter);
		window.addEventListener("dragover", onOver);
		window.addEventListener("dragleave", onLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onEnter);
			window.removeEventListener("dragover", onOver);
			window.removeEventListener("dragleave", onLeave);
			window.removeEventListener("drop", onDrop);
		};
	}, []);

	return (
		<div class="d-flex flex-column h-100">
			<Navbar />
			<div class="app-body d-flex">
				<Sidebar />
				<Content />
			</div>
			<StatusBar />
			<DragDropZone />
		</div>
	);
}
