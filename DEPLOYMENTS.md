# DEPLOYMENTS.md — Panduan deploy & operasi Gurat

Panduan pemilik (Bahasa Indonesia): dari nol sampai situs live, lalu
checklist peluncuran yang dicek manual bersama asisten. Detail restore
ada di `docs/runbook.md` (English) — file ini menautkannya, tidak
menduplikasinya.

**Status: belum live.** Terakhir: Phase 7 di branch `phase-7`. Setiap baris
checklist punya kolom `Sudah | Belum | Tanggal` untuk dicek manual bersama
asisten.

## 0. Ringkasan

- Deploy = GitHub Action `deploy.yml` (`workflow_dispatch`, owner menekan
  setelah migrasi) yang menjalankan `wrangler deploy`. Bukan Workers Builds
  (lihat ADR-006).
- Urutan wajib: `pnpm db:migrate:remote` dulu (aditif, backward compatible),
  baru deploy. Rollback tidak pernah menyentuh database.
- Backup = Action `backup.yml` mingguan (Senin 02:00 WIB) + manual, ke bucket
  R2 privat `gurat-backups`. Restore teruji (lihat `docs/runbook.md` §2).
- `workers.dev` tetap aktif; keamanan admin dijamin JWT Phase-4
  (host-independent) — buktinya curl 401 pasca-deploy, bukan mematikan URL.

## 1. Prasyarat

| #   | Item                                                                                     | Sudah | Belum | Tanggal |
| --- | ---------------------------------------------------------------------------------------- | ----- | ----- | ------- |
| 1.1 | Akun Cloudflare + domain di Cloudflare (free plan)                                       |       |       |         |
| 1.2 | `wrangler login` di mesin owner                                                          |       |       |         |
| 1.3 | Repo di GitHub, branch `phase-7` ter-merge ke `main`                                     |       |       |         |
| 1.4 | Secrets GitHub: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                          |       |       |         |
| 1.5 | Bucket R2 privat `gurat-backups` + lifecycle rule (simpan 12 terbaru, prefix `backups/`) |       |       |         |

Token untuk backup: least-privilege (D1 read + R2 write saja). Token untuk
deploy: scope Workers deploy. Jangan pernah cetak token di log (`set -x`
mati di sekitar pemakaian secret).

## 2. DNS & domain (urutan spec 7.7 — kerjakan berurutan)

| #   | Langkah                                                                                                                                                                | Sudah | Belum | Tanggal |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- | ------- |
| 2.1 | Ekspor/screenshot **semua** record DNS `yvdist.com` yang ada (A/AAAA/CNAME/MX/TXT/CAA…)                                                                                |       |       |         |
| 2.2 | Tambahkan zone ke Cloudflare; buat ulang semua record persis sama; portofolio & subdomain lain utuh ("DNS only" bila platform target mewajibkan; periksa record email) |       |       |         |
| 2.3 | Turunkan TTL dulu; ganti nameserver di registrar; tunggu propagasi; verifikasi portofolio + semua subdomain masih jalan                                                |       |       |         |
| 2.4 | Pasang custom domain Worker (`<sub>.yvdist.com`) dan domain bucket R2 (`media.yvdist.com`)                                                                             |       |       |         |
| 2.5 | Buat aplikasi Access untuk `/admin*`; set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS`                                                                           |       |       |         |
| 2.6 | Verifikasi TLS, redirect (www/non-www bila relevan), HSTS (HSTS di edge dashboard — bukan header Worker)                                                               |       |       |         |

Verifikasi tiap langkah (contoh; ganti nama domain):

```sh
dig +short <sub>.yvdist.com
dig +short media.yvdist.com
nslookup yvdist.com
curl -sI https://<sub>.yvdist.com | head -20
curl -sI https://media.yvdist.com | head -10
```

## 3. Domain Worker & media

1. Worker → Settings → Domains & Routes → Add custom domain
   `<sub>.yvdist.com`.
2. R2 → bucket media → Settings → Custom Domains → sambungkan
   `media.yvdist.com` (akses publik; tanpa ini serving tanpa-Worker mati).
3. Variabel Worker (dashboard → Workers → Settings → Variables, **jangan
   pernah commit**): `SITE_URL=https://<sub>.yvdist.com`,
   `MEDIA_BASE_URL=https://media.yvdist.com`, plus vars Access (tabel §4).
4. Secret via `wrangler secret` (produksi) dan `.dev.vars` (lokal).
   Tidak ada secret di repo.

## 4. Aplikasi Access + variabel

Buat aplikasi Access (Zero Trust → Access → Applications → Add: self-hosted,
domain = host situs, path = `/admin*`), policy: allow email owner.
Salin **Application Audience (AUD) Tag**.

| Var                  | Sumber               | Contoh                                      |
| -------------------- | -------------------- | ------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | dashboard Zero Trust | `https://<team>.cloudflareaccess.com`       |
| `ACCESS_AUD`         | aplikasi Access      | AUD tag aplikasi                            |
| `ADMIN_EMAILS`       | owner                | `you@example.com` (koma bila >1)            |
| `SITE_URL`           | owner                | `https://<sub>.yvdist.com`                  |
| `MEDIA_BASE_URL`     | owner                | `https://media.yvdist.com` (kosong = lokal) |

