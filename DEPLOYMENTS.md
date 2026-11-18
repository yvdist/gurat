# DEPLOYMENTS.md — Panduan deploy & operasi Gurat (untuk pemula)

Panduan pemilik dalam Bahasa Indonesia, ditulis dengan asumsi kamu **baru
pertama kali** memakai GitHub Actions dan dashboard Cloudflare. Setiap
langkah menyebut **di mana** (GitHub / Cloudflare / terminal laptop),
**halaman apa**, dan **tombol apa yang diklik**.

Status saat ini: **belum live.** Kode di `main` sudah siap deploy; semua
yang di bawah ini adalah pekerjaan owner satu kali + checklist berulang.

Detail langkah restore ada di `docs/runbook.md` (English) — file ini
menautkannya, tidak menduplikasinya.

## 0. Peta besar: apa dikerjakan di mana (baca dulu 2 menit)

| Pekerjaan                | Di mana                                                     | Alamat / cara buka                                              |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Menyimpan kode + menekan tombol deploy | **GitHub** (repo `yvdist/gurat`)              | `github.com/yvdist/gurat` → tab **Actions**                     |
| Hosting, domain, DNS, database, gambar | **Cloudflare dashboard** (`dash`)            | `dash.cloudflare.com` (login dulu)                              |
| Migrasi database         | **Terminal di laptop**                                      | `pnpm db:migrate:remote` (setelah `wrangler login`)             |
| Memastikan situs jalan   | **Browser + terminal**                                      | buka URL situs, jalankan perintah `curl`                        |

Tiga hal yang sering membingungkan — diluruskan dulu:

1. **Tidak ada GitHub Pages di sini.** GitHub hanya menyimpan kode dan
   menyediakan tombol "deploy" (disebut *GitHub Actions*). Situsnya
   di-host di **Cloudflare Workers**, bukan di GitHub.
2. **Tidak ada tombol "Deploy" di dashboard Cloudflare yang perlu kamu
   klik.** Deploy dilakukan oleh robot GitHub Actions yang menjalankan
   `wrangler deploy`. Dashboard Cloudflare dipakai untuk *pengaturan*
   (domain, variabel, Access), bukan untuk upload kode.
3. **Urutan wajib setiap rilis:** migrasi database dulu (terminal) →
   tekan tombol deploy (GitHub). Tidak boleh dibalik.

## 1. Persiapan akun & kunci (sekali saja)

### 1.1. Buat akun Cloudflare

1. Buka `cloudflare.com` → **Sign Up**, verifikasi email.
2. Buka `dash.cloudflare.com` dan login. Ini "dash" yang disebut di
   seluruh dokumen ini.

### 1.2. Sambungkan laptop ke Cloudflare

Di terminal, di folder repo ini:

```sh
pnpm exec wrangler login
```

Browser terbuka → **Allow** → kembali ke terminal, muncul pesan sukses.
Ini memberi laptopmu izin mengelola Workers/D1/R2 milikmu. Cukup sekali
(sampai tokennya kedaluwarsa).

### 1.3. Cari Account ID

1. Buka `dash.cloudflare.com` → menu kiri **Workers & Pages**.
2. Di kolom kanan halaman itu ada **Account ID** (deretan huruf-angka) →
   **salin**, simpan di catatan. Dipakai sebagai secret GitHub di §1.4.

### 1.4. Buat API token (2 token) + simpan sebagai secret GitHub

Token = kata sandi khusus robot GitHub Actions. Kita buat dua, sesuai
prinsip akses seminimal mungkin:

1. Di dash, klik **avatar/foto profil** (pojok kanan atas) → **My Profile**
   → tab **API Tokens** → **Create Token**.
2. Pilih **Create Custom Token**, isi:
   - **Token untuk backup** — Permissions: cari **D1** → **Read**; cari
     **R2** (atau "Workers R2 Storage") → **Write**. Account Resources:
     sertakan akunmu. (Nama menu bisa sedikit berbeda antar versi dash —
     cari yang maknanya sama.)
   - **Token untuk deploy** — Permissions: cari **Workers Scripts**
     (atau "Workers") → **Edit**. Ini yang boleh meng-upload kode baru.
3. **Create** → **salin tokennya sekarang** (hanya ditampilkan sekali).

