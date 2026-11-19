// Shared admin toast primitive (SSR pages + editor island). No framework,
// no dependencies — plain DOM so Astro-bundled `<script type="module">`
// pages and Svelte islands can both import it under `script-src 'self'`.
export type ToastKind = "ok" | "err";

let root: HTMLDivElement | null = null;

function ensureRoot(): HTMLDivElement | null {
	if (typeof document === "undefined") return null;
	if (root?.isConnected) return root;
	const found = document.querySelector<HTMLDivElement>("[data-toast-root]");
	if (found) {
		root = found;
		return root;
	}
	const host = document.createElement("div");
	host.className = "admin-toast-root";
	host.setAttribute("data-toast-root", "");
	host.setAttribute("aria-live", "polite");
	document.body.appendChild(host);
	root = host;
	return root;
}

/** Render a monochrome toast; `err` accents glyph/text with `--error` only. */
export function toast(message: string, kind: ToastKind = "ok"): void {
	const host = ensureRoot();
	if (!host) return;
	const el = document.createElement("div");
	el.className = `admin-toast${kind === "err" ? " admin-toast--err" : ""}`;
	el.setAttribute("role", kind === "err" ? "alert" : "status");
	const glyph = document.createElement("span");
	glyph.className = "admin-toast-glyph";
	glyph.setAttribute("aria-hidden", "true");
	glyph.textContent = kind === "err" ? "✕" : "✓";
	const text = document.createElement("span");
	text.className = "admin-toast-msg";
	text.textContent = message;
	const close = document.createElement("button");
	close.type = "button";
	close.className = "admin-toast-close";
	close.setAttribute("aria-label", "Dismiss notification");
	close.textContent = "×";
	close.addEventListener("click", () => el.remove());
	el.appendChild(glyph);
	el.appendChild(text);
	el.appendChild(close);
	host.appendChild(el);
	window.setTimeout(() => el.remove(), 4000);
}

/** Admin error-code → one-line English hint (callers own this map). */
export function adminErrorHint(code: string, detail?: string): string {
	switch (code) {
		case "csrf":
			return "Not allowed from this origin — reload and retry";
		case "slug-conflict":
			return "Slug already exists";
		case "tag-in-use":
			return detail ? `Tag in use by ${detail}` : "Tag is in use";
		case "media-in-use":
			return detail
				? `Used by ${detail} — remove from posts first`
				: "Used by N posts — remove from posts first";
		case "upload failed (403)":
		case "403":
			return "Upload rejected (403) — reload and retry";
		default:
			return code;
	}
}
