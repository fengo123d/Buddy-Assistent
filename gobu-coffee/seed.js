import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './db.js';

const adminEmail = 'admin@gobucoffee.id';
if (!db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) {
  db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
    .run('GOBU Admin', adminEmail, bcrypt.hashSync('GobuAdmin123!', 10), 'admin');
}

// Demo catalogue aligned with the owner-provided GOBU questionnaire.
// Prices for Arabica remain the values already present in the supplied project code
// and must be confirmed by the owner before real transactions.
const products = [
  {name:'GOBU Robusta Fine',category:'Robusta',description:'Kopi Robusta GOBU dari Sidikalang. Memiliki karakter lebih pahit dan kuat dibanding Arabica. Kopi murni tanpa tambahan gula, susu, jagung, atau bahan lain. Tersedia dalam bentuk bubuk Fine.',tasting_notes:'Karakter lebih pahit dan kuat. Informasi tasting notes spesifik belum tersedia.',brew_guide:'Robusta direkomendasikan untuk pelanggan yang menyukai rasa kuat, serta cocok untuk latte dan cappuccino. Ikuti rasio seduh sesuai metode.',image:'/images/robusta-100g.jpg',price:22969,size_prices:{'100g':22969,'250g':36969,'1000g':86969},stock:50},
  {name:'GOBU Arabica Fine',category:'Arabica',description:'Kopi Arabica GOBU dari Aceh. Memiliki karakter lebih asam dibanding Robusta. Kopi murni tanpa tambahan gula, susu, jagung, atau bahan lain. Tersedia dalam bentuk bubuk Fine.',tasting_notes:'Karakter lebih asam dibanding Robusta. Informasi tasting notes spesifik belum tersedia.',brew_guide:'Arabica dapat menjadi pilihan untuk V60 dan pelanggan yang menyukai pengalaman minum kopi lebih ringan. Ikuti rasio seduh sesuai metode.',image:'/images/arabica-100g.jpg',price:26969,size_prices:{'100g':26969,'250g':42969,'1000g':99969},stock:40},
  {name:'Package A – Classic Coffee Hampers',category:'Hampers',description:'Hampers seasonal GOBU Package A – Classic Coffee Hampers. Isi: 250g Premium Arabica Coffee, 250g Premium Robusta Coffee, 5-Sided Wooden Drip Coffee Stand, 10 pcs Coffee Drip Bags, Christmas Gift Packaging, Personalized Name & Christmas Greeting Card. Ketersediaan perlu dikonfirmasi.',tasting_notes:'Seasonal gift package.',brew_guide:'Ikuti panduan penyeduhan kopi yang disertakan atau panduan GOBU Buddy.',image:'/images/hampers-package-a.jpg',price:50000,size_prices:{'1 paket':50000},stock:20,sizes:['1 paket'],grinds:['N/A']},
  {name:'Package B – Signature Coffee Hampers',category:'Hampers',description:'Hampers seasonal GOBU Package B – Signature Coffee Hampers. Isi: 250g Premium Arabica Coffee, 350g Premium Robusta Coffee, 250ml French Press, 5-Sided Wooden Drip Coffee Stand, 10 pcs Coffee Drip Bags, Premium Christmas Gift Box, Personalized Name & Christmas Greeting Card. Ketersediaan perlu dikonfirmasi.',tasting_notes:'Seasonal gift package.',brew_guide:'Ikuti panduan penyeduhan kopi yang disertakan atau panduan GOBU Buddy.',image:'/images/hampers-package-b.jpg',price:87000,size_prices:{'1 paket':87000},stock:15,sizes:['1 paket'],grinds:['N/A']},
  {name:'Package C – Premium Coffee Hampers',category:'Hampers',description:'Hampers seasonal GOBU Package C – Premium Coffee Hampers. Isi: 100g Premium Arabica Coffee, 100g Premium Robusta Coffee, 5-Sided Wooden Drip Coffee Stand, 10 pcs Coffee Drip Bags, Christmas Gift Packaging, Personalized Name & Christmas Greeting Card. Ketersediaan perlu dikonfirmasi.',tasting_notes:'Seasonal gift package.',brew_guide:'Ikuti panduan penyeduhan kopi yang disertakan atau panduan GOBU Buddy.',image:'/images/hampers-coffee-set.jpg',price:120000,size_prices:{'1 paket':120000},stock:10,sizes:['1 paket'],grinds:['N/A']}
];