Lalu simpan ke GitHub:

1. Buka `github.com/yvdist/gurat` → tab **Settings** (paling kanan) →
   menu kiri **Secrets and variables** → **Actions** →
   **New repository secret**.
2. Buat dua secret:
   - Name `CLOUDFLARE_API_TOKEN`, isi token deploy.
   - Name `CLOUDFLARE_ACCOUNT_ID`, isi Account ID dari §1.3.
3. (Catatan: workflow backup memakai secret yang sama
   `CLOUDFLARE_API_TOKEN`. Karena token deploy berscope lebih luas dari
   "D1 read + R2 write",owner yang ingin ketat bisa membuat token backup
   terpisah dan menyimpannya sebagai secret tambahan — opsional.)

| #   | Cek                                                                    | Sudah | Belum | Tanggal |
| --- | ---------------------------------------------------------------------- | ----- | ----- | ------- |
| 1.1 | Login dash bisa; `wrangler login` sukses                                |       |       |         |
| 1.2 | Dua secret GitHub tersimpan (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) | |   |         |

## 2. Domain & DNS (kerjakan berurutan, spec 7.7)

### 2.1. Foto dulu DNS yang ada (jangan dilewati!)

Kalau `yvdist.com` sudah dipakai (portofolio, email, subdomain), catat
**semua** record DNS-nya sekarang — dari panel tempat domain dibeli
(registrar) atau dari DNS lama. Screenshot + tulis: tiap record
A/AAAA/CNAME/MX/TXT/CAA beserta isinya. Ini jaring pengaman kalau ada
yang keliru salin.

| #   | Cek                                              | Sudah | Belum | Tanggal |
| --- | ------------------------------------------------ | ----- | ----- | ------- |
| 2.1 | Semua record DNS lama tercatat (screenshot)      |       |       |         |

### 2.2. Masukkan domain ke Cloudflare

1. Di dash (`dash.cloudflare.com`) → halaman utama akun → **Add domain**
   (atau **Add a website**).
2. Ketik `yvdist.com` → pilih paket **Free** → **Continue**.
3. Cloudflare memindai DNS yang ada → tampil daftar record → **periksa
   satu per satu cocok dengan catatan §2.1** (terutama MX/TXT email;
   yang targetnya platform lain set proxynya **DNS only**/abu-abu).
4. Cloudflare menampilkan **2 nameserver** (mis. `xxx.ns.cloudflare.com`)
   → salin.
5. Buka situs **tempat kamu membeli domain** (registrar) → pengaturan
   nameserver domainmu → ganti ke dua nameserver Cloudflare → simpan.
6. Kembali ke dash → **Done / Check nameservers**. Propagasi bisa
   hitungan menit sampai ±24 jam.
7. Verifikasi: buka `Websites` → `yvdist.com` → **DNS** → **Records** —
   semua record lama ada. Buka situs portofolio + subdomain lain di
   browser: masih jalan.

Perintah cek dari terminal (ganti nama domain sesuai):

```sh
dig +short yvdist.com
nslookup yvdist.com
curl -sI https://yvdist.com | head -5
```

### 2.3. Siapkan dua bucket R2 (media + backup)

1. Dash → menu kiri **R2** → **Create bucket**:
   - Nama `gurat-media` (bucket gambar situs; binding `MEDIA` sudah
     dideklarasikan di `wrangler.jsonc`).
   - Nama `gurat-backups` (bucket **privat** untuk backup database —
     jangan dihubungkan ke domain publik).
2. Aturan retensi backup (simpan 12 terbaru): buka bucket
   `gurat-backups` → cari pengaturan **Lifecycle** (letaknya bisa di tab
   Settings, nama menunya kadang berubah) → tambah rule: prefix
   `backups/`, simpan 12 objek terbaru. Kalau menu tidak ketemu, catat
   dan tanyakan ke asisten — jangan asal klik.
3. Sambungkan domain publik untuk media: buka bucket `gurat-media` →
   tab **Settings** → **Custom Domains** → **Connect Domain** →
   ketik `media.yvdist.com` → ikuti aktivasi. Tanpa ini, gambar tidak
   bisa diakses publik.

