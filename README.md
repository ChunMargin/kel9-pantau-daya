# Pantau Daya

Dashboard monitoring konsumsi energi listrik dengan React, TypeScript, dan Vite. Data pengukuran yang ditampilkan meliputi tegangan, arus, daya aktif, energi (kWh), dan faktor daya, disertai grafik 24 jam, rekap 7 hari/30 hari, serta jam konsumsi tertinggi.

## Menjalankan di lokal

Gunakan dua terminal. Frontend dijalankan dari root repo, sedangkan API Python dijalankan dari folder `simulate-data`.

### 1. Jalankan simulator Python

Python 3.10 atau yang lebih baru diperlukan.

```bash
cd simulate-data
python -m venv .venv
```

Aktifkan virtual environment:

```bash
# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1
```

Lalu pasang dependensi dan jalankan API:

```bash
pip install -r requirements.txt
python -m uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

API menyediakan `GET /api/dashboard`, `GET /api/history?period=day|week|month`, `GET /api/health`, dan WebSocket `/ws/live`. Data historis simulasi dibuat di memori saat API dimulai.

Simulator ini menghasilkan data sintetis di memori untuk pengembangan; data tidak disimpan ke database dan bukan pengukuran perangkat sungguhan.
Status perangkat pada dashboard aktif hanya jika pengukuran terakhir diterima dalam 15 detik terakhir; jika client berhenti mengirim pembaruan, status berubah menjadi tidak aktif.

### 2. Jalankan web app

Di terminal kedua, dari root repo:

```bash
npm install
npm run dev
```

Buka URL lokal yang dicetak Vite (umumnya `http://localhost:5173`). Frontend hanya menampilkan data yang diterima dari API. Jika API tidak aktif, dashboard menunjukkan status offline dan placeholder; frontend tidak membuat data simulasi.

Alamat API lokal dapat diubah melalui `.env.local`:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Lihat `.env.example` untuk nilai awal. Perubahan variabel Vite berlaku setelah dev server dijalankan ulang.

## Build dan Firebase Hosting

```bash
npm run build
```

Konfigurasi `firebase.json` sudah mengarahkan Firebase Hosting ke folder `dist` dan menangani routing SPA. Karena `simulate-data` berada di luar `dist`, Firebase Hosting tidak mengunggah folder tersebut; aturan ignore tambahan tidak diperlukan. Setelah Firebase CLI diinisialisasi dengan project Firebase milik tim:

```bash
firebase deploy --only hosting
```

Hosting hanya menyajikan frontend statis. Untuk menerima data realtime setelah deploy, deploy API/simulator ke layanan backend terpisah (misalnya Cloud Run), lalu set `VITE_API_BASE_URL` ke URL HTTPS API tersebut **sebelum** menjalankan `npm run build`. Untuk origin Firebase produksi, tambahkan domain web ke `SIMULATOR_ALLOWED_ORIGINS` pada layanan API. Jangan menyimpan kredensial backend di variabel `VITE_*`; variabel tersebut dimasukkan ke bundle browser.

`simulate-data/Dockerfile` dapat digunakan sebagai awal deploy service demo ke Cloud Run. Untuk penggunaan produksi, ganti simulator sintetis dengan API/gateway dan penyimpanan historis yang sebenarnya.

## Struktur utama

- `src/` — aplikasi dashboard React dan klien REST/WebSocket.
- `simulate-data/generate_data.py` — membentuk data sintetis yang digunakan API simulator.
- `simulate-data/api.py` — API REST dan WebSocket lokal untuk data simulasi realtime.
- `simulate-data/Dockerfile` — image service simulator untuk deploy terpisah.
