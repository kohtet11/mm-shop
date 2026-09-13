(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const STATUS_LABEL = {
    pending: 'စောင့်ဆိုင်း',
    paid_confirmed: 'ငွေအတည်ပြု',
    shipped: 'ပို့ပြီး',
    cancelled: 'ပယ်ဖျက်',
  };

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function formatMMK(n) {
    return Number(n || 0).toLocaleString('en-US') + ' ကျပ်';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function imgUrl(path) {
    if (!path) return '';
    return path.startsWith('/') ? path : '/uploads/' + path;
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers: opts.body instanceof FormData
        ? opts.headers
        : { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function checkAuth() {
    const me = await api('/api/admin/me');
    if (me.authenticated) showDash();
    else showLogin();
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#dashView').classList.add('hidden');
  }

  function showDash() {
    $('#loginView').classList.add('hidden');
    $('#dashView').classList.remove('hidden');
    loadCategories().catch(() => {});
    loadProducts();
    loadSpinPrizes().catch(() => {});
    loadSpinWins().catch(() => {});
    loadOrders();
    loadSettings();
    loadChatThreads().catch(() => {});
    startChatBadgePoll();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: $('#password').value }),
      });
      showDash();
    } catch (err) {
      $('#loginError').textContent = err.message || 'ဝင်မရပါ';
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
    stopChatPolling();
    stopChatBadgePoll();
    showLogin();
  });

  // Tabs
  $$('.admin-nav [data-tab]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = a.dataset.tab;
      $$('.admin-nav [data-tab]').forEach((x) => x.classList.toggle('active', x === a));
      $$('.tab-panel').forEach((p) => p.classList.add('hidden'));
      $('#tab-' + tab).classList.remove('hidden');
      if (tab === 'chat') startChatPolling();
      else stopChatPolling();
      if (tab === 'categories') loadCategories().catch(() => {});
    });
  });

  // Categories
  const PROTECTED_CAT_SLUGS = new Set(['blind_box', 'spin_game']);

  function categoryLabel(slug) {
    const s = String(slug || '');
    const cats = loadCategories._cache || [];
    const found = cats.find((c) => c.slug === s);
    if (found && found.name) return found.name;
    return (
      { blind_box: 'Blind box', accessories: 'Accessories', spin_game: 'Game', other: 'Other' }[s] ||
      s ||
      'အခြား'
    );
  }

  function fillProductCategorySelect(selected) {
    const sel = $('#pCategory');
    if (!sel) return;
    const cats = loadCategories._cache || [];
    let want = selected || sel.value || 'blind_box';
    if (want === 'other') want = 'blind_box';
    const fallback = [
      { slug: 'blind_box', name: 'Blind box', active: 1 },
      { slug: 'accessories', name: 'Accessories', active: 1 },
      { slug: 'spin_game', name: 'Game', active: 1 },
    ];
    const source = cats.length ? cats : fallback;
    // Product picker: active categories only; never show placeholder "other"
    const list = source.filter((c) => {
      if (!c || c.slug === 'other') return false;
      if (Number(c.active) === 0 && c.slug !== want) return false;
      return true;
    });
    sel.innerHTML = list
      .map(
        (c) =>
          `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name || c.slug)}</option>`
      )
      .join('');
    if (want && want !== 'other' && ![...sel.options].some((o) => o.value === want)) {
      const found = source.find((c) => c.slug === want);
      const opt = document.createElement('option');
      opt.value = want;
      opt.textContent = (found && found.name) || want;
      sel.appendChild(opt);
    }
    sel.value = want;
  }

  async function loadCategories() {
    const cats = await api('/api/admin/categories');
    loadCategories._cache = cats;
    fillProductCategorySelect($('#pCategory') ? $('#pCategory').value : 'blind_box');
    const tbody = $('#categoriesTable tbody');
    if (!tbody) return cats;
    tbody.innerHTML =
      cats
        .map((c) => {
          const protected = PROTECTED_CAT_SLUGS.has(c.slug);
          const count = Number(c.product_count) || 0;
          return `
      <tr>
        <td><strong>${escapeHtml(c.name)}</strong>${protected ? ' <span class="hint">(built-in)</span>' : ''}</td>
        <td><code>${escapeHtml(c.slug)}</code></td>
        <td>${Number(c.sort_order) || 0}</td>
        <td>${count}</td>
        <td>${c.active ? '<span class="badge paid_confirmed">active</span>' : '<span class="badge cancelled">inactive</span>'}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm btn-outline" data-edit-category="${c.id}">ပြင်မည်</button>
          <button type="button" class="btn btn-sm btn-outline" data-toggle-category="${c.id}" data-active="${c.active ? 0 : 1}">${c.active ? 'ပိတ်မည်' : 'ဖွင့်မည်'}</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-category="${c.id}" ${protected ? 'disabled title="Built-in — ဖျက်မရ"' : ''}>ဖျက်မည်</button>
        </td>
      </tr>`;
        })
        .join('') || '<tr><td colspan="6" class="empty">အမျိုးအစား မရှိသေးပါ</td></tr>';
    return cats;
  }

  function openCategoryModal(cat) {
    $('#categoryModalTitle').textContent = cat ? 'အမျိုးအစား ပြင်ဆင်ရန်' : 'အမျိုးအစား အသစ်';
    $('#categoryId').value = cat ? cat.id : '';
    $('#cName').value = cat ? cat.name : '';
    const slugInput = $('#cSlug');
    slugInput.value = cat ? cat.slug : '';
    const protected = cat && PROTECTED_CAT_SLUGS.has(cat.slug);
    slugInput.disabled = !!protected;
    $('#cSlugHint').textContent = protected
      ? 'Built-in slug ကို ပြောင်း၍မရပါ။'
      : 'မထည့်ရင် အမည်မှ auto generate လုပ်မည်။';
    $('#cSort').value = cat ? String(Number(cat.sort_order) || 0) : '50';
    $('#cActive').checked = cat ? !!Number(cat.active) : true;
    $('#categoryModal').classList.add('open');
  }

  const newCategoryBtn = $('#newCategoryBtn');
  if (newCategoryBtn) {
    newCategoryBtn.addEventListener('click', () => openCategoryModal(null));
  }
  const closeCategoryModal = $('#closeCategoryModal');
  if (closeCategoryModal) {
    closeCategoryModal.addEventListener('click', () => $('#categoryModal').classList.remove('open'));
  }
  const cancelCategoryModal = $('#cancelCategoryModal');
  if (cancelCategoryModal) {
    cancelCategoryModal.addEventListener('click', () => $('#categoryModal').classList.remove('open'));
  }
  const categoryModal = $('#categoryModal');
  if (categoryModal) {
    categoryModal.addEventListener('click', (e) => {
      if (e.target === categoryModal) categoryModal.classList.remove('open');
    });
  }

  const categoryForm = $('#categoryForm');
  if (categoryForm) {
    categoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('#categoryId').value;
      const body = {
        name: $('#cName').value.trim(),
        active: $('#cActive').checked ? 1 : 0,
        sort_order: Number($('#cSort').value) || 0,
      };
      const slugVal = $('#cSlug').value.trim();
      if (slugVal && !$('#cSlug').disabled) body.slug = slugVal;
      try {
        if (id) {
          await api('/api/admin/categories/' + id, { method: 'PUT', body: JSON.stringify(body) });
          toast('အမျိုးအစား သိမ်းပြီး');
        } else {
          await api('/api/admin/categories', { method: 'POST', body: JSON.stringify(body) });
          toast('အမျိုးအစား ထည့်ပြီး');
        }
        $('#categoryModal').classList.remove('open');
        await loadCategories();
      } catch (err) {
        toast(err.message || 'မအောင်မြင်ပါ');
      }
    });
  }

  function openQuickCategoryModal() {
    const modal = $('#quickCategoryModal');
    const input = $('#quickCatName');
    if (!modal || !input) return;
    input.value = '';
    modal.classList.add('open');
    setTimeout(() => input.focus(), 30);
  }

  function closeQuickCategoryModal() {
    const modal = $('#quickCategoryModal');
    if (modal) modal.classList.remove('open');
  }

  const pCategoryAddBtn = $('#pCategoryAddBtn');
  if (pCategoryAddBtn) {
    pCategoryAddBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openQuickCategoryModal();
    });
  }
  const closeQuickCategoryModalBtn = $('#closeQuickCategoryModal');
  if (closeQuickCategoryModalBtn) {
    closeQuickCategoryModalBtn.addEventListener('click', closeQuickCategoryModal);
  }
  const cancelQuickCategoryModal = $('#cancelQuickCategoryModal');
  if (cancelQuickCategoryModal) {
    cancelQuickCategoryModal.addEventListener('click', closeQuickCategoryModal);
  }
  const quickCategoryModal = $('#quickCategoryModal');
  if (quickCategoryModal) {
    quickCategoryModal.addEventListener('click', (e) => {
      if (e.target === quickCategoryModal) closeQuickCategoryModal();
    });
  }
  const quickCategoryForm = $('#quickCategoryForm');
  if (quickCategoryForm) {
    quickCategoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = ($('#quickCatName') && $('#quickCatName').value.trim()) || '';
      if (!name) {
        toast('အမည် ထည့်ပါ');
        return;
      }
      try {
        const created = await api('/api/admin/categories', {
          method: 'POST',
          body: JSON.stringify({ name, active: 1 }),
        });
        closeQuickCategoryModal();
        toast('အမျိုးအစား ထည့်ပြီး');
        await loadCategories();
        const slug = created && created.slug ? created.slug : '';
        if (slug) fillProductCategorySelect(slug);
      } catch (err) {
        toast(err.message || 'မအောင်မြင်ပါ');
      }
    });
  }

  document.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-category]');
    if (editBtn) {
      const id = Number(editBtn.dataset.editCategory);
      const cat = (loadCategories._cache || []).find((c) => Number(c.id) === id);
      if (cat) openCategoryModal(cat);
      return;
    }
    const toggleBtn = e.target.closest('[data-toggle-category]');
    if (toggleBtn) {
      const id = Number(toggleBtn.dataset.toggleCategory);
      const cat = (loadCategories._cache || []).find((c) => Number(c.id) === id);
      if (!cat) return;
      try {
        await api('/api/admin/categories/' + id, {
          method: 'PUT',
          body: JSON.stringify({
            name: cat.name,
            slug: cat.slug,
            active: Number(toggleBtn.dataset.active) ? 1 : 0,
            sort_order: Number(cat.sort_order) || 0,
          }),
        });
        await loadCategories();
        toast('အခြေအနေ ပြောင်းပြီး');
      } catch (err) {
        toast(err.message || 'မအောင်မြင်ပါ');
      }
      return;
    }
    const delBtn = e.target.closest('[data-del-category]');
    if (delBtn) {
      if (delBtn.disabled) return;
      const id = Number(delBtn.dataset.delCategory);
      const cat = (loadCategories._cache || []).find((c) => Number(c.id) === id);
      if (!confirm((cat ? cat.name : 'ဤအမျိုးအစား') + ' ကို ဖျက်မည်လား?')) return;
      try {
        await api('/api/admin/categories/' + id, { method: 'DELETE', body: '{}' });
        toast('ဖျက်ပြီး');
        await loadCategories();
      } catch (err) {
        toast(err.message || 'မအောင်မြင်ပါ');
      }
    }
  });

  // Products
  async function loadProducts() {
    const products = await api('/api/admin/products');
    const tbody = $('#productsTable tbody');
    tbody.innerHTML = products
      .map(
        (p) => {
          const pct = Number(p.discount_percent) || 0;
          const bannerBits = [];
          if (p.on_banner) bannerBits.push('<span class="badge paid_confirmed">Banner</span>');
          if (pct > 0) bannerBits.push('<span class="badge pending">' + pct + '% OFF</span>');
          const bannerCell = bannerBits.length ? bannerBits.join(' ') : '<span class="hint">—</span>';
          const stock = Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0;
          const catLabel = categoryLabel(p.category);
          return `
      <tr>
        <td>${p.image_path ? `<img class="thumb-sm" src="${imgUrl(p.image_path)}" alt="" />` : '—'}</td>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          <div class="hint">${escapeHtml((p.description || '').slice(0, 80))}</div>
        </td>
        <td><span class="hint">${escapeHtml(catLabel)}</span></td>
        <td>${formatMMK(p.price_mmk)}</td>
        <td>
          <div class="stock-adjust">
            <button type="button" class="btn btn-sm btn-outline" data-stock-delta="${p.id}" data-delta="-1" title="လျှော့">−</button>
            <span class="stock-val${stock <= 0 ? ' out' : ''}">${stock}</span>
            <button type="button" class="btn btn-sm btn-outline" data-stock-delta="${p.id}" data-delta="1" title="တိုး">+</button>
          </div>
        </td>
        <td>${bannerCell}</td>
        <td>${p.active ? '<span class="badge paid_confirmed">active</span>' : '<span class="badge cancelled">inactive</span>'}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm btn-outline" data-edit-product="${p.id}">ပြင်မည်</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-product="${p.id}">ဖျက်မည်</button>
        </td>
      </tr>`;
        }
      )
      .join('') || '<tr><td colspan="8" class="empty">ပစ္စည်း မရှိသေးပါ</td></tr>';

    loadProducts._cache = products;
  }

  const AUTH_BUILTIN = [
    { value: 'authentic', label: 'မူရင်း Authentic' },
    { value: 'copy', label: 'Copy' },
  ];

  function fillAuthenticitySelect(selected) {
    const sel = $('#pAuthenticity');
    if (!sel) return;
    let want = selected != null && selected !== '' ? String(selected) : 'authentic';
    if (!want) want = 'authentic';
    const extras = [];
    const lower = want.toLowerCase();
    const isBuiltin = AUTH_BUILTIN.some((o) => o.value === lower);
    if (!isBuiltin) {
      extras.push({ value: want, label: want });
    }
    // Keep any previously added custom options still in the select
    [...sel.options].forEach((o) => {
      if (!AUTH_BUILTIN.some((b) => b.value === o.value) && o.value !== want) {
        extras.push({ value: o.value, label: o.textContent || o.value });
      }
    });
    const seen = new Set();
    const opts = [...AUTH_BUILTIN, ...extras].filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
    sel.innerHTML = opts
      .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
      .join('');
    const matchVal = isBuiltin ? lower : want;
    if (![...sel.options].some((o) => o.value === matchVal)) {
      const opt = document.createElement('option');
      opt.value = want;
      opt.textContent = want;
      sel.appendChild(opt);
      sel.value = want;
    } else {
      sel.value = matchVal;
    }
  }

  function ensureAuthOption(value, label) {
    const sel = $('#pAuthenticity');
    if (!sel || !value) return;
    const v = String(value).trim();
    if (!v) return;
    if (![...sel.options].some((o) => o.value === v)) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = label || v;
      sel.appendChild(opt);
    }
    sel.value = v;
  }

  function syncProductSpinFields(product) {
    const add = $('#pSpinAdd');
    const fields = $('#pSpinFields');
    const hint = $('#pSpinHint');
    if (!add || !fields) return;
    const cat = ($('#pCategory') && $('#pCategory').value) || '';
    if (cat !== 'blind_box') {
      add.checked = false;
      fields.classList.add('hidden');
      delete add.dataset.spinId;
      if (hint) hint.textContent = 'ပစ္စည်းအမည်ဖြင့် စပင်ဘီး entry အသစ် ထည့်မည်';
      return;
    }
    const prizes = loadSpinPrizes._cache || [];
    const linked = product
      ? prizes.find((s) => s.product_id && Number(s.product_id) === Number(product.id))
      : null;
    if (linked) {
      add.checked = true;
      fields.classList.remove('hidden');
      if (hint) hint.textContent = 'လက်ရှိဘီး entry #' + linked.id + ' — သိမ်းရင် အပ်ဒိတ်လုပ်မည်';
      add.dataset.spinId = String(linked.id);
    } else {
      add.checked = false;
      fields.classList.add('hidden');
      if (hint) hint.textContent = 'ပစ္စည်းအမည်ဖြင့် စပင်ဘီး entry အသစ် ထည့်မည်';
      delete add.dataset.spinId;
    }
  }

  function syncProductCategoryDependentFields(product) {
    const cat = ($('#pCategory') && $('#pCategory').value) || '';
    const isBlind = cat === 'blind_box';
    const isGame = cat === 'spin_game';
    const authGroup = $('#pAuthGroup');
    const spinAddGroup = $('#pSpinAddGroup');
    const spinCreditGroup = $('#pSpinCreditGroup');
    if (authGroup) authGroup.classList.toggle('hidden', !isBlind);
    if (spinAddGroup) spinAddGroup.classList.toggle('hidden', !isBlind);
    // is_spin_credit only for Game / existing spin-credit products
    const showSpinCredit =
      isGame || !!(product && Number(product.is_spin_credit));
    if (spinCreditGroup) spinCreditGroup.classList.toggle('hidden', !showSpinCredit);
    if (!isBlind) {
      const add = $('#pSpinAdd');
      const fields = $('#pSpinFields');
      if (add) {
        add.checked = false;
        delete add.dataset.spinId;
      }
      if (fields) fields.classList.add('hidden');
    } else {
      syncProductSpinFields(product || openProductModal._current || null);
    }
  }

  function openProductModal(product) {
    openProductModal._current = product || null;
    $('#productModalTitle').textContent = product ? 'ပစ္စည်း ပြင်ဆင်ရန်' : 'ပစ္စည်း အသစ်';
    $('#productId').value = product ? product.id : '';
    $('#pName').value = product ? product.name : '';
    $('#pPrice').value = product ? product.price_mmk : '';
    $('#pStock').value = product
      ? String(Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0)
      : '99';
    $('#pDesc').value = product ? product.description || '' : '';
    $('#pActive').checked = product ? !!product.active : true;
    $('#pOnBanner').checked = product ? !!product.on_banner : false;
    const pSpinCredit = $('#pSpinCredit');
    if (pSpinCredit) pSpinCredit.checked = product ? !!Number(product.is_spin_credit) : false;
    const pCat = $('#pCategory');
    if (pCat) {
      const raw = product && product.category ? String(product.category) : '';
      const want = raw || (pSpinCredit && pSpinCredit.checked ? 'spin_game' : 'blind_box');
      fillProductCategorySelect(want);
    }
    fillAuthenticitySelect(product ? product.authenticity || 'authentic' : 'authentic');
    const pct = product ? String(Number(product.discount_percent) || 0) : '0';
    const discSel = $('#pDiscount');
    if (discSel) {
      const hasOpt = [...discSel.options].some((o) => o.value === pct);
      if (!hasOpt && pct !== '0') {
        const opt = document.createElement('option');
        opt.value = pct;
        opt.textContent = pct + '%';
        discSel.appendChild(opt);
      }
      discSel.value = pct;
    }
    $('#pImage').value = '';
    $('#pImageHint').textContent = product && product.image_path
      ? 'လက်ရှိပုံ: ' + product.image_path
      : '';
    syncProductCategoryDependentFields(product);
    $('#productModal').classList.add('open');
  }

  const pCategoryEl = $('#pCategory');
  if (pCategoryEl) {
    pCategoryEl.addEventListener('change', () => {
      syncProductCategoryDependentFields(openProductModal._current || null);
    });
  }

  const pSpinCreditEl = $('#pSpinCredit');
  if (pSpinCreditEl) {
    pSpinCreditEl.addEventListener('change', () => {
      const pCat = $('#pCategory');
      if (!pCat) return;
      if (pSpinCreditEl.checked && (pCat.value === 'other' || pCat.value === 'blind_box' || !pCat.value)) {
        pCat.value = 'spin_game';
        syncProductCategoryDependentFields(openProductModal._current || null);
      }
    });
  }

  const pSpinAddEl = $('#pSpinAdd');
  if (pSpinAddEl) {
    pSpinAddEl.addEventListener('change', () => {
      const fields = $('#pSpinFields');
      if (fields) fields.classList.toggle('hidden', !pSpinAddEl.checked);
    });
  }

  function openQuickAuthModal() {
    const modal = $('#quickAuthModal');
    const input = $('#quickAuthName');
    if (!modal || !input) return;
    input.value = '';
    modal.classList.add('open');
    setTimeout(() => input.focus(), 30);
  }

  function closeQuickAuthModal() {
    const modal = $('#quickAuthModal');
    if (modal) modal.classList.remove('open');
  }

  const pAuthAddBtn = $('#pAuthAddBtn');
  if (pAuthAddBtn) {
    pAuthAddBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openQuickAuthModal();
    });
  }
  const closeQuickAuthModalBtn = $('#closeQuickAuthModal');
  if (closeQuickAuthModalBtn) {
    closeQuickAuthModalBtn.addEventListener('click', closeQuickAuthModal);
  }
  const cancelQuickAuthModal = $('#cancelQuickAuthModal');
  if (cancelQuickAuthModal) {
    cancelQuickAuthModal.addEventListener('click', closeQuickAuthModal);
  }
  const quickAuthModal = $('#quickAuthModal');
  if (quickAuthModal) {
    quickAuthModal.addEventListener('click', (e) => {
      if (e.target === quickAuthModal) closeQuickAuthModal();
    });
  }
  const quickAuthForm = $('#quickAuthForm');
  if (quickAuthForm) {
    quickAuthForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = ($('#quickAuthName') && $('#quickAuthName').value.trim()) || '';
      if (!name) {
        toast('အမည် ထည့်ပါ');
        return;
      }
      // Store custom label as-is (slug-ish lowercase for builtins already handled)
      const lower = name.toLowerCase();
      let value = name;
      if (lower === 'copy' || lower === 'replica' || lower === 'fake') value = 'copy';
      else if (lower === 'authentic' || lower === 'original' || lower === 'auth' || lower === 'မူရင်း')
        value = 'authentic';
      ensureAuthOption(value, name);
      closeQuickAuthModal();
      toast('အမှတ်အသား ထည့်ပြီး');
    });
  }

  $('#newProductBtn').addEventListener('click', async () => {
    try { await loadCategories(); } catch (_) {}
    openProductModal(null);
  });
  $('#closeProductModal').addEventListener('click', () =>
    $('#productModal').classList.remove('open')
  );
  $('#productModal').addEventListener('click', (e) => {
    if (e.target === $('#productModal')) $('#productModal').classList.remove('open');
  });

  $('#productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#productId').value;
    const fd = new FormData();
    fd.append('name', $('#pName').value.trim());
    fd.append('price_mmk', $('#pPrice').value);
    fd.append('stock', $('#pStock') ? $('#pStock').value : '99');
    const catVal = $('#pCategory') ? $('#pCategory').value : 'blind_box';
    const isBlindBox = catVal === 'blind_box';
    // is_spin_credit only when Game controls are shown
    let spinFlag = '0';
    if ($('#pSpinCreditGroup') && !$('#pSpinCreditGroup').classList.contains('hidden')) {
      spinFlag = $('#pSpinCredit') && $('#pSpinCredit').checked ? '1' : '0';
    }
    fd.append('is_spin_credit', spinFlag);
    fd.append('category', catVal);
    if (isBlindBox) {
      const authSel = $('#pAuthenticity');
      fd.append('authenticity', authSel && authSel.value ? authSel.value : 'authentic');
    } else if (openProductModal._current && openProductModal._current.authenticity) {
      // Leave existing value unchanged when auth UI is hidden
      fd.append('authenticity', String(openProductModal._current.authenticity));
    } else {
      fd.append('authenticity', 'authentic');
    }
    fd.append('description', $('#pDesc').value);
    fd.append('active', $('#pActive').checked ? '1' : '0');
    fd.append('on_banner', $('#pOnBanner').checked ? '1' : '0');
    fd.append('discount_percent', $('#pDiscount') ? $('#pDiscount').value : '0');
    if ($('#pImage').files[0]) fd.append('image', $('#pImage').files[0]);

    try {
      let saved = null;
      if (id) {
        saved = await fetch('/api/admin/products/' + id, {
          method: 'PUT',
          credentials: 'same-origin',
          body: fd,
        }).then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          return data;
        });
      } else {
        saved = await fetch('/api/admin/products', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        }).then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed');
          return data;
        });
      }
      $('#productModal').classList.remove('open');
      toast('သိမ်းပြီးပါပြီ');
      await loadProducts();
      try {
        const addEl = $('#pSpinAdd');
        const savedCat = saved && saved.category ? String(saved.category) : catVal;
        if (savedCat === 'blind_box' && addEl && addEl.checked && saved && saved.id) {
          const spinId = addEl.dataset.spinId;
          const payload = {
            name: String(saved.name || $('#pName').value.trim()),
            product_id: saved.id,
            hit_every: 1,
            active: 1,
            sort_order: 0,
          };
          if (spinId) {
            await api('/api/admin/spin-prizes/' + spinId, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
          } else {
            await api('/api/admin/spin-prizes', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
          }
          await loadSpinPrizes();
        }
      } catch (spinErr) {
        toast('ပစ္စည်းသိမ်းပြီး — ဘီး sync မရ: ' + (spinErr.message || ''));
      }
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener('click', async (e) => {
    const stockBtn = e.target.closest('[data-stock-delta]');
    if (stockBtn) {
      const id = Number(stockBtn.dataset.stockDelta);
      const delta = Number(stockBtn.dataset.delta);
      if (!id || !Number.isFinite(delta)) return;
      try {
        await api('/api/admin/products/' + id + '/stock', {
          method: 'PATCH',
          body: JSON.stringify({ delta }),
        });
        await loadProducts();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const edit = e.target.closest('[data-edit-product]');
    if (edit) {
      const id = Number(edit.dataset.editProduct);
      const p = (loadProducts._cache || []).find((x) => x.id === id);
      if (p) {
        try { await loadCategories(); } catch (_) {}
        openProductModal(p);
      }
      return;
    }
    const del = e.target.closest('[data-del-product]');
    if (del) {
      if (!confirm('ဤပစ္စည်းကို ဖျက်မည်လား?')) return;
      try {
        await api('/api/admin/products/' + del.dataset.delProduct, {
          method: 'DELETE',
          body: '{}',
        });
        toast('ဖျက်ပြီးပါပြီ');
        loadProducts();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const view = e.target.closest('[data-view-order]');
    if (view) {
      openOrder(view.dataset.viewOrder);
      return;
    }
    const delOrder = e.target.closest('[data-del-order]');
    if (delOrder) {
      const oid = delOrder.dataset.delOrder;
      openPasswordConfirm({
        title: 'အော်ဒါ ဖျက်ရန်',
        message: 'အော်ဒါ ' + oid + ' ကို ဖျက်မည်။ အက်ဒမင် စကားဝှက် ထည့်ပါ။',
        pending: { type: 'one', orderId: oid },
      });
      return;
    }
  });


  // Password-gated order delete
  let pendingDelete = null; // { type: 'one'|'all', orderId?: string }

  function openPasswordConfirm({ title, message, pending }) {
    pendingDelete = pending;
    $('#passwordConfirmTitle').textContent = title;
    $('#passwordConfirmMsg').textContent = message;
    $('#passwordConfirmError').textContent = '';
    $('#confirmAdminPassword').value = '';
    $('#passwordConfirmModal').classList.add('open');
    setTimeout(() => $('#confirmAdminPassword').focus(), 50);
  }

  function closePasswordConfirm() {
    pendingDelete = null;
    $('#passwordConfirmModal').classList.remove('open');
    $('#confirmAdminPassword').value = '';
    $('#passwordConfirmError').textContent = '';
  }

  $('#closePasswordConfirm').addEventListener('click', closePasswordConfirm);
  $('#cancelPasswordConfirm').addEventListener('click', closePasswordConfirm);
  $('#passwordConfirmModal').addEventListener('click', (e) => {
    if (e.target === $('#passwordConfirmModal')) closePasswordConfirm();
  });

  $('#passwordConfirmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#confirmAdminPassword').value;
    if (!password) {
      $('#passwordConfirmError').textContent = 'စကားဝှက် ထည့်ပါ';
      return;
    }
    if (!pendingDelete) return;
    const job = pendingDelete;
    try {
      if (job.type === 'all') {
        await api('/api/admin/orders', {
          method: 'DELETE',
          body: JSON.stringify({ password }),
        });
        toast('အော်ဒါအားလုံး ဖျက်ပြီးပါပြီ');
      } else {
        await api('/api/admin/orders/' + encodeURIComponent(job.orderId), {
          method: 'DELETE',
          body: JSON.stringify({ password }),
        });
        toast('အော်ဒါ ဖျက်ပြီးပါပြီ');
        $('#orderModal').classList.remove('open');
      }
      closePasswordConfirm();
      loadOrders();
      loadSpinWins().catch(() => {});
    } catch (err) {
      $('#passwordConfirmError').textContent = err.message || 'ဖျက်မရပါ';
      if (err.status === 403) {
        // wrong password — keep modal open
      }
    }
  });

  const clearAllBtn = $('#clearAllOrdersBtn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      openPasswordConfirm({
        title: 'အားလုံး ဖျက်ရန်',
        message: 'အော်ဒါမှတ်တမ်းအားလုံးနှင့် စလစ်ပုံများကို ဖျက်မည်။ အက်ဒမင် စကားဝှက် ထည့်ပါ။',
        pending: { type: 'all' },
      });
    });
  }

  // Orders
  async function loadOrders() {
    const orders = await api('/api/admin/orders');
    const tbody = $('#ordersTable tbody');
    tbody.innerHTML = orders
      .map(
        (o) => `
      <tr>
        <td>
          <strong>${escapeHtml(o.order_id)}</strong>
          <div class="hint">${escapeHtml(o.created_at || '')}</div>
          <div class="hint">ဘီးအခွင့်: ${Number(o.spin_credits) || 0}${
            Number(o.spin_completed) === 1
              ? ' <span class="badge spin-completed">ပြီးဆုံး</span>'
              : o.spin_expired
                ? ' <span class="badge spin-expired">သက်တမ်းကုန်ဆုံး</span>'
                : o.spin_locked || o.spin_credits_locked
                  ? ' <span class="badge spin-locked">သော့ခတ်</span>'
                  : ''
          }</div>
        </td>
        <td>
          ${escapeHtml(o.customer_name)}<br/>
          <span class="hint">${escapeHtml(o.phone)}</span>
        </td>
        <td>${formatMMK(o.total_mmk)}</td>
        <td><span class="badge ${escapeHtml(o.status)}">${STATUS_LABEL[o.status] || o.status}</span></td>
        <td>${
          o.slip_path
            ? `<img class="thumb-sm" src="${imgUrl(o.slip_path)}" alt="slip" />`
            : '—'
        }</td>
        <td class="row-actions" style="gap:0.35rem;flex-wrap:wrap">
          <button type="button" class="btn btn-sm btn-outline" data-view-order="${escapeHtml(o.order_id)}">ကြည့်မည်</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-order="${escapeHtml(o.order_id)}">ဖျက်မည်</button>
        </td>
      </tr>`
      )
      .join('') || '<tr><td colspan="6" class="empty">အော်ဒါ မရှိသေးပါ</td></tr>';
  }

  async function openOrder(orderId) {
    const o = await api('/api/admin/orders/' + encodeURIComponent(orderId));
    const itemsHtml = (o.items || [])
      .map(
        (it) =>
          `<li>${escapeHtml(it.product_name)} × ${it.quantity} — ${formatMMK(
            it.unit_price_mmk * it.quantity
          )}</li>`
      )
      .join('');

    const playsList =
      (o.spin_plays || [])
        .map(
          (p) =>
            `<li>${escapeHtml(p.prize_name)} <span class="hint">(${escapeHtml(
              p.created_at || ''
            )})</span></li>`
        )
        .join('') || '<li class="hint">မရှိသေးပါ</li>';

    $('#orderDetail').innerHTML = `
      <p><strong>အော်ဒါ:</strong> ${escapeHtml(o.order_id)}</p>
      <p><strong>အမည်:</strong> ${escapeHtml(o.customer_name)}</p>
      <p><strong>ဖုန်း:</strong> ${escapeHtml(o.phone)}</p>
      <p><strong>လိပ်စာ:</strong> ${escapeHtml(o.address)}</p>
      <p><strong>မှတ်ချက်:</strong> ${escapeHtml(o.notes || '—')}</p>
      <p><strong>စုစုပေါင်း:</strong> ${formatMMK(o.total_mmk)}</p>
      <p><strong>အချိန်:</strong> ${escapeHtml(o.created_at || '')}</p>
      <div class="form-group">
        <label>အခြေအနေ</label>
        <select id="orderStatus">
          ${['pending', 'paid_confirmed', 'shipped', 'cancelled']
            .map(
              (s) =>
                `<option value="${s}" ${o.status === s ? 'selected' : ''}>${
                  STATUS_LABEL[s]
                }</option>`
            )
            .join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="orderSpinCredits">စပင်ဘီး ကံစမ်းခွင့် (spin_credits)${
          o.spin_expired
            ? ' <span class="badge spin-expired">သက်တမ်းကုန်ဆုံး</span>'
            : ''
        }</label>
        <input id="orderSpinCredits" type="number" min="0" step="1" value="${Number(o.spin_credits) || 0}" ${
          o.spin_locked || o.spin_credits_locked ? 'disabled' : ''
        } />
        <div class="hint">${
          o.spin_locked || o.spin_credits_locked
            ? 'တစ်ကြိမ်သာ သတ်မှတ်နိုင်သည် / မှားယွင်း ထပ်မဖြည့်ရန် သော့ခတ်ထားသည်'
            : 'စလစ်/ငွေပေးချေမှုအရ အခွင့် အရေအတွက် သတ်မှတ်ပါ (ဥပမာ ၁ ကြိမ် = 1) — တစ်ကြိမ်သာ သတ်မှတ်နိုင်သည်'
        }</div>
      </div>
      ${
        o.is_spin_order || Number(o.spin_completed) === 1 || Number(o.spin_credits) > 0 || o.spin_locked || (o.spin_plays && o.spin_plays.length)
          ? `<p><strong>စပင် အခြေအနေ:</strong> ${
              Number(o.spin_completed) === 1
                ? '<span class="badge spin-completed">ပြီးဆုံး</span>'
                : o.spin_expired
                  ? '<span class="badge spin-expired">သက်တမ်းကုန်ဆုံး</span>'
                  : '<span class="badge pending">ဆက်လက်ကိုင်တွယ်ဆဲ</span>'
            }</p>`
          : ''
      }
      <div class="row-actions" style="gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
        <button type="button" class="btn btn-primary btn-sm" id="saveStatusBtn" data-oid="${escapeHtml(
        o.order_id
      )}">အခြေအနေ သိမ်းမည်</button>
        <button type="button" class="btn btn-pink btn-sm${
          o.spin_locked || o.spin_credits_locked ? ' dimmed' : ''
        }" id="saveSpinCreditsBtn" data-oid="${escapeHtml(
        o.order_id
      )}" ${o.spin_locked || o.spin_credits_locked ? 'disabled' : ''}>ကံစမ်းခွင့် သိမ်းမည်</button>
        ${
          o.is_spin_order || Number(o.spin_completed) === 1 || Number(o.spin_credits) > 0 || o.spin_locked || (o.spin_plays && o.spin_plays.length)
            ? `<button type="button" class="btn btn-sm${
                Number(o.spin_completed) === 1 ? ' btn-outline dimmed' : ' btn-primary'
              }" id="markSpinCompletedBtn" data-oid="${escapeHtml(o.order_id)}" ${
                Number(o.spin_completed) === 1 ? 'disabled' : ''
              }>ပြီးဆုံး</button>`
            : ''
        }
        <button type="button" class="btn btn-danger btn-sm" id="deleteOrderBtn" data-oid="${escapeHtml(
        o.order_id
      )}">ဖျက်မည်</button>
      </div>
      <h3 style="margin-bottom:0.35rem">ပစ္စည်းများ</h3>
      <ul>${itemsHtml || '<li>—</li>'}</ul>
      <h3 style="margin-bottom:0.35rem">စပင်မှတ်တမ်း</h3>
      <p class="spin-cycle-progress hint" style="margin:0 0 0.5rem">
        ဤအော်ဒါ၏ စက်ဝန်း — နောက်စပင်:
        <strong>${(o.spin_cycle && o.spin_cycle.next_in_cycle) || 1}</strong>
        / ${(o.spin_cycle && o.spin_cycle.cycle_size) || 15}
        (စုစုပေါင်း လှည့်ပြီး: ${(o.spin_cycle && o.spin_cycle.spin_play_count) || (o.spin_plays || []).length})
        ${(o.spin_cycle && o.spin_cycle.next_is_special) ? '— နောက်တစ်ကြိမ်သည် <strong>special</strong> slot' : ''}
      </p>
      <ul>${playsList}</ul>
      <h3 style="margin-bottom:0.35rem">ငွေလွှဲစလစ်</h3>
      ${
        o.slip_path
          ? `<a href="${imgUrl(o.slip_path)}" target="_blank" rel="noopener"><img class="slip-preview" src="${imgUrl(
              o.slip_path
            )}" alt="slip" /></a>`
          : '<p>—</p>'
      }
    `;
    $('#orderModal').classList.add('open');

    $('#saveStatusBtn').onclick = async () => {
      try {
        await api('/api/admin/orders/' + encodeURIComponent(o.order_id) + '/status', {
          method: 'PATCH',
          body: JSON.stringify({ status: $('#orderStatus').value }),
        });
        toast('အခြေအနေ ပြောင်းပြီး');
        loadOrders();
        loadSpinWins().catch(() => {});
        openOrder(o.order_id);
      } catch (err) {
        toast(err.message);
      }
    };

    const saveSpinBtn = $('#saveSpinCreditsBtn');
    if (saveSpinBtn) {
      saveSpinBtn.onclick = async () => {
        if (o.spin_locked || o.spin_credits_locked || saveSpinBtn.disabled) {
          toast('မှားယွင်း ထပ်မဖြည့်ရန် သော့ခတ်ထားသည်');
          return;
        }
        try {
          const credits = Math.max(0, parseInt($('#orderSpinCredits').value, 10) || 0);
          await api('/api/admin/orders/' + encodeURIComponent(o.order_id) + '/spin-credits', {
            method: 'PATCH',
            body: JSON.stringify({ spin_credits: credits }),
          });
          toast('ကံစမ်းခွင့် သိမ်းပြီး');
          loadOrders();
          loadSpinWins().catch(() => {});
          openOrder(o.order_id);
        } catch (err) {
          toast(err.message);
        }
      };
    }

    const markDoneBtn = $('#markSpinCompletedBtn');
    if (markDoneBtn) {
      markDoneBtn.onclick = async () => {
        if (Number(o.spin_completed) === 1 || markDoneBtn.disabled) return;
        try {
          await api('/api/admin/orders/' + encodeURIComponent(o.order_id) + '/spin-completed', {
            method: 'PATCH',
            body: JSON.stringify({ spin_completed: 1 }),
          });
          toast('ပြီးဆုံး အဖြစ် သိမ်းပြီး');
          loadOrders();
          loadSpinWins().catch(() => {});
          openOrder(o.order_id);
        } catch (err) {
          toast(err.message);
        }
      };
    }

    const delBtn = $('#deleteOrderBtn');
    if (delBtn) {
      delBtn.onclick = () => {
        openPasswordConfirm({
          title: 'အော်ဒါ ဖျက်ရန်',
          message: 'အော်ဒါ ' + o.order_id + ' ကို ဖျက်မည်။ အက်ဒမင် စကားဝှက် ထည့်ပါ။',
          pending: { type: 'one', orderId: o.order_id },
        });
      };
    }
  }

  $('#closeOrderModal').addEventListener('click', () =>
    $('#orderModal').classList.remove('open')
  );
  $('#orderModal').addEventListener('click', (e) => {
    if (e.target === $('#orderModal')) $('#orderModal').classList.remove('open');
  });

  // Settings
  function applyAdminBrand(s) {
    const name = (s && s.shop_name) || 'MM Shop';
    const brand = $('#adminBrand');
    if (brand) brand.textContent = name + ' Admin';
    document.title = name + ' Admin';
  }

  function renderLogoPreview(logoUrl) {
    const wrap = $('#logoPreviewWrap');
    const img = $('#logoPreview');
    const hint = $('#logoHint');
    if (logoUrl) {
      img.src = logoUrl;
      wrap.classList.remove('hidden');
      hint.textContent = 'လက်ရှိလိုဂို';
    } else {
      img.removeAttribute('src');
      wrap.classList.add('hidden');
      hint.textContent = 'လိုဂိုမရှိသေးပါ';
    }
  }

  function renderMmqrPreview(mmqrUrl) {
    const wrap = $('#mmqrPreviewWrap');
    const img = $('#mmqrPreview');
    const hint = $('#mmqrHint');
    if (!wrap || !img || !hint) return;
    if (mmqrUrl) {
      img.src = mmqrUrl;
      wrap.classList.remove('hidden');
      hint.textContent = 'လက်ရှိ MMQR';
    } else {
      img.removeAttribute('src');
      wrap.classList.add('hidden');
      hint.textContent = 'MMQR မရှိသေးပါ';
    }
  }

  async function loadSettings() {
    const s = await api('/api/admin/settings');
    $('#bank_name').value = s.bank_name || '';
    $('#account_number').value = s.account_number || '';
    $('#account_name').value = s.account_name || '';
    $('#payment_note').value = s.payment_note || '';
    $('#shop_name').value = s.shop_name || 'MM Shop';
    renderLogoPreview(s.logo_url || '');
    renderMmqrPreview(s.mmqr_url || '');
    applyAdminBrand(s);
    loadSettings._cache = s;
  }

  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          bank_name: $('#bank_name').value,
          account_number: $('#account_number').value,
          account_name: $('#account_name').value,
          payment_note: $('#payment_note').value,
        }),
      });

      const file = $('#mmqrFile').files[0];
      if (file) {
        const fd = new FormData();
        fd.append('mmqr', file);
        const res = await fetch('/api/admin/payment/mmqr', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'MMQR တင်မရပါ');
        renderMmqrPreview(data.mmqr_url || '');
        $('#mmqrFile').value = '';
      }

      toast('ငွေပေးချေမှု သိမ်းပြီး');
    } catch (err) {
      toast(err.message);
    }
  });

  $('#removeMmqrBtn').addEventListener('click', async () => {
    if (!confirm('MMQR ကို ဖယ်ရှားမည်လား?')) return;
    try {
      await api('/api/admin/payment/mmqr', { method: 'DELETE', body: '{}' });
      renderMmqrPreview('');
      toast('MMQR ဖယ်ရှားပြီး');
    } catch (err) {
      toast(err.message);
    }
  });

  $('#brandingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const s = await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          shop_name: $('#shop_name').value.trim() || 'MM Shop',
        }),
      });

      const file = $('#logoFile').files[0];
      if (file) {
        const fd = new FormData();
        fd.append('logo', file);
        const res = await fetch('/api/admin/branding/logo', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'လိုဂို တင်မရပါ');
        s.logo_url = data.logo_url;
        s.logo_path = data.logo_path;
        $('#logoFile').value = '';
      }

      renderLogoPreview(s.logo_url || '');
      applyAdminBrand(s);
      toast('အမှတ်တံဆိပ် သိမ်းပြီး');
    } catch (err) {
      toast(err.message);
    }
  });

  $('#removeLogoBtn').addEventListener('click', async () => {
    if (!confirm('လိုဂိုကို ဖယ်ရှားမည်လား?')) return;
    try {
      await api('/api/admin/branding/logo', { method: 'DELETE', body: '{}' });
      renderLogoPreview('');
      toast('လိုဂို ဖယ်ရှားပြီး');
    } catch (err) {
      toast(err.message);
    }
  });

  $('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = $('#currentPassword').value;
    const newPassword = $('#newPassword').value;
    const confirmPassword = $('#confirmPassword').value;
    if (newPassword.length < 6) {
      toast('စကားဝှက်အသစ် အနည်းဆုံး ၆ လုံး');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('စကားဝှက်အသစ် မကိုက်ညီပါ');
      return;
    }
    try {
      await api('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      $('#passwordForm').reset();
      toast('စကားဝှက် ပြောင်းပြီးပါပြီ');
    } catch (err) {
      toast(err.message);
    }
  });


  // ========== Spin prizes ==========

  async function loadSpinPrizes() {
    const data = await api('/api/admin/spin-prizes');
    const prizes = Array.isArray(data) ? data : data.prizes || [];
    loadSpinPrizes._cache = prizes;
    loadSpinPrizes._meta = Array.isArray(data)
      ? { cycle_size: 15, cycle_scope: 'per_order' }
      : data;
    const tbody = $('#spinTable tbody');
    if (!tbody) return prizes;
    const hint = $('#spinCycleHint');
    if (hint) {
      const size = (loadSpinPrizes._meta && loadSpinPrizes._meta.cycle_size) || 15;
      hint.textContent =
        'ဆုအမည်ဘေး 「၁၅ကြိမ်တွင် ၁ကြိမ်」 ကို နှိပ်၍ special ဖွင့်/ပိတ် — စက်ဝန်းသည် အော်ဒါတစ်ခုချင်း (' +
        size +
        ' ကြိမ်)။';
    }
    tbody.innerHTML =
      prizes
        .map((s) => {
          const prod = s.product_name
            ? escapeHtml(s.product_name)
            : '<span class="hint">—</span>';
          const specialOn = Number(s.is_special) === 1;
          const specialBadge = `<span class="badge spin-special${
            specialOn ? ' is-on' : ''
          }" role="button" tabindex="0" title="နှိပ်၍ special ဖွင့်/ပိတ်" data-toggle-special="${s.id}">၁၅ကြိမ်တွင် ၁ကြိမ်</span>`;
          return `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${prod}</td>
        <td>${specialBadge}</td>
        <td>${Number(s.sort_order) || 0}</td>
        <td>${s.active ? '<span class="badge paid_confirmed">active</span>' : '<span class="badge cancelled">inactive</span>'}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm btn-outline" data-edit-spin="${s.id}">ပြင်မည်</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-spin="${s.id}">ဖျက်မည်</button>
        </td>
      </tr>`;
        })
        .join('') ||
      '<tr><td colspan="6" class="empty">ဆု မရှိသေးပါ — စတိုးတွင် စပင်ဘီး ပုန်းနေမည်</td></tr>';
    return prizes;
  }

  async function loadSpinWins() {
    const tbody = $('#spinWinsTable tbody');
    if (!tbody) return [];
    const rows = await api('/api/admin/spin-plays');
    loadSpinWins._cache = rows;
    tbody.innerHTML =
      rows
        .map((r) => {
          const prod = r.product_name
            ? escapeHtml(r.product_name)
            : '<span class="hint">—</span>';
          return `
      <tr>
        <td><span class="hint">${escapeHtml(r.created_at || '')}</span></td>
        <td><strong>${escapeHtml(r.prize_name || '')}</strong></td>
        <td>${prod}</td>
        <td><code>${escapeHtml(r.order_id || '')}</code></td>
        <td>${escapeHtml(r.customer_name || '')}</td>
        <td>${escapeHtml(r.phone || '')}</td>
        <td class="cell-address">${escapeHtml(r.address || '')}</td>
        <td>${Number(r.spin_credits) || 0}</td>
      </tr>`;
        })
        .join('') ||
      '<tr><td colspan="8" class="empty">အနိုင်ရရှိမှု မရှိသေးပါ</td></tr>';
    return rows;
  }

  function getLinkedSpinProductIds(exceptProductId) {
    const prizes = loadSpinPrizes._cache || [];
    const except = exceptProductId != null && exceptProductId !== '' ? Number(exceptProductId) : null;
    const ids = new Set();
    for (const s of prizes) {
      if (!s.product_id) continue;
      const pid = Number(s.product_id);
      if (!Number.isFinite(pid)) continue;
      if (except != null && pid === except) continue;
      ids.add(pid);
    }
    return ids;
  }

  async function fillSpinProductOptions(selectedId) {
    const sel = $('#spinProduct');
    if (!sel) return;
    let products = loadProducts._cache;
    if (!products) {
      try {
        products = await api('/api/admin/products');
        loadProducts._cache = products;
      } catch {
        products = [];
      }
    }
    if (!loadSpinPrizes._cache) {
      try {
        await loadSpinPrizes();
      } catch {
        /* ignore */
      }
    }
    const linkedIds = getLinkedSpinProductIds(selectedId);
    const available = products.filter((p) => {
      // Always keep currently linked product visible (legacy edge cases)
      if (selectedId && Number(selectedId) === Number(p.id)) return true;
      if (String(p.category || '') !== 'blind_box') return false;
      return !linkedIds.has(Number(p.id));
    });
    sel.innerHTML =
      '<option value="">— မချိတ် —</option>' +
      available
        .map(
          (p) =>
            `<option value="${p.id}"${
              selectedId && Number(selectedId) === Number(p.id) ? ' selected' : ''
            }>${escapeHtml(p.name)}</option>`
        )
        .join('');
  }

  async function openSpinModal(prize) {
    $('#spinModalTitle').textContent = prize ? 'ဆု ပြင်ဆင်ရန်' : 'ဆု အသစ်';
    $('#spinId').value = prize ? prize.id : '';
    $('#spinName').value = prize ? prize.name : '';
    $('#spinSort').value = prize ? prize.sort_order : 0;
    $('#spinActive').checked = prize ? !!prize.active : true;
    const specialEl = $('#spinSpecial');
    if (specialEl) specialEl.checked = prize ? !!Number(prize.is_special) : false;
    await fillSpinProductOptions(prize ? prize.product_id : '');
    $('#spinModal').classList.add('open');
  }

  $('#newSpinBtn').addEventListener('click', () => openSpinModal(null));
  $('#closeSpinModal').addEventListener('click', () =>
    $('#spinModal').classList.remove('open')
  );
  $('#spinModal').addEventListener('click', (e) => {
    if (e.target === $('#spinModal')) $('#spinModal').classList.remove('open');
  });

  $('#spinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#spinId').value;
    const payload = {
      name: $('#spinName').value.trim(),
      product_id: $('#spinProduct').value || null,
      hit_every: 1,
      sort_order: parseInt($('#spinSort').value, 10) || 0,
      active: $('#spinActive').checked ? 1 : 0,
      is_special: $('#spinSpecial') && $('#spinSpecial').checked ? 1 : 0,
    };
    try {
      if (id) {
        await api('/api/admin/spin-prizes/' + id, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/admin/spin-prizes', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      $('#spinModal').classList.remove('open');
      toast('စပင်ဘီး သိမ်းပြီး');
      loadSpinPrizes();
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener('click', async (e) => {
    const toggle = e.target.closest('[data-toggle-special]');
    if (toggle) {
      const id = Number(toggle.dataset.toggleSpecial);
      const prize = (loadSpinPrizes._cache || []).find((s) => s.id === id);
      if (!prize) return;
      const next = Number(prize.is_special) === 1 ? 0 : 1;
      try {
        await api('/api/admin/spin-prizes/' + id, {
          method: 'PUT',
          body: JSON.stringify({ is_special: next }),
        });
        toast(next ? 'Special ဖွင့်ပြီး (၁၅ကြိမ်တွင် ၁ကြိမ်)' : 'Special ပိတ်ပြီး');
        await loadSpinPrizes();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    const edit = e.target.closest('[data-edit-spin]');
    if (edit) {
      const id = Number(edit.dataset.editSpin);
      const prize = (loadSpinPrizes._cache || []).find((s) => s.id === id);
      if (prize) openSpinModal(prize);
      return;
    }
    const del = e.target.closest('[data-del-spin]');
    if (del) {
      if (!confirm('ဤဆုကို ဖျက်မည်လား?')) return;
      try {
        await api('/api/admin/spin-prizes/' + del.dataset.delSpin, {
          method: 'DELETE',
          body: '{}',
        });
        toast('ဖျက်ပြီး');
        loadSpinPrizes();
      } catch (err) {
        toast(err.message);
      }
    }
  });


  // Customer chat
  const CHAT_SEEN_KEY = 'mm_admin_chat_seen';
  let chatPollTimer = null;
  let chatBadgeTimer = null;
  let activeChatId = null;
  let chatThreadsCache = [];
  let chatSending = false;

  function loadChatSeen() {
    try {
      return JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function markChatSeen(id, updatedAt) {
    const seen = loadChatSeen();
    seen[String(id)] = String(updatedAt || '');
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(seen));
  }

  function clearChatSeen(id) {
    const seen = loadChatSeen();
    delete seen[String(id)];
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(seen));
  }

  function clearChatPane() {
    activeChatId = null;
    const pane = $('#chatThreadPane');
    if (!pane) return;
    delete pane.dataset.threadId;
    pane.innerHTML = '<div class="empty">ဘယ်ဘက်မှ ချတ် ရွေးပါ</div>';
  }

  async function deleteChatThread(id) {
    const tid = Number(id);
    if (!tid) return;
    if (!confirm('ဤချတ်ကို ဖျက်မည်လား? စကားဝိုင်းနှင့် မက်ဆေ့ချ်အားလုံး ပျောက်သွားမည်။')) return;
    try {
      await api('/api/admin/chat/threads/' + tid, { method: 'DELETE' });
      clearChatSeen(tid);
      if (Number(activeChatId) === tid) clearChatPane();
      toast('ချတ် ဖျက်ပြီးပါပြီ');
      await loadChatThreads();
    } catch (err) {
      toast(err.message);
      await loadChatThreads().catch(() => {});
    }
  }

  function isChatUnread(thread) {
    const seen = loadChatSeen();
    const last = String(thread.updated_at || '');
    const prev = seen[String(thread.id)] || '';
    if (thread.needs_reply) return true;
    return !!(last && last !== prev);
  }

  function formatChatWhen(isoOrSql) {
    if (!isoOrSql) return '';
    const raw = String(isoOrSql);
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return raw;
    try {
      return d.toLocaleString('en-GB', {
        timeZone: 'Asia/Yangon',
        hour12: false,
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return raw;
    }
  }

  function updateChatBadge(threads) {
    const badge = $('#chatNavBadge');
    if (!badge) return;
    const n = (threads || []).filter((t) => t.needs_reply || isChatUnread(t)).length;
    if (n) {
      badge.textContent = n > 9 ? '9+' : String(n);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderChatThreadList(threads) {
    const list = $('#chatThreadList');
    if (!list) return;
    if (!threads.length) {
      list.innerHTML = '<div class="empty hint">ချတ် မရှိသေးပါ</div>';
      return;
    }
    list.innerHTML = threads
      .map((t) => {
        const unread = isChatUnread(t);
        const cls = [
          'chat-thread-item',
          Number(activeChatId) === Number(t.id) ? 'active' : '',
          t.needs_reply || unread ? 'needs-reply' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const preview = t.last_body
          ? (t.last_sender === 'admin' ? 'သင်: ' : '') + t.last_body
          : 'မက်ဆေ့ချ် မရှိသေးပါ';
        return `
        <div class="${cls}" data-open-chat="${t.id}">
          <div class="chat-thread-row">
            <div class="chat-thread-main">
              <div class="who">${escapeHtml(t.customer_name || 'ဖောက်သည်')} ${
                t.status === 'closed' ? '<span class="badge cancelled">ပိတ်</span>' : ''
              }${t.needs_reply ? ' <span class="badge pending">အသစ်</span>' : ''}</div>
              <div class="preview">${escapeHtml(t.customer_phone || '')}${
                t.order_id ? ' · ' + escapeHtml(t.order_id) : ''
              }</div>
              <div class="preview">${escapeHtml(preview)}</div>
              <div class="when">${escapeHtml(formatChatWhen(t.updated_at))}</div>
            </div>
            <button type="button" class="btn btn-danger btn-sm chat-thread-del" data-del-chat="${t.id}" title="ချတ် ဖျက်မည်">ဖျက်မည်</button>
          </div>
        </div>`;
      })
      .join('');
  }

  async function loadChatThreads() {
    const threads = await api('/api/admin/chat/threads');
    chatThreadsCache = Array.isArray(threads) ? threads : [];
    if (
      activeChatId &&
      !chatThreadsCache.some((t) => Number(t.id) === Number(activeChatId))
    ) {
      clearChatPane();
    }
    renderChatThreadList(chatThreadsCache);
    updateChatBadge(chatThreadsCache);
    return chatThreadsCache;
  }

  function chatMessagesHtml(thread, msgs) {
    if (!msgs.length) return '<div class="empty hint">မက်ဆေ့ချ် မရှိသေးပါ</div>';
    return msgs
      .map((m) => {
        const who = m.sender === 'admin' ? 'သင်' : escapeHtml(thread.customer_name || 'ဖောက်သည်');
        return `<div class="admin-chat-msg ${escapeHtml(m.sender)}">
          <div class="bubble">${escapeHtml(m.body)}</div>
          <div class="when">${who} · ${escapeHtml(formatChatWhen(m.created_at))}</div>
        </div>`;
      })
      .join('');
  }

  function bindAdminChatActions(thread) {
    const form = $('#adminChatForm');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (chatSending) return;
        const bodyEl = $('#adminChatBody');
        const body = bodyEl ? bodyEl.value.trim() : '';
        if (!body) return;
        chatSending = true;
        if ($('#adminChatSendBtn')) $('#adminChatSendBtn').disabled = true;
        try {
          await api('/api/admin/chat/threads/' + activeChatId + '/messages', {
            method: 'POST',
            body: JSON.stringify({ body }),
          });
          if (bodyEl) bodyEl.value = '';
          await loadChatThreads();
          await openChatThread(activeChatId, { silent: true });
        } catch (err) {
          toast(err.message);
        } finally {
          chatSending = false;
          if ($('#adminChatSendBtn')) $('#adminChatSendBtn').disabled = false;
        }
      });
    }
    const closeBtn = $('#adminChatCloseBtn');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', async () => {
        try {
          const current = (chatThreadsCache.find((x) => Number(x.id) === Number(activeChatId)) || thread || {});
          const next = current.status === 'closed' ? 'open' : 'closed';
          await api('/api/admin/chat/threads/' + activeChatId, {
            method: 'PATCH',
            body: JSON.stringify({ status: next }),
          });
          toast(next === 'closed' ? 'ချတ် ပိတ်ပြီး' : 'ချတ် ပြန်ဖွင့်ပြီး');
          await loadChatThreads();
          await openChatThread(activeChatId, { force: true });
        } catch (err) {
          toast(err.message);
        }
      });
    }
  }

  async function openChatThread(id, opts = {}) {
    activeChatId = Number(id);
    const pane = $('#chatThreadPane');
    const keepDraft = !opts.force && $('#adminChatBody');
    if (!keepDraft && !opts.silent) {
      pane.innerHTML = '<div class="empty">ဖတ်နေသည်…</div>';
    }
    const data = await api('/api/admin/chat/threads/' + id + '/messages');
    const thread = data.thread || {};
    markChatSeen(thread.id, thread.updated_at);
    renderChatThreadList(chatThreadsCache);
    updateChatBadge(chatThreadsCache);
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    const msgHtml = chatMessagesHtml(thread, msgs);
    const existingMsgs = $('#adminChatMsgs');
    if (keepDraft && existingMsgs && Number(pane.dataset.threadId) === Number(thread.id)) {
      const head = pane.querySelector('.chat-admin-head .hint');
      if (head) {
        head.textContent =
          'ဖုန်း: ' +
          (thread.customer_phone || '') +
          (thread.order_id ? ' · အော်ဒါ: ' + thread.order_id : '') +
          ' · ' +
          (thread.status === 'closed' ? 'ပိတ်ထားသည်' : 'ဖွင့်ထားသည်');
      }
      const who = pane.querySelector('.chat-admin-head .who');
      if (who) who.textContent = thread.customer_name || '';
      const closeBtn = $('#adminChatCloseBtn');
      if (closeBtn) closeBtn.textContent = thread.status === 'closed' ? 'ပြန်ဖွင့်မည်' : 'ချတ် ပိတ်မည်';
      if (existingMsgs.dataset.sig !== msgHtml.length + ':' + msgs.map((m) => m.id).join(',')) {
        const atBottom = existingMsgs.scrollHeight - existingMsgs.scrollTop - existingMsgs.clientHeight < 40;
        existingMsgs.innerHTML = msgHtml;
        existingMsgs.dataset.sig = msgHtml.length + ':' + msgs.map((m) => m.id).join(',');
        if (atBottom) existingMsgs.scrollTop = existingMsgs.scrollHeight;
      }
      bindAdminChatActions(thread);
      return;
    }
    pane.dataset.threadId = String(thread.id);
    pane.innerHTML = `
      <div class="chat-admin-head">
        <div class="who">${escapeHtml(thread.customer_name || '')}</div>
        <div class="hint">ဖုန်း: ${escapeHtml(thread.customer_phone || '')}${
          thread.order_id ? ' · အော်ဒါ: ' + escapeHtml(thread.order_id) : ''
        } · ${thread.status === 'closed' ? 'ပိတ်ထားသည်' : 'ဖွင့်ထားသည်'}</div>
      </div>
      <div class="chat-admin-msgs" id="adminChatMsgs">${msgHtml}</div>
      <form class="chat-admin-compose" id="adminChatForm">
        <textarea id="adminChatBody" required maxlength="2000" placeholder="ပြန်စာ ရိုက်ပါ…"></textarea>
        <div class="row-actions" style="justify-content:flex-end">
          <button type="button" class="btn btn-outline btn-sm" id="adminChatCloseBtn">${
            thread.status === 'closed' ? 'ပြန်ဖွင့်မည်' : 'ချတ် ပိတ်မည်'
          }</button>
          <button type="submit" class="btn btn-primary btn-sm" id="adminChatSendBtn">မက်ဆေ့ချ် ပို့မည်</button>
        </div>
      </form>`;
    const box = $('#adminChatMsgs');
    if (box) {
      box.dataset.sig = msgHtml.length + ':' + msgs.map((m) => m.id).join(',');
      box.scrollTop = box.scrollHeight;
    }
    bindAdminChatActions(thread);
  }

  function startChatPolling() {
    stopChatPolling();
    loadChatThreads()
      .then(() => {
        if (activeChatId) return openChatThread(activeChatId);
      })
      .catch((err) => toast(err.message));
    chatPollTimer = setInterval(() => {
      loadChatThreads()
        .then(() => {
          if (activeChatId) return openChatThread(activeChatId);
        })
        .catch(() => {});
    }, 4000);
  }

  function stopChatPolling() {
    if (chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
  }

  function startChatBadgePoll() {
    stopChatBadgePoll();
    chatBadgeTimer = setInterval(() => {
      loadChatThreads().catch(() => {});
    }, 8000);
  }

  function stopChatBadgePoll() {
    if (chatBadgeTimer) {
      clearInterval(chatBadgeTimer);
      chatBadgeTimer = null;
    }
  }

  const refreshChatBtn = $('#refreshChatBtn');
  if (refreshChatBtn) {
    refreshChatBtn.addEventListener('click', () => {
      loadChatThreads()
        .then(() => {
          if (activeChatId) return openChatThread(activeChatId);
        })
        .catch((err) => toast(err.message));
    });
  }

  document.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-del-chat]');
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      deleteChatThread(delBtn.dataset.delChat).catch((err) => toast(err.message));
      return;
    }
    const btn = e.target.closest('[data-open-chat]');
    if (!btn) return;
    openChatThread(btn.dataset.openChat).catch((err) => toast(err.message));
  });

  checkAuth().catch(() => showLogin());
})();
