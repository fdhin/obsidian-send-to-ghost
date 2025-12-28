/* eslint-disable @typescript-eslint/no-var-requires */
import { SettingsProp, ContentProp, DataProp } from "./../types/index";
import { MarkdownView, Notice, requestUrl } from "obsidian";
import { sign } from "jsonwebtoken";

const matter = require("gray-matter");
const MarkdownIt = require("markdown-it");

const md = new MarkdownIt();
const version = "v4";

const contentPost = (frontmatter: ContentProp, data: DataProp) => ({
	posts: [
		{
			...frontmatter,
			html: md.render(data.content),
		},
	],
});

export const publishPost = async (
	view: MarkdownView,
	settings: SettingsProp
) => {
	// Ghost Url and Admin API key
	const key = settings.adminToken;
	if (key.includes(":")) {
		const [id, secret] = key.split(":");

		// Create the token (including decoding secret)
		const token = sign({}, Buffer.from(secret, "hex"), {
			keyid: id,
			algorithm: "HS256",
			expiresIn: "5m",
			audience: `/${version}/admin/`,
		});

		// get frontmatter
		const noteFile = view.app.workspace.getActiveFile();
		// @ts-ignore
		const metaMatter = app.metadataCache.getFileCache(noteFile).frontmatter;
		const data = matter(view.getViewData());

		const frontmatter = {
			title: metaMatter?.title || view.file.basename,
			tags: metaMatter?.tags
				? metaMatter.tags.map((t: string) => ({ name: t }))
				: [],
			featured: metaMatter?.featured || false,
			status: metaMatter?.published ? "published" : "draft",
			custom_excerpt: metaMatter?.excerpt || undefined,
			feature_image: metaMatter?.feature_image || undefined,
		};
		const ghostId = metaMatter?.ghost_id;

		try {
			// If updating, fetch the latest post data first to get the correct updated_at
			let currentUpdatedAt = null;
			if (ghostId) {
				const getResult = await requestUrl({
					url: `${settings.url}/ghost/api/${version}/admin/posts/${ghostId}/`,
					method: "GET",
					headers: {
						"Content-Type": "application/json;charset=utf-8",
						Authorization: `Ghost ${token}`,
					},
				});
				if (getResult.json?.posts?.[0]) {
					currentUpdatedAt = getResult.json.posts[0].updated_at;
				}
			}

			const payload = contentPost(frontmatter, data);
			if (currentUpdatedAt) {
				// @ts-ignore
				payload.posts[0].updated_at = currentUpdatedAt;
			}
			const post = JSON.stringify(payload);

			if (settings.debug) {
				console.log("Request: " + post);
			}

			const url = ghostId
				? `${settings.url}/ghost/api/${version}/admin/posts/${ghostId}/?source=html`
				: `${settings.url}/ghost/api/${version}/admin/posts/?source=html`;
			const method = ghostId ? "PUT" : "POST";

			const result = await requestUrl({
				url,
				method,
				contentType: "application/json",
				headers: {
					"Access-Control-Allow-Methods": `${method}`,
					"Content-Type": "application/json;charset=utf-8",
					Authorization: `Ghost ${token}`,
				},
				body: post,
			});

			const json = result.json;

			if (settings.debug) {
				console.log(JSON.stringify(json));
			}

			if (json?.posts) {
				const publishedPost = json.posts[0];
				new Notice(
					`"${publishedPost.title}" has been ${publishedPost.status} successful!`
				);

				// Update frontmatter with ghost_id and ghost_url
				view.app.fileManager.processFrontMatter(noteFile, (fm: any) => {
					fm.ghost_id = publishedPost.id;
					fm.ghost_url = publishedPost.url;
					fm.ghost_updated_at = publishedPost.updated_at;
				});
			} else {
				new Notice(`${json.errors[0].context || json.errors[0].message}`);
				new Notice(
					`${json.errors[0]?.details[0].message} - ${json.errors[0]?.details[0].params.allowedValues}`
				);
			}

			return json;
		} catch (error: any) {
			new Notice(
				`Couldn't connect to the Ghost API. Is the API URL and Admin API Key correct?\n\n${error.name}: ${error.message}`
			);
		}
	} else {
		new Notice("Error: Ghost API Key is invalid.")
	}
};