const findProduct = db.prepare('SELECT id FROM products WHERE name=?');
const insertProduct = db.prepare(`INSERT INTO products(name,category,description,tasting_notes,brew_guide,image,price,stock,sizes,grinds,size_prices,active)
VALUES(@name,@category,@description,@tasting_notes,@brew_guide,@image,@price,@stock,@sizes,@grinds,@size_prices,1)`);
const updateProduct = db.prepare(`UPDATE products SET category=@category,description=@description,tasting_notes=@tasting_notes,brew_guide=@brew_guide,image=@image,price=@price,stock=@stock,sizes=@sizes,grinds=@grinds,size_prices=@size_prices,active=1 WHERE name=@name`);
for (const p of products) {
  const record = {...p, sizes:JSON.stringify(p.sizes || ['100g','250g','1000g']), grinds:JSON.stringify(p.grinds || ['Fine']), size_prices:JSON.stringify(p.size_prices)};
  if (findProduct.get(p.name)) updateProduct.run(record); else insertProduct.run(record);
}
// The owner confirmed that GOBU only sells fine-ground coffee; deactivate old demo variants.
db.prepare("UPDATE products SET active=0 WHERE name LIKE '%Coarse%' OR name IN ('GOBU Hampers Basic','GOBU Hampers Premium','GOBU Hampers Complete')").run();

// Remove legacy demo knowledge entries that contradict the owner's current product facts.
db.prepare(`DELETE FROM knowledge WHERE title IN (
 'Fine dan Coarse','Panduan Espresso','Panduan Latte dan Cappuccino','Panduan French Press',
 'Panduan V60','Penyimpanan Kopi','Informasi Kesehatan dan Asam Lambung','Hampers','Kebijakan Jawaban AI',
 'Tentang GOBU Coffee','Perbedaan Robusta dan Arabica'
)`).run();

const docs = [
 ['Tentang GOBU Coffee','GOBU Coffee memiliki karakter brand Strong, Bold, Premium, Affordable. Keunggulan utama yang dinyatakan GOBU adalah kualitas yang bagus dengan harga lebih terjangkau. Target utama usia 18–40 tahun, termasuk pelajar, mahasiswa, dan pekerja kantoran. Filosofi nama dan sejarah singkat belum tersedia.','brand'],
 ['Perbedaan Robusta dan Arabica','GOBU Robusta berasal dari Sidikalang dan lebih pahit/kuat. GOBU Arabica berasal dari Aceh dan lebih asam dibanding Robusta. Tingkat roasting medium. Jangan mengarang tasting notes spesifik.','coffee-knowledge'],
 ['Spesifikasi Produk GOBU','Produk kopi GOBU tersedia dalam ukuran 100g, 250g, dan 1000g. Semua hanya bubuk Fine, bukan biji utuh dan bukan Coarse. Kopi murni tanpa tambahan gula, susu, jagung, atau bahan lain. Masa kedaluwarsa diinformasikan 1 tahun. Kemasan aluminium dengan zipper dan valve. Simpan pada suhu ruang, jauh dari sinar matahari.','product'],
 ['Panduan Brewing GOBU','French Press 1:15, 15g:225ml, 4 menit. V60 1:15–1:17, 15g:225–255ml, 2,5–3,5 menit. Tubruk 1:15, 15g:225ml, 4–5 menit. Coffee Press 1:15, 15g:225ml, 4 menit. Moka Pot mengikuti kapasitas filter, sekitar 3–5 menit. Cold Brew 1:8, 100g:800ml, 12–18 jam di kulkas. Suhu air panas 90–96°C; Cold Brew air dingin/suhu ruang.','brewing'],
 ['Informasi Kesehatan GOBU','Belum tersedia hasil uji lab kafein, pH, atau nutrisi terverifikasi. Produk tidak memiliki tambahan gula atau susu. Jangan memberikan jaminan medis atau angka yang tidak terverifikasi. Toleransi setiap orang berbeda; sarankan konsultasi tenaga kesehatan untuk kondisi medis.','health-safety'],
 ['Kebijakan Hampers GOBU','Hampers GOBU adalah produk seasonal dengan tiga paket: Package A Classic Rp50.000, Package B Signature Rp87.000, Package C Premium Rp120.000. Isi lengkap dan stok tercantum di knowledge chunks. Ketersediaan harus dikonfirmasi. Pembelian 10 paket atau lebih dapat menanyakan penawaran khusus kepada admin.','hampers'],
 ['Kebijakan Jawaban AI','GOBU Buddy harus menjawab ramah, santai, sopan, dan profesional. Jangan mengarang harga, stok, komposisi, asal biji, sertifikasi, kandungan kafein, promo, atau kebijakan. Rahasiakan metode pengolahan dan informasi supplier. Arahkan keluhan serius, refund, pembatalan, masalah transaksi, dan permintaan bicara dengan manusia kepada admin.','ai-policy']
];
const upsertDoc = db.prepare('SELECT id FROM knowledge WHERE title=?');
const updateDoc = db.prepare('UPDATE knowledge SET content=?,category=?,updated_at=CURRENT_TIMESTAMP WHERE title=?');
const insertDoc = db.prepare('INSERT INTO knowledge(title,content,category) VALUES(?,?,?)');
for (const [title,content,category] of docs) {
  if (upsertDoc.get(title)) updateDoc.run(content,category,title); else insertDoc.run(title,content,category);
}
console.log('Database seeded. Admin: admin@gobucoffee.id / GobuAdmin123!');
