(() => {
  const CART_KEY = 'mm_shop_cart';
  const MY_ORDERS_KEY = 'mm_shop_my_orders';
  const MY_ORDERS_MAX = 20;
  let products = [];
  let cart = loadCart();
  let payment = null;
  let myOrdersPollTimer = null;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount();
  }

  const STATUS_LABEL = {
    pending: 'စောင့်ဆိုင်းဆဲ',
    paid_confirmed: 'ငွေအတည်ပြုပြီး',
    shipped: 'ပို့ဆောင်ပြီး',
    cancelled: 'ပယ်ဖျက်ပြီး',
  };

  function loadMyOrders() {
    try {
      const list = JSON.parse(localStorage.getItem(MY_ORDERS_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveMyOrders(list) {
    localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(list.slice(0, MY_ORDERS_MAX)));
  }

  function rememberOrder(orderId, phone) {
    if (!orderId || !phone) return;
    const list = loadMyOrders().filter((o) => o.orderId !== orderId);
    list.unshift({
      orderId: String(orderId),
      phone: String(phone),
      createdAt: new Date().toISOString(),
    });
    saveMyOrders(list);
  }

  function formatOrderDate(isoOrSql) {
    if (!isoOrSql) return '';
    const d = new Date(String(isoOrSql).includes('T') ? isoOrSql : String(isoOrSql).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return String(isoOrSql);
    try {
      return d.toLocaleString('en-GB', { timeZone: 'Asia/Yangon', hour12: false });
    } catch {
      return String(isoOrSql);
    }
  }

  function renderMyOrdersSkeleton() {
    const list = loadMyOrders();
    const el = $('#myOrdersList');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty hint">အော်ဒါ မရှိသေးပါ — အော်ဒါတင်ပြီးနောက် ဤနေရာတွင် အခြေအနေ မြင်ရမည်</div>';
      return;
    }
    el.innerHTML = list
      .map(
        (o) => `
      <div class="my-order-card" data-my-order="${escapeHtml(o.orderId)}">
        <div class="oid">${escapeHtml(o.orderId)}</div>
        <div class="meta">
          <span class="badge pending">စစ်ဆေးနေသည်…</span>
          <span class="hint">${escapeHtml(formatOrderDate(o.createdAt))}</span>
        </div>
      </div>`
      )
      .join('');
  }

  async function trackOne(orderId, phone) {
    const res = await fetch('/api/orders/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, phone }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function refreshMyOrders() {
    const el = $('#myOrdersList');
    if (!el) return;
    let list = loadMyOrders();
    if (!list.length) {
      el.innerHTML = '<div class="empty hint">အော်ဒါ မရှိသေးပါ — အော်ဒါတင်ပြီးနောက် ဤနေရာတွင် အခြေအနေ မြင်ရမည်</div>';
      return;
    }

    const kept = [];
    const cards = [];

    for (const o of list) {
      try {
        const { ok, status, data } = await trackOne(o.orderId, o.phone);
        if (!ok && status === 404) {
          // deleted / not found — drop from saved list
          continue;
        }
        kept.push(o);
        if (!ok) {
          cards.push(`
            <div class="my-order-card unavailable" data-my-order="${escapeHtml(o.orderId)}">
              <div class="oid">${escapeHtml(o.orderId)}</div>
              <div class="meta"><span class="hint">${escapeHtml(data.error || 'မရရှိနိုင်ပါ')}</span></div>
            </div>`);
          continue;
        }
        const st = data.status || 'pending';
        const label = STATUS_LABEL[st] || st;
        const when = formatOrderDate(data.created_at || o.createdAt);
        cards.push(`
          <div class="my-order-card" data-my-order="${escapeHtml(o.orderId)}">
            <div class="oid">${escapeHtml(data.order_id || o.orderId)}</div>
            <div class="meta">
              <span class="badge ${escapeHtml(st)}">${escapeHtml(label)}</span>
              <span>${formatMMK(data.total_mmk)}</span>
              <span class="hint">${escapeHtml(when)}</span>
            </div>
          </div>`);
      } catch (_) {
        kept.push(o);
        cards.push(`
          <div class="my-order-card unavailable" data-my-order="${escapeHtml(o.orderId)}">
            <div class="oid">${escapeHtml(o.orderId)}</div>
            <div class="meta"><span class="hint">ချိတ်ဆက်မရပါ</span></div>
          </div>`);
      }
    }

    if (kept.length !== list.length) saveMyOrders(kept);

    if (!cards.length) {
      el.innerHTML = '<div class="empty hint">အော်ဒါ မရှိသေးပါ — အော်ဒါတင်ပြီးနောက် ဤနေရာတွင် အခြေအနေ မြင်ရမည်</div>';
    } else {
      el.innerHTML = cards.join('');
    }
  }

  function startMyOrdersPolling() {
    stopMyOrdersPolling();
    myOrdersPollTimer = setInterval(() => {
      if ($('#cartOverlay') && $('#cartOverlay').classList.contains('open')) {
        refreshMyOrders();
      } else {
        stopMyOrdersPolling();
      }
    }, 30000);
  }

  function stopMyOrdersPolling() {
    if (myOrdersPollTimer) {
      clearInterval(myOrdersPollTimer);
      myOrdersPollTimer = null;
    }
  }


  function formatMMK(n) {
    return Number(n || 0).toLocaleString('en-US') + ' ကျပ်';
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function updateCartCount() {
    const count = cart.reduce((s, i) => s + i.quantity, 0);
    $('#cartCount').textContent = String(count);
  }

  function imgUrl(path) {
    if (!path) return '';
    return path.startsWith('/') ? path : '/uploads/' + path;
  }

  async function fetchProducts() {
    const res = await fetch('/api/products');
    products = await res.json();
    renderProducts();
  }

  function applyBranding(s) {
    const name = (s && s.shop_name) || 'MM Shop';
    const logoUrl = (s && s.logo_url) || '';
    const textEl = document.getElementById('siteLogoText');
    const imgEl = document.getElementById('siteLogoImg');
    if (textEl) textEl.textContent = logoUrl ? name : '🛒 ' + name;
    if (imgEl) {
      if (logoUrl) {
        imgEl.src = logoUrl;
        imgEl.alt = name;
        imgEl.classList.remove('hidden');
      } else {
        imgEl.removeAttribute('src');
        imgEl.classList.add('hidden');
      }
    }
    document.title = name + ' — အွန်လိုင်းစတိုး';
  }

  async function fetchPayment() {
    // Prefer public settings (includes branding + bank fields)
    try {
      const res = await fetch('/api/settings/public');
      if (res.ok) {
        payment = await res.json();
        applyBranding(payment);
        renderPayment();
        return;
      }
    } catch (_) {}
    const res = await fetch('/api/settings/payment');
    payment = await res.json();
    renderPayment();
  }

  function renderProducts() {
    const grid = $('#productsGrid');
    if (!products.length) {
      grid.innerHTML = '<div class="empty">ပစ္စည်း မရှိသေးပါ</div>';
      return;
    }
    grid.innerHTML = products
      .map(
        (p) => `
      <article class="product-card" data-id="${p.id}">
        <img class="thumb" src="${imgUrl(p.image_path)}" alt="${escapeHtml(p.name)}" loading="lazy" />
        <div class="body">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="desc">${escapeHtml(p.description || '')}</div>
          <div class="price">${formatMMK(p.price_mmk)}</div>
          <div class="actions">
            <button type="button" class="btn btn-primary" data-add="${p.id}">ခြင်းတောင်းထည့်မည်</button>
          </div>
        </div>
      </article>`
      )
      .join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addToCart(productId) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const existing = cart.find((x) => x.product_id === productId);
    if (existing) existing.quantity += 1;
    else {
      cart.push({
        product_id: p.id,
        name: p.name,
        price_mmk: p.price_mmk,
        image_path: p.image_path,
        quantity: 1,
      });
    }
    saveCart();
    toast('ခြင်းတောင်းထဲ ထည့်ပြီးပါပြီ');
  }

  function setQty(productId, qty) {
    const item = cart.find((x) => x.product_id === productId);
    if (!item) return;
    item.quantity = Math.max(1, qty);
    saveCart();
    renderCart();
  }

  function removeFromCart(productId) {
    cart = cart.filter((x) => x.product_id !== productId);
    saveCart();
    renderCart();
  }

  function cartTotal() {
    return cart.reduce((s, i) => s + i.price_mmk * i.quantity, 0);
  }

  function renderCart() {
    const list = $('#cartList');
    if (!cart.length) {
      list.innerHTML = '<div class="empty">ခြင်းတောင်း ဗလာဖြစ်နေသည်</div>';
      $('#goCheckoutBtn').disabled = true;
    } else {
      $('#goCheckoutBtn').disabled = false;
      list.innerHTML = cart
        .map(
          (i) => `
        <div class="cart-item">
          <img src="${imgUrl(i.image_path)}" alt="" />
          <div>
            <strong>${escapeHtml(i.name)}</strong>
            <div class="hint">${formatMMK(i.price_mmk)}</div>
            <div class="qty-row">
              <button type="button" data-dec="${i.product_id}">−</button>
              <span>${i.quantity}</span>
              <button type="button" data-inc="${i.product_id}">+</button>
            </div>
          </div>
          <div>
            <div>${formatMMK(i.price_mmk * i.quantity)}</div>
            <button type="button" class="btn btn-sm btn-outline" data-remove="${i.product_id}" style="margin-top:0.4rem">ဖယ်မည်</button>
          </div>
        </div>`
        )
        .join('');
    }
    $('#cartTotal').textContent = formatMMK(cartTotal());
    $('#checkoutTotal').textContent = formatMMK(cartTotal());
  }

  function renderPayment() {
    if (!payment) return;
    const mmqr = payment.mmqr_url
      ? `<div class="mmqr-box">
          <div><strong>MMQR ဖြင့် ငွေလွှဲရန်</strong></div>
          <img class="mmqr-img" src="${escapeHtml(payment.mmqr_url)}" alt="MMQR" />
        </div>`
      : '';
    $('#payInstructions').innerHTML = `
      <div><strong>ဘဏ်လွှဲငွေ ညွှန်ကြားချက်</strong></div>
      <div>ဘဏ်အမည် — ${escapeHtml(payment.bank_name || '-')}</div>
      <div>အကောင့်နံပါတ် — <strong>${escapeHtml(payment.account_number || '-')}</strong></div>
      <div>အကောင့်အမည် — ${escapeHtml(payment.account_name || '-')}</div>
      <div class="hint" style="margin-top:0.4rem">${escapeHtml(payment.payment_note || '')}</div>
      ${mmqr}
    `;
  }

  function openOverlay(id) {
    $('#' + id).classList.add('open');
  }
  function closeOverlay(id) {
    $('#' + id).classList.remove('open');
    if (id === 'cartOverlay') stopMyOrdersPolling();
  }

  // Events
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      addToCart(Number(add.dataset.add));
      return;
    }
    const close = e.target.closest('[data-close]');
    if (close) {
      closeOverlay(close.dataset.close);
      return;
    }
    const inc = e.target.closest('[data-inc]');
    if (inc) {
      const id = Number(inc.dataset.inc);
      const item = cart.find((x) => x.product_id === id);
      if (item) setQty(id, item.quantity + 1);
      return;
    }
    const dec = e.target.closest('[data-dec]');
    if (dec) {
      const id = Number(dec.dataset.dec);
      const item = cart.find((x) => x.product_id === id);
      if (item) setQty(id, item.quantity - 1);
      return;
    }
    const rem = e.target.closest('[data-remove]');
    if (rem) {
      removeFromCart(Number(rem.dataset.remove));
      return;
    }
    if (e.target === $('#cartOverlay')) {
      closeOverlay('cartOverlay');
      stopMyOrdersPolling();
    }
    if (e.target === $('#checkoutOverlay')) closeOverlay('checkoutOverlay');
  });

  $('#openCartBtn').addEventListener('click', () => {
    renderCart();
    renderMyOrdersSkeleton();
    openOverlay('cartOverlay');
    refreshMyOrders();
    startMyOrdersPolling();
  });

  $('#goCheckoutBtn').addEventListener('click', () => {
    if (!cart.length) return;
    closeOverlay('cartOverlay');
    $('#checkoutFormView').classList.remove('hidden');
    $('#checkoutSuccess').classList.add('hidden');
    $('#checkoutTotal').textContent = formatMMK(cartTotal());
    openOverlay('checkoutOverlay');
  });

  $('#doneBtn').addEventListener('click', () => {
    closeOverlay('checkoutOverlay');
    cart = [];
    saveCart();
    renderCart();
  });

  $('#checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!cart.length) {
      toast('ခြင်းတောင်း ဗလာဖြစ်နေသည်');
      return;
    }
    const btn = $('#submitOrderBtn');
    btn.disabled = true;
    btn.textContent = 'တင်နေသည်…';

    const fd = new FormData();
    fd.append('customer_name', $('#customerName').value.trim());
    fd.append('phone', $('#phone').value.trim());
    fd.append('address', $('#address').value.trim());
    fd.append('notes', $('#notes').value.trim());
    fd.append(
      'items',
      JSON.stringify(cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })))
    );
    const slip = $('#slip').files[0];
    if (!slip) {
      toast('ငွေလွှဲစလစ် ပုံတင်ပါ');
      btn.disabled = false;
      btn.textContent = 'အော်ဒါ အတည်ပြုမည်';
      return;
    }
    fd.append('slip', slip);

    try {
      const res = await fetch('/api/orders', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'မအောင်မြင်ပါ');
      $('#successOrderId').textContent = data.order_id;
      const phoneVal = $('#phone').value.trim();
      rememberOrder(data.order_id, phoneVal);
      const trackLink = $('#trackOrderLink');
      if (trackLink) {
        trackLink.href =
          '/track?id=' +
          encodeURIComponent(data.order_id) +
          '&phone=' +
          encodeURIComponent(phoneVal);
      }
      $('#checkoutFormView').classList.add('hidden');
      $('#checkoutSuccess').classList.remove('hidden');
      cart = [];
      saveCart();
      $('#checkoutForm').reset();
    } catch (err) {
      toast(err.message || 'အမှားဖြစ်နေသည်');
    } finally {
      btn.disabled = false;
      btn.textContent = 'အော်ဒါ အတည်ပြုမည်';
    }
  });

  updateCartCount();
  fetchProducts();
  fetchPayment();
})();
