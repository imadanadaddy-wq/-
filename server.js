// KNUH Meal Dashboard - Express + SQLite backend
// Uses Node's built-in node:sqlite (Node 22.13+) to avoid native compilation.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

// DB path: configurable so Railway Volume can mount /data
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'knuh.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meal_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    meal_type TEXT NOT NULL,      -- 'breakfast' | 'late_night'
    menu TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending' | 'picked_up'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    picked_up_at DATETIME,
    picked_up_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (picked_up_by) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON meal_orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_user ON meal_orders(user_id, status);
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helpers ---
function getUserByEmployeeId(employee_id) {
  return db.prepare('SELECT * FROM users WHERE employee_id = ?').get(employee_id);
}

function requireUser(req, res) {
  const employee_id = req.headers['x-employee-id'] || req.query.employee_id || req.body?.employee_id;
  if (!employee_id) {
    res.status(401).json({ error: '로그인이 필요합니다' });
    return null;
  }
  const user = getUserByEmployeeId(String(employee_id));
  if (!user) {
    res.status(401).json({ error: '등록되지 않은 사용자입니다' });
    return null;
  }
  return user;
}

// --- Routes ---

// Register or fetch existing user (idempotent)
app.post('/api/register', (req, res) => {
  let { employee_id, name } = req.body || {};
  employee_id = String(employee_id || '').trim();
  name = String(name || '').trim();

  if (!/^\d{3,10}$/.test(employee_id)) {
    return res.status(400).json({ error: '사번은 숫자만 입력해주세요' });
  }
  if (!name) {
    return res.status(400).json({ error: '이름을 입력해주세요' });
  }

  const existing = getUserByEmployeeId(employee_id);
  if (existing) {
    if (existing.name !== name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, existing.id);
      existing.name = name;
    }
    return res.json(existing);
  }

  const result = db.prepare('INSERT INTO users (employee_id, name) VALUES (?, ?)').run(employee_id, name);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
  res.json(user);
});

// Auto-login check
app.get('/api/me', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json(user);
});

// Create or update my pending order for a meal_type
app.post('/api/orders', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  let { meal_type, menu } = req.body || {};
  menu = String(menu || '').trim();

  if (!['breakfast', 'late_night'].includes(meal_type)) {
    return res.status(400).json({ error: '잘못된 식사 유형입니다' });
  }
  if (!menu) {
    return res.status(400).json({ error: '메뉴를 입력해주세요' });
  }
  if (menu.length > 200) {
    return res.status(400).json({ error: '메뉴가 너무 깁니다 (200자 이하)' });
  }

  // One pending order per (user, meal_type)
  const existing = db.prepare(`
    SELECT * FROM meal_orders
    WHERE user_id = ? AND meal_type = ? AND status = 'pending'
  `).get(user.id, meal_type);

  if (existing) {
    db.prepare('UPDATE meal_orders SET menu = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(menu, existing.id);
    return res.json(db.prepare('SELECT * FROM meal_orders WHERE id = ?').get(existing.id));
  }

  const result = db.prepare(`
    INSERT INTO meal_orders (user_id, meal_type, menu) VALUES (?, ?, ?)
  `).run(user.id, meal_type, menu);

  res.json(db.prepare('SELECT * FROM meal_orders WHERE id = ?').get(Number(result.lastInsertRowid)));
});

// Get my pending orders
app.get('/api/orders/my', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const orders = db.prepare(`
    SELECT * FROM meal_orders
    WHERE user_id = ? AND status = 'pending'
    ORDER BY meal_type
  `).all(user.id);
  res.json(orders);
});

// Cancel my order
app.delete('/api/orders/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT * FROM meal_orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
  if (order.user_id !== user.id) return res.status(403).json({ error: '본인 주문만 취소 가능합니다' });

  db.prepare('DELETE FROM meal_orders WHERE id = ?').run(orderId);
  res.json({ ok: true });
});

// Acting view: all pending orders with user info
app.get('/api/orders/active', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const orders = db.prepare(`
    SELECT
      mo.id, mo.meal_type, mo.menu, mo.created_at,
      u.employee_id, u.name
    FROM meal_orders mo
    JOIN users u ON mo.user_id = u.id
    WHERE mo.status = 'pending'
    ORDER BY mo.meal_type, mo.created_at
  `).all();
  res.json(orders);
});

// Mark as picked up
app.post('/api/orders/:id/pickup', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const result = db.prepare(`
    UPDATE meal_orders
    SET status = 'picked_up', picked_up_at = CURRENT_TIMESTAMP, picked_up_by = ?
    WHERE id = ? AND status = 'pending'
  `).run(user.id, Number(req.params.id));

  if (result.changes === 0) {
    return res.status(404).json({ error: '이미 처리되었거나 없는 주문입니다' });
  }
  res.json({ ok: true });
});

// Optional: clear ALL picked-up orders older than 7 days (housekeeping)
app.post('/api/admin/cleanup', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const result = db.prepare(`
    DELETE FROM meal_orders
    WHERE status = 'picked_up' AND picked_up_at < datetime('now', '-7 days')
  `).run();
  res.json({ deleted: result.changes });
});

// Health check for Railway
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`KNUH Meal Dashboard listening on :${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
