# GOBU Coffee — Full-stack Store + GOBU Buddy (Local Open-source AI)

Website toko kopi GOBU berbasis Node.js, Express, SQLite, dan vanilla JavaScript. Project ini memiliki katalog, cart, checkout demo, simulasi pembayaran, tracking pesanan, akun pelanggan, admin dashboard, dan GOBU Buddy.

## Arsitektur GOBU Buddy

GOBU Buddy tidak menggunakan OpenAI API dan tidak membutuhkan `OPENAI_API_KEY`.

- **Google Colab**: mengelola materi, membagi dokumen menjadi knowledge chunks, memvalidasi, dan mengekspor `knowledge_chunks.json`.
- **RAG retrieval**: aplikasi membuat embedding untuk chunk dan pertanyaan menggunakan model lokal `nomic-embed-text` melalui Ollama, lalu mengambil maksimal lima chunk yang paling relevan.
- **Open-source LLM**: `qwen2.5:3b` melalui Ollama menyusun jawaban berdasarkan chunk terpilih, riwayat percakapan, dan data produk live dari SQLite.
- **Deployment demo**: Node.js + Ollama berjalan di komputer lokal. Google Colab tidak perlu terus menyala saat website demo lokal digunakan.

RAG berarti AI mengambil potongan informasi relevan sebelum menyusun jawaban. Ini bukan fine-tuning model; knowledge GOBU dapat diperbarui tanpa melatih ulang LLM.

## 1. Persiapan

Install:
- Node.js 20 LTS atau lebih baru.
- Ollama desktop: https://ollama.com/download

Extract ZIP, buka folder `gobu-coffee` di VS Code, lalu jalankan:

```powershell
npm install
Copy-Item .env.example .env
```

## 2. Download model open-source lokal

Buka terminal baru dan jalankan:

```powershell
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
```

Pastikan aplikasi Ollama tetap berjalan. Ollama biasanya menyediakan API lokal di `http://127.0.0.1:11434`.

Model chat `qwen2.5:3b` memerlukan RAM yang memadai. Jika komputer terasa berat, ubah `OLLAMA_CHAT_MODEL` pada `.env` menjadi model lebih kecil yang sudah di-pull, misalnya `qwen2.5:1.5b`, lalu pull model tersebut.

## 3. Siapkan database GOBU

Di terminal project:

```powershell
npm run seed
npm start
```

Buka http://localhost:3000.

Akun admin demo:
- Email: `admin@gobucoffee.id`
- Password: `GobuAdmin123!`

Segera ganti password sebelum project dipublikasikan. Data stok dan akun admin merupakan data demo.

## 4. Google Colab — membuat knowledge chunks

Notebook tersedia di:

`notebooks/GOBU_Buddy_Knowledge_Chunk_Builder.ipynb`

Langkah:
1. Buka https://colab.research.google.com/ dan upload notebook tersebut.
2. Dari folder project, upload file `ai/knowledge_source.json` saat diminta notebook.
3. Jalankan semua cell.
4. Notebook memecah materi menjadi chunk, memvalidasi ID/field/konten, lalu mengunduh `knowledge_chunks.json`.
5. Ganti file `data/knowledge_chunks.json` di project dengan file hasil Colab.
6. Restart server. Embedding chunk akan dibuat otomatis oleh Ollama pada penggunaan pertama dan disimpan ke `data/gobu-ai-embeddings.json`.

Project sudah menyertakan 12 knowledge chunks awal sehingga dapat diuji tanpa menjalankan notebook terlebih dahulu. Notebook dipakai saat materi knowledge diperbarui.

## 5. Tes GOBU Buddy

Pastikan Ollama berjalan, kedua model sudah di-pull, dan server Node aktif. Buka chat GOBU Buddy dan coba:

- "Apa perbedaan GOBU Robusta dan Arabica?"
- "Aku kurang suka kopi pahit, rekomendasikan kopi."
- "Bagaimana rasio V60 untuk dua gelas?"
- "Aku mau bikin latte, kopi mana yang cocok?"
- "Apa isi Package B hampers?"
- "Berapa kandungan kafein GOBU Robusta?"
- "Siapa supplier GOBU?"

