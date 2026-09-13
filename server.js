'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const PORT = Number(process.env.PORT) || 3847;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ROOT = __dirname;
const DATA_ROOT = process.env.DATA_ROOT || (fs.existsSync('/var/data') ? '/var/data' : __dirname);
const DATA_DIR = path.join(DATA_ROOT, 'data');
const UPLOADS_DIR = path.join(DATA_ROOT, 'uploads');
const PRODUCTS_DIR = path.join(UPLOADS_DIR, 'products');
const SLIPS_DIR = path.join(UPLOADS_DIR, 'slips');
const BRANDING_DIR = path.join(UPLOADS_DIR, 'branding');
const PAYMENT_DIR = path.join(UPLOADS_DIR, 'payment');
const DB_PATH = path.join(DATA_DIR, 'shop.db');

[DATA_DIR, PRODUCTS_DIR, SLIPS_DIR, BRANDING_DIR, PAYMENT_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// --- Database (better-sqlite3 with sql.js fallback) ---
let db;
let dbType = 'better-sqlite3';

function initBetterSqlite3() {
  const Database = require('better-sqlite3');
  const database = new Database(DB_PATH);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  return {
    exec(sql) {
      database.exec(sql);
    },
    prepare(sql) {
      const stmt = database.prepare(sql);
      return {
        run(...args) {
          const info = stmt.run(...args);
          return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
        },
        get(...args) {
          return stmt.get(...args);
        },
        all(...args) {
          return stmt.all(...args);
        },
      };
    },
    close() {
      database.close();
    },
  };
}

function initSqlJs() {
  // Synchronous-ish wrapper around sql.js for our simple needs
  const initSqlJs = require('sql.js');
  // We'll load async then block isn't possible — use sync file + deferred init in start()
  throw new Error('sql.js requires async init — handled in start()');
}

try {
  db = initBetterSqlite3();
} catch (err) {
  console.warn('better-sqlite3 failed, will try sql.js:', err.message);
  dbType = 'sql.js';
  db = null;
}

function createTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price_mmk INTEGER NOT NULL,
      description TEXT DEFAULT '',
      image_path TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      on_banner INTEGER DEFAULT 0,
      discount_percent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      notes TEXT DEFAULT '',
      total_mmk INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      slip_path TEXT NOT NULL,
      spin_credits INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      unit_price_mmk INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(order_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS spin_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      product_id INTEGER,
      hit_every INTEGER NOT NULL DEFAULT 1,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS spin_plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      prize_id INTEGER,
      prize_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(order_id),
      FOREIGN KEY (prize_id) REFERENCES spin_prizes(id)
    );
  `);
}


function migrateProductsColumns(database) {
  const cols = database.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  if (!cols.includes('on_banner')) {
    database.exec('ALTER TABLE products ADD COLUMN on_banner INTEGER DEFAULT 0');
  }
  if (!cols.includes('discount_percent')) {
    database.exec('ALTER TABLE products ADD COLUMN discount_percent INTEGER DEFAULT 0');
  }
}

function migrateOrdersSpinCredits(database) {
  const cols = database.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!cols.includes('spin_credits')) {
    database.exec('ALTER TABLE orders ADD COLUMN spin_credits INTEGER DEFAULT 0');
  }
}

function clampDiscountPercent(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(90, n);
}

function parseOnBanner(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === '0' || value === 0 || value === false || value === 'false' ? 0 : 1;
}

function seedIfEmpty(database) {
  const count = database.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (count > 0) return;

  const placeholders = [
    {
      name: 'Skullpanda Blind Box',
      price: 45000,
      desc: 'လှပသော Skullpanda ဘလိုင်ဘောက်စ် — ကျပန်း ဒီဇိုင်း ရရှိမည်။',
      color: '#14b8a6',
      file: 'skullpanda.svg',
    },
    {
      name: 'Nommi Mini Figure',
      price: 38000,
      desc: 'Nommi မီနီ ရုပ်ပုံ — စုဆောင်းသူများအတွက် အထူး။',
      color: '#ec4899',
      file: 'nommi.svg',
    },
    {
      name: 'Zootopia Collectible',
      price: 52000,
      desc: 'Zootopia စုဆောင်းပစ္စည်း — အရည်အသွေးမြင့် ပလပ်စတစ်။',
      color: '#8b5cf6',
      file: 'zootopia.svg',
    },
  ];

  const insert = database.prepare(
    `INSERT INTO products (name, price_mmk, description, image_path, active, on_banner, discount_percent)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  );

  placeholders.forEach((p, idx) => {
    const svgPath = path.join(PRODUCTS_DIR, p.file);
    if (!fs.existsSync(svgPath)) {
      fs.writeFileSync(
        svgPath,
        makeProductSvg(p.name, p.color),
        'utf8'
      );
    }
    // Demo: first sample product on banner with 15% OFF
    const onBanner = idx === 0 ? 1 : 0;
    const discount = idx === 0 ? 15 : 0;
    insert.run(p.name, p.price, p.desc, `products/${p.file}`, onBanner, discount);
  });

  const settingsDefaults = [
    ['bank_name', 'KBZ Bank'],
    ['account_number', '1234567890'],
    ['account_name', 'MM Shop Myanmar'],
    ['payment_note', 'ငွေလွှဲပြီးနောက် စလစ်ပုံတင်ပြီး အော်ဒါတင်ပါ။'],
    ['shop_name', 'MM Shop'],
  ];
  const setIns = database.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [k, v] of settingsDefaults) {
    setIns.run(k, v);
  }

  console.log('Seeded 3 sample products and default payment settings.');
}

