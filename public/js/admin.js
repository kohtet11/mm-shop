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
    loadProducts();
    loadSpinPrizes().catch(() => {});
    loadSpinWins().catch(() => {});
    loadOrders();
    loadSettings();
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
    });
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
          return `
      <tr>
        <td>${p.image_path ? `<img class="thumb-sm" src="${imgUrl(p.image_path)}" alt="" />` : '—'}</td>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          <div class="hint">${escapeHtml((p.description || '').slice(0, 80))}</div>
        </td>
        <td>${formatMMK(p.price_mmk)}</td>
        <td>${bannerCell}</td>
        <td>${p.active ? '<span class="badge paid_confirmed">active</span>' : '<span class="badge cancelled">inactive</span>'}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm btn-outline" data-edit-product="${p.id}">ပြင်မည်</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-product="${p.id}">ဖျက်မည်</button>
        </td>
      </tr>`;
        }
      )
      .join('') || '<tr><td colspan="6" class="empty">ပစ္စည်း မရှိသေးပါ</td></tr>';

    loadProducts._cache = products;
  }

  function syncProductSpinFields(product) {
    const add = $('#pSpinAdd');
    const fields = $('#pSpinFields');
    const hit = $('#pSpinHit');
    const hint = $('#pSpinHint');
    if (!add || !fields || !hit) return;
    const prizes = loadSpinPrizes._cache || [];
    const linked = product
      ? prizes.find((s) => s.product_id && Number(s.product_id) === Number(product.id))
      : null;
    if (linked) {
      add.checked = true;
      fields.classList.remove('hidden');
      hit.value = String(linked.hit_every || 10);
      hint.textContent = 'လက်ရှိဘီး entry #' + linked.id + ' — သိမ်းရင် အပ်ဒိတ်လုပ်မည်';
      add.dataset.spinId = String(linked.id);
    } else {
      add.checked = false;
      fields.classList.add('hidden');
      hit.value = '10';
      hint.textContent = 'ပစ္စည်းအမည်ဖြင့် စပင်ဘီး entry အသစ် ထည့်မည်';
      delete add.dataset.spinId;
    }
  }

  function openProductModal(product) {
    $('#productModalTitle').textContent = product ? 'ပစ္စည်း ပြင်ဆင်ရန်' : 'ပစ္စည်း အသစ်';
    $('#productId').value = product ? product.id : '';
    $('#pName').value = product ? product.name : '';
    $('#pPrice').value = product ? product.price_mmk : '';
    $('#pDesc').value = product ? product.description || '' : '';
    $('#pActive').checked = product ? !!product.active : true;
    $('#pOnBanner').checked = product ? !!product.on_banner : false;
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
    syncProductSpinFields(product);
    $('#productModal').classList.add('open');
  }

  const pSpinAddEl = $('#pSpinAdd');
  if (pSpinAddEl) {
    pSpinAddEl.addEventListener('change', () => {
      const fields = $('#pSpinFields');
      if (fields) fields.classList.toggle('hidden', !pSpinAddEl.checked);
    });
  }

  $('#newProductBtn').addEventListener('click', () => openProductModal(null));
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
        if (addEl && addEl.checked && saved && saved.id) {
          const hitEvery = Math.max(1, parseInt($('#pSpinHit').value, 10) || 10);
          const spinId = addEl.dataset.spinId;
          const payload = {
            name: String(saved.name || $('#pName').value.trim()),
            product_id: saved.id,
            hit_every: hitEvery,
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
    const edit = e.target.closest('[data-edit-product]');
    if (edit) {
      const id = Number(edit.dataset.editProduct);
      const p = (loadProducts._cache || []).find((x) => x.id === id);
      if (p) openProductModal(p);
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
          <div class="hint">ဘီးအခွင့်: ${Number(o.spin_credits) || 0}</div>
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
        <label for="orderSpinCredits">စပင်ဘီး ကံစမ်းခွင့် (spin_credits)</label>
        <input id="orderSpinCredits" type="number" min="0" step="1" value="${Number(o.spin_credits) || 0}" />
        <div class="hint">စလစ်/ငွေပေးချေမှုအရ အခွင့် အရေအတွက် သတ်မှတ်ပါ (ဥပမာ ၁ ကြိမ် = 1)</div>
      </div>
      <div class="row-actions" style="gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
        <button type="button" class="btn btn-primary btn-sm" id="saveStatusBtn" data-oid="${escapeHtml(
        o.order_id
      )}">အခြေအနေ သိမ်းမည်</button>
        <button type="button" class="btn btn-pink btn-sm" id="saveSpinCreditsBtn" data-oid="${escapeHtml(
        o.order_id
      )}">ကံစမ်းခွင့် သိမ်းမည်</button>
        <button type="button" class="btn btn-danger btn-sm" id="deleteOrderBtn" data-oid="${escapeHtml(
        o.order_id
      )}">ဖျက်မည်</button>
      </div>
      <h3 style="margin-bottom:0.35rem">ပစ္စည်းများ</h3>
      <ul>${itemsHtml || '<li>—</li>'}</ul>
      <h3 style="margin-bottom:0.35rem">စပင်မှတ်တမ်း</h3>
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

    $('#saveSpinCreditsBtn').onclick = async () => {
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
    const prizes = await api('/api/admin/spin-prizes');
    loadSpinPrizes._cache = prizes;
    const tbody = $('#spinTable tbody');
    if (!tbody) return prizes;
    tbody.innerHTML =
      prizes
        .map((s) => {
          const prod = s.product_name
            ? escapeHtml(s.product_name)
            : '<span class="hint">—</span>';
          return `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${prod}</td>
        <td><code>1/${Number(s.hit_every) || 1}</code></td>
        <td>${Number(s.sort_order) || 0}</td>
        <td>${s.active ? '<span class="badge paid_confirmed">active</span>' : '<span class="badge cancelled">inactive</span>'}</td>
        <td class="row-actions">
          <button type="button" class="btn btn-sm btn-outline" data-edit-spin="${s.id}">ပြင်မည်</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-spin="${s.id}">ဖျက်မည်</button>
        </td>
      </tr>`;
        })
        .join('') || '<tr><td colspan="6" class="empty">ဆု မရှိသေးပါ — စတိုးတွင် စပင်ဘီး ပုန်းနေမည်</td></tr>';
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
    sel.innerHTML =
      '<option value="">— မချိတ် —</option>' +
      products
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
    $('#spinHitEvery').value = prize ? prize.hit_every : 10;
    $('#spinSort').value = prize ? prize.sort_order : 0;
    $('#spinActive').checked = prize ? !!prize.active : true;
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
      hit_every: Math.max(1, parseInt($('#spinHitEvery').value, 10) || 1),
      sort_order: parseInt($('#spinSort').value, 10) || 0,
      active: $('#spinActive').checked ? 1 : 0,
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

  checkAuth().catch(() => showLogin());
})();