| #   | Verifikasi                                  | Sudah | Belum | Tanggal |
| --- | ------------------------------------------- | ----- | ----- | ------- |
| 4.1 | Owner bisa sign in lewat Access ke `/admin` |       |       |         |
| 4.2 | Akun non-allowlist ditolak                  |       |       |         |

## 5. Migrasi lalu deploy

```sh
pnpm db:migrate:remote   # owner, eksplisit, SEBELUM deploy (aditif saja)
# lalu: GitHub → Actions → deploy → Run workflow (workflow_dispatch)
```

| #   | Langkah                         | Sudah | Belum | Tanggal |
| --- | ------------------------------- | ----- | ----- | ------- |
| 5.1 | `pnpm db:migrate:remote` sukses |       |       |         |
| 5.2 | Action `deploy` hijau           |       |       |         |

Migrasi aditif + backward compatible: kode lama tetap jalan di skema baru.
Rollback = `wrangler rollback <version-id>` (lihat `wrangler versions
list`), lalu deploy ulang commit hijau terakhir — detail di
`docs/runbook.md` §4.

## 6. Verifikasi pasca-deploy

```sh
curl -sI https://<sub>.yvdist.com | grep -i "content-security-policy\|x-request-id"
curl -sI https://<sub>.yvdist.com/writing/hello-world | grep -i "content-security-policy"
curl -s https://<sub>.yvdist.com/healthz   # {"ok":true}
curl -s https://<sub>.yvdist.com/sitemap.xml | head -5
curl -s https://<sub>.yvdist.com/feed.xml | head -5
curl -sI https://media.yvdist.com/media/<id>/480.webp | grep -i "cache-control"  # immutable
curl -s -o /dev/null -w "%{http_code}\n" https://<sub>.workers.dev/admin/api/posts  # 401 tanpa JWT
curl -s -o /dev/null -w "%{http_code}\n" https://<sub>.workers.dev/admin/api/tags   # 401 tanpa JWT
```

| #   | Cek                                                                       | Sudah | Belum | Tanggal |
| --- | ------------------------------------------------------------------------- | ----- | ----- | ------- |
| 6.1 | Header baseline + CSP di `/`, post EN/ID, `/healthz`                      |       |       |         |
| 6.2 | `/healthz` = `{"ok":true}`, `no-store`, `noindex`                         |       |       |         |
| 6.3 | Feeds + sitemap benar                                                     |       |       |         |
| 6.4 | Media: `Cache-Control: immutable`                                         |       |       |         |
| 6.5 | `/admin/api/*` 401 di `workers.dev` tanpa JWT (keamanan host-independent) |       |       |         |
| 6.6 | Tidak ada pelanggaran CSP di console (buka home/post/tag/404, dua tema)   |       |       |         |

## 7. Backup & restore

Otomatis tiap Senin 02:00 WIB + manual (`workflow_dispatch` sebelum operasi
berisiko) ke `gurat-backups/backups/YYYY-MM-DD.sql`. Langkah restore yang
teruji: `docs/runbook.md` §2 (drill lokal: 9 posts / 4 tags / 10 media
cocok sebelum–sesudah, 2026-11-17).

| #   | Cek                                       | Sudah | Belum | Tanggal |
| --- | ----------------------------------------- | ----- | ----- | ------- |
| 7.1 | Workflow backup pernah hijau sekali       |       |       |         |
| 7.2 | Restore ke scratch DB teruji, count cocok |       |       |         |

Media: bucket publik hanya berisi varian turunan. Dengan
`KEEP_ORIGINALS=false` tidak ada original di mana pun — kehilangan bucket
berarti upload ulang sumber (keterbatasan yang diterima, ADR-005).

## 8. Search Console & Bing

| #   | Cek                                            | Sudah | Belum | Tanggal |
| --- | ---------------------------------------------- | ----- | ----- | ------- |
| 8.1 | Search Console terverifikasi, sitemap disubmit |       |       |         |
| 8.2 | Bing Webmaster terverifikasi, sitemap disubmit |       |       |         |

## 9. Rollback

1. `wrangler versions list` → cari versi hijau terakhir.
2. `wrangler rollback <version-id>`, lalu deploy ulang commit hijau
   terakhir via `workflow_dispatch`.
3. Jangan pernah rollback migrasi (aditif saja). Detail:
   `docs/runbook.md` §4.

## 10. Checklist launch (spec 7.8)

| #    | Item                                                                               | Sudah | Belum | Tanggal |
| ---- | ---------------------------------------------------------------------------------- | ----- | ----- | ------- |
| 10.1 | D1 produksi termigrasi; owner bisa sign in via Access; non-allowlist ditolak       |       |       |         |
| 10.2 | Post nyata pertama terbit EN + ID, terjemahan tertaut; feed & sitemap benar        |       |       |         |
| 10.3 | Search Console (+ Bing) terverifikasi, sitemap disubmit                            |       |       |         |
| 10.4 | Workflow backup pernah hijau; restore teruji                                       |       |       |         |
| 10.5 | README mendokumentasikan: dev lokal, deploy, migrasi, backup/restore, alur menulis |       |       |         |
| 10.6 | `docs/phase-reports/07.md` ditulis + ringkasan deviasi/limitasi                    |       |       |         |
