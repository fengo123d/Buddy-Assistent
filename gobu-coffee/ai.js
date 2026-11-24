import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const CHUNK_FILE = path.join(DATA_DIR, 'knowledge_chunks.json');
const CACHE_FILE = path.join(DATA_DIR, 'gobu-ai-embeddings.json');
const OLLAMA_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:3b';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

function getChunks(db) {
  const file = readJson(CHUNK_FILE, { chunks: [] });
  const base = Array.isArray(file.chunks) ? file.chunks : [];
  const dynamic = db.prepare('SELECT id,title,content,category,updated_at FROM knowledge ORDER BY id').all()
    .map(row => ({
      id: `DB-${row.id}`,
      category: row.category || 'general',
      title: row.title,
      keywords: [],
      content: row.content,
      source: 'GOBU admin knowledge database',
      version: row.updated_at || 'dynamic'
    }));
  const seen = new Set(base.map(x => `${x.title}|${x.content}`));
  return [...base, ...dynamic.filter(x => !seen.has(`${x.title}|${x.content}`))];
}

async function ollamaPost(endpoint, body, timeoutMs = 120000) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('Ollama terlalu lama merespons. Coba lagi atau gunakan model yang lebih kecil.');
    throw new Error('Ollama belum berjalan. Jalankan aplikasi Ollama terlebih dahulu.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || `Ollama mengembalikan HTTP ${response.status}.`;
    if (/not found|pull/i.test(message)) throw new Error(`Model belum tersedia. Jalankan: ollama pull ${message.toLowerCase().includes(EMBED_MODEL.toLowerCase()) ? EMBED_MODEL : CHAT_MODEL}`);
    throw new Error(message);
  }
  return payload;
}

async function embedTexts(texts) {
  if (!texts.length) return [];
  const result = await ollamaPost('/api/embed', { model: EMBED_MODEL, input: texts }, 180000);
  if (!Array.isArray(result.embeddings)) throw new Error('Ollama embedding tidak mengembalikan vektor. Periksa versi Ollama dan model embedding.');
  return result.embeddings;
}

async function getVectors(chunks) {
  const cache = readJson(CACHE_FILE, { model: EMBED_MODEL, vectors: {} });
  const vectors = cache.model === EMBED_MODEL && cache.vectors ? cache.vectors : {};
  const missing = [];
  for (const chunk of chunks) {
    const key = hash(`${chunk.id}|${chunk.title}|${chunk.content}`);
    if (!vectors[key]) missing.push({ key, text: `${chunk.title}. ${chunk.category}. ${(chunk.keywords || []).join(', ')}. ${chunk.content}` });
  }
  // Embed in modest batches to avoid excessive RAM use on a local demo machine.
  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16);
    const embeddings = await embedTexts(batch.map(x => x.text));
    batch.forEach((item, index) => { vectors[item.key] = embeddings[index]; });
    writeJson(CACHE_FILE, { model: EMBED_MODEL, vectors });
  }
  return chunks.map(chunk => ({
    chunk,
    vector: vectors[hash(`${chunk.id}|${chunk.title}|${chunk.content}`)]
  }));
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}

