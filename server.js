'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');

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
const BANNERS_DIR = path.join(UPLOADS_DIR, 'banners');
const DB_PATH = path.join(DATA_DIR, 'shop.db');

[DATA_DIR, PRODUCTS_DIR, SLIPS_DIR, BRANDING_DIR, PAYMENT_DIR, BANNERS_DIR].forEach((d) => {
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
    transaction(fn) {
      const trx = database.transaction((...args) => fn(...args));
      return (...args) => trx(...args);
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
      stock INTEGER DEFAULT 99,
      is_spin_credit INTEGER DEFAULT 0,
      category TEXT DEFAULT 'other',
      authenticity TEXT DEFAULT 'authentic',
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
      spin_credits_locked INTEGER DEFAULT 0,
      spin_credits_granted_at TEXT,
      spin_completed INTEGER DEFAULT 0,
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
      is_special INTEGER DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      order_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_threads_phone ON chat_threads(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id);

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_categories_active_sort ON categories(active, sort_order, id);

    CREATE TABLE IF NOT EXISTS banner_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_path TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_banner_slides_active_sort ON banner_slides(active, sort_order, id);
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
  if (!cols.includes('stock')) {
    database.exec('ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 99');
  }
  if (!cols.includes('is_spin_credit')) {
    database.exec('ALTER TABLE products ADD COLUMN is_spin_credit INTEGER DEFAULT 0');
  }
  if (!cols.includes('category')) {
    database.exec("ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'other'");
  }
  if (!cols.includes('authenticity')) {
    database.exec("ALTER TABLE products ADD COLUMN authenticity TEXT DEFAULT 'authentic'");
  }
  // is_spin_credit items default to spin_game; leave explicit categories intact
  database.exec(
    `UPDATE products SET category = 'spin_game'
     WHERE COALESCE(is_spin_credit, 0) = 1
       AND (category IS NULL OR TRIM(category) = '' OR category = 'other')`
  );
}

const BUILTIN_CATEGORIES = [
  { slug: 'blind_box', name: 'Blind box', sort_order: 10, active: 1 },
  { slug: 'accessories', name: 'Accessories', sort_order: 20, active: 1 },
  { slug: 'spin_game', name: 'Game', sort_order: 30, active: 1 },
  // Placeholder only — hidden from product picker & public chips
  { slug: 'other', name: 'Other', sort_order: 40, active: 0 },
];
const PROTECTED_CATEGORY_SLUGS = new Set(['blind_box', 'spin_game']);
const KNOWN_FALLBACK_SLUGS = new Set(BUILTIN_CATEGORIES.map((c) => c.slug));

function slugifyCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 64);
}

function ensureUniqueCategorySlug(database, baseSlug, excludeId) {
  let base = slugifyCategory(baseSlug) || 'category';
  let n = 0;
  while (n < 10000) {
    const candidate = n === 0 ? base : base + '_' + n;
    const row = database.prepare('SELECT id FROM categories WHERE slug = ?').get(candidate);
    if (!row || (excludeId != null && Number(row.id) === Number(excludeId))) {
      return candidate;
    }
    n += 1;
  }
  return base + '_' + Date.now();
}

function seedCategories(database) {
  const find = database.prepare('SELECT id FROM categories WHERE slug = ?');
  const insert = database.prepare(
    `INSERT INTO categories (slug, name, active, sort_order) VALUES (?, ?, ?, ?)`
  );
  for (const cat of BUILTIN_CATEGORIES) {
    if (!find.get(cat.slug)) {
      const active = cat.active === undefined || cat.active === null ? 1 : Number(cat.active) ? 1 : 0;
      insert.run(cat.slug, cat.name, active, cat.sort_order);
    }
  }
  // Hide legacy placeholder from product picker / storefront chips
  database.prepare(`UPDATE categories SET active = 0 WHERE slug = 'other' AND active != 0`).run();
}

function categorySlugExists(database, slug) {
  if (!slug) return false;
  return !!database.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug);
}

function normalizeProductCategory(value, fallback = 'blind_box') {
  const s = slugifyCategory(value);
  if (!s) return fallback;
  try {
    if (db && categorySlugExists(db, s)) return s;
  } catch (_) {}
  if (KNOWN_FALLBACK_SLUGS.has(s)) return s;
  return fallback;
}

function categoryForProduct(input, isSpinCredit) {
  const spin = !!Number(isSpinCredit);
  const raw = input === undefined || input === null ? '' : String(input).trim();
  if (spin && !raw) return 'spin_game';
  const cat = normalizeProductCategory(raw, spin ? 'spin_game' : 'blind_box');
  if (spin && cat === 'other') return 'spin_game';
  return cat;
}

function normalizeAuthenticity(value, fallback = 'authentic') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const s = raw.toLowerCase();
  if (s === 'copy' || s === 'replica' || s === 'fake') return 'copy';
  if (s === 'authentic' || s === 'original' || s === 'auth' || s === 'မူရင်း') return 'authentic';
  // Custom authenticity label (Blind box Plus): store cleaned display string
  const cleaned = raw.replace(/[<>"'`\\]/g, '').slice(0, 64).trim();
  if (!cleaned) return fallback;
  return cleaned;
}

/** Spin prizes may only link to blind_box products. */
function assertSpinPrizeBlindBoxProduct(database, productId) {
  if (productId == null) return null;
  const prod = database
    .prepare('SELECT id, category, name FROM products WHERE id = ?')
    .get(productId);
  if (!prod) return { status: 400, error: 'ပစ္စည်း မတွေ့ပါ' };
  if (String(prod.category || '') !== 'blind_box') {
    return {
      status: 400,
      error: 'ဘီးဆုသည် Blind box ပစ္စည်းနှင့်သာ ချိတ်နိုင်သည်',
    };
  }
  return null;
}

function migrateOrdersSpinCredits(database) {
  const cols = database.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!cols.includes('spin_credits')) {
    database.exec('ALTER TABLE orders ADD COLUMN spin_credits INTEGER DEFAULT 0');
  }
  if (!cols.includes('spin_credits_locked')) {
    database.exec('ALTER TABLE orders ADD COLUMN spin_credits_locked INTEGER DEFAULT 0');
  }
  if (!cols.includes('spin_credits_granted_at')) {
    database.exec('ALTER TABLE orders ADD COLUMN spin_credits_granted_at TEXT');
  }
  if (!cols.includes('spin_completed')) {
    database.exec('ALTER TABLE orders ADD COLUMN spin_completed INTEGER DEFAULT 0');
  }
}

/** Backfill lock for orders that already had credits granted or spins played. */
function migrateOrdersSpinCreditsLockBackfill(database) {
  const cols = database.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!cols.includes('spin_credits_locked')) return;
  database.exec(`
    UPDATE orders SET
      spin_credits_locked = 1,
      spin_credits_granted_at = COALESCE(spin_credits_granted_at, datetime('now'))
    WHERE COALESCE(spin_credits_locked, 0) = 0
      AND (
        COALESCE(spin_credits, 0) > 0
        OR order_id IN (
          SELECT DISTINCT order_id FROM spin_plays
          WHERE order_id IS NOT NULL AND order_id != ''
        )
      )
  `);
}

function orderSpinCreditsLocked(order) {
  return !!(Number(order && order.spin_credits_locked) || (order && order.spin_credits_granted_at));
}

/** Had spins = grant lock/flag OR spin_plays > 0 (or currently holding credits after grant). */
function orderHadSpinCredits(database, order) {
  if (orderSpinCreditsLocked(order)) return true;
  if ((Number(order && order.spin_credits) || 0) > 0) return true;
  return getOrderSpinPlayCount(database, order.order_id) > 0;
}

function getOrderSpinCreditState(database, order) {
  const credits = Number(order && order.spin_credits) || 0;
  const locked = orderSpinCreditsLocked(order);
  const playCount = getOrderSpinPlayCount(database, order.order_id);
  const hadSpins = locked || playCount > 0 || credits > 0;
  // Expired only when remaining is 0 AND credits were previously granted/used
  const expired = credits === 0 && (locked || playCount > 0);
  return { credits, locked, expired, hadSpins, playCount };
}

