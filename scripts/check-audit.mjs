// Audit gate (spec 07 §7.4d): fails on any HIGH/CRITICAL advisory outside
// `audit-allowlist.json`. `pnpm audit --json` shape (npm registry format):
// `{ advisories: { [id]: { severity, module_name, title, url } } }`.
import { readFileSync } from "node:fs";

/** @type {string[]} */
const allowlist = JSON.parse(
	readFileSync(new URL("../audit-allowlist.json", import.meta.url), "utf8"),
);

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const parsed = JSON.parse(raw || "{}");
const advisories =
	typeof parsed === "object" && parsed !== null
		? Object.values(parsed.advisories ?? {})
		: [];

let failed = false;
for (const adv of advisories) {
	if (adv.severity !== "high" && adv.severity !== "critical") continue;
	const key = `${adv.module_name}@${adv.severity}`;
	if (allowlist.includes(adv.module_name) || allowlist.includes(key)) continue;
	console.error(
		`FAIL ${adv.severity} ${adv.module_name}: ${adv.title} ${adv.url}`,
	);
	failed = true;
}
if (failed) {
	console.error(
		"\nFix the dependency or document an entry in audit-allowlist.json.",
	);
	process.exit(1);
}
console.log("audit gate: no unlisted HIGH/CRITICAL advisories.");