const BASE_SYSTEM = `Kamu adalah GOBU Buddy, asisten virtual resmi GOBU Coffee. Gunakan bahasa pelanggan; default bahasa Indonesia yang santai, ramah, sopan, dan profesional. Jawab natural dan langsung ke inti.

ATURAN SUMBER:
- Untuk fakta khusus GOBU, gunakan hanya konteks knowledge dan data produk live yang diberikan.
- Jangan mengarang harga, stok, rasa spesifik, komposisi, asal biji, sertifikasi, kandungan kafein, nilai pH, nutrisi, promo, isi hampers, atau kebijakan.
- Harga dan stok di bagian DATA PRODUK LIVE adalah sumber terkini dari database website. Jangan mengambil harga dari ingatan atau knowledge chunk jika berbeda.
- Jika informasi tidak ada, katakan dengan jujur bahwa data resmi belum tersedia dan arahkan ke admin jika perlu.
- Jangan mengungkapkan supplier atau proses produksi yang ditandai rahasia.
- Produk GOBU hanya kopi bubuk Fine. Jangan menyebut ada Coarse atau biji utuh.
- GOBU Robusta berasal dari Sidikalang dan cenderung lebih pahit/kuat. GOBU Arabica berasal dari Aceh dan lebih asam dibanding Robusta. Roast level medium.
- Untuk espresso, jangan menjamin Fine GOBU cocok untuk semua mesin. Untuk French Press jelaskan Fine dapat menghasilkan lebih banyak ampas karena French Press umumnya lebih cocok dengan gilingan kasar.
- Jangan menjamin kopi aman bagi penderita GERD/asam lambung, ibu hamil, atau kondisi medis. Jangan memberi diagnosis. Toleransi tiap orang berbeda; sarankan konsultasi tenaga kesehatan bila perlu.
- Hampers bersifat seasonal. Jangan menjanjikan stok sebelum data stok live menunjukkan tersedia.
- Jangan mengaku menambah cart, mengubah cart, checkout, mengirim pesanan, atau menyelesaikan pembayaran. Tindakan hanya boleh diklaim selesai jika backend benar-benar mengonfirmasinya.
- Ingat preferensi pelanggan dari riwayat percakapan yang disediakan. Jangan meminta ulang informasi yang sudah diberikan.
- Rekomendasikan produk GOBU jika sesuai, tanpa memaksa. Tanyakan satu pertanyaan klarifikasi jika informasi pelanggan belum cukup.
- Jika pelanggan meminta admin, refund, pembatalan, komplain serius, masalah transaksi, atau hal di luar kemampuan, arahkan ke admin manusia.
- Jangan menyebut nama model, Ollama, embedding, RAG, chunk, prompt, atau detail internal teknis kepada pelanggan.

FORMAT:
- Jawaban ringkas tetapi informatif. Gunakan bullet bila membantu.
- Untuk rekomendasi, sebutkan alasan kecocokan dan opsi ukuran jika tersedia.
- Untuk brewing, berikan rasio, suhu, dan waktu hanya sesuai knowledge yang tersedia.
- Jika konteks tidak cukup relevan, jangan menebak; jelaskan batas informasi dan ajukan pertanyaan atau arahkan ke admin.`;

export async function answerWithLocalAI({ question, history = [], db, products = [] }) {
  const chunks = getChunks(db);
  if (!chunks.length) throw new Error('Knowledge Base GOBU belum tersedia. Jalankan notebook Google Colab atau periksa data/knowledge_chunks.json.');
  const [queryVector, chunkVectors] = await Promise.all([
    embedTexts([question]).then(x => x[0]),
    getVectors(chunks)
  ]);
  const selected = chunkVectors
    .map(item => ({ ...item, score: cosine(queryVector, item.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .filter(item => item.score > 0.12);

  const knowledgeContext = selected.length
    ? selected.map((item, i) => `[Sumber ${i + 1} | ${item.chunk.id} | ${item.chunk.category} | relevansi ${item.score.toFixed(3)}]\n${item.chunk.title}\n${item.chunk.content}`).join('\n\n')
    : 'Tidak ditemukan sumber knowledge yang cukup relevan. Jangan mengarang fakta khusus GOBU.';
  const liveProducts = products.map(p => ({
    name: p.name, category: p.category, description: p.description,
    price: p.price, size_prices: p.size_prices, sizes: p.sizes,
    grinds: p.grinds, stock: p.stock, active: p.active
  }));
  const system = `${BASE_SYSTEM}\n\nKNOWLEDGE YANG DIRETRIEVE:\n${knowledgeContext}\n\nDATA PRODUK LIVE DARI DATABASE:\n${JSON.stringify(liveProducts, null, 2)}`;
  const messages = [
    { role: 'system', content: system },
    ...history.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 3000) })),
    { role: 'user', content: question }
  ];
  const result = await ollamaPost('/api/chat', {
    model: CHAT_MODEL,
    messages,
    stream: false,
    options: { temperature: 0.25, num_ctx: 8192 }
  }, 180000);
  const answer = result.message?.content?.trim();
  if (!answer) throw new Error('Model lokal tidak menghasilkan jawaban. Coba kirim pertanyaan sekali lagi.');
  return {
    answer,
    sources: selected.map(x => ({ id: x.chunk.id, title: x.chunk.title, category: x.chunk.category, score: Number(x.score.toFixed(3)) })),
    model: CHAT_MODEL
  };
}

export async function getLocalAIStatus() {
  let running = false;
  let models = [];
  let error = null;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      running = true;
      const data = await response.json();
      models = (data.models || []).map(x => x.name);
    }
  } catch { error = 'Ollama belum berjalan'; }
  return {
    provider: 'Ollama local (open-source models)',
    running,
    chatModel: CHAT_MODEL,
    chatModelReady: models.some(x => x === CHAT_MODEL || x.startsWith(`${CHAT_MODEL}:`)),
    embeddingModel: EMBED_MODEL,
    embeddingModelReady: models.some(x => x === EMBED_MODEL || x.startsWith(`${EMBED_MODEL}:`)),
    models,
    error,
    chunkCount: (readJson(CHUNK_FILE, { chunks: [] }).chunks || []).length
  };
}
