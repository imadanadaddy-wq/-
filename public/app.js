// KNUH Meal Dashboard - frontend SPA
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const root = document.getElementById('app');

  const STORAGE_KEY = 'knuh.user.v1';
  const ROLE_KEY = 'knuh.role.v1';
  const POLL_MS = 15000;

  // Meal types ordered breakfast first throughout the app
  const MEAL_ORDER = ['breakfast', 'late_night'];

  // ===== State =====
  let user = null;          // {id, employee_id, name, is_admin}
  let role = null;          // 'applicant' | 'acting' | 'admin'
  let pollTimer = null;

  // Applicant
  let applicantStep = 'home';      // 'home' | 'date' | 'menu' | 'done'
  let draftMealType = null;        // chosen meal type during stepped flow
  let draftDates = [];             // ['YYYY-MM-DD', ...]
  let draftMenuName = '';
  let draftCustomText = '';
  let lastSubmitted = null;        // {meal_type, menu, dates, isUpdate}
  let myOrders = [];

  // Acting
  let actingStep = 'choose'; // 'choose' | 'list'
  let actingMealType = null;
  let actingDate = null;
  let activeOrders = [];
  let activeSummary = [];

  // Admin
  let adminMealTab = 'breakfast';
  let adminItems = [];

  let menuItemsCache = { breakfast: [], late_night: [] };

  // ===== Storage =====
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
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ===== Date helpers =====
  function todayStr() { return ymd(new Date()); }
  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDays(s, n) {
    const d = new Date(s + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  function nextNDays(n) {
    const out = [];
    let cur = todayStr();
    for (let i = 0; i < n; i++) { out.push(cur); cur = addDays(cur, 1); }
    return out;
  }
  const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
  function fmtDate(s, { withDow = true, withMonth = false } = {}) {
    const d = new Date(s + 'T00:00:00');
    const dow = DOW_KR[d.getDay()];
    const day = d.getDate();
    const month = d.getMonth() + 1;
    if (withMonth) return `${month}/${day} (${dow})`;
    return withDow ? `${day}일 (${dow})` : `${day}일`;
  }
  function fmtFull(s) {
    const d = new Date(s + 'T00:00:00');
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${DOW_KR[d.getDay()]})`;
  }
  function dayOfWeek(s) { return new Date(s + 'T00:00:00').getDay(); }

  // ===== Helpers =====
  function mealLabel(t) { return t === 'breakfast' ? '조식' : '야식'; }
  function mealEmoji(t) { return t === 'breakfast' ? '🍳' : '🍜'; }
  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  // Sort orders breakfast-first then by date
  function sortOrders(list) {
    return [...list].sort((a, b) => {
      if (a.service_date !== b.service_date) return a.service_date < b.service_date ? -1 : 1;
      const ai = MEAL_ORDER.indexOf(a.meal_type);
      const bi = MEAL_ORDER.indexOf(b.meal_type);
      return ai - bi;
    });
  }

  function renderBrand() {
    return `
      <div class="brand">
        <div>
          <div class="brand-logo">KNUH</div>
          <div class="brand-sub">조식·야식 신청</div>
        </div>
        ${user ? `
          <div class="user-pill">
            <span class="dot"></span>
            <span>${escape(user.name)} · ${escape(user.employee_id)}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ===== Login =====
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
    const eid = $('#eid'), nm = $('#nm'), btn = $('#loginBtn');
    eid.focus();
    async function submit() {
      const employee_id = eid.value.trim();
      const name = nm.value.trim();
      if (!employee_id || !name) { toast('사번과 이름을 모두 입력해주세요'); return; }
      btn.disabled = true; btn.textContent = '등록 중...';
      try {
        const u = await api('/api/register', {
          method: 'POST', body: JSON.stringify({ employee_id, name })
        });
        saveUser(u);
        render();
      } catch (e) {
        toast(e.message);
        btn.disabled = false; btn.textContent = '등록하고 시작하기';
      }
    }
    btn.addEventListener('click', submit);
    [eid, nm].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  }

  // ===== Role picker =====
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
        ${user.is_admin ? `
          <button class="role-card admin" data-role="admin">
            <span class="role-emoji">🛠️</span>
            <span class="role-name">관리자</span>
            <span class="role-desc">메뉴 항목 추가·삭제</span>
          </button>
        ` : ''}
      </div>
      <div style="margin-top:20px;text-align:center;">
        <button class="btn btn-ghost btn-sm" id="logoutBtn">로그아웃</button>
      </div>
    `;
    document.querySelectorAll('.role-card').forEach(c => {
      c.addEventListener('click', () => { saveRole(c.dataset.role); render(); });
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

  // ===== Date chip helpers =====
  function renderDateChips(dates, selected, withOrdersDates = new Set()) {
    const today = todayStr();
    return `
      <div class="date-grid">
        ${dates.map(d => {
          const isSel = selected.includes(d);
          const isToday = d === today;
          const dow = dayOfWeek(d);
          const dt = new Date(d + 'T00:00:00');
          const cls = [
            'date-chip',
            isSel ? 'selected' : '',
            isToday ? 'today' : '',
            dow === 0 ? 'sun' : '',
            dow === 6 ? 'sat' : '',
            withOrdersDates.has(d) ? 'has-orders' : '',
          ].filter(Boolean).join(' ');
          return `
            <button class="${cls}" data-date="${d}">
              <span class="dow">${DOW_KR[dow]}</span>
              <span class="day">${dt.getDate()}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  // ===== APPLICANT - Stepped flow =====

  function applicantHeader(title, opts = {}) {
    // opts: { onBack: bool, step: 0..3 (0 = hidden), totalSteps: 3 }
    const showStep = typeof opts.step === 'number' && opts.step > 0;
    return `
      <div class="step-top">
        ${opts.onBack ? `<button class="icon-btn" id="stepBack" aria-label="뒤로">‹</button>`
                     : `<button class="icon-btn" id="stepClose" aria-label="홈으로">✕</button>`}
        <div class="step-title">${escape(title)}</div>
        ${showStep ? `<div class="step-indicator">${opts.step}/${opts.totalSteps || 3}</div>`
                  : `<div class="step-indicator-spacer"></div>`}
      </div>
    `;
  }

  function renderApplicantHome() {
    const sorted = sortOrders(myOrders);

    root.innerHTML = `
      ${renderBrand()}
      <div class="topbar">
        <h1>메뉴 신청</h1>
        <button class="btn btn-ghost btn-sm" id="switchRole">역할 전환</button>
      </div>

      ${sorted.length === 0 ? `
        <p style="margin:8px 4px 18px;color:var(--muted);font-size:13px;">
          어떤 식사를 신청하시겠어요?
        </p>
        <div class="choice-grid">
          <button class="choice-card breakfast" data-meal="breakfast">
            <span class="emoji">🍳</span>
            <span class="name">조식</span>
            <span class="count">아침 식사</span>
          </button>
          <button class="choice-card late_night" data-meal="late_night">
            <span class="emoji">🍜</span>
            <span class="name">야식</span>
            <span class="count">밤 야식</span>
          </button>
        </div>
      ` : `
        <div class="section-title" style="margin-top:14px;">
          <h2>내 신청 현황</h2>
          <span class="hint">탭하면 바코드 · ${sorted.length}건</span>
        </div>
        <div class="my-orders-list">
          ${sorted.map((o, i) => `
            <div class="my-order-row">
              <button class="my-order-main" data-view-idx="${i}">
                <div class="meal-badge ${o.meal_type}">${mealEmoji(o.meal_type)}</div>
                <div class="info">
                  <div class="date">${fmtFull(o.service_date)} · ${mealLabel(o.meal_type)}</div>
                  <div class="menu">${escape(o.menu)}</div>
                </div>
                <span class="view-hint">바코드 ›</span>
              </button>
              <button class="x" data-cancel-id="${o.id}" title="취소">✕</button>
            </div>
          `).join('')}
        </div>

        <div style="margin-top:18px;">
          <div class="add-meal-row">
            <button class="btn btn-primary add-half breakfast-btn" data-meal="breakfast">
              <span style="font-size:18px;">🍳</span> 조식 신청
            </button>
            <button class="btn btn-primary add-half late_night-btn" data-meal="late_night">
              <span style="font-size:18px;">🍜</span> 야식 신청
            </button>
          </div>
        </div>
      `}
    `;

    $('#switchRole').addEventListener('click', () => { saveRole(null); render(); });

    document.querySelectorAll('[data-meal]').forEach(b =>
      b.addEventListener('click', () => {
        draftMealType = b.dataset.meal;
        draftDates = [todayStr()];
        draftMenuName = '';
        draftCustomText = '';
        applicantStep = 'date';
        renderApplicantStep();
      }));

    document.querySelectorAll('[data-view-idx]').forEach(b =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.viewIdx);
        openOrderViewer(sortOrders(myOrders), i, { allowPickup: false });
      }));

    document.querySelectorAll('[data-cancel-id]').forEach(b =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('이 신청을 취소할까요?')) return;
        try {
          await api(`/api/orders/${b.dataset.cancelId}`, { method: 'DELETE' });
          toast('취소되었습니다');
          await loadMyOrders();
          renderApplicantHome();
        } catch (e) { toast(e.message); }
      }));
  }

  function renderApplicantStep() {
    if (applicantStep === 'date') renderApplicantDate();
    else if (applicantStep === 'menu') renderApplicantMenu();
    else if (applicantStep === 'done') renderApplicantDone();
    else renderApplicantHome();
  }

  function renderApplicantDate() {
    const dates = nextNDays(7);
    const existing = new Set(
      myOrders.filter(o => o.meal_type === draftMealType).map(o => o.service_date)
    );

    root.innerHTML = `
      ${renderBrand()}
      ${applicantHeader(`${mealEmoji(draftMealType)} ${mealLabel(draftMealType)} 신청`, { onBack: true, step: 1, totalSteps: 3 })}

      <div class="card step-card">
        <h2 class="step-h">날짜 선택</h2>
        <p class="step-desc">여러 날짜를 한번에 선택할 수 있어요. 이미 신청한 날은 점으로 표시됩니다.</p>

        <div class="date-quick">
          <button data-quick="today">오늘</button>
          <button data-quick="tomorrow">내일</button>
          <button data-quick="3">앞으로 3일</button>
          <button data-quick="clear">초기화</button>
        </div>

        ${renderDateChips(dates, draftDates, existing)}
      </div>

      <div class="step-action">
        <button class="btn btn-primary" id="stepNext" ${draftDates.length === 0 ? 'disabled' : ''}>
          ${draftDates.length === 0 ? '날짜를 선택해주세요'
            : `${draftDates.length}일 선택 · 다음으로`}
        </button>
      </div>
    `;

    $('#stepBack').addEventListener('click', goHome);

    document.querySelectorAll('[data-date]').forEach(b =>
      b.addEventListener('click', () => {
        const d = b.dataset.date;
        const i = draftDates.indexOf(d);
        if (i >= 0) draftDates.splice(i, 1);
        else draftDates.push(d);
        draftDates.sort();
        renderApplicantDate();
      }));

    document.querySelectorAll('[data-quick]').forEach(b =>
      b.addEventListener('click', () => {
        const q = b.dataset.quick;
        if (q === 'today') draftDates = [todayStr()];
        else if (q === 'tomorrow') draftDates = [addDays(todayStr(), 1)];
        else if (q === '3') draftDates = nextNDays(3);
        else if (q === 'clear') draftDates = [];
        renderApplicantDate();
      }));

    $('#stepNext').addEventListener('click', () => {
      if (draftDates.length === 0) return;
      // If single date and existing order present, pre-fill menu
      if (draftDates.length === 1) {
        const ex = myOrders.find(o => o.service_date === draftDates[0] && o.meal_type === draftMealType);
        if (ex) draftCustomText = ex.menu;
      }
      applicantStep = 'menu';
      renderApplicantStep();
    });
  }

  function renderApplicantMenu() {
    const items = menuItemsCache[draftMealType] || [];
    const dateLabel = draftDates.length === 1
      ? fmtFull(draftDates[0])
      : `${draftDates.length}일 (${draftDates.map(d => fmtDate(d, { withDow: false })).join(', ')})`;

    root.innerHTML = `
      ${renderBrand()}
      ${applicantHeader(`${mealEmoji(draftMealType)} ${mealLabel(draftMealType)} 신청`, { onBack: true, step: 2, totalSteps: 3 })}

      <div class="card step-card">
        <h2 class="step-h">메뉴 선택</h2>
        <p class="step-desc">${escape(dateLabel)}</p>

        ${items.length === 0 ? `
          <div class="empty" style="margin-top:8px;">
            <span class="empty-emoji">📭</span>
            등록된 메뉴가 없습니다. 직접 입력으로 신청해주세요.
          </div>
        ` : `
          <div class="menu-grid">
            ${items.map(it => `
              <button class="menu-chip ${draftMenuName===it.name?'selected':''}" data-menu="${escape(it.name)}">
                ${escape(it.name)}
              </button>
            `).join('')}
          </div>
        `}

        <div class="field" style="margin-top:14px;margin-bottom:0;">
          <label for="menuInput">직접 입력 (선택)</label>
          <textarea class="textarea" id="menuInput" maxlength="200"
            placeholder="예: 컵라면, 안 매운걸로 / 죽 (전복죽 선호)">${escape(draftCustomText)}</textarea>
        </div>
      </div>

      <div class="step-action">
        <button class="btn btn-primary" id="stepSubmit">
          ${draftDates.length === 1 ? '신청하기' : `${draftDates.length}일 신청하기`}
        </button>
      </div>
    `;

    $('#stepBack').addEventListener('click', () => {
      applicantStep = 'date';
      renderApplicantStep();
    });

    document.querySelectorAll('[data-menu]').forEach(b =>
      b.addEventListener('click', () => {
        draftMenuName = b.dataset.menu;
        draftCustomText = '';
        renderApplicantMenu();
      }));

    const ta = $('#menuInput');
    ta.addEventListener('input', () => {
      draftCustomText = ta.value;
      if (draftCustomText && draftMenuName) {
        draftMenuName = '';
        document.querySelectorAll('.menu-chip.selected').forEach(c => c.classList.remove('selected'));
      }
    });

    $('#stepSubmit').addEventListener('click', async () => {
      const menu = (draftCustomText || ta.value || '').trim() || draftMenuName;
      if (!menu) { toast('메뉴를 선택하거나 입력해주세요'); return; }

      const btn = $('#stepSubmit');
      btn.disabled = true; btn.textContent = '신청 중...';

      try {
        const r = await api('/api/orders/batch', {
          method: 'POST',
          body: JSON.stringify({ meal_type: draftMealType, menu, dates: draftDates })
        });
        lastSubmitted = {
          meal_type: draftMealType,
          menu,
          dates: [...draftDates],
          created: r.created,
          updated: r.updated,
        };
        await loadMyOrders();
        applicantStep = 'done';
        renderApplicantStep();
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
        btn.textContent = draftDates.length === 1 ? '신청하기' : `${draftDates.length}일 신청하기`;
      }
    });
  }

  function renderApplicantDone() {
    if (!lastSubmitted) { goHome(); return; }
    const { meal_type, menu, dates, created, updated } = lastSubmitted;
    const summaryText = [
      created.length ? `${created.length}일 신청` : '',
      updated.length ? `${updated.length}일 수정` : '',
    ].filter(Boolean).join(' · ');

    // Sort dates breakfast-first ordering applies elsewhere; here just sort dates ascending
    const sortedDates = [...dates].sort();

    root.innerHTML = `
      ${renderBrand()}
      ${applicantHeader('신청 완료', { onBack: false, step: 3, totalSteps: 3 })}

      <div class="card step-card done-card">
        <div class="done-emoji">✅</div>
        <h2 class="done-h">${escape(summaryText || '신청 완료')}</h2>
        <p class="step-desc" style="text-align:center;">
          ${mealEmoji(meal_type)} ${mealLabel(meal_type)} · ${escape(menu)}
        </p>
        <ul class="done-dates">
          ${sortedDates.map(d => `<li>${fmtFull(d)}</li>`).join('')}
        </ul>
        <div class="done-actions">
          <button class="btn" id="doneViewBarcode">📱 내 바코드 보기</button>
          <button class="btn btn-primary" id="doneHome">홈으로</button>
        </div>
        <p class="muted-note" style="text-align:center;margin-top:10px;">
          현황은 언제든 홈에서 다시 볼 수 있어요.
        </p>
      </div>
    `;

    $('#stepClose').addEventListener('click', goHome);
    $('#doneHome').addEventListener('click', goHome);
    $('#doneViewBarcode').addEventListener('click', () => {
      // Open viewer focused on the first date of this submission
      const sorted = sortOrders(myOrders);
      const target = sorted.findIndex(o =>
        o.meal_type === meal_type && sortedDates.includes(o.service_date)
      );
      if (target >= 0) {
        openOrderViewer(sorted, target, { allowPickup: false });
      } else {
        toast('바코드를 표시할 신청이 없습니다');
      }
    });
  }

  function goHome() {
    applicantStep = 'home';
    draftMealType = null;
    draftDates = [];
    draftMenuName = '';
    draftCustomText = '';
    renderApplicantHome();
  }

  function renderApplicant() {
    if (applicantStep === 'home') renderApplicantHome();
    else renderApplicantStep();
  }

  // ===== ACTING =====
  async function renderActingChoose() {
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    const countFor = (mt, d) => {
      const r = activeSummary.find(x => x.service_date === d && x.meal_type === mt);
      return r ? r.n : 0;
    };
    const totalFor = (mt) => activeSummary.filter(x => x.meal_type === mt).reduce((s, x) => s + x.n, 0);

    root.innerHTML = `
      ${renderBrand()}
      <div class="topbar">
        <h1>액팅</h1>
        <button class="btn btn-ghost btn-sm" id="switchRole">역할 전환</button>
      </div>
      <p style="margin:4px 4px 16px;color:var(--muted);font-size:13px;">
        먼저 어떤 식사를 보러 가실지 선택하세요.
      </p>
      <div class="choice-grid">
        <button class="choice-card breakfast" data-meal="breakfast">
          <span class="emoji">🍳</span>
          <span class="name">조식</span>
          <span class="count">오늘 ${countFor('breakfast', today)} · 내일 ${countFor('breakfast', tomorrow)} · 전체 ${totalFor('breakfast')}</span>
        </button>
        <button class="choice-card late_night" data-meal="late_night">
          <span class="emoji">🍜</span>
          <span class="name">야식</span>
          <span class="count">오늘 ${countFor('late_night', today)} · 내일 ${countFor('late_night', tomorrow)} · 전체 ${totalFor('late_night')}</span>
        </button>
      </div>
    `;

    $('#switchRole').addEventListener('click', () => { saveRole(null); render(); });
    document.querySelectorAll('[data-meal]').forEach(c =>
      c.addEventListener('click', () => {
        actingMealType = c.dataset.meal;
        actingDate = todayStr();
        actingStep = 'list';
        renderActing();
      }));
  }

  async function renderActingList() {
    const dates = nextNDays(7);
    const withOrders = new Set(
      activeSummary.filter(x => x.meal_type === actingMealType).map(x => x.service_date)
    );
    const countOnDate = activeOrders.length;

    root.innerHTML = `
      ${renderBrand()}
      <div class="topbar">
        <button class="btn btn-ghost btn-sm" id="backBtn">← 뒤로</button>
        <h1 style="flex:1;text-align:center;font-size:18px;">
          ${mealEmoji(actingMealType)} ${mealLabel(actingMealType)}
        </h1>
        <button class="btn btn-ghost btn-sm" id="switchRole">전환</button>
      </div>

      <div class="section-title" style="margin-top:14px;">
        <h2>날짜</h2>
        <span class="hint">${fmtFull(actingDate)}</span>
      </div>
      ${renderDateChips(dates, [actingDate], withOrders)}

      <div class="section-title">
        <h2>대기 중 (${countOnDate}건)</h2>
        <span class="hint">탭하면 바코드</span>
      </div>

      <div class="order-list">
        ${activeOrders.length === 0 ? `
          <div class="empty">
            <span class="empty-emoji">🌙</span>
            ${fmtDate(actingDate)} ${mealLabel(actingMealType)} 신청이 없어요
          </div>
        ` : activeOrders.map(o => `
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

    $('#backBtn').addEventListener('click', () => { actingStep = 'choose'; render(); });
    $('#switchRole').addEventListener('click', () => { saveRole(null); render(); });

    document.querySelectorAll('[data-date]').forEach(b =>
      b.addEventListener('click', async () => {
        actingDate = b.dataset.date;
        await loadActiveOrders();
        renderActing();
      }));

    document.querySelectorAll('.order-card').forEach(c =>
      c.addEventListener('click', () => {
        const id = Number(c.dataset.id);
        const startIdx = activeOrders.findIndex(o => o.id === id);
        if (startIdx >= 0) {
          openOrderViewer(activeOrders, startIdx, {
            allowPickup: true,
            onDataChanged: async () => {
              await Promise.all([loadActiveOrders(), loadActiveSummary()]);
              renderActing();
            }
          });
        }
      }));
  }

  function renderActing() {
    if (actingStep === 'choose') renderActingChoose();
    else renderActingList();
  }

  // ===== Order viewer (swipeable, used by acting & applicant) =====
  function openOrderViewer(initialOrders, startIndex = 0, opts = {}) {
    if (!initialOrders || initialOrders.length === 0) {
      toast('표시할 항목이 없습니다');
      return;
    }
    const allowPickup = !!opts.allowPickup;
    let orders = [...initialOrders];
    let idx = Math.max(0, Math.min(startIndex, orders.length - 1));
    let dataChanged = false;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="viewer-content" id="viewerContent"></div>
        <div class="viewer-nav">
          <button class="nav-btn" id="navPrev" aria-label="이전">‹</button>
          <div class="viewer-indicator">
            <span id="viewerCount"></span>
            <span class="swipe-hint"></span>
          </div>
          <button class="nav-btn" id="navNext" aria-label="다음">›</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const content = overlay.querySelector('#viewerContent');
    const prevBtn = overlay.querySelector('#navPrev');
    const nextBtn = overlay.querySelector('#navNext');
    const countEl = overlay.querySelector('#viewerCount');

    function renderCard(animDir = 0) {
      if (orders.length === 0) { close(); return; }
      if (idx >= orders.length) idx = orders.length - 1;
      if (idx < 0) idx = 0;
      const order = orders[idx];

      const card = document.createElement('div');
      card.className = 'viewer-card';
      if (animDir > 0) card.classList.add('enter-right');
      else if (animDir < 0) card.classList.add('enter-left');
      card.innerHTML = `
        <div class="modal-header">
          <div class="modal-title">${mealEmoji(order.meal_type)} ${mealLabel(order.meal_type)} · ${fmtDate(order.service_date, { withMonth: true })}</div>
          <button class="modal-close" data-action="close" aria-label="닫기">✕</button>
        </div>
        <div class="id-name">${escape(order.name || user.name)}</div>
        <div class="id-eid">사번 ${escape(order.employee_id || user.employee_id)}</div>
        <div class="id-menu">
          <span class="label">메뉴</span>
          ${escape(order.menu)}
        </div>
        <div class="barcode-wrap">
          <svg class="barcode-svg"></svg>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost-light" data-action="close">닫기</button>
          ${allowPickup ? `<button class="btn" data-action="pickup">수령 완료 · 다음</button>` : ''}
        </div>
      `;

      content.innerHTML = '';
      content.appendChild(card);

      try {
        JsBarcode(card.querySelector('.barcode-svg'), String(order.employee_id || user.employee_id), {
          format: 'CODE128', displayValue: true, fontSize: 16,
          height: 90, margin: 6, background: '#ffffff', lineColor: '#000000',
        });
      } catch (e) { console.error('barcode error', e); }

      countEl.textContent = orders.length > 1 ? `${idx + 1} / ${orders.length}` : '';
      prevBtn.style.visibility = orders.length > 1 ? 'visible' : 'hidden';
      nextBtn.style.visibility = orders.length > 1 ? 'visible' : 'hidden';
      prevBtn.disabled = idx === 0;
      nextBtn.disabled = idx === orders.length - 1;
    }

    function go(dir) {
      if (dir < 0 && idx > 0) { idx--; renderCard(-1); }
      else if (dir > 0 && idx < orders.length - 1) { idx++; renderCard(1); }
      else {
        const card = content.firstElementChild;
        if (card) {
          card.style.transition = 'transform .12s';
          card.style.transform = `translateX(${dir > 0 ? -12 : 12}px)`;
          setTimeout(() => { card.style.transform = ''; setTimeout(() => card.style.transition = '', 150); }, 120);
        }
      }
    }

    async function doPickup() {
      if (!allowPickup) return;
      const order = orders[idx];
      const btn = content.querySelector('[data-action="pickup"]');
      if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
      try {
        await api(`/api/orders/${order.id}/pickup`, { method: 'POST' });
        toast(`${order.name}님 수령 완료`);
        dataChanged = true;
        orders.splice(idx, 1);
        if (orders.length === 0) { close(); return; }
        if (idx >= orders.length) idx = orders.length - 1;
        renderCard(1);
      } catch (e) {
        toast(e.message);
        if (btn) { btn.disabled = false; btn.textContent = '수령 완료 · 다음'; }
      }
    }

    function close() {
      overlay.removeEventListener('click', overlayClick);
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
      document.body.style.overflow = '';
      if (dataChanged && typeof opts.onDataChanged === 'function') opts.onDataChanged();
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    function overlayClick(e) {
      if (e.target === overlay) { close(); return; }
      const action = e.target.closest?.('[data-action]')?.dataset.action;
      if (action === 'close') close();
      else if (action === 'pickup') doPickup();
    }
    overlay.addEventListener('click', overlayClick);
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));

    function keyHandler(e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (allowPickup && e.key === 'Enter') { e.preventDefault(); doPickup(); }
    }
    document.addEventListener('keydown', keyHandler);

    // Touch swipe
    let startX = null, startY = null, dragX = 0, isDragging = false;
    const SWIPE_THRESHOLD = 55;

    content.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = false;
      dragX = 0;
    }, { passive: true });

    content.addEventListener('touchmove', (e) => {
      if (startX === null) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!isDragging) {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
          isDragging = true;
        } else if (Math.abs(dy) > 12) {
          startX = null; return;
        } else return;
      }
      dragX = dx;
      const card = content.firstElementChild;
      if (card) {
        let applied = dx;
        if ((idx === 0 && dx > 0) || (idx === orders.length - 1 && dx < 0)) {
          applied = dx * 0.3;
        }
        card.style.transition = 'none';
        card.style.transform = `translateX(${applied}px)`;
        card.style.opacity = String(Math.max(0.4, 1 - Math.abs(applied) / 420));
      }
    }, { passive: true });

    content.addEventListener('touchend', () => {
      if (startX === null) return;
      const card = content.firstElementChild;
      if (!isDragging) { startX = null; return; }
      isDragging = false;
      const moved = dragX;
      startX = null; startY = null; dragX = 0;
      if (card) {
        card.style.transition = '';
        if (moved < -SWIPE_THRESHOLD && idx < orders.length - 1) go(1);
        else if (moved > SWIPE_THRESHOLD && idx > 0) go(-1);
        else { card.style.transform = ''; card.style.opacity = ''; }
      }
    });

    renderCard(0);
    return { close };
  }

  // ===== ADMIN =====
  async function renderAdmin() {
    const items = adminItems.filter(i => i.meal_type === adminMealTab);

    root.innerHTML = `
      ${renderBrand()}
      <div class="topbar">
        <h1>🛠️ 관리자</h1>
        <button class="btn btn-ghost btn-sm" id="switchRole">역할 전환</button>
      </div>
      <p style="margin:4px 4px 16px;color:var(--muted);font-size:13px;">
        메뉴 항목을 추가·삭제하거나 일시적으로 숨길 수 있어요. 신청자 화면에 즉시 반영됩니다.
      </p>

      <div class="tabs">
        <button class="tab ${adminMealTab==='breakfast'?'active':''}" data-tab="breakfast">🍳 조식 메뉴</button>
        <button class="tab ${adminMealTab==='late_night'?'active':''}" data-tab="late_night">🍜 야식 메뉴</button>
      </div>

      <div class="section-title">
        <h2>${mealLabel(adminMealTab)} 메뉴 (${items.filter(i=>i.active).length}개 활성)</h2>
      </div>

      <div class="admin-list">
        ${items.length === 0 ? `
          <div class="empty">
            <span class="empty-emoji">📭</span>
            아직 등록된 메뉴가 없습니다
          </div>
        ` : items.map(it => `
          <div class="admin-row ${it.active ? '' : 'inactive'}">
            <div class="name">${escape(it.name)}</div>
            <button data-toggle="${it.id}" data-active="${it.active}">${it.active ? '숨기기' : '보이기'}</button>
            <button class="del" data-del="${it.id}" data-name="${escape(it.name)}">삭제</button>
          </div>
        `).join('')}
      </div>

      <div class="section-title">
        <h2>새 메뉴 추가</h2>
      </div>
      <div class="add-row">
        <input class="input" id="newName" maxlength="50" placeholder="예: 컵라면" />
        <button class="btn btn-primary" id="addBtn">추가</button>
      </div>
      <p class="muted-note">활성(보이기) 상태인 항목만 신청자에게 보입니다. 사용 안하는 메뉴는 숨기거나 삭제하세요.</p>
    `;

    $('#switchRole').addEventListener('click', () => { saveRole(null); render(); });

    document.querySelectorAll('.tab').forEach(t =>
      t.addEventListener('click', () => { adminMealTab = t.dataset.tab; renderAdmin(); }));

    document.querySelectorAll('[data-toggle]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.toggle);
        const newActive = b.dataset.active !== '1';
        try {
          await api(`/api/menu-items/${id}`, {
            method: 'PATCH', body: JSON.stringify({ active: newActive })
          });
          await loadAdminItems();
          renderAdmin();
        } catch (e) { toast(e.message); }
      }));

    document.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = Number(b.dataset.del);
        const name = b.dataset.name;
        if (!confirm(`"${name}" 메뉴를 삭제할까요? (기존 신청 내용에는 영향 없음)`)) return;
        try {
          await api(`/api/menu-items/${id}`, { method: 'DELETE' });
          toast('삭제되었습니다');
          await loadAdminItems();
          renderAdmin();
        } catch (e) { toast(e.message); }
      }));

    const input = $('#newName');
    async function addMenu() {
      const name = input.value.trim();
      if (!name) { toast('메뉴 이름을 입력해주세요'); return; }
      try {
        await api('/api/menu-items', {
          method: 'POST',
          body: JSON.stringify({ meal_type: adminMealTab, name })
        });
        toast('추가되었습니다');
        input.value = '';
        await loadAdminItems();
        renderAdmin();
      } catch (e) { toast(e.message); }
    }
    $('#addBtn').addEventListener('click', addMenu);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') addMenu(); });
  }

  // ===== Data loaders =====
  async function loadMyOrders() {
    try { myOrders = await api('/api/orders/my'); } catch { myOrders = []; }
  }
  async function loadActiveOrders() {
    if (!actingMealType || !actingDate) { activeOrders = []; return; }
    try {
      activeOrders = await api(`/api/orders/active?meal_type=${actingMealType}&date=${actingDate}`);
    } catch { activeOrders = []; }
  }
  async function loadActiveSummary() {
    try { activeSummary = await api('/api/orders/active/summary?days=7'); }
    catch { activeSummary = []; }
  }
  async function loadMenuItems() {
    try {
      const items = await api('/api/menu-items');
      menuItemsCache = { breakfast: [], late_night: [] };
      for (const it of items) {
        if (menuItemsCache[it.meal_type]) menuItemsCache[it.meal_type].push(it);
      }
    } catch { menuItemsCache = { breakfast: [], late_night: [] }; }
  }
  async function loadAdminItems() {
    try { adminItems = await api('/api/menu-items?include_inactive=1'); }
    catch { adminItems = []; }
  }

  // ===== Polling =====
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        if (role === 'acting') {
          await loadActiveSummary();
          if (actingStep === 'list') {
            await loadActiveOrders();
            renderActing();
          } else {
            renderActing();
          }
        } else if (role === 'applicant') {
          // Only refresh home view automatically; in the middle of a step, don't disturb
          if (applicantStep === 'home') {
            await loadMyOrders();
            renderApplicantHome();
          }
        }
      } catch {}
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ===== Router =====
  async function render() {
    stopPolling();
    if (!user) { renderLogin(); return; }

    try {
      const fresh = await api('/api/me');
      saveUser(fresh);
    } catch {
      try {
        const fresh = await api('/api/register', {
          method: 'POST',
          body: JSON.stringify({ employee_id: user.employee_id, name: user.name })
        });
        saveUser(fresh);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        user = null; renderLogin(); return;
      }
    }

    if (role === 'admin' && !user.is_admin) saveRole(null);

    if (!role) { renderRolePicker(); return; }

    if (role === 'applicant') {
      await Promise.all([loadMyOrders(), loadMenuItems()]);
      renderApplicant();
      startPolling();
    } else if (role === 'acting') {
      await loadActiveSummary();
      if (actingStep === 'list' && actingMealType) {
        if (!actingDate) actingDate = todayStr();
        await loadActiveOrders();
      }
      renderActing();
      startPolling();
    } else if (role === 'admin') {
      await loadAdminItems();
      renderAdmin();
    }
  }

  // Boot
  loadStored();
  render();
  window.addEventListener('focus', () => { if (user && role) render(); });
})();