| #   | Cek                                                              | Sudah | Belum | Tanggal |
| --- | ---------------------------------------------------------------- | ----- | ----- | ------- |
| 2.2 | Domain di Cloudflare; nameserver diganti; situs lama masih jalan |       |       |         |
| 2.3 | Bucket `gurat-media` + domain `media.yvdist.com` aktif           |       |       |         |
| 2.4 | Bucket privat `gurat-backups` + lifecycle rule (12 terbaru)     |       |       |         |

## 3. Pasang domain ke Worker (situsnya sendiri)

"Worker" = program situs ini yang jalan di Cloudflare. Setelah kode
ter-deploy (§5), Worker bisa diakses lewat `*.workers.dev`, tapi kita mau
alamat sendiri:

1. Dash → **Workers & Pages** → klik Worker **`gurat`**.
2. Tab **Settings** → **Domains & Routes** → **Add** → **Custom domain**.
3. Ketik subdomain pilihanmu, mis. `gurat.yvdist.com`
   (nilai ini juga yang nantinya diisi ke variabel `SITE_URL` di §4).
4. **Add domain** → tunggu status Active.
5. Cek: `curl -sI https://gurat.yvdist.com | head -5` → harus `200`.

> Nanti kalau ganti subdomain, ulangi langkah ini DAN ubah `SITE_URL`
> di §4 (keduanya harus sama).

## 4. Kunci halaman admin (Cloudflare Access) + isi variabel

### 4.1. Buat aplikasi Access untuk `/admin*`

1. Dash → menu kiri **Zero Trust** → **Access** → **Applications** →
   **Add an application** → pilih **Self-hosted**.
2. Isi: Name `gurat-admin`; Subdomain/Path: domain = host situs
   (mis. `gurat.yvdist.com`), Path = `/admin*`.
3. Policy: **Allow** → Include **Emails** → isi email owner
   (boleh lebih dari satu, pisahkan koma).
4. Simpan → buka aplikasi itu → tab **Overview** → salin
   **Application Audience (AUD) Tag** (kode seperti `abc123…`).
5. Catat juga **Team domain**-mu: bentuknya
   `https://<team>.cloudflareaccess.com` (terlihat di halaman Zero Trust).

### 4.2. Isi variabel Worker (dashboard, jangan pernah commit)

1. Dash → **Workers & Pages** → **`gurat`** → **Settings** →
   **Variables and Secrets** → bagian **Variables** → **Add variable**,
   satu per satu:

| Var                  | Isi dengan                                              | Contoh                                |
| -------------------- | ------------------------------------------------------- | ------------------------------------- |
| `SITE_URL`           | Alamat situs (tanpa garis miring di akhir)              | `https://gurat.yvdist.com`            |
| `MEDIA_BASE_URL`     | Domain media publik                                     | `https://media.yvdist.com`            |
| `ACCESS_TEAM_DOMAIN` | Team domain dari §4.1 langkah 5                         | `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD`         | AUD tag dari §4.1 langkah 4                             | `abc123…`                             |
| `ADMIN_EMAILS`       | Email owner (koma bila >1)                              | `kamu@example.com`                    |

(`KEEP_ORIGINALS` biarkan `false` — default dari `wrangler.jsonc`.)

2. **Save.** Variabel langsung aktif untuk request berikutnya; kalau
   ragu, deploy ulang (§5) — tidak ada salahnya.

| #   | Cek                                                              | Sudah | Belum | Tanggal |
| --- | ---------------------------------------------------------------- | ----- | ----- | ------- |
| 4.1 | Buka `https://<sub>.yvdist.com/admin` → diminta login Access      |       |       |         |
| 4.2 | Login dengan email owner → halaman Posts terbuka                 |       |       |         |
| 4.3 | Coba email lain (non-allowlist) → ditolak                        |       |       |         |

## 5. Migrasi database, lalu tekan tombol deploy (setiap rilis)

Lakukan **berurutan**, tidak boleh dibalik:

**Langkah A — migrasi (terminal laptop):**

```sh
pnpm db:migrate:remote
```

Artinya: terapkan perubahan struktur database ke D1 produksi. Sifatnya
*aditif* (hanya menambah, tidak menghapus), jadi aman dijalankan kapan
pun sebelum deploy. Tunggu sampai selesai tanpa error.