Status model dapat diperiksa melalui:

`http://localhost:3000/api/ai/status`

Endpoint tersebut menunjukkan apakah Ollama aktif dan model chat/embedding tersedia.

## 6. Cara kerja chat

1. Frontend mengirim pertanyaan ke `/api/chat/preview` (guest) atau `/api/chat` (login).
2. Ollama `nomic-embed-text` membuat embedding pertanyaan.
3. Sistem mencari chunk paling relevan dengan cosine similarity.
4. Data produk dan harga/stok terkini dibaca dari SQLite.
5. Ollama `qwen2.5:3b` menghasilkan jawaban dengan aturan GOBU Buddy.
6. Jika Ollama atau model belum siap, UI menampilkan pesan error yang menjelaskan langkah perbaikannya; tidak ada jawaban fallback palsu.

Embedding tersimpan secara lokal di `data/gobu-ai-embeddings.json`. Jika mengganti model embedding, hapus file cache tersebut agar dibuat ulang dengan model baru.

## 7. Knowledge dan batasan AI

- Knowledge resmi awal disimpan di `ai/knowledge_source.json`.
- Hasil chunk tersimpan di `data/knowledge_chunks.json`.
- Admin dapat menambahkan knowledge melalui Admin > AI Knowledge; data admin juga ikut dimasukkan ke proses retrieval.
- AI menggunakan harga dan stok dari database live, bukan harga yang diingat dalam dokumen.
- Metode pengolahan dan informasi supplier GOBU ditandai rahasia.
- AI tidak boleh membuat klaim medis, angka kafein/pH/nutrisi yang belum diuji, atau menjamin kopi aman untuk kondisi kesehatan tertentu.
- AI tidak mengaku telah melakukan transaksi kecuali backend benar-benar mengonfirmasi tindakan itu.

**Penting tentang harga:** Harga Robusta mengikuti nilai yang ada pada seed project. Harga Arabica mengikuti nilai yang sudah ada di kode project sebelumnya dan perlu dikonfirmasi pemilik sebelum digunakan untuk transaksi sungguhan. Stok awal adalah stok demo. Harga hampers di seed mengikuti jawaban pemilik: Package A Rp50.000, Package B Rp87.000, Package C Rp120.000; status stok tetap harus diperbarui.

## 8. Troubleshooting

**Pesan: Ollama belum berjalan**
- Buka aplikasi Ollama.
- Coba `ollama list`.
- Pastikan API lokal aktif di `http://127.0.0.1:11434`.

**Model belum tersedia**
```powershell
ollama pull qwen2.5:3b
ollama pull nomic-embed-text
```

**Komputer kehabisan RAM / model lambat**
- Gunakan model chat lebih kecil seperti `qwen2.5:1.5b`.
- Sesuaikan `OLLAMA_CHAT_MODEL` di `.env` dan jalankan `ollama pull qwen2.5:1.5b`.
- Tutup aplikasi berat lain.

**Knowledge berubah tetapi jawaban belum ikut berubah**
- Pastikan `data/knowledge_chunks.json` sudah diganti.
- Hapus `data/gobu-ai-embeddings.json` jika mengubah model embedding atau ingin memaksa pembuatan embedding ulang.
- Restart server.

## 9. Catatan demo dan produksi

Demo lokal menggunakan Ollama di komputer sendiri. Runtime Google Colab dapat berhenti dan tidak digunakan sebagai server permanen. Untuk website online, deploy model Ollama pada server dengan resource memadai atau gunakan hosting inference open-source yang stabil; jangan mengekspos endpoint Ollama ke internet tanpa autentikasi dan pembatasan akses.

Checkout dan pembayaran yang ada di project tetap merupakan simulasi. Sebelum menerima transaksi nyata, integrasikan payment gateway beserta verifikasi webhook, HTTPS, validasi, rate limiting, perlindungan CSRF/origin, backup database, monitoring, dan integrasi ongkir/tracking.
