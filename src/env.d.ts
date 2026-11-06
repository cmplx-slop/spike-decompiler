// bun asset imports (`with { type: "file" }`): typed as resource URLs.
declare module "*.svg" {
	const url: string;
	export default url;
}
