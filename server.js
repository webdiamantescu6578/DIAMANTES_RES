require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 9050;
// ESTA ES LA LÍNEA MÁGICA: Usar /tmp evita el error de permisos en la nube
const FILE = path.join('/tmp', 'data.json'); 

app.use(express.json());
app.use(express.static(__dirname));

function defaultData() {
  return {
    users: [{
      name: 'Administrador', phone: '56386964', email: 'admin1234@gmail.com',
      password: 'admin1234', credits: 0, isAdmin: true, banned: false
    }],
    orders: [],
    notices: [{ id: 'n1', text: '¡Bienvenido a KAREL_Diamantes! Soporte: 56386964', date: new Date().toISOString() }],
    offers: {
      freefire: {
        name: 'Free Fire', emoji: '🔥',
        image: 'https://www.pngarts.com/files/3/Free-Fire-PNG-Image.png',
        items: [
          { diamonds: 110,  prices: { USDT: 1.50, Saldo: 2.00,  Transferencia: 2.00 } },
          { diamonds: 341,  prices: { USDT: 4.00, Saldo: 5.00,  Transferencia: 5.00 } },
          { diamonds: 572,  prices: { USDT: 6.50, Saldo: 8.00,  Transferencia: 8.00 } },
          { diamonds: 1166, prices: { USDT: 13.0, Saldo: 15.0,  Transferencia: 15.0 } },
          { diamonds: 2398, prices: { USDT: 26.0, Saldo: 30.0,  Transferencia: 30.0 } }
        ]
      }
    }
  };
}

let data;
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch (e) { data = defaultData(); fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); }
const save = () => fs.writeFileSync(FILE, JSON.stringify(data, null, 2));

const sessions = new Map();

function auth(req, res, next) {
  const t = req.headers['x-token'];
  const email = t && sessions.get(t);
  if (!email) return res.status(401).json({ error: 'Sesión inválida' });
  const user = data.users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (user.banned) return res.status(403).json({ error: 'Cuenta baneada' });
  req.user = user; next();
}
const adminOnly = (req, res, next) =>
  req.user.isAdmin ? next() : res.status(403).json({ error: 'Solo administradores' });

const pub = u => ({ name: u.name, phone: u.phone, email: u.email, credits: u.credits, isAdmin: u.isAdmin, banned: u.banned });

app.post('/api/register', (req, res) => {
  const { name, phone, email, password } = req.body;
  if (!name || !phone || !email || !password) return res.status(400).json({ error: 'Faltan datos' });
  if (data.users.find(u => u.email === email)) return res.status(400).json({ error: 'Correo ya registrado' });
  const user = { name, phone, email, password, credits: 0, isAdmin: email === 'admin1234@gmail.com', banned: false };
  data.users.push(user); save();
  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, email);
  res.json({ token, user: pub(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = data.users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
  if (user.banned) return res.status(403).json({ error: 'Cuenta baneada. Soporte: 56386964' });
  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, email);
  res.json({ token, user: pub(user) });
});

app.post('/api/logout', auth, (req, res) => {
  for (const [t, e] of sessions) if (e === req.user.email) sessions.delete(t);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: pub(req.user) }));

app.post('/api/change-password', auth, (req, res) => {
  const { current, next: np } = req.body;
  if (req.user.password !== current) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  if (!np || np.length < 4) return res.status(400).json({ error: 'Nueva contraseña muy corta' });
  req.user.password = np; save();
  res.json({ ok: true });
});

app.get('/api/offers', auth, (req, res) => res.json({ offers: data.offers }));
app.get('/api/notices', auth, (req, res) => res.json({ notices: data.notices }));

