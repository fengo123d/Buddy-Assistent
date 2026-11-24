import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { answerWithLocalAI, getLocalAIStatus } from './ai.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors()); app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
const safeUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role});
function auth(req,res,next){
 const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token) return res.status(401).json({error:'Silakan login terlebih dahulu.'});
 try { req.user=jwt.verify(token,JWT_SECRET); next(); } catch { return res.status(401).json({error:'Sesi berakhir. Silakan login kembali.'}); }
}
function admin(req,res,next){ if(req.user?.role!=='admin') return res.status(403).json({error:'Akses khusus admin.'}); next(); }
const productRows = () => db.prepare('SELECT * FROM products WHERE active=1 ORDER BY category,id').all().map(p=>({...p,sizes:JSON.parse(p.sizes),grinds:JSON.parse(p.grinds),size_prices:JSON.parse(p.size_prices||'{}')}));
app.get('/api/health',async(req,res)=>res.json({ok:true,aiProvider:'ollama-local',ai:await getLocalAIStatus()}));
app.get('/api/ai/status',async(req,res)=>res.json(await getLocalAIStatus()));
app.post('/api/register',async(req,res)=>{
 const {name,email,password}=req.body||{};
 if(!name||!email||!password||password.length<8) return res.status(400).json({error:'Nama, email, dan password minimal 8 karakter wajib diisi.'});
 try { const hash=await bcrypt.hash(password,10); const result=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name.trim(),email.toLowerCase().trim(),hash); const user=db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid); const token=jwt.sign({id:user.id,role:user.role,name:user.name},JWT_SECRET,{expiresIn:'7d'}); res.json({token,user:safeUser(user)}); }
 catch(e){res.status(400).json({error:e.message.includes('UNIQUE')?'Email sudah terdaftar.':'Gagal membuat akun.'});}
});
app.post('/api/login',async(req,res)=>{
 const {email,password}=req.body||{}; const user=db.prepare('SELECT * FROM users WHERE email=?').get((email||'').toLowerCase().trim());
 if(!user||!(await bcrypt.compare(password||'',user.password_hash))) return res.status(401).json({error:'Email atau password salah.'});
 const token=jwt.sign({id:user.id,role:user.role,name:user.name},JWT_SECRET,{expiresIn:'7d'}); res.json({token,user:safeUser(user)});
});
app.get('/api/me',auth,(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);res.json({user:safeUser(u)});});
app.get('/api/products',(req,res)=>res.json({products:productRows()}));
app.get('/api/products/:id',(req,res)=>{const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(req.params.id);if(!p)return res.status(404).json({error:'Produk tidak ditemukan.'});res.json({product:{...p,sizes:JSON.parse(p.sizes),grinds:JSON.parse(p.grinds),size_prices:JSON.parse(p.size_prices||'{}')}});});
app.get('/api/orders',auth,(req,res)=>{
 const orders=db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id);
 const items=db.prepare('SELECT * FROM order_items WHERE order_id=?');
 const events=db.prepare('SELECT status,description,created_at FROM order_events WHERE order_id=? ORDER BY id');
 res.json({orders:orders.map(o=>({...o,items:items.all(o.id),events:events.all(o.id)}))});
});
app.post('/api/orders/:id/pay',auth,(req,res)=>{
 const order=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
 if(!order)return res.status(404).json({error:'Pesanan tidak ditemukan.'});
 if(order.payment_status==='paid')return res.status(400).json({error:'Pesanan ini sudah dibayar.'});
 if(order.order_status==='Cancelled')return res.status(400).json({error:'Pesanan dibatalkan dan tidak dapat dibayar.'});
 const outcome=req.body?.outcome==='failed'?'failed':'paid';
 const reference='SIM-'+Date.now().toString(36).toUpperCase();
 const description=outcome==='paid'?'Pembayaran simulasi berhasil. Pesanan masuk antrean pemrosesan.':'Simulasi pembayaran gagal. Silakan coba kembali.';
 const tx=db.transaction(()=>{
  db.prepare(`UPDATE orders SET payment_status=?,payment_reference=?,paid_at=CASE WHEN ?='paid' THEN CURRENT_TIMESTAMP ELSE paid_at END WHERE id=?`).run(outcome,reference,outcome,order.id);
  db.prepare('INSERT INTO order_events(order_id,status,description) VALUES(?,?,?)').run(order.id,outcome==='paid'?'Payment confirmed':'Payment failed',description);
  if(outcome==='paid') db.prepare('INSERT INTO order_events(order_id,status,description) VALUES(?,?,?)').run(order.id,'Order placed','Pesanan telah diterima dan menunggu diproses.');
 });
 tx();
 res.json({ok:true,paymentStatus:outcome,paymentReference:reference});
});
app.get('/api/orders/:code/track',auth,(req,res)=>{
 const order=db.prepare('SELECT * FROM orders WHERE order_code=? AND user_id=?').get(req.params.code,req.user.id);
 if(!order)return res.status(404).json({error:'Pesanan tidak ditemukan.'});
 const events=db.prepare('SELECT status,description,created_at FROM order_events WHERE order_id=? ORDER BY id').all(order.id);
 res.json({order,events});
});
app.post('/api/orders',auth,(req,res)=>{
 const {items,customerName,phone,address,city,courier,paymentMethod,notes}=req.body||{};
 if(!Array.isArray(items)||!items.length||!customerName||!phone||!address||!city) return res.status(400).json({error:'Lengkapi produk dan alamat pengiriman.'});
 const clean=[];let subtotal=0;
 for(const item of items){const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(item.productId));const qty=Math.max(1,Math.min(99,Number(item.quantity)||1));if(!p)return res.status(400).json({error:'Ada produk yang tidak tersedia.'});if(p.stock<qty)return res.status(400).json({error:`Stok ${p.name} tidak mencukupi.`});const variant=[item.size,item.grind].filter(Boolean).join(' / ');const unitPrice=(JSON.parse(p.size_prices||'{}')[item.size]||p.price);clean.push({p,qty,variant,price:unitPrice});subtotal+=unitPrice*qty;}
 const shipping=15000,total=subtotal+shipping,code='GB-'+Date.now().toString().slice(-8);
 const create=db.transaction(()=>{const order=db.prepare(`INSERT INTO orders(user_id,order_code,customer_name,phone,address,city,courier,subtotal,shipping,total,payment_method,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id,code,customerName,phone,address,city,courier||'Reguler',subtotal,shipping,total,paymentMethod||'Transfer bank',notes||'');const oid=order.lastInsertRowid;for(const x of clean){db.prepare('INSERT INTO order_items(order_id,product_id,product_name,variant,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?,?)').run(oid,x.p.id,x.p.name,x.variant,x.qty,x.price,x.price*x.qty);db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(x.qty,x.p.id);}return oid;});
 const id=create();
 db.prepare('INSERT INTO order_events(order_id,status,description) VALUES(?,?,?)').run(id,'Order placed','Pesanan berhasil dibuat. Menunggu pembayaran.');
 res.status(201).json({message:'Pesanan berhasil dibuat. Silakan lanjutkan simulasi pembayaran.',order:db.prepare('SELECT * FROM orders WHERE id=?').get(id)});
});
app.post('/api/chat/preview',async(req,res)=>{
 const question=String(req.body?.message||'').trim();
 if(!question)return res.status(400).json({error:'Tulis pertanyaan terlebih dahulu.'});
 if(question.length>2000)return res.status(400).json({error:'Pesan terlalu panjang.'});
 try {
  const history=Array.isArray(req.body.history)?req.body.history.slice(-8).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'').slice(0,3000)})):[];
  const result=await answerWithLocalAI({question,history,db,products:productRows()});
  res.json({answer:result.answer,sources:result.sources,model:result.model});
 } catch(e) {
  console.error('Local GOBU Buddy error:',e.message);
  res.status(503).json({error:e.message||'GOBU Buddy lokal belum siap. Pastikan Ollama dan model sudah dijalankan.'});
 }
});
app.post('/api/chat',auth,async(req,res)=>{
 const question=String(req.body?.message||'').trim();
 if(!question)return res.status(400).json({error:'Tulis pertanyaan terlebih dahulu.'});
 if(question.length>3000)return res.status(400).json({error:'Pesan terlalu panjang.'});
 let conversationId=Number(req.body.conversationId)||null;
 if(conversationId){const c=db.prepare('SELECT id FROM conversations WHERE id=? AND user_id=?').get(conversationId,req.user.id);if(!c)conversationId=null;}
 if(!conversationId){const r=db.prepare('INSERT INTO conversations(user_id,title) VALUES(?,?)').run(req.user.id,question.slice(0,60));conversationId=r.lastInsertRowid;}
 const history=db.prepare('SELECT role,content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 8').all(conversationId).reverse();
 try {
  const result=await answerWithLocalAI({question,history,db,products:productRows()});
  db.prepare('INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)').run(conversationId,'user',question);
  const saved=db.prepare('INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)').run(conversationId,'assistant',result.answer);
  const lower=question.toLowerCase();
  let recs=[];
  if(/robusta/.test(lower))recs=productRows().filter(p=>p.category==='Robusta').slice(0,2);
  else if(/arabica/.test(lower))recs=productRows().filter(p=>p.category==='Arabica').slice(0,2);
  else if(/hampers|hadiah|gift/.test(lower))recs=productRows().filter(p=>p.category==='Hampers').slice(0,3);
  res.json({conversationId,answer:result.answer,messageId:saved.lastInsertRowid,recommendations:recs.map(p=>({id:p.id,name:p.name,category:p.category,price:p.price,stock:p.stock,image:p.image,description:p.description})),sources:result.sources});
 } catch(e) {
  console.error('Local GOBU Buddy error:',e.message);
  res.status(503).json({error:e.message||'GOBU Buddy lokal belum siap. Pastikan Ollama dan model sudah dijalankan.'});
 }
});
app.get('/api/chat/history',auth,(req,res)=>{const chats=db.prepare('SELECT * FROM conversations WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id);res.json({conversations:chats});});
app.post('/api/feedback',auth,(req,res)=>{const {messageId,rating,comment}=req.body||{};if(!['up','down'].includes(rating))return res.status(400).json({error:'Rating tidak valid.'});db.prepare('INSERT INTO ai_feedback(user_id,message_id,rating,comment) VALUES(?,?,?,?)').run(req.user.id,messageId||null,rating,comment||'');res.json({ok:true});});
// Admin APIs
app.get('/api/admin/summary',auth,admin,(req,res)=>{res.json({products:db.prepare('SELECT COUNT(*) n FROM products').get().n,orders:db.prepare('SELECT COUNT(*) n FROM orders').get().n,customers:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,revenue:db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE payment_status='paid'").get().n,pending:db.prepare("SELECT COUNT(*) n FROM orders WHERE order_status NOT IN ('Completed','Cancelled')").get().n,feedback:db.prepare('SELECT COUNT(*) n FROM ai_feedback').get().n});});
app.get('/api/admin/products',auth,admin,(req,res)=>res.json({products:db.prepare('SELECT * FROM products ORDER BY id DESC').all()}));
app.post('/api/admin/products',auth,admin,(req,res)=>{const p=req.body||{};if(!p.name||!p.category||!p.description)return res.status(400).json({error:'Nama, kategori, dan deskripsi wajib diisi.'});const r=db.prepare('INSERT INTO products(name,category,description,tasting_notes,brew_guide,image,price,stock,sizes,grinds,size_prices,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(p.name,p.category,p.description,p.tasting_notes||'',p.brew_guide||'',p.image||'',Math.max(0,Number(p.price)||0),Math.max(0,Number(p.stock)||0),JSON.stringify(p.sizes||['100g','250g','1000g']),JSON.stringify(p.grinds||['Fine','Coarse']),JSON.stringify(p.size_prices||{}),p.active===false?0:1);res.json({id:r.lastInsertRowid});});
app.put('/api/admin/products/:id',auth,admin,(req,res)=>{const p=req.body||{};db.prepare('UPDATE products SET name=?,category=?,description=?,tasting_notes=?,brew_guide=?,image=?,price=?,stock=?,active=? WHERE id=?').run(p.name,p.category,p.description,p.tasting_notes||'',p.brew_guide||'',p.image||'',Math.max(0,Number(p.price)||0),Math.max(0,Number(p.stock)||0),p.active===false?0:1,req.params.id);res.json({ok:true});});
app.delete('/api/admin/products/:id',auth,admin,(req,res)=>{db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/orders',auth,admin,(req,res)=>res.json({orders:db.prepare('SELECT orders.*,users.email FROM orders JOIN users ON users.id=orders.user_id ORDER BY orders.id DESC').all()}));
app.put('/api/admin/orders/:id',auth,admin,(req,res)=>{const {orderStatus,paymentStatus,trackingNumber}=req.body||{};const existing=db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
 if(!existing)return res.status(404).json({error:'Pesanan tidak ditemukan.'});
 db.prepare('UPDATE orders SET order_status=COALESCE(?,order_status),payment_status=COALESCE(?,payment_status),tracking_number=COALESCE(?,tracking_number) WHERE id=?').run(orderStatus||null,paymentStatus||null,trackingNumber??null,req.params.id);
 if(orderStatus&&orderStatus!==existing.order_status)db.prepare('INSERT INTO order_events(order_id,status,description) VALUES(?,?,?)').run(existing.id,orderStatus,`Status pesanan diperbarui menjadi ${orderStatus}.`);
 if(paymentStatus&&paymentStatus!==existing.payment_status)db.prepare('INSERT INTO order_events(order_id,status,description) VALUES(?,?,?)').run(existing.id,`Payment ${paymentStatus}`,`Status pembayaran diperbarui menjadi ${paymentStatus}.`);
 res.json({ok:true});});
app.get('/api/admin/knowledge',auth,admin,(req,res)=>res.json({knowledge:db.prepare('SELECT * FROM knowledge ORDER BY id DESC').all()}));
app.post('/api/admin/knowledge',auth,admin,(req,res)=>{const {title,content,category}=req.body||{};if(!title||!content)return res.status(400).json({error:'Judul dan isi wajib diisi.'});const r=db.prepare('INSERT INTO knowledge(title,content,category) VALUES(?,?,?)').run(title,content,category||'general');res.json({id:r.lastInsertRowid});});
app.put('/api/admin/knowledge/:id',auth,admin,(req,res)=>{const {title,content,category}=req.body||{};db.prepare('UPDATE knowledge SET title=?,content=?,category=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title,content,category||'general',req.params.id);res.json({ok:true});});
app.delete('/api/admin/knowledge/:id',auth,admin,(req,res)=>{db.prepare('DELETE FROM knowledge WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/feedback',auth,admin,(req,res)=>res.json({feedback:db.prepare('SELECT ai_feedback.*,users.name FROM ai_feedback LEFT JOIN users ON users.id=ai_feedback.user_id ORDER BY ai_feedback.id DESC LIMIT 100').all()}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const port=Number(process.env.PORT)||3000;app.listen(port,()=>console.log(`GOBU Coffee running at http://localhost:${port}`));
