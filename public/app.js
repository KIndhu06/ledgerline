(() => {
  'use strict';

  // The login token lives only in memory. Refreshing the page signs you out.
  const state = { token: null, user: null, accounts: [], selectedId: null, tab: null };
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const MAX_PAISE = 100000000n;

  // ---------- small helpers ----------
  // Builds elements with textContent only, so account names, emails and audit
  // details from the server can never be run as HTML.
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
    }
    return node;
  }

  let toastTimer = null;
  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = 'show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, 3500);
  }

  // Money is whole paise. 100 paise = 1 rupee. BigInt avoids rounding errors.
  function inr(value) {
    let n;
    try { n = BigInt(value); } catch (e) { return '₹—'; }
    const negative = n < 0n;
    if (negative) n = -n;
    const whole = new Intl.NumberFormat('en-IN').format(n / 100n);
    const frac = String(n % 100n).padStart(2, '0');
    return (negative ? '-' : '') + '₹' + whole + '.' + frac;
  }

  function parseRupees(text) {
    const t = String(text).trim();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
    const parts = t.split('.');
    const paise = BigInt(parts[0]) * 100n + BigInt(((parts[1] || '') + '00').slice(0, 2));
    if (paise < 1n || paise > MAX_PAISE) return null;
    return Number(paise);
  }

  function when(value) {
    const d = new Date(value);
    return isNaN(d) ? '' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function newKey() {
    return 'web-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2, 10));
  }

  const isStaff = () => state.user && (state.user.role === 'admin' || state.user.role === 'auditor');

  // ---------- talking to the server ----------
  async function api(method, path, body, headers) {
    const all = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
    if (state.token) all.Authorization = 'Bearer ' + state.token;
    let res;
    try {
      res = await fetch(path, { method, headers: all, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new Error('Cannot reach the server. Check your connection and try again.');
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
    if (res.status === 401 && state.token) {
      signOut('Your session ended. Please sign in again.');
      throw new Error('Session ended');
    }
    if (!res.ok) {
      const fallback = res.status === 403 ? 'That request was blocked.' : 'Something went wrong (' + res.status + ').';
      throw new Error((data && data.error) || fallback);
    }
    return data;
  }

  function signOut(notice) {
    state.token = null; state.user = null; state.accounts = []; state.selectedId = null; state.tab = null;
    renderAuth(notice);
  }

  // ---------- sign in / register ----------
  function renderAuth(notice) {
    app.replaceChildren();
    let mode = 'login';

    const email = h('input', { id: 'email', type: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com' });
    const password = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true, placeholder: 'Your password' });
    const hint = h('p', { class: 'hint', hidden: true }, 'Use 10 to 72 characters.');
    const error = h('p', { class: 'form-error', role: 'alert' }, notice || '');
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');
    const tabLogin = h('button', { type: 'button', class: 'seg active' }, 'Sign in');
    const tabRegister = h('button', { type: 'button', class: 'seg' }, 'Create account');

    function setMode(next) {
      mode = next;
      tabLogin.classList.toggle('active', next === 'login');
      tabRegister.classList.toggle('active', next === 'register');
      submit.textContent = next === 'login' ? 'Sign in' : 'Create account';
      password.setAttribute('autocomplete', next === 'login' ? 'current-password' : 'new-password');
      hint.hidden = next === 'login';
      error.textContent = '';
    }
    tabLogin.addEventListener('click', () => setMode('login'));
    tabRegister.addEventListener('click', () => setMode('register'));

    const form = h('form', { novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
      h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), password),
      hint, error, submit);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      if (!email.value.trim() || !password.value) { error.textContent = 'Enter your email and password.'; return; }
      submit.disabled = true;
      try {
        const creds = { email: email.value, password: password.value };
        if (mode === 'register') await api('POST', '/api/auth/register', creds);
        const out = await api('POST', '/api/auth/login', creds);
        state.token = out.token;
        state.user = out.user;
        await enterApp();
      } catch (e) {
        error.textContent = e.message;
        submit.disabled = false;
      }
    });

    app.append(h('div', { class: 'auth-wrap' },
      h('div', { class: 'auth-card' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'L'), 'LedgerLine'),
        h('p', { class: 'tagline' }, 'Money movement with a ledger you can prove.'),
        h('div', { class: 'segmented' }, tabLogin, tabRegister),
        form)));
    email.focus();
  }

  // ---------- app shell ----------
  async function enterApp() {
    state.tab = isStaff() ? 'accounts' : 'overview';
    await loadAccounts();
    renderShell();
  }

  async function loadAccounts() {
    state.accounts = await api('GET', '/api/accounts');
    const ids = state.accounts.map((a) => String(a.id));
    if (!ids.includes(String(state.selectedId))) {
      state.selectedId = state.accounts.length ? state.accounts[0].id : null;
    }
  }

  function renderShell() {
    app.replaceChildren();
    const main = h('main');
    app.append(
      h('header', { class: 'topbar' },
        h('div', { class: 'topbar-inner' },
          h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'L'), 'LedgerLine'),
          h('div', { class: 'user-chip' },
            h('span', { class: 'email' }, state.user.email),
            h('span', { class: 'role' }, state.user.role),
            h('button', { class: 'btn', type: 'button', onclick: () => signOut('You have been signed out.') }, 'Sign out')))),
      main);
    if (isStaff()) renderStaff(main); else renderHolder(main);
  }

  // ---------- statement (shared) ----------
  async function fillStatement(box, accountId) {
    box.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
    try {
      const rows = await api('GET', '/api/accounts/' + accountId + '/entries');
      if (!rows.length) { box.replaceChildren(h('p', { class: 'empty' }, 'No transactions yet.')); return; }
      const body = h('tbody');
      for (const r of rows) {
        const amount = BigInt(r.amount);
        body.append(h('tr', {},
          h('td', {}, when(r.created_at)),
          h('td', {}, h('span', { class: 'pill' }, r.type)),
          h('td', {}, '#' + r.transaction_id),
          h('td', { class: 'num' }, h('span', { class: amount >= 0n ? 'pos' : 'neg' }, (amount >= 0n ? '+' : '') + inr(amount)))));
      }
      box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Type'), h('th', {}, 'Ref'), h('th', { class: 'num' }, 'Amount'))),
        body)));
    } catch (e) {
      box.replaceChildren(h('p', { class: 'form-error' }, e.message));
    }
  }

  // ---------- holder view ----------
  function renderHolder(main) {
    const accountsBox = h('div');
    const statementBox = h('div');
    const statementTitle = h('h2', {}, 'Statement');

    function drawAccounts() {
      accountsBox.replaceChildren();
      if (!state.accounts.length) {
        accountsBox.append(h('p', { class: 'empty' }, 'You have no accounts yet. Create your first one below.'));
      } else {
        const grid = h('div', { class: 'account-grid' });
        for (const a of state.accounts) {
          grid.append(h('button', {
            type: 'button',
            class: 'account-card' + (String(a.id) === String(state.selectedId) ? ' selected' : ''),
            onclick: () => { state.selectedId = a.id; drawAccounts(); drawStatement(); drawMoveForm(); },
          },
          h('div', { class: 'name' }, a.name),
          h('div', { class: 'num' }, 'Account #' + a.id),
          h('div', { class: 'bal' }, inr(a.balance))));
        }
        accountsBox.append(grid);
      }
      const nameInput = h('input', { type: 'text', maxlength: '60', placeholder: 'New account name', 'aria-label': 'New account name' });
      const addBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Create');
      const addForm = h('form', { class: 'inline-form' }, nameInput, addBtn);
      addForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (!name) { toast('Give the account a name.', 'error'); return; }
        addBtn.disabled = true;
        try {
          const created = await api('POST', '/api/accounts', { name });
          state.selectedId = created.id;
          await loadAccounts();
          drawAll();
          toast('Account created.', 'success');
        } catch (e) { toast(e.message, 'error'); addBtn.disabled = false; }
      });
      accountsBox.append(addForm);
    }

    function drawStatement() {
      const acc = state.accounts.find((a) => String(a.id) === String(state.selectedId));
      statementTitle.textContent = acc ? 'Statement · ' + acc.name : 'Statement';
      if (!acc) { statementBox.replaceChildren(h('p', { class: 'empty' }, 'Select an account to see its statement.')); return; }
      fillStatement(statementBox, acc.id);
    }

    // money form
    const moveBox = h('div');
    let kind = 'deposit';
    function drawMoveForm() {
      moveBox.replaceChildren();
      if (!state.accounts.length) { moveBox.append(h('p', { class: 'empty' }, 'Create an account to move money.')); return; }

      const tabs = h('div', { class: 'tabs' });
      for (const [k, label] of [['deposit', 'Deposit'], ['withdraw', 'Withdraw'], ['transfer', 'Transfer']]) {
        tabs.append(h('button', { type: 'button', class: 'tab' + (kind === k ? ' active' : ''),
          onclick: () => { kind = k; drawMoveForm(); } }, label));
      }

      const select = h('select', { id: 'acct' });
      for (const a of state.accounts) {
        const opt = h('option', { value: String(a.id) }, a.name + ' (#' + a.id + ') · ' + inr(a.balance));
        if (String(a.id) === String(state.selectedId)) opt.selected = true;
        select.append(opt);
      }
      const destination = h('input', { id: 'dest', type: 'text', inputmode: 'numeric', placeholder: 'e.g. 12', autocomplete: 'off' });
      const amount = h('input', { id: 'amt', type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
      const message = h('p', { class: 'form-error', role: 'alert' });
      const go = h('button', { class: 'btn primary block', type: 'submit' },
        kind === 'deposit' ? 'Deposit' : kind === 'withdraw' ? 'Withdraw' : 'Send money');

      const form = h('form', { novalidate: true },
        h('div', { class: 'field' }, h('label', { for: 'acct' }, kind === 'transfer' ? 'From account' : 'Account'), select),
        kind === 'transfer' ? h('div', { class: 'field' }, h('label', { for: 'dest' }, 'To account number'), destination) : null,
        h('div', { class: 'field' }, h('label', { for: 'amt' }, 'Amount (₹)'), amount),
        message, go);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        message.textContent = '';
        const paise = parseRupees(amount.value);
        if (paise === null) { message.textContent = 'Enter an amount between ₹0.01 and ₹10,00,000, with at most 2 decimals.'; return; }
        let path; let body;
        if (kind === 'deposit') { path = '/api/transactions/deposit'; body = { account_id: select.value, amount: paise }; }
        else if (kind === 'withdraw') { path = '/api/transactions/withdraw'; body = { account_id: select.value, amount: paise }; }
        else {
          if (!/^[1-9]\d{0,17}$/.test(destination.value.trim())) { message.textContent = 'Enter the destination account number.'; return; }
          path = '/api/transactions/transfer';
          body = { from_account_id: select.value, to_account_id: destination.value.trim(), amount: paise };
        }
        go.disabled = true;
        try {
          await api('POST', path, body, { 'Idempotency-Key': newKey() });
          state.selectedId = select.value;
          await loadAccounts();
          drawAll();
          toast(kind === 'deposit' ? 'Deposit complete.' : kind === 'withdraw' ? 'Withdrawal complete.' : 'Transfer complete.', 'success');
        } catch (e) { message.textContent = e.message; go.disabled = false; }
      });

      moveBox.append(tabs, form);
    }

    function drawAll() { drawAccounts(); drawMoveForm(); drawStatement(); }

    main.append(
      h('h1', { class: 'page-title' }, 'Your accounts'),
      h('p', { class: 'page-sub' }, 'Amounts are in rupees. Every movement is recorded in the ledger.'),
      h('div', { class: 'grid' },
        h('div', {},
          h('section', { class: 'card' }, h('h2', {}, 'Accounts'), accountsBox),
          h('section', { class: 'card' }, statementTitle, statementBox)),
        h('div', {},
          h('section', { class: 'card' }, h('h2', {}, 'Move money'), moveBox))));
    drawAll();
  }

  // ---------- admin / auditor view ----------
  function renderStaff(main) {
    const panel = h('div');
    const tabs = h('div', { class: 'tabs' });
    const list = [['accounts', 'All accounts'], ['reconcile', 'Reconcile'], ['audit', 'Audit log']];
    if (state.user.role === 'admin') list.push(['users', 'Users']);

    function drawTabs() {
      tabs.replaceChildren();
      for (const [k, label] of list) {
        tabs.append(h('button', { type: 'button', class: 'tab' + (state.tab === k ? ' active' : ''),
          onclick: () => { state.tab = k; drawTabs(); drawPanel(); } }, label));
      }
    }

    function table(headers, rows, numericCols) {
      const nums = numericCols || [];
      const body = h('tbody');
      for (const row of rows) {
        body.append(h('tr', {}, row.map((cell, i) => h('td', { class: nums.includes(i) ? 'num' : '' }, cell))));
      }
      return h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, headers.map((x, i) => h('th', { class: nums.includes(i) ? 'num' : '' }, x)))), body));
    }

    async function drawPanel() {
      panel.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
      try {
        if (state.tab === 'accounts') {
          await loadAccounts();
          const statementBox = h('div');
          const title = h('h2', {}, 'Statement');
          const rows = state.accounts.map((a) => [
            '#' + a.id, a.name, a.owner_id ? 'User #' + a.owner_id : 'Bank (system)', inr(a.balance),
            h('button', { class: 'btn', type: 'button', onclick: () => { title.textContent = 'Statement · ' + a.name + ' (#' + a.id + ')'; fillStatement(statementBox, a.id); } }, 'View'),
          ]);
          panel.replaceChildren(
            h('section', { class: 'card' }, h('h2', {}, 'All accounts'),
              rows.length ? table(['ID', 'Name', 'Owner', 'Balance', ''], rows, [3]) : h('p', { class: 'empty' }, 'No accounts yet.')),
            h('section', { class: 'card' }, title, statementBox));
          statementBox.append(h('p', { class: 'empty' }, 'Choose an account above and press View.'));
        } else if (state.tab === 'reconcile') {
          const r = await api('GET', '/api/admin/reconcile');
          panel.replaceChildren(h('section', { class: 'card' },
            h('div', { class: 'card-head' }, h('h2', {}, 'Books check'),
              h('button', { class: 'btn', type: 'button', onclick: drawPanel }, 'Run again')),
            h('div', { class: 'status ' + (r.ok ? 'ok' : 'bad') },
              r.ok ? '✓ The books balance. Every balance matches the ledger.' : '✕ A mismatch was found. See the details below.'),
            h('div', { class: 'kv' },
              h('span', {}, 'Ledger entries add up to'), h('strong', {}, inr(r.ledger_total)),
              h('span', {}, 'All balances add up to'), h('strong', {}, inr(r.balance_total)),
              h('span', {}, 'Accounts that do not match'), h('strong', {}, String(r.mismatched_accounts.length)),
              h('span', {}, 'Unbalanced transactions'), h('strong', {}, String(r.unbalanced_transactions.length)))));
        } else if (state.tab === 'audit') {
          const rows = await api('GET', '/api/admin/audit?limit=100');
          panel.replaceChildren(h('section', { class: 'card' }, h('h2', {}, 'Audit log (latest 100)'),
            rows.length ? table(['#', 'When', 'Who', 'Action', 'Details'],
              rows.map((r) => [String(r.id), when(r.created_at), r.actor_id ? 'User #' + r.actor_id : 'System', h('span', { class: 'pill' }, r.action.replace(/_/g, ' ')),
                h('span', { class: 'mono' }, r.details ? JSON.stringify(r.details) : '')])) : h('p', { class: 'empty' }, 'Nothing logged yet.')));
        } else if (state.tab === 'users') {
          const rows = await api('GET', '/api/admin/users');
          panel.replaceChildren(h('section', { class: 'card' }, h('h2', {}, 'Users'),
            table(['ID', 'Email', 'Role', 'Joined'], rows.map((u) => [String(u.id), u.email, h('span', { class: 'pill' }, u.role), when(u.created_at)]))));
        }
      } catch (e) {
        panel.replaceChildren(h('section', { class: 'card' }, h('p', { class: 'form-error' }, e.message)));
      }
    }

    main.append(
      h('h1', { class: 'page-title' }, state.user.role === 'admin' ? 'Administration' : 'Audit view'),
      h('p', { class: 'page-sub' }, 'Read-only. This role can inspect the system but cannot move money.'),
      tabs, panel);
    drawTabs();
    drawPanel();
  }

  renderAuth();
})();