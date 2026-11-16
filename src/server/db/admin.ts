import type { Db } from "./client";
import type { Post } from "./schema";
import type { Locale } from "../../config/site";

// Admin write-path stubs. Signatures are final; Phase 4 implements them.
// Every stub throws NotImplementedError so accidental use fails loudly.

// biome-ignore lint/complexity/noBannedTypes: stub signature placeholder until Phase 4
export class NotImplementedError extends Error {
	constructor(feature: string) {
		super(`${feature} is not implemented (Phase 4)`);
		this.name = "NotImplementedError";
	}
}

export interface NewPostInput {
	locale: Locale;
	slug: string;
	title: string;
	excerpt?: string;
	contentJson: string;
	translationGroupId?: string | null;
	tagIds?: string[];
	coverMediaId?: string | null;
}

export interface SavePostPatch {
	slug?: string;
	title?: string;
	excerpt?: string;
	contentJson?: string;
	tagIds?: string[];
	coverMediaId?: string | null;
	seoDescription?: string | null;
}

export async function createPost(_db: Db, _input: NewPostInput): Promise<Post> {
	throw new NotImplementedError("createPost");
}

export async function savePost(_db: Db, _id: string, _patch: SavePostPatch): Promise<Post> {
	throw new NotImplementedError("savePost");
}

export async function publishPost(
	_db: Db,
	_id: string,
	_publishedAt?: number,
): Promise<Post> {
	throw new NotImplementedError("publishPost");
}

export async function unpublishPost(_db: Db, _id: string): Promise<Post> {
	throw new NotImplementedError("unpublishPost");
}