function makeProductSvg(label, color) {
  const safe = String(label).replace(/[<>&]/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${color};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:#0f172a;stop-opacity:1"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <circle cx="200" cy="160" r="70" fill="rgba(255,255,255,0.25)"/>
  <rect x="100" y="250" width="200" height="80" rx="16" fill="rgba(255,255,255,0.2)"/>
  <text x="200" y="300" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" fill="#fff" font-weight="600">${safe}</text>
</svg>`;
}

// --- Async sql.js fallback ---
async function initSqlJsDb() {
  let SQL;
  try {
    SQL = await require('sql.js')();
  } catch (e) {
    // try loading from dist
    const sqlJs = require('sql.js');
    SQL = await sqlJs();
  }

  let database;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    database = new SQL.Database(buf);
  } else {
    database = new SQL.Database();
  }

  const persist = () => {
    const data = database.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  };

  // Auto-persist periodically and on writes
  const wrap = {
    exec(sql) {
      database.run(sql);
      persist();
    },
    prepare(sql) {
      return {
        run(...args) {
          database.run(sql, args);
          persist();
          const changes = database.getRowsModified();
          // lastInsertRowid approximation
          let lastInsertRowid = 0;
          try {
            const r = database.exec('SELECT last_insert_rowid() AS id');
            if (r[0] && r[0].values[0]) lastInsertRowid = r[0].values[0][0];
          } catch (_) {}
          return { changes, lastInsertRowid };
        },
        get(...args) {
          const stmt = database.prepare(sql);
          stmt.bind(args);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...args) {
          const stmt = database.prepare(sql);
          stmt.bind(args);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },
      };
    },
    close() {
      persist();
      database.close();
    },
  };
  return wrap;
}

// --- Session helpers ---
function createSession(database) {
  const token = crypto.randomBytes(32).toString('hex');
  database.prepare('INSERT INTO sessions (token) VALUES (?)').run(token);
  return token;
}

function destroySession(database, token) {
  if (!token) return;
  database.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, 64);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function getAdminPasswordHash(database) {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password_hash');
  return row && row.value ? row.value : '';
}

function checkAdminPassword(database, password) {
  const stored = getAdminPasswordHash(database);
  if (stored) return verifyPassword(password, stored);
  return String(password) === String(ADMIN_PASSWORD);
}

function upsertSetting(database, key, value) {
  database
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

function ensureDefaultSettings(database) {
  const setIns = database.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  setIns.run('shop_name', 'MM Shop');
  // Keep payment defaults if missing (e.g. existing DB without seed)
  setIns.run('bank_name', 'KBZ Bank');
  setIns.run('account_number', '1234567890');
  setIns.run('account_name', 'MM Shop Myanmar');
  setIns.run('payment_note', 'ငွေလွှဲပြီးနောက် စလစ်ပုံတင်ပြီး အော်ဒါတင်ပါ။');
}

function publicUploadUrl(relPath) {
  if (!relPath) return '';
  const p = String(relPath).trim();
  if (!p) return '';
  if (p.startsWith('/')) return p;
  return '/uploads/' + p;
}

function publicLogoUrl(logoPath) {
  return publicUploadUrl(logoPath);
}

function getPublicSettings(database) {
  const s = getSettingsMap(database);
  return {
    shop_name: s.shop_name || 'MM Shop',
    logo_url: publicUploadUrl(s.logo_path || ''),
    bank_name: s.bank_name || '',
    account_number: s.account_number || '',
    account_name: s.account_name || '',
    payment_note: s.payment_note || '',
    mmqr_url: publicUploadUrl(s.mmqr_path || ''),
  };
}


function unlinkUploadRel(relPath) {
  if (!relPath) return;
  const p = String(relPath).trim();
  if (!p) return;
  const full = path.join(UPLOADS_DIR, p);
  // Only allow deleting under uploads/
  if (!full.startsWith(UPLOADS_DIR + path.sep) && full !== UPLOADS_DIR) return;
  if (fs.existsSync(full)) {
    try { fs.unlinkSync(full); } catch (_) {}
  }
}

function requirePasswordBody(req, res) {
  const password = req.body && req.body.password;
  if (password === undefined || password === null || String(password) === '') {
    res.status(400).json({ error: 'စကားဝှက် လိုအပ်သည်' });
    return null;
  }
  if (!checkAdminPassword(db, password)) {
    res.status(403).json({ error: 'စကားဝှက် မှားနေသည်' });
    return null;
  }
  return password;
}

function deleteOrderById(database, orderId) {
  const o = database.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
  if (!o) return null;
  database.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  database.prepare('DELETE FROM orders WHERE order_id = ?').run(orderId);
  unlinkUploadRel(o.slip_path);
  return o;
}

function isAdmin(req, database) {
  const token = req.cookies && req.cookies.admin_session;
  if (!token) return false;
  const row = database.prepare('SELECT token FROM sessions WHERE token = ?').get(token);
  return !!row;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req, db)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Multer ---
function makeUploader(dest) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      const safe = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)
        ? ext
        : '.jpg';
      cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${safe}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\//.test(file.mimetype) || file.mimetype === 'image/svg+xml') {
        cb(null, true);
      } else {
        cb(new Error('Images only'));
      }
    },
  });
}

const uploadProduct = makeUploader(PRODUCTS_DIR);
const uploadSlip = makeUploader(SLIPS_DIR);
const uploadBranding = makeUploader(BRANDING_DIR);
const uploadPayment = makeUploader(PAYMENT_DIR);

// --- App ---
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(ROOT, 'public')));

function getSettingsMap(database) {
  const rows = database.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

function formatOrder(row, items) {
  return {
    id: row.id,
    order_id: row.order_id,
    customer_name: row.customer_name,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    total_mmk: row.total_mmk,
    status: row.status,
    slip_path: row.slip_path,
    spin_credits: Number(row.spin_credits) || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: items || [],
  };
}

// ========== PUBLIC API ==========

app.get('/api/products', (_req, res) => {
  const products = db
    .prepare(
      `SELECT id, name, price_mmk, description, image_path, active, on_banner, discount_percent
       FROM products WHERE active = 1 ORDER BY id DESC`
    )
    .all();
  res.json(products);
});

app.get('/api/settings/payment', (_req, res) => {
  const s = getPublicSettings(db);
  res.json({
    bank_name: s.bank_name,
    account_number: s.account_number,
    account_name: s.account_name,
    payment_note: s.payment_note,
  });
});

app.get('/api/settings/public', (_req, res) => {
  res.json(getPublicSettings(db));
});

app.post('/api/orders', (req, res) => {
  uploadSlip.single('slip')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    try {
      const { customer_name, phone, address, notes, items } = req.body;
      if (!customer_name || !phone || !address) {
        return res.status(400).json({ error: 'အမည်၊ ဖုန်းနှင့် လိပ်စာ လိုအပ်သည်' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'ငွေလွှဲစလစ် ပုံတင်ရန် လိုအပ်သည်' });
      }

      let parsedItems;
      try {
        parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
      } catch {
        return res.status(400).json({ error: 'Invalid items' });
      }
      if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
        return res.status(400).json({ error: 'ခြင်းတောင်း ဗလာဖြစ်နေသည်' });
      }

      let total = 0;
      const lineItems = [];
      for (const it of parsedItems) {
        const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
        const product = db
          .prepare('SELECT id, name, price_mmk, active FROM products WHERE id = ?')
          .get(it.product_id);
        if (!product || !product.active) {
          return res.status(400).json({ error: `ပစ္စည်း မရရှိနိုင်ပါ (id=${it.product_id})` });
        }
        total += product.price_mmk * qty;
        lineItems.push({
          product_id: product.id,
          product_name: product.name,
          unit_price_mmk: product.price_mmk,
          quantity: qty,
        });
      }

      const orderId = 'MM' + Date.now().toString(36).toUpperCase() + uuidv4().slice(0, 4).toUpperCase();
      const slipPath = `slips/${req.file.filename}`;

      db.prepare(
        `INSERT INTO orders (order_id, customer_name, phone, address, notes, total_mmk, status, slip_path)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).run(
        orderId,
        String(customer_name).trim(),
        String(phone).trim(),
        String(address).trim(),
        notes ? String(notes).trim() : '',
        total,
        slipPath
      );

      const itemIns = db.prepare(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price_mmk, quantity)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const li of lineItems) {
        itemIns.run(orderId, li.product_id, li.product_name, li.unit_price_mmk, li.quantity);
      }

      res.json({ ok: true, order_id: orderId, total_mmk: total });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// ========== PUBLIC ORDER TRACK ==========

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s\-]/g, '');
}