**Langkah B — deploy (browser, GitHub):**

1. Buka `github.com/yvdist/gurat` → tab **Actions** (baris atas, sejajar
   Code/Issues/Pull requests).
2. Di sidebar kiri, klik workflow **`deploy`**.
3. Klik tombol **Run workflow** (kanan atas) → pilih Branch `main` →
   klik **Run workflow** (hijau).
4. Muncul satu baris run baru → klik → lihat job `deploy` berjalan:
   install → types → check → build → `wrangler deploy`. Tunggu semua
   centang hijau (±3–5 menit).
5. Kalau merah: klik langkah yang gagal, baca log error paling bawah,
   perbaiki, ulangi. Jangan lanjut ke §6 sebelum hijau.

| #   | Cek                                                        | Sudah | Belum | Tanggal |
| --- | ---------------------------------------------------------- | ----- | ----- | ------- |
| 5.1 | `pnpm db:migrate:remote` sukses                            |       |       |         |
| 5.2 | Actions → `deploy` hijau                                   |       |       |         |

## 6. Verifikasi pasca-deploy (browser + terminal)

Salin-tempel perintah ini (ganti `<sub>` dengan subdomainmu).
`workers.dev` = alamat cadangan Cloudflare
(mis. `gurat.<akun>.workers.dev` — lihat di log deploy §5.4).

```sh
SUB=gurat.yvdist.com   # ganti sesuai subdomainmu

# 1. Header keamanan + CSP ada di halaman publik
curl -sI "https://$SUB" | grep -i "content-security-policy\|x-request-id"
curl -sI "https://$SUB/writing/hello-world" | grep -i "content-security-policy"

# 2. Health check: harus {"ok":true}
curl -s "https://$SUB/healthz"
curl -sI "https://$SUB/healthz" | grep -i "cache-control\|x-robots-tag"

# 3. Feed + sitemap benar
curl -s "https://$SUB/sitemap.xml" | head -5
curl -s "https://$SUB/feed.xml" | head -5

# 4. Gambar disajikan immutable dari domain media
curl -sI "https://media.yvdist.com/media/<id>/480.webp" | grep -i "cache-control"
# (<id> = salah satu id media; lihat di /admin → Media → klik gambar)

# 5. Admin aman di host mana pun: TANPA login harus 401
curl -s -o /dev/null -w "%{http_code}\n" "https://<worker-kamu>.workers.dev/admin/api/posts"
curl -s -o /dev/null -w "%{http_code}\n" "https://<worker-kamu>.workers.dev/admin/api/tags"
```

Lalu di browser: buka home → satu post EN → satu post ID → satu tag →
satu URL ngawur (404), masing-masing dalam tema terang dan gelap.
Buka DevTools → Console: **tidak boleh ada** baris merah
`Content Security Policy`.

| #   | Cek                                                                        | Sudah | Belum | Tanggal |
| --- | -------------------------------------------------------------------------- | ----- | ----- | ------- |
| 6.1 | CSP + header baseline ada di `/`, post EN/ID, `/healthz`                   |       |       |         |
| 6.2 | `/healthz` = `{"ok":true}`, `no-store`, `noindex`                          |       |       |         |
| 6.3 | Feed + sitemap benar                                                       |       |       |         |
| 6.4 | Media `Cache-Control: immutable`                                           |       |       |         |
| 6.5 | `/admin/api/*` 401 di `workers.dev` tanpa login                            |       |       |         |
| 6.6 | Console bersih dari pelanggaran CSP (2 tema)                               |       |       |         |

## 7. Backup & restore

**Backup (otomatis + manual):** workflow `backup` jalan tiap Senin 02:00
WIB. Menjalankan manual: GitHub → tab **Actions** → sidebar **`backup`**
→ **Run workflow** → tunggu hijau (wajib sebelum operasi berisiko).
Hasilnya: file `backups/gurat-TANGGAL.sql` di bucket `gurat-backups`
(lihat di dash → **R2** → `gurat-backups` → Objects).

**Restore (kalau database rusak/hilang):** langkah persis yang sudah
teruji ada di **`docs/runbook.md` §2** (drill lokal 2026-11-17: 9 posts /
4 tags / 10 media cocok sebelum–sesudah). Intinya: unduh SQL dari R2 →
buat D1 scratch → import per tabel → hitung baris → cocok → selesai.