function migrateSpinPlaysColumns(database) {
  const cols = database.prepare('PRAGMA table_info(spin_plays)').all().map((c) => c.name);
  if (!cols.length) return;
  if (!cols.includes('order_id')) {
    database.exec("ALTER TABLE spin_plays ADD COLUMN order_id TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('prize_id')) {
    database.exec('ALTER TABLE spin_plays ADD COLUMN prize_id INTEGER');
  }
  if (!cols.includes('prize_name')) {
    database.exec("ALTER TABLE spin_plays ADD COLUMN prize_name TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('created_at')) {
    database.exec("ALTER TABLE spin_plays ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  }
}

function migrateSpinPrizesSpecial(database) {
  const cols = database.prepare('PRAGMA table_info(spin_prizes)').all().map((c) => c.name);
  if (!cols.length) return;
  if (!cols.includes('is_special')) {
    database.exec('ALTER TABLE spin_prizes ADD COLUMN is_special INTEGER DEFAULT 0');
  }
}

const SPIN_CYCLE_SIZE = 15;

function parseIsSpecial(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === '0' || value === 0 || value === false || value === 'false' ? 0 : 1;
}

function pickUniformSpinPrize(prizes) {
  if (!prizes || !prizes.length) return null;
  return prizes[Math.floor(Math.random() * prizes.length)];
}

/** Count successful spins for one order (independent per buyer/order). */
function getOrderSpinPlayCount(database, orderId) {
  const row = database
    .prepare('SELECT COUNT(*) AS c FROM spin_plays WHERE order_id = ?')
    .get(orderId);
  return Number(row && row.c) || 0;
}

/** Public/buyer spin wins for one order: prize name, linked product, time. */
function listOrderSpinPlays(database, orderId) {
  const oid = String(orderId || '').trim();
  if (!oid) return [];
  return database
    .prepare(
      `SELECT
         sp.id,
         sp.prize_id,
         sp.prize_name,
         sp.created_at,
         spr.product_id AS product_id,
         p.name AS product_name
       FROM spin_plays sp
       LEFT JOIN spin_prizes spr ON spr.id = sp.prize_id
       LEFT JOIN products p ON p.id = spr.product_id
       WHERE sp.order_id = ?
       ORDER BY datetime(sp.created_at) DESC, sp.id DESC`
    )
    .all(oid)
    .map((r) => ({
      id: r.id,
      name: r.prize_name,
      prize_name: r.prize_name,
      prize_id: r.prize_id || null,
      product_id: r.product_id || null,
      product_name: r.product_name || null,
      created_at: r.created_at,
    }));
}

/**
 * Per-order 15-spin cycle: spins 15, 30, 45… use special pool; other spins use normal.
 * hit_every is kept in DB but ignored here (uniform random within chosen pool).
 */
function pickSpinPrizeForCycle(prizes, nextSpinNumber) {
  const specialPool = prizes.filter((p) => Number(p.is_special) === 1);
  const normalPool = prizes.filter((p) => Number(p.is_special) !== 1);
  const isSpecialSlot = nextSpinNumber % SPIN_CYCLE_SIZE === 0;
  let pool;
  let poolKind;
  if (isSpecialSlot) {
    if (specialPool.length) {
      pool = specialPool;
      poolKind = 'special';
    } else {
      pool = normalPool;
      poolKind = 'normal_fallback';
      console.warn(
        `[spin] order special slot #${nextSpinNumber} but no special prizes marked — falling back to normal pool`
      );
    }
  } else if (normalPool.length) {
    pool = normalPool;
    poolKind = 'normal';
  } else {
    pool = specialPool;
    poolKind = 'special_fallback';
    console.warn(
      `[spin] order normal slot #${nextSpinNumber} but no normal prizes — falling back to special pool`
    );
  }
  const won = pickUniformSpinPrize(pool);
  return { won, isSpecialSlot, poolKind, nextSpinNumber };
}

function getOrderSpinCycleProgress(database, orderId) {
  const count = getOrderSpinPlayCount(database, orderId);
  const next = count + 1;
  const pos = (count % SPIN_CYCLE_SIZE) + 1; // 1..15 position of next spin in this order's cycle
  return {
    spin_play_count: count,
    cycle_size: SPIN_CYCLE_SIZE,
    next_spin_number: next,
    next_in_cycle: pos,
    next_is_special: next % SPIN_CYCLE_SIZE === 0,
  };
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

function parseStock(value, fallback = 99) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(1000000, n);
}

function parseBoolFlag(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === '0' || value === 0 || value === false || value === 'false' ? 0 : 1;
}

const SPIN_ADDRESS_PLACEHOLDER = '—';

function isSpinAddressPlaceholder(value) {
  const s = String(value || '').trim();
  return !s || s === '-' || s === '—' || s === '–';
}

const SAMPLE_ASSET_DIR = '/assets/samples';

const BUILTIN_SAMPLES = [
  {
    slug: 'skullpanda',
    name: 'Skullpanda Blind Box',
    price: 45000,
    desc: 'လှပသော Skullpanda ဘလိုင်ဘောက်စ် — ကျပန်း ဒီဇိုင်း ရရှိမည်။',
    image_path: SAMPLE_ASSET_DIR + '/skullpanda.svg',
    on_banner: 1,
    discount_percent: 15,
    stock: 99,
    prize_name: 'Skullpanda Blind Box',
    is_special: 1,
    prize_sort: 1,
    category: 'blind_box',
  },
  {
    slug: 'nommi',
    name: 'Nommi Mini Figure',
    price: 38000,
    desc: 'Nommi မီနီ ရုပ်ပုံ — စုဆောင်းသူများအတွက် အထူး။',
    image_path: SAMPLE_ASSET_DIR + '/nommi.svg',
    on_banner: 0,
    discount_percent: 0,
    stock: 99,
    prize_name: 'Nommi Mini Figure',
    is_special: 0,
    prize_sort: 2,
    category: 'blind_box',
  },
  {
    slug: 'zootopia',
    name: 'Zootopia Collectible',
    price: 52000,
    desc: 'Zootopia စုဆောင်းပစ္စည်း — အရည်အသွေးမြင့် ပလပ်စတစ်။',
    image_path: SAMPLE_ASSET_DIR + '/zootopia.svg',
    on_banner: 0,
    discount_percent: 0,
    stock: 99,
    prize_name: 'Zootopia Collectible',
    is_special: 0,
    prize_sort: 3,
    category: 'blind_box',
  },
  {
    slug: 'spin-chance',
    name: 'စပင်ဘီး ကံစမ်းခွင့် (၁ ကြိမ်)',
    price: 5000,
    desc: 'ငွေလွှဲပြီး စလစ်ပုံတင်ကာ အော်ဒါတင်ပါ။ Admin က အတည်ပြုပြီးနောက် ကံစမ်းခွင့် (၁ ကြိမ်) ထည့်ပေးမည်။',
    image_path: SAMPLE_ASSET_DIR + '/spin-chance.svg',
    on_banner: 0,
    discount_percent: 0,
    stock: 99,
    active: 0,
    is_spin_credit: 1,
    category: 'spin_game',
  },
];

function sampleLegacyImagePaths(sample) {
  const file = sample.slug + '.svg';
  return [
    'products/' + file,
    '/uploads/products/' + file,
    'uploads/products/' + file,
  ];
}

function isSampleImagePath(current, sample) {
  const p = String(current || '').trim();
  if (!p) return true;
  if (p === sample.image_path) return true;
  return sampleLegacyImagePaths(sample).includes(p);
}

/**
 * Idempotent built-in catalog. Ensures the 3 demo products + linked spin
 * prizes + a buy-spin-chance product exist after an empty/wiped DB
 * (e.g. free Render). Never deletes admin-added rows or orders.
 * Admin may still edit or delete samples.
 */
function seedBuiltins(database) {
  const findProductByName = database.prepare('SELECT * FROM products WHERE name = ?');
  const insertProduct = database.prepare(
    `INSERT INTO products (name, price_mmk, description, image_path, active, on_banner, discount_percent, stock, is_spin_credit, category, authenticity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateProductActive = database.prepare(
    `UPDATE products SET active = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const updateProductImage = database.prepare(
    `UPDATE products SET image_path = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const updateSpinCreditFlag = database.prepare(
    `UPDATE products SET is_spin_credit = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const updateProductCategory = database.prepare(
    `UPDATE products SET category = ?, updated_at = datetime('now') WHERE id = ?`
  );
  const findPrizeByProduct = database.prepare(
    'SELECT * FROM spin_prizes WHERE product_id = ? LIMIT 1'
  );
  const findPrizeByName = database.prepare(
    'SELECT * FROM spin_prizes WHERE name = ? LIMIT 1'
  );
  const insertPrize = database.prepare(
    `INSERT INTO spin_prizes (name, product_id, hit_every, is_special, active, sort_order)
     VALUES (?, ?, 1, ?, 1, ?)`
  );
  const linkPrizeProduct = database.prepare(
    'UPDATE spin_prizes SET product_id = ? WHERE id = ?'
  );

  const productIds = {};
  let addedProducts = 0;
  let fixedImages = 0;
  let addedPrizes = 0;

  for (const sample of BUILTIN_SAMPLES) {
    let row = findProductByName.get(sample.name);
    if (!row) {
      const wantActive = sample.active === 0 ? 0 : 1;
      const result = insertProduct.run(
        sample.name,
        sample.price,
        sample.desc,
        sample.image_path,
        wantActive,
        sample.on_banner,
        sample.discount_percent,
        sample.stock != null ? sample.stock : 99,
        sample.is_spin_credit ? 1 : 0,
        categoryForProduct(sample.category, sample.is_spin_credit),
        normalizeAuthenticity(sample.authenticity, 'authentic')
      );
      row = {
        id: result.lastInsertRowid,
        image_path: sample.image_path,
        active: wantActive,
        is_spin_credit: sample.is_spin_credit ? 1 : 0,
        category: categoryForProduct(sample.category, sample.is_spin_credit),
      };
      addedProducts += 1;
    } else if (isSampleImagePath(row.image_path, sample) && String(row.image_path || '') !== sample.image_path) {
      updateProductImage.run(sample.image_path, row.id);
      fixedImages += 1;
    }
    const wantSpinCredit = sample.is_spin_credit ? 1 : 0;
    if (Number(row.is_spin_credit || 0) !== wantSpinCredit && sample.is_spin_credit) {
      updateSpinCreditFlag.run(wantSpinCredit, row.id);
      row.is_spin_credit = wantSpinCredit;
    }
    // Keep seeded buy-spin off the public grid (active=0) while purchase API still finds it.
    if (sample.is_spin_credit && sample.active === 0 && Number(row.active) !== 0) {
      updateProductActive.run(0, row.id);
      row.active = 0;
    }
    const wantCat = categoryForProduct(sample.category, wantSpinCredit);
    const currentCat = String(row.category || '').trim();
    const shouldSetCat =
      !currentCat ||
      currentCat === 'other' ||
      (wantSpinCredit && currentCat !== 'spin_game');
    if (shouldSetCat && currentCat !== wantCat) {
      updateProductCategory.run(wantCat, row.id);
      row.category = wantCat;
    }
    productIds[sample.slug] = row.id;
  }

  for (const sample of BUILTIN_SAMPLES) {
    if (!sample.prize_name) continue;
    const pid = productIds[sample.slug];
    let prize = findPrizeByProduct.get(pid);
    if (!prize) prize = findPrizeByName.get(sample.prize_name);
    if (!prize) {
      insertPrize.run(sample.prize_name, pid, sample.is_special, sample.prize_sort);
      addedPrizes += 1;
    } else if ((prize.product_id == null || prize.product_id === '') && pid) {
      linkPrizeProduct.run(pid, prize.id);
    }
  }

  if (addedProducts || addedPrizes || fixedImages) {
    console.log(
      `Built-in samples: +${addedProducts} products, +${addedPrizes} prizes, ${fixedImages} image path(s) updated.`
    );
  }
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
    transaction(fn) {
      return (...args) => {
        try {
          database.run('BEGIN');
          const result = fn(...args);
          database.run('COMMIT');
          persist();
          return result;
        } catch (e) {
          try {
            database.run('ROLLBACK');
          } catch (_) {}
          try {
            persist();
          } catch (_) {}
          throw e;
        }
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
  // Remove obsolete global counter if present (cycle is per-order via spin_plays)
  try {
    database.prepare("DELETE FROM settings WHERE key = 'global_spin_count'").run();
  } catch (_) {}
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
  database.prepare('DELETE FROM spin_plays WHERE order_id = ?').run(orderId);
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
const uploadBanner = makeUploader(BANNERS_DIR);

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


/** Buy-spin catalog row (may be inactive so it stays off the storefront grid). */
function findSpinCreditProduct(database) {
  return (
    database
      .prepare(
        `SELECT id, name, price_mmk, stock, active, is_spin_credit
         FROM products
         WHERE COALESCE(is_spin_credit, 0) = 1
         ORDER BY id ASC
         LIMIT 1`
      )
      .get() || null
  );
}

function orderHasSpinCreditItems(database, orderId) {
  const rows = database
    .prepare(
      `SELECT COUNT(*) AS c
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?
         AND COALESCE(p.is_spin_credit, 0) = 1`
    )
    .get(orderId);
  return (Number(rows && rows.c) || 0) > 0;
}

function orderIsSpinRelated(database, order) {
  if (!order) return false;
  if (orderHadSpinCredits(database, order)) return true;
  if (Number(order.spin_completed) === 1) return true;
  return orderHasSpinCreditItems(database, order.order_id);
}

function formatOrder(row, items) {
  const spin = getOrderSpinCreditState(db, row);
  const spinRelated = orderIsSpinRelated(db, row);
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
    spin_credits: spin.credits,
    spin_credits_locked: spin.locked ? 1 : 0,
    spin_credits_granted_at: row.spin_credits_granted_at || null,
    spin_expired: spin.expired,
    spin_locked: spin.locked,
    spin_completed: Number(row.spin_completed) === 1 ? 1 : 0,
    is_spin_order: spinRelated,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: items || [],
  };
}

// ========== PUBLIC API ==========

app.get('/api/products', (_req, res) => {
  const products = db
    .prepare(
      `SELECT id, name, price_mmk, description, image_path, active, on_banner, discount_percent, stock, is_spin_credit, category, authenticity
       FROM products
       WHERE active = 1 AND COALESCE(is_spin_credit, 0) = 0
       ORDER BY id DESC`
    )
    .all();
  res.json(products);
});

app.get('/api/categories', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, slug, name, active, sort_order, created_at
       FROM categories
       WHERE active = 1 AND slug != 'other'
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json(rows);
});

app.get('/api/banner-slides', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, image_path, active, sort_order, created_at
       FROM banner_slides
       WHERE active = 1
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json(rows);
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
      const nameVal = String(customer_name || '').trim();
      const phoneVal = String(phone || '').trim();
      let addressVal = String(address || '').trim();
      if (!nameVal || !phoneVal) {
        return res.status(400).json({ error: 'အမည်နှင့် ဖုန်း လိုအပ်သည်' });
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

      const qtyByProduct = new Map();
      for (const it of parsedItems) {
        const pid = parseInt(it.product_id, 10);
        if (!Number.isFinite(pid)) {
          return res.status(400).json({ error: 'Invalid product' });
        }
        const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
        qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + qty);
      }

      const orderId = 'MM' + Date.now().toString(36).toUpperCase() + uuidv4().slice(0, 4).toUpperCase();
      const slipPath = `slips/${req.file.filename}`;
      const notesVal = notes ? String(notes).trim() : '';

      let total = 0;
      let lineItems = [];
      try {
        const created = db.transaction(() => {
          total = 0;
          lineItems = [];
          for (const [pid, qty] of qtyByProduct.entries()) {
            const product = db
              .prepare(
                'SELECT id, name, price_mmk, active, stock, is_spin_credit FROM products WHERE id = ?'
              )
              .get(pid);
            if (!product) {
              const err = new Error(`ပစ္စည်း မရရှိနိုင်ပါ (id=${pid})`);
              err.status = 400;
              throw err;
            }
            const isSpinCredit = !!Number(product.is_spin_credit);
            // Spin-credit buy item may be catalog-hidden (active=0) but still purchasable.
            if (!product.active && !isSpinCredit) {
              const err = new Error(`ပစ္စည်း မရရှိနိုင်ပါ (id=${pid})`);
              err.status = 400;
              throw err;
            }
            const available = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
            if (available < qty) {
              const err = new Error(
                `${product.name} စတော့ မလောက်ပါ (ကျန် ${available})`
              );
              err.status = 400;
              throw err;
            }
            const dec = db
              .prepare(
                `UPDATE products SET stock = stock - ?, updated_at = datetime('now')
                 WHERE id = ? AND stock >= ?`
              )
              .run(qty, product.id, qty);
            if (!dec.changes) {
              const err = new Error(`${product.name} စတော့ မလောက်ပါ`);
              err.status = 400;
              throw err;
            }
            total += product.price_mmk * qty;
            lineItems.push({
              product_id: product.id,
              product_name: product.name,
              unit_price_mmk: product.price_mmk,
              quantity: qty,
            });
          }

          // Spin-credit carts also need a real delivery address for shipping won prizes.
          if (!addressVal || isSpinAddressPlaceholder(addressVal)) {
            const err = new Error('အမည်၊ ဖုန်းနှင့် လိပ်စာ လိုအပ်သည်');
            err.status = 400;
            throw err;
          }

          db.prepare(
            `INSERT INTO orders (order_id, customer_name, phone, address, notes, total_mmk, status, slip_path)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
          ).run(orderId, nameVal, phoneVal, addressVal, notesVal, total, slipPath);

          const itemIns = db.prepare(
            `INSERT INTO order_items (order_id, product_id, product_name, unit_price_mmk, quantity)
             VALUES (?, ?, ?, ?, ?)`
          );
          for (const li of lineItems) {
            itemIns.run(orderId, li.product_id, li.product_name, li.unit_price_mmk, li.quantity);
          }
          return { orderId, total };
        })();
        res.json({ ok: true, order_id: created.orderId, total_mmk: created.total });
      } catch (e) {
        if (e && e.status === 400) {
          return res.status(400).json({ error: e.message });
        }
        throw e;
      }
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

function findChatThreadByPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  const exact = db.prepare('SELECT * FROM chat_threads WHERE customer_phone = ?').get(p);
  if (exact) return exact;
  const all = db.prepare('SELECT * FROM chat_threads').all();
  return all.find((t) => normalizePhone(t.customer_phone) === p) || null;
}

function getChatThreadById(id) {
  const tid = parseInt(id, 10);
  if (!Number.isFinite(tid)) return null;
  return db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(tid) || null;
}

function phoneMatchesThread(thread, phone) {
  return !!(thread && normalizePhone(thread.customer_phone) === normalizePhone(phone));
}

function clampChatBody(body) {
  const s = String(body || '').trim();
  if (!s) return '';
  return s.slice(0, 2000);
}

function formatChatThread(row, extras) {
  return Object.assign(
    {
      id: row.id,
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      order_id: row.order_id || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: row.status || 'open',
    },
    extras || {}
  );
}

function formatChatMessage(row) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    sender: row.sender,
    body: row.body,
    created_at: row.created_at,
  };
}

function listChatMessages(threadId) {
  return db
    .prepare(
      `SELECT id, thread_id, sender, body, created_at
       FROM chat_messages WHERE thread_id = ? ORDER BY id ASC`
    )
    .all(threadId)
    .map(formatChatMessage);
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

    const spin = getOrderSpinCreditState(db, order);
    const spinRelated = orderIsSpinRelated(db, order);
    res.json({
      order_id: order.order_id,
      status: order.status,
      total_mmk: order.total_mmk,
      created_at: order.created_at,
      slip_received: !!(order.slip_path && String(order.slip_path).trim()),
      spin_credits: spin.credits,
      spin_expired: spin.expired,
      spin_locked: spin.locked,
      spin_completed: Number(order.spin_completed) === 1 ? 1 : 0,
      is_spin_order: spinRelated,
      spin_plays: listOrderSpinPlays(db, order.order_id),
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

// ========== PUBLIC CUSTOMER CHAT ==========

app.post('/api/chat/threads', (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.customer_name || body.name || '').trim();
    const phone = normalizePhone(body.customer_phone || body.phone || '');
    const rawOrder = body.order_id !== undefined ? body.order_id : body.orderId;
    const orderId = rawOrder === undefined || rawOrder === null ? undefined : String(rawOrder).trim() || null;

    if (!name || !phone) {
      return res.status(400).json({ error: 'အမည်နှင့် ဖုန်းနံပါတ် လိုအပ်သည်' });
    }
    if (name.length > 80) {
      return res.status(400).json({ error: 'အမည် တိုတောင်းရမည်' });
    }
    if (phone.length < 6 || phone.length > 20) {
      return res.status(400).json({ error: 'ဖုန်းနံပါတ် မှားနေသည်' });
    }

    let thread = findChatThreadByPhone(phone);
    if (thread) {
      const nextOrder = orderId !== undefined ? orderId : thread.order_id;
      db.prepare(
        `UPDATE chat_threads
         SET customer_name = ?, customer_phone = ?, order_id = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(name, phone, nextOrder, thread.id);
      thread = getChatThreadById(thread.id);
    } else {
      const result = db
        .prepare(
          `INSERT INTO chat_threads (customer_name, customer_phone, order_id, status)
           VALUES (?, ?, ?, 'open')`
        )
        .run(name, phone, orderId === undefined ? null : orderId);
      thread = getChatThreadById(result.lastInsertRowid);
    }
    res.json(formatChatThread(thread));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/chat/threads/:id/messages', (req, res) => {
  try {
    const thread = getChatThreadById(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ချတ် မတွေ့ပါ' });
    const phone = req.query.phone || '';
    if (!phoneMatchesThread(thread, phone)) {
      return res.status(403).json({ error: 'ဖုန်းနံပါတ် မကိုက်ညီပါ' });
    }
    res.json({
      thread: formatChatThread(thread),
      messages: listChatMessages(thread.id),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/chat/threads/:id/messages', (req, res) => {
  try {
    const thread = getChatThreadById(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ချတ် မတွေ့ပါ' });
    const body = req.body || {};
    if (!phoneMatchesThread(thread, body.phone || '')) {
      return res.status(403).json({ error: 'ဖုန်းနံပါတ် မကိုက်ညီပါ' });
    }
    const text = clampChatBody(body.body);
    if (!text) return res.status(400).json({ error: 'မက်ဆေ့ချ် ရိုက်ထည့်ပါ' });

    const result = db
      .prepare(`INSERT INTO chat_messages (thread_id, sender, body) VALUES (?, 'customer', ?)`)
      .run(thread.id, text);
    db.prepare(
      `UPDATE chat_threads SET updated_at = datetime('now'), status = 'open' WHERE id = ?`
    ).run(thread.id);
    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid);
    res.json(formatChatMessage(msg));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});



// ========== PUBLIC SPIN WHEEL ==========

function clampHitEvery(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(1000000, n);
}

// Legacy weighted picker kept for reference; 15-cycle mode uses pickUniformSpinPrize.
function pickWeightedSpinPrize(prizes) {
  // weight = 1/hit_every, then normalize — NOT used when global 15-cycle is active
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


function findSpinPrizeByProductId(database, productId, exceptPrizeId) {
  if (productId == null || productId === '') return null;
  const pid = Number(productId);
  if (!Number.isFinite(pid)) return null;
  if (exceptPrizeId != null) {
    return database
      .prepare('SELECT id, name FROM spin_prizes WHERE product_id = ? AND id != ? LIMIT 1')
      .get(pid, exceptPrizeId);
  }
  return database
    .prepare('SELECT id, name FROM spin_prizes WHERE product_id = ? LIMIT 1')
    .get(pid);
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
    is_special: Number(row.is_special) ? 1 : 0,
    active: row.active,
    sort_order: row.sort_order,
    created_at: row.created_at,
    product_name: row.product_name || null,
  };
}


app.get('/api/spin/product', (_req, res) => {
  try {
    const product = findSpinCreditProduct(db);
    if (!product) {
      return res.status(404).json({ error: 'ကံစမ်းခွင့် ပစ္စည်း မရှိသေးပါ' });
    }
    res.json({
      id: product.id,
      name: product.name,
      price_mmk: product.price_mmk,
      stock: Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/spin/purchase', (req, res) => {
  uploadSlip.single('slip')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    try {
      const nameVal = String(req.body.name || req.body.customer_name || '').trim();
      const phoneVal = String(req.body.phone || '').trim();
      let qty = parseInt(req.body.qty != null ? req.body.qty : req.body.quantity, 10);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;
      qty = Math.min(99, qty);

      const addressVal = String(req.body.address || '').trim();
      if (!nameVal || !phoneVal || !addressVal || isSpinAddressPlaceholder(addressVal)) {
        return res.status(400).json({ error: 'အမည်၊ ဖုန်းနှင့် လိပ်စာ လိုအပ်သည်' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'ငွေလွှဲစလစ် ပုံတင်ရန် လိုအပ်သည်' });
      }

      const product = findSpinCreditProduct(db);
      if (!product) {
        return res.status(400).json({ error: 'ကံစမ်းခွင့် ပစ္စည်း မရရှိနိုင်ပါ' });
      }

      const orderId =
        'MM' + Date.now().toString(36).toUpperCase() + uuidv4().slice(0, 4).toUpperCase();
      const slipPath = `slips/${req.file.filename}`;

      try {
        const created = db.transaction(() => {
          const fresh = db
            .prepare(
              'SELECT id, name, price_mmk, active, stock, is_spin_credit FROM products WHERE id = ?'
            )
            .get(product.id);
          if (!fresh || !Number(fresh.is_spin_credit)) {
            const e = new Error('ကံစမ်းခွင့် ပစ္စည်း မရရှိနိုင်ပါ');
            e.status = 400;
            throw e;
          }
          const available = Number.isFinite(Number(fresh.stock)) ? Number(fresh.stock) : 0;
          if (available < qty) {
            const e = new Error(`${fresh.name} စတော့ မလောက်ပါ (ကျန် ${available})`);
            e.status = 400;
            throw e;
          }
          const dec = db
            .prepare(
              `UPDATE products SET stock = stock - ?, updated_at = datetime('now')
               WHERE id = ? AND stock >= ?`
            )
            .run(qty, fresh.id, qty);
          if (!dec.changes) {
            const e = new Error(`${fresh.name} စတော့ မလောက်ပါ`);
            e.status = 400;
            throw e;
          }
          const total = fresh.price_mmk * qty;
          db.prepare(
            `INSERT INTO orders (order_id, customer_name, phone, address, notes, total_mmk, status, slip_path)
             VALUES (?, ?, ?, ?, '', ?, 'pending', ?)`
          ).run(orderId, nameVal, phoneVal, addressVal, total, slipPath);
          db.prepare(
            `INSERT INTO order_items (order_id, product_id, product_name, unit_price_mmk, quantity)
             VALUES (?, ?, ?, ?, ?)`
          ).run(orderId, fresh.id, fresh.name, fresh.price_mmk, qty);
          return { orderId, total_mmk: total, quantity: qty };
        })();
        res.json({
          ok: true,
          orderId: created.orderId,
          order_id: created.orderId,
          total_mmk: created.total_mmk,
          quantity: created.quantity,
        });
      } catch (e) {
        if (e && e.status === 400) {
          return res.status(400).json({ error: e.message });
        }
        throw e;
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

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

function findOrderForSpin(orderId) {
  const oid = String(orderId || '').trim();
  if (!oid) return null;
  return db.prepare('SELECT * FROM orders WHERE order_id = ?').get(oid) || null;
}

function isBlankField(value) {
  return !value || !String(value).trim();
}

function orderHasFullContact(order) {
  // New purchases require a real address; legacy spin orders may still have "—".
  // Unlock remains order-id based — name + phone (+ any address incl. placeholder) suffice.
  return (
    !!order &&
    !isBlankField(order.customer_name) &&
    !isBlankField(order.phone) &&
    (!isBlankField(order.address) || isSpinAddressPlaceholder(order.address))
  );
}

const CONTACT_INCOMPLETE_MSG =
  'အော်ဒါတွင် အမည်နှင့် ဖုန်း ပြည့်စုံရမည် — ဆက်သွယ်ရန် အချက်အလက် ဖြည့်ပါ';

function rejectIfIncompleteContact(order, res) {
  if (orderHasFullContact(order)) return false;
  res.status(400).json({
    error: CONTACT_INCOMPLETE_MSG,
    code: 'missing_contact',
  });
  return true;
}

function spinRequestOrderId(req) {
  const src = req.method === 'GET' ? req.query || {} : req.body || {};
  return src.orderId || src.order_id || '';
}

function spinUnlockHandler(req, res) {
  try {
    const orderId = spinRequestOrderId(req);
    const order = findOrderForSpin(orderId);
    if (!order) {
      return res.status(404).json({ error: 'အော်ဒါ မတွေ့ပါ — အော်ဒါနံပါတ် စစ်ပါ' });
    }
    if (rejectIfIncompleteContact(order, res)) return;
    const spin = getOrderSpinCreditState(db, order);
    const cycle = getOrderSpinCycleProgress(db, order.order_id);
    res.json({
      ok: true,
      orderId: order.order_id,
      credits: spin.credits,
      expired: spin.expired,
      locked: spin.locked,
      spinCredits: spin.credits,
      spinCycle: cycle,
      spin_completed: Number(order.spin_completed) === 1 ? 1 : 0,
      spinCompleted: Number(order.spin_completed) === 1,
      is_spin_order: orderIsSpinRelated(db, order),
      spin_plays: listOrderSpinPlays(db, order.order_id),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}

app.get('/api/spin/credits', spinUnlockHandler);
app.get('/api/spin/unlock', spinUnlockHandler);
app.post('/api/spin/unlock', spinUnlockHandler);

app.post('/api/spin', (req, res) => {
  try {
    const orderId = (req.body && (req.body.orderId || req.body.order_id)) || '';
    const order = findOrderForSpin(orderId);
    if (!order) {
      return res.status(404).json({ error: 'အော်ဒါ မတွေ့ပါ — အော်ဒါနံပါတ် စစ်ပါ' });
    }
    if (rejectIfIncompleteContact(order, res)) return;
    const spin = getOrderSpinCreditState(db, order);
    if (spin.credits < 1) {
      return res.status(403).json({
        error: spin.expired
          ? 'သက်တမ်းကုန်ဆုံး — ကံစမ်းခွင့် အားလုံး အသုံးပြုပြီးပါပြီ'
          : 'ကံစမ်းခွင့် မရှိပါ — Admin က အခွင့်ထည့်ပေးမှ လှည့်နိုင်သည်',
        credits: 0,
        expired: spin.expired,
        locked: spin.locked,
        spinCredits: 0,
      });
    }

    const prizes = db
      .prepare(
        `SELECT id, name, product_id, hit_every, is_special
         FROM spin_prizes
         WHERE active = 1
         ORDER BY sort_order ASC, id ASC`
      )
      .all();
    if (!prizes.length) {
      return res.status(400).json({ error: 'စပင်ဘီး ဆုများ မရှိသေးပါ' });
    }

    // Per-order cycle: count this order's past plays (independent of other buyers)
    const nextSpinNumber = getOrderSpinPlayCount(db, order.order_id) + 1;
    const pick = pickSpinPrizeForCycle(prizes, nextSpinNumber);
    if (!pick.won) {
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
      const again = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order.order_id);
      const st = getOrderSpinCreditState(db, again || order);
      return res.status(403).json({
        error: st.expired
          ? 'သက်တမ်းကုန်ဆုံး — ကံစမ်းခွင့် အားလုံး အသုံးပြုပြီးပါပြီ'
          : 'ကံစမ်းခွင့် မရှိပါ',
        credits: st.credits,
        expired: st.expired,
        locked: st.locked,
        spinCredits: st.credits,
      });
    }

    const won = pick.won;
    db.prepare(
      `INSERT INTO spin_plays (order_id, prize_id, prize_name) VALUES (?, ?, ?)`
    ).run(order.order_id, won.id, won.name);

    const leftRow = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order.order_id);
    const leftState = getOrderSpinCreditState(db, leftRow || { ...order, spin_credits: 0 });

    const leftOrder = leftRow || { ...order, spin_credits: 0 };
    res.json({
      prizeId: won.id,
      name: won.name,
      productId: won.product_id || null,
      credits: leftState.credits,
      expired: leftState.expired,
      locked: leftState.locked,
      spinCredits: leftState.credits,
      isSpecialSlot: pick.isSpecialSlot,
      spinNumber: nextSpinNumber,
      nextInCycle: (nextSpinNumber % SPIN_CYCLE_SIZE) || SPIN_CYCLE_SIZE,
      spin_completed: Number(leftOrder.spin_completed) === 1 ? 1 : 0,
      spinCompleted: Number(leftOrder.spin_completed) === 1,
      spin_plays: listOrderSpinPlays(db, order.order_id),
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

app.get('/api/admin/categories', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, slug, name, active, sort_order, created_at,
        (SELECT COUNT(*) FROM products p WHERE p.category = categories.slug) AS product_count
       FROM categories
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json(rows);
});

app.post('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const active = req.body.active === undefined || req.body.active === null
      ? 1
      : Number(req.body.active) ? 1 : 0;
    let sort_order = Number(req.body.sort_order);
    if (!Number.isFinite(sort_order)) {
      const maxRow = db.prepare('SELECT MAX(sort_order) AS m FROM categories').get();
      sort_order = (maxRow && Number.isFinite(Number(maxRow.m)) ? Number(maxRow.m) : 0) + 10;
    }
    let slug = slugifyCategory(req.body.slug || name);
    if (!slug) slug = 'category';
    slug = ensureUniqueCategorySlug(db, slug, null);
    const result = db
      .prepare(
        `INSERT INTO categories (slug, name, active, sort_order) VALUES (?, ?, ?, ?)`
      )
      .run(slug, name, active, sort_order);
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create category' });
  }
});

app.put('/api/admin/categories/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const name =
      req.body.name === undefined || req.body.name === null
        ? existing.name
        : String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const active =
      req.body.active === undefined || req.body.active === null
        ? Number(existing.active) ? 1 : 0
        : Number(req.body.active) ? 1 : 0;

    let sort_order =
      req.body.sort_order === undefined || req.body.sort_order === null
        ? Number(existing.sort_order) || 0
        : Number(req.body.sort_order);
    if (!Number.isFinite(sort_order)) sort_order = Number(existing.sort_order) || 0;

    let slug = existing.slug;
    if (req.body.slug !== undefined && req.body.slug !== null && String(req.body.slug).trim()) {
      if (PROTECTED_CATEGORY_SLUGS.has(existing.slug)) {
        // Protected built-ins keep their slug
        slug = existing.slug;
      } else {
        slug = ensureUniqueCategorySlug(db, req.body.slug, id);
      }
    }

    const oldSlug = existing.slug;
    db.prepare(
      `UPDATE categories SET slug = ?, name = ?, active = ?, sort_order = ? WHERE id = ?`
    ).run(slug, name, active, sort_order, id);

    if (slug !== oldSlug) {
      db.prepare(`UPDATE products SET category = ? WHERE category = ?`).run(slug, oldSlug);
    }

    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to update category' });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    if (PROTECTED_CATEGORY_SLUGS.has(existing.slug)) {
      return res.status(400).json({
        error: 'Cannot delete built-in category "' + existing.slug + '"',
      });
    }
    const countRow = db
      .prepare('SELECT COUNT(*) AS c FROM products WHERE category = ?')
      .get(existing.slug);
    const count = countRow ? Number(countRow.c) : 0;
    if (count > 0) {
      return res.status(409).json({
        error: 'Category has products; move products to another category first',
        product_count: count,
      });
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.json({ ok: true, deleted: existing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to delete category' });
  }
});

app.get('/api/admin/products', requireAdmin, (_req, res) => {
  const products = db
    .prepare(
      `SELECT id, name, price_mmk, description, image_path, active, on_banner, discount_percent, stock, is_spin_credit, category, authenticity, created_at, updated_at
       FROM products ORDER BY id DESC`
    )
    .all();
  res.json(products);
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  uploadProduct.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const { name, price_mmk, description, active, on_banner, discount_percent, stock, is_spin_credit, category, authenticity } = req.body;
      if (!name || price_mmk === undefined) {
        return res.status(400).json({ error: 'name and price required' });
      }
      const image_path = req.file ? `products/${req.file.filename}` : '';
      const isActive = active === '0' || active === 0 || active === false ? 0 : 1;
      const isBanner = parseOnBanner(on_banner, 0);
      const discount = clampDiscountPercent(discount_percent);
      const stockVal = parseStock(stock, 99);
      const spinCredit = parseBoolFlag(is_spin_credit, 0);
      const cat = categoryForProduct(category, spinCredit);
      const auth = normalizeAuthenticity(authenticity, 'authentic');
      const result = db
        .prepare(
          `INSERT INTO products (name, price_mmk, description, image_path, active, on_banner, discount_percent, stock, is_spin_credit, category, authenticity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(name).trim(),
          parseInt(price_mmk, 10) || 0,
          description ? String(description) : '',
          image_path,
          isActive,
          isBanner,
          discount,
          stockVal,
          spinCredit,
          cat,
          auth
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

      const { name, price_mmk, description, active, on_banner, discount_percent, stock, is_spin_credit, category, authenticity } = req.body;
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
      const stockVal =
        stock === undefined || stock === null || stock === ''
          ? (Number.isFinite(Number(existing.stock)) ? Number(existing.stock) : 99)
          : parseStock(stock, 0);
      const spinCredit =
        is_spin_credit === undefined
          ? (Number(existing.is_spin_credit) ? 1 : 0)
          : parseBoolFlag(is_spin_credit, 0);
      const cat =
        category === undefined
          ? categoryForProduct(existing.category, spinCredit)
          : categoryForProduct(category, spinCredit);
      const auth =
        authenticity === undefined
          ? normalizeAuthenticity(existing.authenticity, 'authentic')
          : normalizeAuthenticity(authenticity, 'authentic');

      db.prepare(
        `UPDATE products SET name = ?, price_mmk = ?, description = ?, image_path = ?,
         active = ?, on_banner = ?, discount_percent = ?, stock = ?, is_spin_credit = ?, category = ?, authenticity = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        name !== undefined ? String(name).trim() : existing.name,
        price_mmk !== undefined ? parseInt(price_mmk, 10) || 0 : existing.price_mmk,
        description !== undefined ? String(description) : existing.description,
        image_path,
        isActive,
        isBanner,
        discount,
        stockVal,
        spinCredit,
        cat,
        auth,
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
  // Keep admin delete working when a spin prize is linked (samples included).
  db.prepare('UPDATE spin_prizes SET product_id = NULL WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.patch('/api/admin/products/:id/stock', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    let next;
    if (body.delta !== undefined && body.delta !== null && body.delta !== '') {
      const delta = parseInt(body.delta, 10);
      if (!Number.isFinite(delta)) {
        return res.status(400).json({ error: 'Invalid delta' });
      }
      const cur = Number.isFinite(Number(existing.stock)) ? Number(existing.stock) : 0;
      next = Math.max(0, Math.min(1000000, cur + delta));
    } else if (body.stock !== undefined && body.stock !== null && body.stock !== '') {
      next = parseStock(body.stock, 0);
    } else {
      return res.status(400).json({ error: 'stock or delta required' });
    }
    db.prepare(
      `UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(next, id);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// ========== ADMIN REPORTS (Asia/Yangon calendar) ==========
// SQLite datetime('now') stores UTC. Filter by converting to Yangon (+06:30).
const YANGON_SQL_MODS = "'+6 hours', '+30 minutes'";

const REPORT_STATUS_LABEL = {
  pending: 'စောင့်ဆိုင်း',
  paid_confirmed: 'ငွေအတည်ပြု',
  shipped: 'ပို့ပြီး',
  cancelled: 'ပယ်ဖျက်',
};

function yangonParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA => YYYY-MM-DD
  const ymd = fmt.format(d);
  const [y, m, day] = ymd.split('-');
  return { ymd, y, m, day, year: y, month: `${y}-${m}` };
}

function parseReportPeriodDate(query) {
  const period = String((query && query.period) || 'day').toLowerCase();
  if (!['day', 'month', 'year'].includes(period)) {
    return { error: 'period သည် day | month | year ဖြစ်ရမည်' };
  }
  const now = yangonParts();
  let date = String((query && query.date) || '').trim();
  if (!date) {
    if (period === 'day') date = now.ymd;
    else if (period === 'month') date = now.month;
    else date = now.year;
  }
  if (period === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'date သည် YYYY-MM-DD ဖြစ်ရမည်' };
  }
  if (period === 'month' && !/^\d{4}-\d{2}$/.test(date)) {
    return { error: 'date သည် YYYY-MM ဖြစ်ရမည်' };
  }
  if (period === 'year' && !/^\d{4}$/.test(date)) {
    return { error: 'date သည် YYYY ဖြစ်ရမည်' };
  }
  let whereSql;
  if (period === 'day') {
    whereSql = `date(COL, ${YANGON_SQL_MODS}) = ?`;
  } else if (period === 'month') {
    whereSql = `strftime('%Y-%m', COL, ${YANGON_SQL_MODS}) = ?`;
  } else {
    whereSql = `strftime('%Y', COL, ${YANGON_SQL_MODS}) = ?`;
  }
  const periodLabel =
    period === 'day' ? 'နေ့' : period === 'month' ? 'လ' : 'နှစ်';
  return { period, date, whereSql, periodLabel };
}

function itemsSummary(items) {
  if (!items || !items.length) return '';
  return items
    .map((it) => `${it.product_name || 'item'} x${Number(it.quantity) || 0}`)
    .join(', ');
}

function querySalesReportRows(database, periodInfo) {
  const where = periodInfo.whereSql.replace(/COL/g, 'o.created_at');
  const orders = database
    .prepare(
      `SELECT o.* FROM orders o
       WHERE ${where}
       ORDER BY datetime(o.created_at) DESC, o.id DESC`
    )
    .all(periodInfo.date);
  return orders.map((o) => {
    const items = database
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .all(o.order_id);
    return {
      order_id: o.order_id,
      created_at: o.created_at,
      customer_name: o.customer_name || '',
      phone: o.phone || '',
      address: o.address || '',
      items_summary: itemsSummary(items),
      total_mmk: Number(o.total_mmk) || 0,
      status: o.status || '',
      status_label: REPORT_STATUS_LABEL[o.status] || o.status || '',
      spin_credits: Number(o.spin_credits) || 0,
      spin_completed: Number(o.spin_completed) === 1 ? 1 : 0,
      slip: o.slip_path && String(o.slip_path).trim() ? 'ရှိ' : 'မရှိ',
      slip_yes: !!(o.slip_path && String(o.slip_path).trim()),
    };
  });
}

function sumSalesPeriodTotalMmk(rows) {
  return rows.reduce((sum, r) => sum + (Number(r.total_mmk) || 0), 0);
}

function sumUniqueSpinOrderTotals(rows) {
  const seen = new Map();
  for (const r of rows) {
    const oid = r.order_id;
    if (!oid) continue;
    if (!seen.has(oid)) {
      seen.set(oid, Number(r.order_total_mmk) || 0);
    }
  }
  let total = 0;
  for (const v of seen.values()) total += v;
  return { unique_orders: seen.size, period_order_total_mmk: total };
}

function querySpinReportRows(database, periodInfo) {
  const where = periodInfo.whereSql.replace(/COL/g, 'sp.created_at');
  const rows = database
    .prepare(
      `SELECT
         sp.id,
         sp.order_id,
         sp.prize_id,
         sp.prize_name,
         sp.created_at,
         o.customer_name,
         o.phone,
         o.address,
         o.spin_credits,
         o.total_mmk AS order_total_mmk,
         COALESCE(spr.product_id, NULL) AS product_id,
         p.name AS product_name
       FROM spin_plays sp
       LEFT JOIN orders o ON o.order_id = sp.order_id
       LEFT JOIN spin_prizes spr ON spr.id = sp.prize_id
       LEFT JOIN products p ON p.id = spr.product_id
       WHERE ${where}
       ORDER BY datetime(sp.created_at) DESC, sp.id DESC`
    )
    .all(periodInfo.date);
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    order_id: r.order_id || '',
    prize_name: r.prize_name || '',
    product_name: r.product_name || '',
    customer_name: r.customer_name || '',
    phone: r.phone || '',
    address: r.address || '',
    spin_credits: Number(r.spin_credits) || 0,
    order_total_mmk: Number(r.order_total_mmk) || 0,
  }));
}

function reportFilename(kind, periodInfo) {
  return `glow-gear-${kind}-${periodInfo.period}-${periodInfo.date}.xlsx`;
}

async function buildSalesWorkbook(rows, periodInfo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Glow Gear';
  const ws = wb.addWorksheet('ရောင်းရင်း');
  ws.columns = [
    { header: 'Order ID', key: 'order_id', width: 18 },
    { header: 'Created at', key: 'created_at', width: 20 },
    { header: 'Customer', key: 'customer_name', width: 18 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Address', key: 'address', width: 28 },
    { header: 'Items', key: 'items_summary', width: 36 },
    { header: 'Total MMK', key: 'total_mmk', width: 14 },
    { header: 'Status', key: 'status_label', width: 14 },
    { header: 'Spin credits', key: 'spin_credits', width: 12 },
    { header: 'Spin completed', key: 'spin_completed', width: 14 },
    { header: 'Slip', key: 'slip', width: 8 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  const periodTotal = sumSalesPeriodTotalMmk(rows);
  const totalRow = ws.addRow({
    order_id: 'စုစုပေါင်း',
    total_mmk: periodTotal,
  });
  totalRow.font = { bold: true };
  ws.addRow([]);
  const summaryRow = ws.addRow({
    order_id: 'ကာလ စုစုပေါင်း',
    created_at: `${periodInfo.periodLabel} / ${periodInfo.date} (Asia/Yangon)`,
    total_mmk: periodTotal,
  });
  summaryRow.font = { bold: true };
  return wb;
}

async function buildSpinWorkbook(rows, periodInfo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Glow Gear';
  const ws = wb.addWorksheet('Spin');
  ws.columns = [
    { header: 'Time', key: 'created_at', width: 20 },
    { header: 'Order ID', key: 'order_id', width: 18 },
    { header: 'Prize', key: 'prize_name', width: 22 },
    { header: 'Product', key: 'product_name', width: 22 },
    { header: 'Customer', key: 'customer_name', width: 18 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Address', key: 'address', width: 28 },
    { header: 'Remaining credits', key: 'spin_credits', width: 16 },
    { header: 'Order total MMK', key: 'order_total_mmk', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  const uniq = sumUniqueSpinOrderTotals(rows);
  ws.addRow([]);
  const summaryRow = ws.addRow({
    created_at: 'ကာလ Order စုစုပေါင်း (unique)',
    order_id: `${periodInfo.periodLabel} / ${periodInfo.date} (Asia/Yangon)`,
    order_total_mmk: uniq.period_order_total_mmk,
  });
  summaryRow.font = { bold: true };
  return wb;
}

function escapeHtmlReport(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderReportPrintHtml({ title, subtitle, summaryLine, headers, bodyRows }) {
  const th = headers.map((h) => `<th>${escapeHtmlReport(h)}</th>`).join('');
  const trs = bodyRows.length
    ? bodyRows
        .map(
          (cells) =>
            '<tr>' +
            cells.map((c) => `<td>${escapeHtmlReport(c)}</td>`).join('') +
            '</tr>'
        )
        .join('\n')
    : `<tr><td colspan="${headers.length}">မှတ်တမ်း မရှိပါ</td></tr>`;
  const summaryHtml = summaryLine
    ? `<div class="summary">${escapeHtmlReport(summaryLine)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="my">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlReport(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.25rem; color: #111; }
    h1 { font-size: 1.25rem; margin: 0 0 0.35rem; }
    .meta { color: #555; margin-bottom: 0.65rem; font-size: 0.95rem; }
    .summary {
      font-size: 1.15rem; font-weight: 700; margin: 0 0 1rem;
      padding: 0.55rem 0.75rem; background: #ecfdf5; border: 1px solid #99f6e4;
      border-radius: 8px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.45rem; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    .toolbar { margin-bottom: 1rem; }
    .toolbar button {
      background: #0d9488; color: #fff; border: 0; padding: 0.5rem 1rem;
      border-radius: 8px; cursor: pointer; font-size: 0.95rem;
    }
    @media print {
      .toolbar { display: none !important; }
      body { margin: 0.4cm; }
      th { background: #eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .summary { background: #f0fdf4 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">ပရင့်မည်</button>
  </div>
  <h1>${escapeHtmlReport(title)}</h1>
  <div class="meta">${escapeHtmlReport(subtitle)}</div>
  ${summaryHtml}
  <table>
    <thead><tr>${th}</tr></thead>
    <tbody>${trs}</tbody>
  </table>
  <script>
    // optional auto-print when ?autoprint=1
    if (/[?&]autoprint=1\\b/.test(location.search)) {
      window.addEventListener('load', () => setTimeout(() => window.print(), 200));
    }
  </script>
</body>
</html>`;
}

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
  res.json({
    ...formatOrder(o, items),
    spin_plays: plays,
    spin_cycle: getOrderSpinCycleProgress(db, o.order_id),
  });
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

app.patch('/api/admin/orders/:orderId/spin-completed', requireAdmin, (req, res) => {
  try {
    const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
    if (!o) return res.status(404).json({ error: 'Not found' });
    if (!orderIsSpinRelated(db, o)) {
      return res.status(400).json({ error: 'ဤအော်ဒါသည် စပင်နှင့် မသက်ဆိုင်ပါ' });
    }
    const body = req.body || {};
    const completed =
      body.spin_completed === undefined
        ? 1
        : parseBoolFlag(body.spin_completed, 1);
    db.prepare(
      `UPDATE orders SET spin_completed = ?, updated_at = datetime('now') WHERE order_id = ?`
    ).run(completed ? 1 : 0, req.params.orderId);
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
    res.json({
      ...formatOrder(updated, items),
      spin_plays: plays,
      spin_cycle: getOrderSpinCycleProgress(db, updated.order_id),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/admin/orders/:orderId/spin-credits', requireAdmin, (req, res) => {
  try {
    const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
    if (!o) return res.status(404).json({ error: 'Not found' });
    if (orderSpinCreditsLocked(o)) {
      return res.status(403).json({
        error: 'မှားယွင်း ထပ်မဖြည့်ရန် သော့ခတ်ထားသည် — တစ်ကြိမ်သာ သတ်မှတ်နိုင်သည်',
        locked: true,
        expired: getOrderSpinCreditState(db, o).expired,
        credits: Number(o.spin_credits) || 0,
      });
    }
    let credits = parseInt(req.body && req.body.spin_credits, 10);
    if (!Number.isFinite(credits) || credits < 0) {
      return res.status(400).json({ error: 'spin_credits သည် 0 သို့မဟုတ် အပေါင်းကိန်း ဖြစ်ရမည်' });
    }
    credits = Math.min(1000, credits);
    if (credits > 0) {
      db.prepare(
        `UPDATE orders SET spin_credits = ?, spin_credits_locked = 1,
         spin_credits_granted_at = datetime('now'), updated_at = datetime('now')
         WHERE order_id = ?`
      ).run(credits, req.params.orderId);
    } else {
      db.prepare(
        `UPDATE orders SET spin_credits = ?, updated_at = datetime('now') WHERE order_id = ?`
      ).run(credits, req.params.orderId);
    }
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
    res.json({
      ...formatOrder(updated, items),
      spin_plays: plays,
      spin_cycle: getOrderSpinCycleProgress(db, updated.order_id),
    });
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



// ========== ADMIN REPORTS API ==========

app.get('/api/admin/reports/sales', requireAdmin, (req, res) => {
  try {
    const info = parseReportPeriodDate(req.query);
    if (info.error) return res.status(400).json({ error: info.error });
    const rows = querySalesReportRows(db, info);
    const period_total_mmk = sumSalesPeriodTotalMmk(rows);
    res.json({
      type: 'sales',
      period: info.period,
      date: info.date,
      timezone: 'Asia/Yangon',
      count: rows.length,
      period_total_mmk,
      rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/reports/spin', requireAdmin, (req, res) => {
  try {
    const info = parseReportPeriodDate(req.query);
    if (info.error) return res.status(400).json({ error: info.error });
    const rows = querySpinReportRows(db, info);
    const uniq = sumUniqueSpinOrderTotals(rows);
    res.json({
      type: 'spin',
      period: info.period,
      date: info.date,
      timezone: 'Asia/Yangon',
      count: rows.length,
      unique_orders: uniq.unique_orders,
      period_order_total_mmk: uniq.period_order_total_mmk,
      rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/reports/sales.xlsx', requireAdmin, async (req, res) => {
  try {
    const info = parseReportPeriodDate(req.query);
    if (info.error) return res.status(400).json({ error: info.error });
    const rows = querySalesReportRows(db, info);
    const wb = await buildSalesWorkbook(rows, info);
    const buf = await wb.xlsx.writeBuffer();
    const name = reportFilename('sales', info);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/reports/spin.xlsx', requireAdmin, async (req, res) => {
  try {
    const info = parseReportPeriodDate(req.query);
    if (info.error) return res.status(400).json({ error: info.error });
    const rows = querySpinReportRows(db, info);
    const wb = await buildSpinWorkbook(rows, info);
    const buf = await wb.xlsx.writeBuffer();
    const name = reportFilename('spin', info);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/reports/print', requireAdmin, (req, res) => {
  try {
    const type = String(req.query.type || 'sales').toLowerCase();
    if (!['sales', 'spin'].includes(type)) {
      return res.status(400).json({ error: 'type သည် sales | spin ဖြစ်ရမည်' });
    }
    const info = parseReportPeriodDate(req.query);
    if (info.error) return res.status(400).json({ error: info.error });
    const subtitle = `ကာလ: ${info.periodLabel} — ${info.date} (Asia/Yangon)`;
    let html;
    if (type === 'sales') {
      const rows = querySalesReportRows(db, info);
      const periodTotal = sumSalesPeriodTotalMmk(rows);
      html = renderReportPrintHtml({
        title: 'Glow Gear — ရောင်းရင်း စာရင်း',
        subtitle: subtitle + ` — စုစုပေါင်း ${rows.length} ခု`,
        summaryLine: `ကာလ စုစုပေါင်း: ${periodTotal.toLocaleString('en-US')} MMK`,
        headers: [
          'Order ID',
          'အချိန်',
          'အမည်',
          'ဖုန်း',
          'လိပ်စာ',
          'ပစ္စည်းများ',
          'စုစုပေါင်း',
          'အခြေအနေ',
          'Spin credits',
          'Spin ပြီး',
          'စလစ်',
        ],
        bodyRows: rows.map((r) => [
          r.order_id,
          r.created_at,
          r.customer_name,
          r.phone,
          r.address,
          r.items_summary,
          r.total_mmk,
          r.status_label,
          r.spin_credits,
          r.spin_completed ? 'ဟုတ်' : 'မဟုတ်',
          r.slip,
        ]),
      });
    } else {
      const rows = querySpinReportRows(db, info);
      const uniq = sumUniqueSpinOrderTotals(rows);
      html = renderReportPrintHtml({
        title: 'Glow Gear — Spin စာရင်း',
        subtitle: subtitle + ` — စုစုပေါင်း ${rows.length} ခု`,
        summaryLine: `ကာလ Order စုစုပေါင်း (unique ${uniq.unique_orders}): ${uniq.period_order_total_mmk.toLocaleString('en-US')} MMK`,
        headers: [
          'အချိန်',
          'Order ID',
          'ဆုအမည်',
          'ပစ္စည်း',
          'အမည်',
          'ဖုန်း',
          'လိပ်စာ',
          'ကျန်အခွင့်',
          'Order total MMK',
        ],
        bodyRows: rows.map((r) => [
          r.created_at,
          r.order_id,
          r.prize_name,
          r.product_name,
          r.customer_name,
          r.phone,
          r.address,
          r.spin_credits,
          r.order_total_mmk,
        ]),
      });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/reports/sales', requireAdmin, (req, res) => {
  try {
    if (requirePasswordBody(req, res) === null) return;
    const info = parseReportPeriodDate({ ...req.query, ...(req.body || {}) });
    if (info.error) return res.status(400).json({ error: info.error });
    const where = info.whereSql.replace(/COL/g, 'created_at');
    const orders = db
      .prepare(`SELECT order_id FROM orders WHERE ${where}`)
      .all(info.date);
    let deleted = 0;
    for (const o of orders) {
      if (deleteOrderById(db, o.order_id)) deleted += 1;
    }
    res.json({
      ok: true,
      type: 'sales',
      period: info.period,
      date: info.date,
      deleted,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/reports/spin', requireAdmin, (req, res) => {
  try {
    if (requirePasswordBody(req, res) === null) return;
    const info = parseReportPeriodDate({ ...req.query, ...(req.body || {}) });
    if (info.error) return res.status(400).json({ error: info.error });
    const where = info.whereSql.replace(/COL/g, 'created_at');
    const result = db
      .prepare(`DELETE FROM spin_plays WHERE ${where}`)
      .run(info.date);
    res.json({
      ok: true,
      type: 'spin',
      period: info.period,
      date: info.date,
      deleted: result.changes || 0,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});


// ========== ADMIN SPIN PRIZES ==========

app.get('/api/admin/spin-plays', requireAdmin, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT
           sp.id,
           sp.order_id,
           sp.prize_id,
           sp.prize_name,
           sp.created_at,
           o.customer_name,
           o.phone,
           o.address,
           o.spin_credits,
           COALESCE(spr.product_id, NULL) AS product_id,
           p.name AS product_name
         FROM spin_plays sp
         LEFT JOIN orders o ON o.order_id = sp.order_id
         LEFT JOIN spin_prizes spr ON spr.id = sp.prize_id
         LEFT JOIN products p ON p.id = spr.product_id
         ORDER BY datetime(sp.created_at) DESC, sp.id DESC`
      )
      .all();
    res.json(
      rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        prize_id: r.prize_id,
        prize_name: r.prize_name,
        product_id: r.product_id || null,
        product_name: r.product_name || null,
        order_id: r.order_id,
        customer_name: r.customer_name || '',
        phone: r.phone || '',
        address: r.address || '',
        spin_credits: Number(r.spin_credits) || 0,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

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
    res.json({
      prizes: prizes.map(formatSpinPrizeAdmin),
      cycle_size: SPIN_CYCLE_SIZE,
      // Cycle progress is per order (spin_plays count), not global
      cycle_scope: 'per_order',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/spin-prizes', requireAdmin, (req, res) => {
  try {
    const { name, product_id, hit_every, active, sort_order, is_special } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'အမည် လိုအပ်သည်' });
    }
    let pid = null;
    if (product_id !== undefined && product_id !== null && product_id !== '') {
      pid = parseInt(product_id, 10);
      if (!Number.isFinite(pid)) return res.status(400).json({ error: 'Invalid product_id' });
      const bad = assertSpinPrizeBlindBoxProduct(db, pid);
      if (bad) return res.status(bad.status).json({ error: bad.error });
      const taken = findSpinPrizeByProductId(db, pid);
      if (taken) {
        return res.status(400).json({
          error: 'ဤပစ္စည်းသည် ဘီးဆု #' + taken.id + ' နှင့် ချိတ်ပြီးသားဖြစ်သည်',
        });
      }
    }
    const hit = clampHitEvery(hit_every);
    const isActive = active === '0' || active === 0 || active === false || active === 'false' ? 0 : 1;
    const isSpecial = parseIsSpecial(is_special, 0);
    const sort = parseInt(sort_order, 10);
    const sortVal = Number.isFinite(sort) ? sort : 0;
    const result = db
      .prepare(
        `INSERT INTO spin_prizes (name, product_id, hit_every, is_special, active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(String(name).trim(), pid, hit, isSpecial, isActive, sortVal);
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

    const { name, product_id, hit_every, active, sort_order, is_special } = req.body || {};
    let pid = existing.product_id;
    if (product_id !== undefined) {
      if (product_id === null || product_id === '') {
        pid = null;
      } else {
        pid = parseInt(product_id, 10);
        if (!Number.isFinite(pid)) return res.status(400).json({ error: 'Invalid product_id' });
        const bad = assertSpinPrizeBlindBoxProduct(db, pid);
        if (bad) return res.status(bad.status).json({ error: bad.error });
        const taken = findSpinPrizeByProductId(db, pid, id);
        if (taken) {
          return res.status(400).json({
            error: 'ဤပစ္စည်းသည် ဘီးဆု #' + taken.id + ' နှင့် ချိတ်ပြီးသားဖြစ်သည်',
          });
        }
      }
    }

    const isActive =
      active === undefined
        ? existing.active
        : active === '0' || active === 0 || active === false || active === 'false'
          ? 0
          : 1;

    const isSpecial =
      is_special === undefined
        ? Number(existing.is_special) ? 1 : 0
        : parseIsSpecial(is_special, 0);

    const hit =
      hit_every === undefined ? existing.hit_every : clampHitEvery(hit_every);
    const sort =
      sort_order === undefined
        ? existing.sort_order
        : Number.isFinite(parseInt(sort_order, 10))
          ? parseInt(sort_order, 10)
          : existing.sort_order;

    db.prepare(
      `UPDATE spin_prizes SET name = ?, product_id = ?, hit_every = ?, is_special = ?, active = ?, sort_order = ?
       WHERE id = ?`
    ).run(
      name !== undefined ? String(name).trim() : existing.name,
      pid,
      hit,
      isSpecial,
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


// ========== ADMIN CUSTOMER CHAT ==========

app.get('/api/admin/chat/threads', requireAdmin, (_req, res) => {
  try {
    const threads = db
      .prepare(
        `SELECT t.*,
           (SELECT body FROM chat_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1) AS last_body,
           (SELECT sender FROM chat_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1) AS last_sender,
           (SELECT COUNT(*) FROM chat_messages WHERE thread_id = t.id) AS message_count
         FROM chat_threads t
         ORDER BY datetime(t.updated_at) DESC, t.id DESC`
      )
      .all();
    res.json(
      threads.map((t) =>
        formatChatThread(t, {
          last_body: t.last_body || '',
          last_sender: t.last_sender || null,
          message_count: Number(t.message_count) || 0,
          needs_reply: t.last_sender === 'customer' && (t.status || 'open') === 'open',
        })
      )
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/chat/threads/:id/messages', requireAdmin, (req, res) => {
  try {
    const thread = getChatThreadById(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ချတ် မတွေ့ပါ' });
    res.json({
      thread: formatChatThread(thread),
      messages: listChatMessages(thread.id),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/chat/threads/:id/messages', requireAdmin, (req, res) => {
  try {
    const thread = getChatThreadById(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ချတ် မတွေ့ပါ' });
    const body = req.body || {};
    const text = clampChatBody(body.body);
    const close = body.close === true || body.status === 'closed';
    if (!text && !close) {
      return res.status(400).json({ error: 'မက်ဆေ့ချ် ရိုက်ထည့်ပါ' });
    }
    let msg = null;
    if (text) {
      const result = db
        .prepare(`INSERT INTO chat_messages (thread_id, sender, body) VALUES (?, 'admin', ?)`)
        .run(thread.id, text);
      msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid);
    }
    const newStatus = close ? 'closed' : 'open';
    db.prepare(
      `UPDATE chat_threads SET updated_at = datetime('now'), status = ? WHERE id = ?`
    ).run(newStatus, thread.id);
    const updated = getChatThreadById(thread.id);
    res.json({
      thread: formatChatThread(updated),
      message: msg ? formatChatMessage(msg) : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/admin/chat/threads/:id', requireAdmin, (req, res) => {
  try {
    const thread = getChatThreadById(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ချတ် မတွေ့ပါ' });
    const status = req.body && req.body.status;
    if (status !== 'open' && status !== 'closed') {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.prepare(
      `UPDATE chat_threads SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(status, thread.id);
    res.json(formatChatThread(getChatThreadById(thread.id)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/chat/threads/:id', requireAdmin, (req, res) => {
  try {
    const thread = getChatThreadById(req.params.id);
    if (!thread) return res.status(404).json({ error: 'ချတ် မတွေ့ပါ' });
    const deleteThread = db.transaction((tid) => {
      db.prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(tid);
      db.prepare('DELETE FROM chat_threads WHERE id = ?').run(tid);
    });
    deleteThread(thread.id);
    res.json({ ok: true, id: thread.id });
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


function mapBannerSlide(row) {
  if (!row) return null;
  return {
    id: row.id,
    image_path: row.image_path || '',
    image_url: publicUploadUrl(row.image_path || ''),
    active: Number(row.active) ? 1 : 0,
    sort_order: Number(row.sort_order) || 0,
    created_at: row.created_at || '',
  };
}

app.get('/api/admin/banner-slides', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, image_path, active, sort_order, created_at
       FROM banner_slides
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json(rows.map(mapBannerSlide));
});

app.post('/api/admin/banner-slides', requireAdmin, (req, res) => {
  uploadBanner.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'ပုံတင်ရန် လိုအပ်သည်' });
      }
      const image_path = `banners/${req.file.filename}`;
      const sortRaw = req.body && req.body.sort_order;
      let sort_order = 0;
      if (sortRaw !== undefined && sortRaw !== null && String(sortRaw).trim() !== '') {
        sort_order = Number(sortRaw) || 0;
      } else {
        const maxRow = db.prepare('SELECT MAX(sort_order) AS m FROM banner_slides').get();
        sort_order = (maxRow && maxRow.m != null ? Number(maxRow.m) : 0) + 10;
      }
      const active =
        req.body && req.body.active !== undefined && req.body.active !== null && String(req.body.active) !== ''
          ? Number(req.body.active) ? 1 : 0
          : 1;
      const info = db
        .prepare(
          `INSERT INTO banner_slides (image_path, active, sort_order) VALUES (?, ?, ?)`
        )
        .run(image_path, active, sort_order);
      const row = db
        .prepare(
          `SELECT id, image_path, active, sort_order, created_at FROM banner_slides WHERE id = ?`
        )
        .get(info.lastInsertRowid);
      res.status(201).json(mapBannerSlide(row));
    } catch (e) {
      console.error(e);
      if (req.file) {
        try {
          fs.unlinkSync(path.join(BANNERS_DIR, req.file.filename));
        } catch (_) {}
      }
      res.status(500).json({ error: 'Server error' });
    }
  });
});

app.patch('/api/admin/banner-slides/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const existing = db.prepare('SELECT * FROM banner_slides WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'မတွေ့ပါ' });

    let active = existing.active;
    let sort_order = existing.sort_order;
    if (req.body && req.body.active !== undefined) {
      active = Number(req.body.active) ? 1 : 0;
    }
    if (req.body && req.body.sort_order !== undefined) {
      sort_order = Number(req.body.sort_order) || 0;
    }
    db.prepare('UPDATE banner_slides SET active = ?, sort_order = ? WHERE id = ?').run(
      active,
      sort_order,
      id
    );
    const row = db
      .prepare(
        `SELECT id, image_path, active, sort_order, created_at FROM banner_slides WHERE id = ?`
      )
      .get(id);
    res.json(mapBannerSlide(row));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/banner-slides/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const existing = db.prepare('SELECT * FROM banner_slides WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'မတွေ့ပါ' });
    db.prepare('DELETE FROM banner_slides WHERE id = ?').run(id);
    unlinkUploadRel(existing.image_path);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
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
  migrateSpinPlaysColumns(db);
  migrateSpinPrizesSpecial(db);
  migrateOrdersSpinCreditsLockBackfill(db);
  seedCategories(db);
  seedBuiltins(db);
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
