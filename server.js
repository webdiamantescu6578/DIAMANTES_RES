const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 9080;
const ADMIN_EMAIL = 'anthonu680@gmail.com';
const ADMIN_PASSWORD = 'admin123'; // Cámbiala luego en la web
const DB_FILE = path.join(__dirname, 'db.json');

// 🔑 TU API KEY DE FZR CARDS (Usa variable de entorno o esta por defecto)
const FZR_API_KEY = process.env.FZR_API_KEY || 'fc_58efaa3b6c0131a173eef853'; 
const FZR_BASE_URL = 'https://api.fzr.cards/api/v2';

/* ============== DB (JSON) ============== */
let db;
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function nextId(k) { db.counters[k] = (db.counters[k] || 0) + 1; return db.counters[k]; }

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = {
      users: [], offers: [], orders: [], notices: [],
      settings: { usdtWallet: 'TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (TRC20)' },
      counters: { users: 0, offers: 0, orders: 0, notices: 0 },
    };
    db.users.push({
      id: nextId('users'), name: 'Admin', phone: '59369816', email: ADMIN_EMAIL,
      password: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      credits: 1000, isAdmin: true, isBanned: false,
      createdAt: new Date().toISOString(),
    });
    saveDB();
  }
}
loadDB();

/* ============== Helpers ============== */
const round2 = n => Math.round(n * 100) / 100;
const sanitizeUser = u => !u ? null : ({
  id: u.id, name: u.name, phone: u.phone, email: u.email,
  credits: round2(u.credits), isAdmin: u.isAdmin, isBanned: u.isBanned, createdAt: u.createdAt,
});
const orderPublic = o => ({
  id: o.id, game: o.game, label: o.label, price: round2(o.price),
  playerId: o.playerId, method: o.method, status: o.status,
  createdAt: o.createdAt, updatedAt: o.updatedAt, userId: o.userId, fzrOrderId: o.fzrOrderId
});
const getUserById = id => db.users.find(u => u.id === id);
const getUserByEmail = email => db.users.find(u => u.email.toLowerCase() === email.toLowerCase());

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  const u = getUserById(req.session.userId);
  if (!u) return res.status(401).json({ error: 'No autenticado' });
  if (u.isBanned) { req.session.destroy(() => {}); return res.status(403).json({ error: 'Cuenta baneada' }); }
  req.user = u; next();
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Solo admin' });
    next();
  });
}

