import { useRef } from "preact/hooks";
import logo from "../../logo.svg";
import {
	jarInfo, openJarFile, restartEngine,
	engineOptions, OPTION_LABELS, toggleOption,
	theme, toggleTheme,
} from "../state";

export function Navbar() {
	const picker = useRef<HTMLInputElement>(null);

	return (
		<nav class={`app-navbar navbar py-1 ${theme.value === "dark" ? "navbar-dark bg-dark border-bottom border-secondary-subtle" : "bg-body-tertiary border-bottom"}`}>
			<div class="container-fluid">
				<span class="navbar-brand mb-0 h1 d-flex align-items-center gap-2 fs-6">
					<img src={logo} alt="" width="26" height="26" class="brand-logo" />
					spike
				</span>

				<span class="text-body-secondary small text-truncate" style="max-width: 38vw">
					{jarInfo.value && (
						<span>
							<i class="fa-solid fa-box-archive me-1" />
							{jarInfo.value.name}
							<span class="ms-2 text-body-tertiary">
								{jarInfo.value.shown.toLocaleString()} entries
								{jarInfo.value.hidden > 0 && ` (${jarInfo.value.hidden} unsafe entries hidden)`}
							</span>
						</span>
					)}
				</span>

				<div class="d-flex align-items-center gap-2">
					<button
						class="btn btn-outline-secondary btn-sm"
						onClick={toggleTheme}
						title={theme.value === "dark" ? "Switch to light theme" : "Switch to dark theme"}
						aria-label="toggle light/dark theme"
					>
						<i class={`fa-solid ${theme.value === "dark" ? "fa-sun" : "fa-moon"}`} />
					</button>
					<details class="dropdown">
						<summary class="btn btn-outline-secondary btn-sm" title="Decompiler options">
							<i class="fa-solid fa-sliders" />
							<span class="d-none d-md-inline ms-1">Options</span>
						</summary>
						<div class="dropdown-menu show p-2" style="width: 18rem">
							{Object.entries(OPTION_LABELS).map(([flag, label]) => (
								<div class="form-check form-switch mb-1">
									<input
										class="form-check-input" type="checkbox" id={`opt-${flag}`}
										checked={engineOptions.value[flag]}
										onChange={() => toggleOption(flag)}
									/>
									<label class="form-check-label small" for={`opt-${flag}`}>{label}</label>
								</div>
							))}
							<div class="text-body-tertiary small mt-1">applies to newly opened classes</div>
						</div>
					</details>

					<button class="btn btn-outline-secondary btn-sm" onClick={restartEngine}
					        title="Restart the decompiler JVM (frees memory / recovers from errors)">
						<i class="fa-solid fa-rotate-right" />
						<span class="d-none d-md-inline ms-1">Engine</span>
					</button>

					<button class="btn btn-info btn-sm" onClick={() => picker.current?.click()}>
						<i class="fa-solid fa-folder-open" />
						<span class="ms-1">Open jar</span>
					</button>
					<input
						ref={picker} type="file" accept=".jar,.zip,.war,.ear" hidden
						onChange={(e) => {
							const input = e.currentTarget as HTMLInputElement;
							if (input.files?.[0]) openJarFile(input.files[0]);
							input.value = "";
						}}
					/>
				</div>
			</div>
		</nav>
	);
}
