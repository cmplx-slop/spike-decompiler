import { render } from "preact";
import { App } from "./components/App";
import logo from "../logo.svg";
import { appName, description } from "./utils";

const fav = document.createElement("link");
fav.rel = "icon";
fav.type = "image/svg+xml";
fav.href = logo;
document.head.appendChild(fav);
document.title = `${appName} - ${description}`

render(<App />, document.getElementById("app")!);
