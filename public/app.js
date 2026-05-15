// KNUH Meal Dashboard - frontend SPA
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const root = document.getElementById('app');

  const STORAGE_KEY = 'knuh.user.v1';
  const ROLE_KEY = 'knuh.role.v1';
  const POLL_MS = 15000;

  // ===== State =====
  let user = null;       // {id, employee_id, name}
  let role = null;       // 'applicant' | 'acting'
  let mealTab = 'late_night'; // for applicant view default
  let myOrders = [];
  let activeOrders = [];
  let pollTimer = null;

  // ===== Storage helpers =====
  function loadStored() {
    try {
      const u = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      const r = localStorage.getItem(ROLE_KEY);
      if (u) user = u;
      if (r) role = r;
    } catch {}
  }
  function saveUser(u) {
    user = u;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  }
  function saveRole(r) {
    role = r;
    if (r) localStorage.setItem(ROLE_KEY, r);
    else localStorage.removeItem(ROLE_KEY);
  }

  // ===== API =====
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (user) headers['X-Employee-Id'] = user.employee_id;
    const res = await fetch(path, { ...opts, headers });
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`);
    return body;
  }

  // ===== Toast =====
  let toastEl = null;
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
  }

  // ===== Renderers =====
  function mealLabel(t) { return t === 'breakfast' ? '조식' : '야식'; }
  function mealEmoji(t) { return t === 'breakfast' ? '🍳' : '🍜'; }

  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  function renderBrand() {
    return `
      <div class="brand">
        <div>
          <div class="brand-logo">KNUH</div>
          <div class="brand-sub">야식·조식 신청</div>
        </div>
        ${user ? `
          <button class="user-pill" id="userPill" title="역할 변경 / 로그아웃">
            <span class="dot"></span>
            <span>${escape(user.name)} · ${escape(user.employee_id)}</span>
          </button>
        ` : ''}
      </div>
    `;
  }

  // ===== Screens =====
  function renderLogin() {
    root.innerHTML = `
      ${renderBrand()}
      <div class="card">
        <h2 style="margin:0 0 6px;font-size:20px;font-weight:800;">처음이신가요?</h2>
        <p style="margin:0 0 18px;color:var(--muted);font-size:13px;">
          사번과 이름을 입력하면 다음부터는 자동으로 로그인됩니다.
        </p>
        <div class="field">
          <label for="eid">사번</label>
          <input class="input" id="eid" inputmode="numeric" pattern="[0-9]*"
                 maxlength="10" placeholder="예: 22807" autocomplete="off" />
        </div>
        <div class="field">
          <label for="nm">이름</label>
          <input class="input" id="nm" maxlength="20" placeholder="예: 김덕근" autocomplete="off" />
        </div>
        <button class="btn btn-primary" id="loginBtn">등록하고 시작하기</button>
      </div>
    `;

    const eid = $('#eid');
    const nm = $('#nm');
    const btn = $('#loginBtn');
    eid.focus();

    async function submit() {
      const employee_id = eid.value.trim();
      const name = nm.value.trim();
      if (!employee_id || !name) { toast('사번과 이름을 모두 입력해주세요'); return; }
      btn.disabled = true;
      btn.textContent = '등록 중...';
      try {
        const u = await api('/api/register', {
          method: 'POST',
          body: JSON.stringify({ employee_id, name })
        });
        saveUser(u);
        render();
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
        btn.textContent = '등록하고 시작하기';
      }
    }
    btn.addEventListener('click', submit);
    [eid, nm].forEach(el => el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    }));
  }

  function renderRolePicker() {
    root.innerHTML = `
      ${renderBrand()}
      <div style="margin: 8px 4px 20px;">
        <h2 style="margin:0;font-size:22px;font-weight:800;">안녕하세요, ${escape(user.name)}님 👋</h2>
        <p style="margin:6px 0 0;color:var(--muted);font-size:13px;">오늘 어떻게 사용하실까요?</p>
      </div>
      <div class="role-grid">
        <button class="role-card" data-role="applicant">
          <span class="role-emoji">🙋</span>
          <span class="role-name">신청자</span>
          <span class="role-desc">조식·야식 메뉴를 신청해요</span>
        </button>
        <button class="role-card" data-role="acting">
          <span class="role-emoji">🏃</span>
          <span class="role-name">액팅</span>
          <span class="role-desc">메뉴 확인하고 받으러 가요</span>
        </button>
      </div>
      <div style="margin-top:20px;text-align:center;">
        <button class="btn btn-ghost btn-sm" id="logoutBtn">로그아웃</button>
      </div>
    `;
    document.querySelectorAll('.role-card').forEach(c => {
      c.addEventListener('click', () => {
        saveRole(c.dataset.role);
        render();
      });
    });
    $('#logoutBtn').addEventListener('click', () => {
      if (confirm('로그아웃 하시겠습니까?')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(ROLE_KEY);
        user = null; role = null;
        render();
      }
    });
  }

  // ----- Applicant -----
  const QUICK_MENUS = {
    late_night: ['컵라면', '김밥', '햄버거', '죽', '샌드위치'],
    breakfast:  ['빵+우유', '죽', '주먹밥', '시리얼', '샌드위치']
  };

  function renderApplicant() {
    const myByType = Object.fromEntries(myOrders.map(o => [o.meal_type, o]));
    const cur = myByType[mealTab];

    root.innerHTML = `
      ${renderBrand()}
      <div class="topbar">
        <h1 style="margin:0;font-size:20px;font-weight:800;">메뉴 신청</h1>
        <button class="btn btn-ghost btn-sm" id="switchRole">역할 전환</button>
      </div>
      <p style="margin:4px 4px 16px;color:var(--muted);font-size:13px;">
        메뉴를 선택하거나 직접 입력해서 신청해요.
      </p>

      <div class="tabs">
        <button class="tab ${mealTab==='late_night'?'active':''}" data-tab="late_night">🍜 야식</button>
        <button class="tab ${mealTab==='breakfast'?'active':''}" data-tab="breakfast">🍳 조식</button>
      </div>

      <div class="card" style="margin-top:14px;">
        <div class="field" style="margin-bottom:8px;">
          <label for="menuInput">${mealEmoji(mealTab)} ${mealLabel(mealTab)} 메뉴</label>
          <textarea class="textarea" id="menuInput" maxlength="200"
            placeholder="예: 컵라면, 안 매운걸로 / 죽 (전복죽 선호)">${escape(cur?.menu || '')}</textarea>
        </div>
        <div class="quick-menu" id="quickMenu">
          ${QUICK_MENUS[mealTab].map(m => `<button data-menu="${escape(m)}">${escape(m)}</button>`).join('')}
        </div>
        <button class="btn btn-primary" id="submitBtn">
          ${cur ? '수정하기' : '신청하기'}
        </button>

        ${cur ? `
          <div class="my-order">
            <div class="meal-badge ${cur.meal_type}">${mealEmoji(cur.meal_type)}</div>
            <div class="menu">${escape(cur.menu)}</div>
            <button class="x" id="cancelMy" title="취소">✕</button>
          </div>
        ` : ''}
      </div>

      ${renderMyOtherOrders(myByType)}
    `;

    document.querySelectorAll('.tab').forEach(t =>
      t.addEventListener('click', () => { mealTab = t.dataset.tab; renderApplicant(); }));

    $('#switchRole').addEventListener('click', () => { saveRole(null); render(); });

    document.querySelectorAll('#quickMenu button').forEach(b =>
      b.addEventListener('click', () => {
        const ta = $('#menuInput');
        ta.value = b.dataset.menu;
        ta.focus();
      }));

    $('#submitBtn').addEventListener('click', async () => {
      const menu = $('#menuInput').value.trim();
      if (!menu) { toast('메뉴를 입력해주세요'); return; }
      try {
        await api('/api/orders', {
          method: 'POST',
          body: JSON.stringify({ meal_type: mealTab, menu })
        });
        toast(cur ? '메뉴를 수정했어요' : '신청 완료!');
        await loadMyOrders();
        renderApplicant();
      } catch (e) { toast(e.message); }
    });

    if (cur) {
      $('#cancelMy').addEventListener('click', async () => {
        if (!confirm(`${mealLabel(cur.meal_type)} 신청을 취소할까요?`)) return;
        try {
          await api(`/api/orders/${cur.id}`, { method: 'DELETE' });
          toast('신청이 취소되었어요');
          await loadMyOrders();
          renderApplicant();
        } catch (e) { toast(e.message); }
      });
    }
  }

  function renderMyOtherOrders(myByType) {
    const other = mealTab === 'late_night' ? myByType.breakfast : myByType.late_night;
    if (!other) return '';
    return `
      <div class="section-title">
        <h2>현재 신청 중</h2>
      </div>
      <div class="my-order" style="margin-top:0;">
        <div class="meal-badge ${other.meal_type}">${mealEmoji(other.meal_type)}</div>
        <div class="menu">
          <strong>${mealLabel(other.meal_type)}</strong> · ${escape(other.menu)}
        </div>
      </div>
    `;
  }

  // ----- Acting -----
  let actingFilter = 'all'; // 'all' | 'breakfast' | 'late_night'

  function renderActing() {
    const filtered = activeOrders.filter(o =>
      actingFilter === 'all' ? true : o.meal_type === actingFilter
    );
    const counts = {
      all: activeOrders.length,
      breakfast: activeOrders.filter(o => o.meal_type === 'breakfast').length,
      late_night: activeOrders.filter(o => o.meal_type === 'late_night').length,
    };

    root.innerHTML = `
      ${renderBrand()}
      <div class="topbar">
        <h1 style="margin:0;font-size:20px;font-weight:800;">신청 목록</h1>
        <button class="btn btn-ghost btn-sm" id="switchRole">역할 전환</button>
      </div>
      <p style="margin:4px 4px 16px;" class="refresh-hint">
        <span>카드를 누르면 바코드가 표시됩니다 · ${POLL_MS/1000}초마다 자동 갱신</span>
      </p>

      <div class="tabs" style="grid-template-columns: 1fr 1fr 1fr;">
        <button class="tab ${actingFilter==='all'?'active':''}" data-filter="all">전체 ${counts.all}</button>
        <button class="tab ${actingFilter==='late_night'?'active':''}" data-filter="late_night">🍜 야식 ${counts.late_night}</button>
        <button class="tab ${actingFilter==='breakfast'?'active':''}" data-filter="breakfast">🍳 조식 ${counts.breakfast}</button>
      </div>

      <div class="section-title">
        <h2>대기 중인 신청</h2>
        <span class="hint">탭하면 바코드 보기</span>
      </div>

      <div class="order-list" id="orderList">
        ${filtered.length === 0 ? `
          <div class="empty">
            <span class="empty-emoji">🌙</span>
            아직 신청된 메뉴가 없어요
          </div>
        ` : filtered.map(o => `
          <button class="order-card" data-id="${o.id}">
            <div class="meal-badge ${o.meal_type}">${mealEmoji(o.meal_type)}</div>
            <div class="order-body">
              <div class="order-name">
                ${escape(o.name)}
                <span class="order-eid">${escape(o.employee_id)}</span>
              </div>
              <div class="order-menu">${escape(o.menu)}</div>
            </div>
            <div class="order-chevron">›</div>
          </button>
        `).join('')}
      </div>
    `;

    $('#switchRole').addEventListener('click', () => { saveRole(null); render(); });

    document.querySelectorAll('[data-filter]').forEach(t =>
      t.addEventListener('click', () => { actingFilter = t.dataset.filter; renderActing(); }));

    document.querySelectorAll('.order-card').forEach(c =>
      c.addEventListener('click', () => {
        const id = Number(c.dataset.id);
        const order = activeOrders.find(o => o.id === id);
        if (order) openBarcodeModal(order);
      }));
  }

  // ----- Barcode Modal -----
  function openBarcodeModal(order) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div class="modal-title">${mealEmoji(order.meal_type)} ${mealLabel(order.meal_type)}</div>
          <button class="modal-close" id="closeModal" aria-label="닫기">✕</button>
        </div>
        <div class="id-name">${escape(order.name)}</div>
        <div class="id-eid">사번 ${escape(order.employee_id)}</div>
        <div class="id-menu">
          <span class="label">메뉴</span>
          ${escape(order.menu)}
        </div>
        <div class="barcode-wrap">
          <svg id="barcode"></svg>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost-light" id="modalDismiss">닫기</button>
          <button class="btn" id="markPicked">수령 완료 처리</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Render Code128 barcode
    try {
      JsBarcode('#barcode', String(order.employee_id), {
        format: 'CODE128',
        displayValue: true,
        fontSize: 16,
        height: 90,
        margin: 6,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch (e) {
      console.error('barcode error', e);
    }

    function close() {
      overlay.remove();
      document.body.style.overflow = '';
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    $('#closeModal').addEventListener('click', close);
    $('#modalDismiss').addEventListener('click', close);

    $('#markPicked').addEventListener('click', async () => {
      try {
        await api(`/api/orders/${order.id}/pickup`, { method: 'POST' });
        toast(`${order.name}님 수령 완료`);
        close();
        await loadActiveOrders();
        renderActing();
      } catch (e) { toast(e.message); }
    });
  }

  // ===== Data loading =====
  async function loadMyOrders() {
    try { myOrders = await api('/api/orders/my'); }
    catch { myOrders = []; }
  }
  async function loadActiveOrders() {
    try { activeOrders = await api('/api/orders/active'); }
    catch { activeOrders = []; }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (role === 'acting') {
        await loadActiveOrders();
        renderActing();
      } else if (role === 'applicant') {
        await loadMyOrders();
        // Avoid re-render if user is typing
        if (document.activeElement?.id !== 'menuInput') renderApplicant();
      }
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ===== Main router =====
  async function render() {
    stopPolling();
    if (!user) { renderLogin(); return; }

    // Validate user on backend (auto-login)
    try { await api('/api/me'); }
    catch {
      // backend lost user → re-register quietly with stored data
      try {
        const fresh = await api('/api/register', {
          method: 'POST',
          body: JSON.stringify({ employee_id: user.employee_id, name: user.name })
        });
        saveUser(fresh);
      } catch (e) {
        localStorage.removeItem(STORAGE_KEY);
        user = null;
        renderLogin();
        return;
      }
    }

    if (!role) { renderRolePicker(); return; }

    if (role === 'applicant') {
      await loadMyOrders();
      renderApplicant();
      startPolling();
    } else if (role === 'acting') {
      await loadActiveOrders();
      renderActing();
      startPolling();
    }
  }

  // ===== Boot =====
  loadStored();
  render();

  // Refresh when tab regains focus
  window.addEventListener('focus', () => { if (user && role) render(); });
})();