app.post('/api/admin/sync-catalog', auth, adminOnly, async (req, res) => {
  try {
    const response = await fetch('https://joystickshop.com/api/v1/catalogo', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.JOYSTICK_API_KEY}`
      }
    });
    
    const result = await response.json();
    if (!result.success) return res.status(400).json({ error: 'Error de Joystick Shop: ' + result.message });

    for (const [juegoNombre, paquetes] of Object.entries(result.catalogo)) {
      const gameKey = juegoNombre.toLowerCase().replace(/\s+/g, '');
      const existingImage = data.offers[gameKey] ? data.offers[gameKey].image : null;

      data.offers[gameKey] = {
        name: juegoNombre,
        emoji: juegoNombre === 'Free Fire' ? '🔥' : '🎮',
        image: existingImage,
        items: Object.entries(paquetes).map(([paquete, precio]) => {
          const precioFinal = +(precio * 1.20).toFixed(2); 
          return {
            diamonds: parseInt(paquete),
            prices: { USDT: precioFinal, Saldo: precioFinal, Transferencia: precioFinal }
          };
        })
      };
    }
    
    if(data.offers['freefire'] && !data.offers['freefire'].image) {
        data.offers['freefire'].image = 'https://www.pngarts.com/files/3/Free-Fire-PNG-Image.png';
    }

    save();
    res.json({ ok: true, message: 'Catálogo sincronizado con éxito', offers: data.offers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error conectando con la API de Joystick Shop' });
  }
});

app.post('/api/order', auth, async (req, res) => {
  const { gameKey, diamonds, method, gameId } = req.body;
  const game = data.offers[gameKey];
  if (!game) return res.status(400).json({ error: 'Juego no válido' });
  
  const item = game.items.find(i => i.diamonds === diamonds);
  if (!item) return res.status(400).json({ error: 'Oferta no válida' });
  if (!gameId || !gameId.trim()) return res.status(400).json({ error: 'Ingresa tu ID' });
  if (!['USDT', 'Saldo', 'Transferencia'].includes(method)) return res.status(400).json({ error: 'Método no válido' });
  
  const price = item.prices[method];
  if (method === 'Saldo' && req.user.credits < price) {
    return res.status(400).json({ error: 'Saldo insuficiente' });
  }

  try {
    const bodyAPI = {
      juego: game.name,
      paquete: String(diamonds),
      id_jugador: gameId.trim()
    };

    const respuestaAPI = await fetch('https://joystickshop.com/api/v1/pedido', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.JOYSTICK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyAPI)
    });

    const dataProveedor = await respuestaAPI.json();

    if (!dataProveedor.success) {
      return res.status(400).json({ 
        error: `Error del proveedor: ${dataProveedor.message || 'No se pudo procesar la recarga'}` 
      });
    }

    if (method === 'Saldo') {
      req.user.credits -= price;
    }

    const order = {
      id: 'ORD' + Date.now().toString(36).toUpperCase(),
      userEmail: req.user.email, 
      userName: req.user.name,
      gameKey, 
      game: game.name, 
      diamonds, 
      method, 
      price,
      gameId: gameId.trim(), 
      status: 'aceptado',
      date: new Date().toISOString(),
      proveedor_id: dataProveedor.order_id,
      estado_proveedor: dataProveedor.estado
    };
    
    data.orders.unshift(order); 
    save();
    
    res.json({ order, user: pub(req.user) });

  } catch (error) {
    console.error("Error crítico conectando a JoystickShop:", error);
    res.status(500).json({ error: 'Error interno al conectar con el proveedor' });
  }
});

app.get('/api/orders', auth, (req, res) =>
  res.json({ orders: data.orders.filter(o => o.userEmail === req.user.email) }));

app.get('/api/order/:id', auth, (req, res) => {
  const o = data.orders.find(x => x.id === req.params.id && x.userEmail === req.user.email);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json({ order: o, user: pub(req.user) });
});

app.get('/api/admin/clients', auth, adminOnly, (req, res) =>
  res.json({ clients: data.users.map(pub) }));

app.post('/api/admin/client', auth, adminOnly, (req, res) => {
  const { email, isAdmin, banned } = req.body;
  const u = data.users.find(x => x.email === email);
  if (!u) return res.status(404).json({ error: 'No existe' });
  if (u.email === 'admin1234@gmail.com' && (isAdmin === false || banned === true))
    return res.status(400).json({ error: 'No puedes modificar al admin principal' });
  if (typeof isAdmin === 'boolean') u.isAdmin = isAdmin;
  if (typeof banned === 'boolean') u.banned = banned;
  save(); res.json({ ok: true });
});

app.get('/api/admin/orders', auth, adminOnly, (req, res) => res.json({ orders: data.orders }));

app.post('/api/admin/order', auth, adminOnly, (req, res) => {
  const { id, status } = req.body;
  const o = data.orders.find(x => x.id === id);
  if (!o) return res.status(404).json({ error: 'No existe' });
  if (!['aceptado', 'rechazado'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  const prev = o.status;
  o.status = status;
  if (status === 'rechazado' && prev === 'proceso' && o.method === 'Saldo') {
    const u = data.users.find(x => x.email === o.userEmail);
    if (u) u.credits += o.price;
  }
  save(); res.json({ ok: true });
});

app.post('/api/admin/credits', auth, adminOnly, (req, res) => {
  const { email, amount } = req.body;
  const u = data.users.find(x => x.email === email);
  if (!u) return res.status(404).json({ error: 'Cliente no encontrado' });
  const n = parseFloat(amount);
  if (isNaN(n)) return res.status(400).json({ error: 'Cantidad inválida' });
  u.credits = Math.max(0, +(u.credits + n).toFixed(2));
  save(); res.json({ ok: true, user: pub(u) });
});

app.post('/api/admin/offers', auth, adminOnly, (req, res) => {
  if (!req.body.offers) return res.status(400).json({ error: 'Faltan ofertas' });
  data.offers = req.body.offers; save(); res.json({ ok: true });
});

app.post('/api/admin/notices', auth, adminOnly, (req, res) => {
  if (!Array.isArray(req.body.notices)) return res.status(400).json({ error: 'Faltan avisos' });
  data.notices = req.body.notices; save(); res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => console.log('Diamantes_Res → http://localhost:' + PORT));
