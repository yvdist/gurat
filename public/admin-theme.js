// Admin theme bootstrap (same stored override as the public shell:
// `gurat-theme` in localStorage, else OS preference). Lives in `public/`
// (byte-stable, no build transform) and loads via `src="/admin-theme.js"`,
// so the hash-free admin CSP (`script-src 'self'`, never inline) allows it
// in dev and prod alike. Never inline this into Admin.astro.
function applyAdminTheme() {
	var t = null;
	try {
		t = localStorage.getItem("gurat-theme");
	} catch (_err) {
		t = null;
	}
	try {
		document.documentElement.dataset.theme =
			t === "light" || t === "dark"
				? t
				: matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light";
	} catch (_err) {
		document.documentElement.dataset.theme = "light";
	}
}
applyAdminTheme();
