// Admin theme bootstrap (same stored override as the public shell:
// `gurat-theme` in localStorage, else OS preference). Lives in `public/`
// (byte-stable, no build transform) and loads via `src="/admin-theme.js"`,
// so the hash-free admin CSP (`script-src 'self'`, never inline) allows it
// in dev and prod alike. Never inline this into Admin.astro.
function adminThemeValue() {
	var stored = null;
	try {
		stored = localStorage.getItem("gurat-theme");
	} catch (_err) {
		stored = null;
	}
	if (stored === "light" || stored === "dark") return stored;
	try {
		return matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	} catch (_err) {
		return "light";
	}
}
function applyAdminTheme() {
	document.documentElement.dataset.theme = adminThemeValue();
}
function syncAdminTheme() {
	var t = adminThemeValue();
	var buttons = document.querySelectorAll("[data-theme-value]");
	var i;
	for (i = 0; i < buttons.length; i++) {
		buttons[i].setAttribute(
			"aria-pressed",
			String(buttons[i].getAttribute("data-theme-value") === t),
		);
	}
}
function setAdminTheme(t) {
	try {
		localStorage.setItem("gurat-theme", t);
	} catch (_err) {
		/* private mode keeps session-only theme */
	}
	document.documentElement.dataset.theme = t;
	syncAdminTheme();
}
applyAdminTheme();
syncAdminTheme();
document.addEventListener("DOMContentLoaded", () => {
	var buttons = document.querySelectorAll("[data-theme-value]");
	var i;
	for (i = 0; i < buttons.length; i++) {
		buttons[i].addEventListener("click", function () {
			var v = this.getAttribute("data-theme-value");
			if (v === "light" || v === "dark") setAdminTheme(v);
		});
	}
});
