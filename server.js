// KNUH Meal Dashboard - Express + SQLite backend
// Uses Node's built-in node:sqlite (Node 22.13+) to avoid native compilation.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

// Admins: hard-coded for now. Add more employee_ids to this set as needed.
const ADMIN_EMPLOYEE_IDS = new Set(['22807']);
const isAdmin = (user) => user && ADMIN_EMPLOYEE_IDS.has(user.employee_id);

// DB path: configurable so Railway Volume can mount /data
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'knuh.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

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
    meal_type TEXT NOT NULL,
    menu TEXT NOT NULL,
    service_date DATE NOT NULL DEFAULT (date('now', 'localtime')),
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    picked_up_at DATETIME,
    picked_up_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (picked_up_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_type TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON meal_orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_date ON meal_orders(service_date, meal_type, status);
  CREATE INDEX IF NOT EXISTS idx_menu_items_meal ON menu_items(meal_type, active, sort_order);
`);

// Migration: add service_date column to existing meal_orders if missing
(function migrate() {
  const cols = db.prepare("PRAGMA table_info(meal_orders)").all();
  if (!cols.some(c => c.name === 'service_date')) {
    console.log('[migration] adding service_date column');
    db.exec("ALTER TABLE meal_orders ADD COLUMN service_date DATE");
    db.exec("UPDATE meal_orders SET service_date = date(created_at, 'localtime') WHERE service_date IS NULL");
  }
})();

// Partial unique index: one pending order per (user, date, meal_type)
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_pending
    ON meal_orders(user_id, service_date, meal_type)
    WHERE status = 'pending';
`);

// Seed default menu items if table is empty
(function seedMenu() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
  if (count > 0) return;
  console.log('[seed] populating default menu items');
  const seeds = {
    late_night: ['컵라면', '김밥', '햄버거', '죽', '샌드위치', '라면'],
    breakfast: ['빵+우유', '죽', '주먹밥', '시리얼', '샌드위치', '토스트'],
  };
  const ins = db.prepare('INSERT INTO menu_items (meal_type, name, sort_order) VALUES (?, ?, ?)');
  for (const [meal_type, items] of Object.entries(seeds)) {
    items.forEach((name, i) => ins.run(meal_type, name, i));
  }
})();

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

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!isAdmin(user)) {
    res.status(403).json({ error: '관리자 권한이 필요합니다' });
    return null;
  }
  return user;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime());
}

// --- Auth / User ---

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
    return res.json({ ...existing, is_admin: isAdmin(existing) });
  }

  const result = db.prepare('INSERT INTO users (employee_id, name) VALUES (?, ?)').run(employee_id, name);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
  res.json({ ...user, is_admin: isAdmin(user) });
});

app.get('/api/me', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ ...user, is_admin: isAdmin(user) });
});

// --- Menu items ---

app.get('/api/menu-items', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { meal_type, include_inactive } = req.query;
  let sql = 'SELECT * FROM menu_items';
  const params = [];
  const conds = [];
  if (meal_type) { conds.push('meal_type = ?'); params.push(meal_type); }
  if (!include_inactive) { conds.push('active = 1'); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY meal_type, sort_order, id';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/menu-items', (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  let { meal_type, name } = req.body || {};
  name = String(name || '').trim();

  if (!['breakfast', 'late_night'].includes(meal_type)) {
    return res.status(400).json({ error: '잘못된 식사 유형입니다' });
  }
  if (!name) return res.status(400).json({ error: '메뉴 이름을 입력해주세요' });
  if (name.length > 50) return res.status(400).json({ error: '메뉴 이름이 너무 깁니다 (50자 이하)' });

  const dup = db.prepare(`
    SELECT * FROM menu_items WHERE meal_type = ? AND name = ? AND active = 1
  `).get(meal_type, name);
  if (dup) return res.status(409).json({ error: '이미 같은 이름의 메뉴가 있습니다' });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM menu_items WHERE meal_type = ?').get(meal_type).m;
  const result = db.prepare(`
    INSERT INTO menu_items (meal_type, name, sort_order) VALUES (?, ?, ?)
  `).run(meal_type, name, maxOrder + 1);

  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(result.lastInsertRowid)));
});

app.patch('/api/menu-items/:id', (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const id = Number(req.params.id);
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: '메뉴를 찾을 수 없습니다' });

  const updates = [];
  const params = [];
  if (typeof req.body?.name === 'string') {
    const name = req.body.name.trim();
    if (!name || name.length > 50) return res.status(400).json({ error: '메뉴 이름이 올바르지 않습니다' });
    updates.push('name = ?'); params.push(name);
  }
  if (typeof req.body?.active === 'boolean') {
    updates.push('active = ?'); params.push(req.body.active ? 1 : 0);
  }
  if (typeof req.body?.sort_order === 'number') {
    updates.push('sort_order = ?'); params.push(req.body.sort_order);
  }
  if (!updates.length) return res.status(400).json({ error: '변경할 내용이 없습니다' });

  params.push(id);
  db.prepare(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id));
});

app.delete('/api/menu-items/:id', (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: '메뉴를 찾을 수 없습니다' });
  res.json({ ok: true });
});

// --- Orders ---