/* ============== Middlewares ============== */
app.use(express.json());
app.use(session({
  secret: 'diamantes_res_secret_2024',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(express.static(path.join(__dirname, 'public')));

/* ============== Auth ============== */
app.post('/api/register', (req, res) => {
  const { name, phone, email, password } = req.body || {};
  if (!name || !phone || !email || !password || password.length < 4)
    return res.status(400).json({ error: 'Completa todos los campos (contraseña mín. 4)' });
  if (getUserByEmail(email)) return res.status(400).json({ error: 'Ese correo ya está registrado' });
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const u = {
    id: nextId('users'), name: name.trim(), phone: phone.trim(),
    email: email.trim().toLowerCase(), password: bcrypt.hashSync(password, 10),
    credits: 0, isAdmin, isBanned: false, createdAt: new Date().toISOString(),
  };
  db.users.push(u); saveDB();
  req.session.userId = u.id;
  res.json({ user: sanitizeUser(u) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = email ? getUserByEmail(email.trim()) : null;
  if (!u || !bcrypt.compareSync(password || '', u.password))
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  if (u.isBanned) return res.status(403).json({ error: 'Cuenta baneada. Soporte: 59369816' });
  req.session.userId = u.id;
  res.json({ user: sanitizeUser(u) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: sanitizeUser(req.user) }));

app.post('/api/change-password', requireAuth, (req, res) => {
  const { current, new: nw } = req.body || {};
  if (!bcrypt.compareSync(current || '', req.user.password))
    return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  if (!nw || nw.length < 4) return res.status(400).json({ error: 'La nueva contraseña es muy corta' });
  req.user.password = bcrypt.hashSync(nw, 10); saveDB();
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({ usdtWallet: db.settings.usdtWallet, support: '59369816', adminEmail: ADMIN_EMAIL });
});

/* ============== CATÁLOGO FZR ============== */
app.get('/api/offers', async (req, res) => {
  try {
    const catResp = await fetch(`${FZR_BASE_URL}/topups?limit=50`, { headers: { 'X-Api-Key': FZR_API_KEY } });
    const catData = await catResp.json();
    if (!catData.ok) throw new Error(catData.error || 'Error al cargar categorías FZR');

    const freeFireCat = catData.items.find(c => c.name.toLowerCase().includes('free fire'));
    if (!freeFireCat) throw new Error('No se encontró Free Fire en FZR');

    const offResp = await fetch(`${FZR_BASE_URL}/topups/offers?category_id=${freeFireCat.category_id}`, { headers: { 'X-Api-Key': FZR_API_KEY } });
    const offData = await offResp.json();
    if (!offData.ok) throw new Error(offData.error || 'Error al cargar ofertas FZR');

    const offers = offData.offers.map(o => ({
      id: o.offer_id, game: 'Free Fire', label: o.name, diamonds: parseInt(o.name.match(/\d+/)?.[0] || 0), price: parseFloat(o.price_usd)
    }));

    res.json({ games: [{ name: 'Free Fire', offers }] });
  } catch (error) {
    console.error('Error FZR:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/* ============== PEDIDOS FZR ============== */
app.get('/api/orders', requireAuth, (req, res) => {
  const list = db.orders.filter(o => o.userId === req.user.id).sort((a, b) => b.id - a.id);
  res.json({ orders: list.map(orderPublic) });
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const o = db.orders.find(x => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (o.userId !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error: 'Sin permiso' });
  res.json({ order: orderPublic(o) });
});

app.post('/api/fzr/order', requireAuth, async (req, res) => {
  const { offerId, playerId, method, price, label } = req.body || {};
  if (!offerId || !playerId) return res.status(400).json({ error: 'Faltan datos del pedido' });
  if (method === 'credits' && req.user.credits < price) return res.status(400).json({ error: 'Créditos insuficientes' });

  try {
    const catResp = await fetch(`${FZR_BASE_URL}/topups?limit=50`, { headers: { 'X-Api-Key': FZR_API_KEY } });
    const catData = await catResp.json();
    const freeFireCat = catData.items.find(c => c.name.toLowerCase().includes('free fire'));
    if (!freeFireCat) throw new Error('Categoría no encontrada');

    const idempotencyKey = `ord-${Date.now()}-${req.user.id}`;
    const fzrResp = await fetch(`${FZR_BASE_URL}/topups/order`, {
      method: 'POST',
      headers: { 'X-Api-Key': FZR_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ category_id: freeFireCat.category_id, offer_id: offerId, fields: { player_id: String(playerId).trim() } })
    });

    const fzrData = await fzrResp.json();
    if (!fzrResp.ok || !fzrData.ok) {
      let msg = fzrData.error || 'Error al procesar con FZR';
      if (fzrResp.status === 401) msg = 'API Key de FZR inválida';
      if (fzrResp.status === 429) msg = 'Demasiadas solicitudes';
      throw new Error(msg);
    }

    if (method === 'credits') req.user.credits = round2(req.user.credits - price);

    const o = {
      id: nextId('orders'), userId: req.user.id, offerId, game: 'Free Fire', label: label || 'Recarga', price,
      playerId: String(playerId).trim(), method: method || 'usdt', status: 'pending', 
      fzrOrderId: fzrData.order?.id || fzrData.id || 'OK', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    db.orders.push(o); saveDB();
    res.json({ order: orderPublic(o), user: sanitizeUser(req.user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============== ADMIN ============== */
app.get('/api/admin/clients', requireAdmin, (req, res) => res.json({ clients: [...db.users].sort((a, b) => b.id - a.id).map(sanitizeUser) }));
app.post('/api/admin/clients/:id/admin', requireAdmin, (req, res) => {
  const u = getUserById(Number(req.params.id)); if (!u) return res.status(404).json({ error: 'No encontrado' });
  if (u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return res.status(400).json({ error: 'No puedes cambiar al dueño' });
  u.isAdmin = !!req.body.value; saveDB(); res.json({ ok: true });
});
app.post('/api/admin/clients/:id/ban', requireAdmin, (req, res) => {
  const u = getUserById(Number(req.params.id)); if (!u) return res.status(404).json({ error: 'No encontrado' });
  if (u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return res.status(400).json({ error: 'No puedes banear al dueño' });
  u.isBanned = !!req.body.value; saveDB(); res.json({ ok: true });
});
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json({ orders: [...db.orders].sort((a, b) => b.id - a.id).map(o => ({ ...orderPublic(o), userEmail: (getUserById(o.userId) || {}).email || 'N/A' })) });
});
app.post('/api/admin/orders/:id/:action', requireAdmin, (req, res) => {
  const o = db.orders.find(x => x.id === Number(req.params.id)); if (!o) return res.status(404).json({ error: 'No encontrado' });
  o.status = req.params.action === 'accept' ? 'accepted' : 'rejected'; o.updatedAt = new Date().toISOString(); saveDB(); res.json({ ok: true });
});
app.post('/api/admin/credits', requireAdmin, (req, res) => {
  const { email, amount, action } = req.body || {}; const amt = parseFloat(amount); const u = getUserByEmail(String(email).trim());
  if (!u || isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Datos inválidos' });
  u.credits = round2(u.credits + (action === 'remove' ? -amt : amt)); saveDB(); res.json({ ok: true, client: sanitizeUser(u) });
});
app.get('/api/admin/notices', requireAdmin, (req, res) => res.json({ notices: [...db.notices].sort((a, b) => b.id - a.id) }));
app.post('/api/admin/notices', requireAdmin, (req, res) => {
  if (!req.body.title || !req.body.content) return res.status(400).json({ error: 'Faltan datos' });
  db.notices.push({ id: nextId('notices'), title: req.body.title, content: req.body.content, createdAt: new Date().toISOString() }); saveDB(); res.json({ ok: true });
});
app.delete('/api/admin/notices/:id', requireAdmin, (req, res) => { db.notices = db.notices.filter(n => n.id !== Number(req.params.id)); saveDB(); res.json({ ok: true }); });
app.get('/api/admin/config', requireAdmin, (req, res) => res.json({ usdtWallet: db.settings.usdtWallet }));
app.post('/api/admin/config', requireAdmin, (req, res) => { db.settings.usdtWallet = req.body.usdtWallet; saveDB(); res.json({ ok: true }); });

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`💎 Corriendo en http://127.0.0.1:${PORT}`));