Media: bucket publik hanya berisi **varian turunan**. Dengan
`KEEP_ORIGINALS=false` tidak ada file asli di mana pun — kalau bucket
hilang, upload ulang sumbernya (keterbatasan yang diterima, ADR-005).

| #   | Cek                                              | Sudah | Belum | Tanggal |
| --- | ------------------------------------------------ | ----- | ----- | ------- |
| 7.1 | Actions → `backup` pernah hijau sekali           |       |       |         |
| 7.2 | File `backups/*.sql` terlihat di bucket R2       |       |       |         |
| 7.3 | Restore ke scratch DB teruji, jumlah baris cocok |       |       |         |

## 8. Search Console & Bing (agar artikel ketemu Google)

1. Buka `search.google.com/search-console` → **Add property** → tipe
   **Domain** → isi `yvdist.com`.
2. Google memberi record **TXT** → dash → **Websites** → `yvdist.com` →
   **DNS** → **Records** → **Add record** (Type TXT, isi dari Google) →
   kembali ke Search Console → **Verify**.
3. Di Search Console → **Sitemaps** → tambah
   `https://<sub>.yvdist.com/sitemap.xml`.
4. Ulangi di `bing.com/webmasters` (bisa impor langsung dari Search
   Console — ada tombolnya).

| #   | Cek                                                | Sudah | Belum | Tanggal |
| --- | -------------------------------------------------- | ----- | ----- | ------- |
| 8.1 | Search Console terverifikasi, sitemap disubmit     |       |       |         |
| 8.2 | Bing Webmaster terverifikasi, sitemap disubmit     |       |       |         |

## 9. Rollback (kalau deploy baru rusak)

Jangan panik — versi lama masih tersimpan di Cloudflare:

1. Terminal laptop (sudah `wrangler login`):
   `pnpm exec wrangler versions list` → catat ID versi hijau terakhir.
2. `pnpm exec wrangler rollback <ID-versi-itu>`.
3. Kalau perlu, deploy ulang commit hijau terakhir via Actions (§5B).
4. **Jangan pernah** rollback migrasi database (semuanya aditif — kode
   lama tetap jalan di skema baru). Detail: `docs/runbook.md` §4.

## 10. Checklist launch (spec 7.8 — dicek manual bersama asisten)

| #    | Item                                                                                   | Sudah | Belum | Tanggal |
| ---- | -------------------------------------------------------------------------------------- | ----- | ----- | ------- |
| 10.1 | D1 produksi termigrasi; owner bisa sign in via Access; non-allowlist ditolak            |       |       |         |
| 10.2 | Post nyata pertama terbit EN + ID, terjemahan tertaut; feed & sitemap benar            |       |       |         |
| 10.3 | Search Console (+ Bing) terverifikasi, sitemap disubmit                                |       |       |         |
| 10.4 | Workflow backup pernah hijau; restore teruji                                            |       |       |         |
| 10.5 | README mendokumentasikan: dev lokal, deploy, migrasi, backup/restore, alur menulis     |       |       |         |
| 10.6 | `docs/phase-reports/07.md` ditulis + ringkasan deviasi/limitasi                         |       |       |         |

## 11. Tanya-jawab singkat

- **Deploy-nya di dashboard Cloudflare atau di GitHub?**
  Di **GitHub** (tab Actions → workflow `deploy` → Run workflow).
  Dashboard Cloudflare hanya untuk pengaturan, bukan untuk upload kode.
- **Apakah memakai GitHub Pages?** Tidak. GitHub Pages tidak terlibat
  sama sekali; hostingnya di Cloudflare Workers.
- **Apakah `workers.dev` harus dimatikan?** Tidak. Dibiarkan aktif;
  keamanannya dijamin JWT (bukti: cek 401 di §6 langkah 5).
- **HSTS di mana?** Di edge Cloudflare (dashboard → Websites →
  `yvdist.com` → SSL/TLS → Edge Certificates → HTTP Strict Transport
  Security). Bukan header Worker — header HSTS dari Worker akan bohong
  di `http://localhost`.