app.post('/api/orders', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  let { meal_type, menu, service_date } = req.body || {};
  menu = String(menu || '').trim();

  if (!['breakfast', 'late_night'].includes(meal_type)) {
    return res.status(400).json({ error: '잘못된 식사 유형입니다' });
  }
  if (!menu) return res.status(400).json({ error: '메뉴를 입력해주세요' });
  if (menu.length > 200) return res.status(400).json({ error: '메뉴가 너무 깁니다 (200자 이하)' });
  if (service_date && !validDate(service_date)) {
    return res.status(400).json({ error: '잘못된 날짜 형식입니다 (YYYY-MM-DD)' });
  }
  if (!service_date) {
    service_date = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
  }

  const existing = db.prepare(`
    SELECT * FROM meal_orders
    WHERE user_id = ? AND meal_type = ? AND service_date = ? AND status = 'pending'
  `).get(user.id, meal_type, service_date);

  if (existing) {
    db.prepare('UPDATE meal_orders SET menu = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(menu, existing.id);
    return res.json(db.prepare('SELECT * FROM meal_orders WHERE id = ?').get(existing.id));
  }

  const result = db.prepare(`
    INSERT INTO meal_orders (user_id, meal_type, menu, service_date) VALUES (?, ?, ?, ?)
  `).run(user.id, meal_type, menu, service_date);

  res.json(db.prepare('SELECT * FROM meal_orders WHERE id = ?').get(Number(result.lastInsertRowid)));
});

// Batch: one menu, many dates
app.post('/api/orders/batch', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  let { meal_type, menu, dates } = req.body || {};
  menu = String(menu || '').trim();

  if (!['breakfast', 'late_night'].includes(meal_type)) {
    return res.status(400).json({ error: '잘못된 식사 유형입니다' });
  }
  if (!menu) return res.status(400).json({ error: '메뉴를 입력해주세요' });
  if (menu.length > 200) return res.status(400).json({ error: '메뉴가 너무 깁니다 (200자 이하)' });
  if (!Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: '날짜를 한 개 이상 선택해주세요' });
  }
  if (dates.length > 31) return res.status(400).json({ error: '한번에 최대 31일까지 가능합니다' });

  const uniq = [...new Set(dates)];
  for (const d of uniq) {
    if (!validDate(d)) return res.status(400).json({ error: `잘못된 날짜: ${d}` });
  }

  const findStmt = db.prepare(`
    SELECT id FROM meal_orders
    WHERE user_id = ? AND meal_type = ? AND service_date = ? AND status = 'pending'
  `);
  const updStmt = db.prepare('UPDATE meal_orders SET menu = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?');
  const insStmt = db.prepare(`
    INSERT INTO meal_orders (user_id, meal_type, menu, service_date) VALUES (?, ?, ?, ?)
  `);

  const created = [];
  const updated = [];

  db.prepare('BEGIN').run();
  try {
    for (const d of uniq) {
      const existing = findStmt.get(user.id, meal_type, d);
      if (existing) {
        updStmt.run(menu, existing.id);
        updated.push(d);
      } else {
        insStmt.run(user.id, meal_type, menu, d);
        created.push(d);
      }
    }
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    return res.status(500).json({ error: '저장 중 오류: ' + e.message });
  }

  res.json({ created, updated });
});

app.get('/api/orders/my', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { from } = req.query;
  const fromDate = (from && validDate(from)) ? from : db.prepare("SELECT date('now', 'localtime') AS d").get().d;

  const orders = db.prepare(`
    SELECT * FROM meal_orders
    WHERE user_id = ? AND status = 'pending' AND service_date >= ?
    ORDER BY service_date, meal_type
  `).all(user.id, fromDate);
  res.json(orders);
});

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

app.get('/api/orders/active', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { meal_type, date } = req.query;
  const conds = ["mo.status = 'pending'"];
  const params = [];

  if (meal_type) {
    if (!['breakfast', 'late_night'].includes(meal_type)) {
      return res.status(400).json({ error: '잘못된 식사 유형입니다' });
    }
    conds.push('mo.meal_type = ?'); params.push(meal_type);
  }
  if (date) {
    if (!validDate(date)) return res.status(400).json({ error: '잘못된 날짜 형식입니다' });
    conds.push('mo.service_date = ?'); params.push(date);
  }

  const orders = db.prepare(`
    SELECT mo.id, mo.meal_type, mo.menu, mo.service_date, mo.created_at,
           u.employee_id, u.name
    FROM meal_orders mo
    JOIN users u ON mo.user_id = u.id
    WHERE ${conds.join(' AND ')}
    ORDER BY mo.service_date, mo.meal_type, mo.created_at
  `).all(...params);
  res.json(orders);
});

// Summary for acting date picker: count per (date, meal_type)
app.get('/api/orders/active/summary', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
  const rows = db.prepare(`
    SELECT service_date, meal_type, COUNT(*) AS n
    FROM meal_orders
    WHERE status = 'pending'
      AND service_date >= date('now', 'localtime')
      AND service_date <= date('now', 'localtime', '+${days} days')
    GROUP BY service_date, meal_type
    ORDER BY service_date
  `).all();
  res.json(rows);
});

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

app.post('/api/admin/cleanup', (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;
  const result = db.prepare(`
    DELETE FROM meal_orders
    WHERE status = 'picked_up' AND picked_up_at < datetime('now', '-7 days')
  `).run();
  res.json({ deleted: result.changes });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`KNUH Meal Dashboard listening on :${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
