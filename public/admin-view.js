// Admin posts list/grid toggle (mirrors the `admin-theme.js` contract:
// byte-stable `public/` script, `src=`-included, try/catch storage,
// `DOMContentLoaded` sync, zero inline JS — hash-free admin CSP stays
// `script-src 'self'`). Persists to `gurat-admin-posts-view`.
function postsViewCurrent() {
	var stored = null;
	try {
		stored = localStorage.getItem("gurat-admin-posts-view");
	} catch (_err) {
		stored = null;
	}
	if (stored === "grid" || stored === "column") return stored;
	return "column";
}
function applyPostsView(view) {
	var list = document.querySelector(".admin-rows");
	if (list) list.setAttribute("data-view", view);
	var buttons = document.querySelectorAll("[data-posts-view]");
	var i;
	for (i = 0; i < buttons.length; i++) {
		buttons[i].setAttribute(
			"aria-pressed",
			String(buttons[i].getAttribute("data-posts-view") === view),
		);
	}
}
function setPostsView(view) {
	try {
		localStorage.setItem("gurat-admin-posts-view", view);
	} catch (_err) {
		/* private mode keeps session-only view */
	}
	applyPostsView(view);
}
applyPostsView(postsViewCurrent());
document.addEventListener("DOMContentLoaded", () => {
	applyPostsView(postsViewCurrent());
	var buttons = document.querySelectorAll("[data-posts-view]");
	var i;
	for (i = 0; i < buttons.length; i++) {
		buttons[i].addEventListener("click", function () {
			var v = this.getAttribute("data-posts-view");
			if (v === "grid" || v === "column") setPostsView(v);
		});
	}
});
