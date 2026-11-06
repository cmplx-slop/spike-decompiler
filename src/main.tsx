import { render } from "preact";
import { App } from "./components/App";
import logo from "../logo.svg";

// Favicon injected from the bundler'd asset URL: dev servers answer unknown
// static paths with index.html, so a static <link href="/logo.svg"> in
// index.html would not resolve — but a module-graph asset URL always does.
const fav = document.createElement("link");
fav.rel = "icon";
fav.type = "image/svg+xml";
fav.href = logo;
document.head.appendChild(fav);

render(<App />, document.getElementById("app")!);