function trackOrderHandler(req, res) {
  try {
    const orderId = String(
      (req.method === 'GET' ? req.query.id : req.body && req.body.orderId) ||
        (req.body && req.body.order_id) ||
        ''
    ).trim();
    const phoneRaw =
      (req.method === 'GET' ? req.query.phone : req.body && req.body.phone) || '';
    const phone = normalizePhone(phoneRaw);

    if (!orderId || !phone) {
      return res.status(400).json({ error: 'အော်ဒါနံပါတ်နှင့် ဖုန်းနံပါတ် လိုအပ်သည်' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
    if (!order || normalizePhone(order.phone) !== phone) {
      return res.status(404).json({ error: 'အော်ဒါ မတွေ့ပါ' });
    }

    const items = db
      .prepare(
        `SELECT product_name, unit_price_mmk, quantity
         FROM order_items WHERE order_id = ?`
      )
      .all(order.order_id);

    res.json({
      order_id: order.order_id,
      status: order.status,
      total_mmk: order.total_mmk,
      created_at: order.created_at,
      slip_received: !!(order.slip_path && String(order.slip_path).trim()),
      items: items.map((it) => ({
        product_name: it.product_name,
        unit_price_mmk: it.unit_price_mmk,
        quantity: it.quantity,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

app.get('/api/orders/track', trackOrderHandler);
app.post('/api/orders/track', trackOrderHandler);


// ========== PUBLIC SPIN WHEEL ==========

function clampHitEvery(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(1000000, n);
}

function pickWeightedSpinPrize(prizes) {
  // weight = 1/hit_every, then normalize
  const weights = prizes.map((p) => {
    const n = Math.max(1, parseInt(p.hit_every, 10) || 1);
    return 1 / n;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return prizes[0];
  let r = Math.random() * total;
  for (let i = 0; i < prizes.length; i++) {
    r -= weights[i];
    if (r <= 0) return prizes[i];
  }
  return prizes[prizes.length - 1];
}

function formatSpinPrizePublic(row) {
  return {
    id: row.id,
    name: row.name,
    product_id: row.product_id || null,
  };
}

function formatSpinPrizeAdmin(row) {
  return {
    id: row.id,
    name: row.name,
    product_id: row.product_id || null,
    hit_every: row.hit_every,
    active: row.active,
    sort_order: row.sort_order,
    created_at: row.created_at,
    product_name: row.product_name || null,
  };
}

app.get('/api/spin/prizes', (_req, res) => {
  try {
    const prizes = db
      .prepare(
        `SELECT id, name, product_id
         FROM spin_prizes
         WHERE active = 1
         ORDER BY sort_order ASC, id ASC`
      )
      .all();
    res.json(prizes.map(formatSpinPrizePublic));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

function findOrderForSpin(orderId, phone) {
  const oid = String(orderId || '').trim();
  const ph = normalizePhone(phone);
  if (!oid || !ph) return null;
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(oid);
  if (!order || normalizePhone(order.phone) !== ph) return null;
  return order;
}

app.post('/api/spin/unlock', (req, res) => {
  try {
    const orderId = (req.body && (req.body.orderId || req.body.order_id)) || '';
    const phone = (req.body && req.body.phone) || '';
    const order = findOrderForSpin(orderId, phone);
    if (!order) {
      return res.status(404).json({ error: 'အော်ဒါ မတွေ့ပါ — အော်ဒါနံပါတ်နှင့် ဖုန်း စစ်ပါ' });
    }
    const credits = Number(order.spin_credits) || 0;
    res.json({
      ok: true,
      orderId: order.order_id,
      spinCredits: credits,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/spin', (req, res) => {
  try {
    const orderId = (req.body && (req.body.orderId || req.body.order_id)) || '';
    const phone = (req.body && req.body.phone) || '';
    const order = findOrderForSpin(orderId, phone);
    if (!order) {
      return res.status(404).json({ error: 'အော်ဒါ မတွေ့ပါ — အော်ဒါနံပါတ်နှင့် ဖုန်း စစ်ပါ' });
    }
    const credits = Number(order.spin_credits) || 0;
    if (credits < 1) {
      return res.status(403).json({
        error: 'ကံစမ်းခွင့် မရှိပါ — Admin က အခွင့်ထည့်ပေးမှ လှည့်နိုင်သည်',
        spinCredits: 0,
      });
    }

    const prizes = db
      .prepare(
        `SELECT id, name, product_id, hit_every
         FROM spin_prizes
         WHERE active = 1
         ORDER BY sort_order ASC, id ASC`
      )
      .all();
    if (!prizes.length) {
      return res.status(400).json({ error: 'စပင်ဘီး ဆုများ မရှိသေးပါ' });
    }

    // Atomic consume 1 credit (re-check in UPDATE)
    const upd = db
      .prepare(
        `UPDATE orders SET spin_credits = spin_credits - 1, updated_at = datetime('now')
         WHERE order_id = ? AND spin_credits >= 1`
      )
      .run(order.order_id);
    if (!upd.changes) {
      return res.status(403).json({
        error: 'ကံစမ်းခွင့် မရှိပါ',
        spinCredits: 0,
      });
    }

    const won = pickWeightedSpinPrize(prizes);
    db.prepare(
      `INSERT INTO spin_plays (order_id, prize_id, prize_name) VALUES (?, ?, ?)`
    ).run(order.order_id, won.id, won.name);

    const left = db
      .prepare('SELECT spin_credits FROM orders WHERE order_id = ?')
      .get(order.order_id);

    res.json({
      prizeId: won.id,
      name: won.name,
      productId: won.product_id || null,
      spinCredits: Number(left && left.spin_credits) || 0,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== ADMIN AUTH ==========

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!checkAdminPassword(db, password)) {
    return res.status(401).json({ error: 'စကားဝှက် မှားနေသည်' });
  }
  const token = createSession(db);
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post('/api/admin/password', requireAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'လက်ရှိနှင့် စကားဝှက်အသစ် လိုအပ်သည်' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'စကားဝှက်အသစ် အနည်းဆုံး ၆ လုံး ရှိရမည်' });
    }
    if (!checkAdminPassword(db, currentPassword)) {
      return res.status(400).json({ error: 'လက်ရှိ စကားဝှက် မှားနေသည်' });
    }
    upsertSetting(db, 'admin_password_hash', hashPassword(newPassword));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  destroySession(db, req.cookies && req.cookies.admin_session);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ authenticated: isAdmin(req, db) });
});

// ========== ADMIN PRODUCTS ==========

app.get('/api/admin/products', requireAdmin, (_req, res) => {
  const products = db
    .prepare(
      `SELECT id, name, price_mmk, description, image_path, active, on_banner, discount_percent, created_at, updated_at
       FROM products ORDER BY id DESC`
    )
    .all();
  res.json(products);
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  uploadProduct.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const { name, price_mmk, description, active, on_banner, discount_percent } = req.body;
      if (!name || price_mmk === undefined) {
        return res.status(400).json({ error: 'name and price required' });
      }
      const image_path = req.file ? `products/${req.file.filename}` : '';
      const isActive = active === '0' || active === 0 || active === false ? 0 : 1;
      const isBanner = parseOnBanner(on_banner, 0);
      const discount = clampDiscountPercent(discount_percent);
      const result = db
        .prepare(
          `INSERT INTO products (name, price_mmk, description, image_path, active, on_banner, discount_percent)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(name).trim(),
          parseInt(price_mmk, 10) || 0,
          description ? String(description) : '',
          image_path,
          isActive,
          isBanner,
          discount
        );
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
      res.json(product);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  uploadProduct.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const id = parseInt(req.params.id, 10);
      const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Not found' });

      const { name, price_mmk, description, active, on_banner, discount_percent } = req.body;
      let image_path = existing.image_path;
      if (req.file) {
        image_path = `products/${req.file.filename}`;
      }

      const isActive =
        active === undefined
          ? existing.active
          : active === '0' || active === 0 || active === false || active === 'false'
            ? 0
            : 1;
      const isBanner =
        on_banner === undefined ? (existing.on_banner || 0) : parseOnBanner(on_banner, 0);
      const discount =
        discount_percent === undefined
          ? (existing.discount_percent || 0)
          : clampDiscountPercent(discount_percent);

      db.prepare(
        `UPDATE products SET name = ?, price_mmk = ?, description = ?, image_path = ?,
         active = ?, on_banner = ?, discount_percent = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        name !== undefined ? String(name).trim() : existing.name,
        price_mmk !== undefined ? parseInt(price_mmk, 10) || 0 : existing.price_mmk,
        description !== undefined ? String(description) : existing.description,
        image_path,
        isActive,
        isBanner,
        discount,
        id
      );

      res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ========== ADMIN ORDERS ==========

app.get('/api/admin/orders', requireAdmin, (_req, res) => {
  const orders = db
    .prepare(`SELECT * FROM orders ORDER BY datetime(created_at) DESC, id DESC`)
    .all();
  const result = orders.map((o) => {
    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .all(o.order_id);
    return formatOrder(o, items);
  });
  res.json(result);
});

app.get('/api/admin/orders/:orderId', requireAdmin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .all(o.order_id);
  const plays = db
    .prepare(
      `SELECT id, prize_id, prize_name, created_at FROM spin_plays
       WHERE order_id = ? ORDER BY id DESC LIMIT 20`
    )
    .all(o.order_id);
  res.json({ ...formatOrder(o, items), spin_plays: plays });
});

app.patch('/api/admin/orders/:orderId/status', requireAdmin, (req, res) => {
  const allowed = ['pending', 'paid_confirmed', 'shipped', 'cancelled'];
  const { status } = req.body || {};
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE order_id = ?`
  ).run(status, req.params.orderId);
  const updated = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .all(updated.order_id);
  res.json(formatOrder(updated, items));
});

app.patch('/api/admin/orders/:orderId/spin-credits', requireAdmin, (req, res) => {
  try {
    const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
    if (!o) return res.status(404).json({ error: 'Not found' });
    let credits = parseInt(req.body && req.body.spin_credits, 10);
    if (!Number.isFinite(credits) || credits < 0) {
      return res.status(400).json({ error: 'spin_credits သည် 0 သို့မဟုတ် အပေါင်းကိန်း ဖြစ်ရမည်' });
    }
    credits = Math.min(1000, credits);
    db.prepare(
      `UPDATE orders SET spin_credits = ?, updated_at = datetime('now') WHERE order_id = ?`
    ).run(credits, req.params.orderId);
    const updated = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .all(updated.order_id);
    const plays = db
      .prepare(
        `SELECT id, prize_id, prize_name, created_at FROM spin_plays
         WHERE order_id = ? ORDER BY id DESC LIMIT 20`
      )
      .all(updated.order_id);
    res.json({ ...formatOrder(updated, items), spin_plays: plays });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


app.delete('/api/admin/orders', requireAdmin, (req, res) => {
  try {
    if (requirePasswordBody(req, res) === null) return;
    const orders = db.prepare('SELECT order_id, slip_path FROM orders').all();
    for (const o of orders) {
      deleteOrderById(db, o.order_id);
    }
    res.json({ ok: true, deleted: orders.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/orders/:orderId', requireAdmin, (req, res) => {
  try {
    if (requirePasswordBody(req, res) === null) return;
    const deleted = deleteOrderById(db, req.params.orderId);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, order_id: deleted.order_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// ========== ADMIN SPIN PRIZES ==========

app.get('/api/admin/spin-prizes', requireAdmin, (_req, res) => {
  try {
    const prizes = db
      .prepare(
        `SELECT sp.*, p.name AS product_name
         FROM spin_prizes sp
         LEFT JOIN products p ON p.id = sp.product_id
         ORDER BY sp.sort_order ASC, sp.id ASC`
      )
      .all();
    res.json(prizes.map(formatSpinPrizeAdmin));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/spin-prizes', requireAdmin, (req, res) => {
  try {
    const { name, product_id, hit_every, active, sort_order } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'အမည် လိုအပ်သည်' });
    }
    let pid = null;
    if (product_id !== undefined && product_id !== null && product_id !== '') {
      pid = parseInt(product_id, 10);
      if (!Number.isFinite(pid)) return res.status(400).json({ error: 'Invalid product_id' });
      const prod = db.prepare('SELECT id FROM products WHERE id = ?').get(pid);
      if (!prod) return res.status(400).json({ error: 'ပစ္စည်း မတွေ့ပါ' });
    }
    const hit = clampHitEvery(hit_every);
    const isActive = active === '0' || active === 0 || active === false || active === 'false' ? 0 : 1;
    const sort = parseInt(sort_order, 10);
    const sortVal = Number.isFinite(sort) ? sort : 0;
    const result = db
      .prepare(
        `INSERT INTO spin_prizes (name, product_id, hit_every, active, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(String(name).trim(), pid, hit, isActive, sortVal);
    const row = db
      .prepare(
        `SELECT sp.*, p.name AS product_name
         FROM spin_prizes sp
         LEFT JOIN products p ON p.id = sp.product_id
         WHERE sp.id = ?`
      )
      .get(result.lastInsertRowid);
    res.json(formatSpinPrizeAdmin(row));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/spin-prizes/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM spin_prizes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { name, product_id, hit_every, active, sort_order } = req.body || {};
    let pid = existing.product_id;
    if (product_id !== undefined) {
      if (product_id === null || product_id === '') {
        pid = null;
      } else {
        pid = parseInt(product_id, 10);
        if (!Number.isFinite(pid)) return res.status(400).json({ error: 'Invalid product_id' });
        const prod = db.prepare('SELECT id FROM products WHERE id = ?').get(pid);
        if (!prod) return res.status(400).json({ error: 'ပစ္စည်း မတွေ့ပါ' });
      }
    }

    const isActive =
      active === undefined
        ? existing.active
        : active === '0' || active === 0 || active === false || active === 'false'
          ? 0
          : 1;

    const hit =
      hit_every === undefined ? existing.hit_every : clampHitEvery(hit_every);
    const sort =
      sort_order === undefined
        ? existing.sort_order
        : Number.isFinite(parseInt(sort_order, 10))
          ? parseInt(sort_order, 10)
          : existing.sort_order;

    db.prepare(
      `UPDATE spin_prizes SET name = ?, product_id = ?, hit_every = ?, active = ?, sort_order = ?
       WHERE id = ?`
    ).run(
      name !== undefined ? String(name).trim() : existing.name,
      pid,
      hit,
      isActive,
      sort,
      id
    );

    const row = db
      .prepare(
        `SELECT sp.*, p.name AS product_name
         FROM spin_prizes sp
         LEFT JOIN products p ON p.id = sp.product_id
         WHERE sp.id = ?`
      )
      .get(id);
    res.json(formatSpinPrizeAdmin(row));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/spin-prizes/:id', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM spin_prizes WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM spin_prizes WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== ADMIN SETTINGS ==========

app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  const s = getSettingsMap(db);
  // Never expose password hash to client; include branding fields
  const { admin_password_hash, ...safe } = s;
  res.json({
    ...safe,
    shop_name: s.shop_name || 'MM Shop',
    logo_path: s.logo_path || '',
    logo_url: publicUploadUrl(s.logo_path || ''),
    mmqr_path: s.mmqr_path || '',
    mmqr_url: publicUploadUrl(s.mmqr_path || ''),
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const allowed = [
    'bank_name',
    'account_number',
    'account_name',
    'payment_note',
    'shop_name',
  ];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      let val = String(req.body[key]);
      if (key === 'shop_name') {
        val = val.trim() || 'MM Shop';
      }
      upsertSetting(db, key, val);
    }
  }
  const s = getSettingsMap(db);
  const { admin_password_hash, ...safe } = s;
  res.json({
    ...safe,
    shop_name: s.shop_name || 'MM Shop',
    logo_path: s.logo_path || '',
    logo_url: publicUploadUrl(s.logo_path || ''),
    mmqr_path: s.mmqr_path || '',
    mmqr_url: publicUploadUrl(s.mmqr_path || ''),
  });
});

app.post('/api/admin/branding/logo', requireAdmin, (req, res) => {
  uploadBranding.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'လိုဂို ပုံတင်ရန် လိုအပ်သည်' });
      }
      const prev = getSettingsMap(db).logo_path;
      const logo_path = `branding/${req.file.filename}`;
      upsertSetting(db, 'logo_path', logo_path);
      if (prev && prev !== logo_path) {
        const oldFile = path.join(UPLOADS_DIR, prev);
        if (fs.existsSync(oldFile)) {
          try { fs.unlinkSync(oldFile); } catch (_) {}
        }
      }
      res.json({
        ok: true,
        logo_path,
        logo_url: publicLogoUrl(logo_path),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

app.delete('/api/admin/branding/logo', requireAdmin, (_req, res) => {
  try {
    const prev = getSettingsMap(db).logo_path;
    upsertSetting(db, 'logo_path', '');
    if (prev) {
      const oldFile = path.join(UPLOADS_DIR, prev);
      if (fs.existsSync(oldFile)) {
        try { fs.unlinkSync(oldFile); } catch (_) {}
      }
    }
    res.json({ ok: true, logo_path: '', logo_url: '' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/payment/mmqr', requireAdmin, (req, res) => {
  uploadPayment.single('mmqr')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'MMQR ပုံတင်ရန် လိုအပ်သည်' });
      }
      const prev = getSettingsMap(db).mmqr_path;
      const mmqr_path = `payment/${req.file.filename}`;
      upsertSetting(db, 'mmqr_path', mmqr_path);
      if (prev && prev !== mmqr_path) {
        const oldFile = path.join(UPLOADS_DIR, prev);
        if (fs.existsSync(oldFile)) {
          try { fs.unlinkSync(oldFile); } catch (_) {}
        }
      }
      res.json({
        ok: true,
        mmqr_path,
        mmqr_url: publicUploadUrl(mmqr_path),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

app.delete('/api/admin/payment/mmqr', requireAdmin, (_req, res) => {
  try {
    const prev = getSettingsMap(db).mmqr_path;
    upsertSetting(db, 'mmqr_path', '');
    if (prev) {
      const oldFile = path.join(UPLOADS_DIR, prev);
      if (fs.existsSync(oldFile)) {
        try { fs.unlinkSync(oldFile); } catch (_) {}
      }
    }
    res.json({ ok: true, mmqr_path: '', mmqr_url: '' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Track order page
app.get('/track', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'track.html'));
});

// Admin SPA fallback
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});
app.get('/admin/*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});

// Error handler for multer etc.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

async function start() {
  if (!db) {
    console.log('Initializing sql.js fallback...');
    try {
      db = await initSqlJsDb();
      dbType = 'sql.js';
    } catch (e) {
      console.error('Failed to init database:', e);
      process.exit(1);
    }
  }

  createTables(db);
  migrateProductsColumns(db);
  migrateOrdersSpinCredits(db);
  seedIfEmpty(db);
  ensureDefaultSettings(db);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MM Shop listening on http://0.0.0.0:${PORT}`);
    console.log(`DATA_ROOT: ${DATA_ROOT}`);
    console.log(`Database: ${dbType} @ ${DB_PATH}`);
    const hasHash = !!getAdminPasswordHash(db);
    console.log(
      hasHash
        ? 'Admin password: using DB hash'
        : 'Admin password: (from ADMIN_PASSWORD env or default admin123)'
    );
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
