// App metadata, sourced from package.json so there is one source of truth.
import pkg from "../../package.json";

export const appName = pkg.name;
export const description = pkg.description;
export const repo = pkg.repository.url;
