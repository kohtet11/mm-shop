(() => {
  const CART_KEY = 'mm_shop_cart';
  const MY_ORDERS_KEY = 'mm_shop_my_orders';
  const MY_ORDERS_MAX = 20;
  let products = [];
  let cart = loadCart();
  let payment = null;
  let myOrdersPollTimer = null;
  let promoTimer = null;
  let promoIndex = 0;
  let spinPrizes = [];
  let spinRotation = 0;
  let spinBusy = false;
  let spinCredits = 0;
  let spinUnlockedOrderId = '';
  const SPIN_COLORS = [
    '#7c3aed', '#a855f7', '#c026d3', '#db2777',
    '#6366f1', '#8b5cf6', '#ec4899', '#4f46e5',
  ];
  const SPIN_SESSION_KEY = 'mm_shop_spin_unlock';

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
    renderPromoCarousel();
    renderProducts();
  }

  function applyBranding(s) {
    // Keep the fixed Glow Gear full-width banner; do not swap in admin logo_url.
    const name = (s && s.shop_name) || 'Glow Gear';
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

  function discountBadgeHtml(pct) {
    const n = Number(pct) || 0;
    if (n <= 0) return '';
    return `<span class="discount-badge">${n}% OFF</span>`;
  }

  function renderPromoCarousel() {
    const wrap = $('#promoCarousel');
    const track = $('#promoTrack');
    const dots = $('#promoDots');
    if (!wrap || !track || !dots) return;

    stopPromoTimer();
    const slides = products.filter((p) => Number(p.on_banner) === 1);
    if (!slides.length) {
      wrap.hidden = true;
      wrap.classList.remove('ready');
      track.innerHTML = '';
      dots.innerHTML = '';
      return;
    }

    wrap.hidden = false;
    wrap.classList.add('ready');
    promoIndex = 0;

    track.innerHTML = slides
      .map(
        (p, i) => `
      <button type="button" class="promo-slide${i === 0 ? ' active' : ''}" data-promo-product="${p.id}" aria-label="${escapeHtml(p.name)}">
        <div class="promo-media">
          <img src="${imgUrl(p.image_path)}" alt="${escapeHtml(p.name)}" loading="lazy" />
          ${discountBadgeHtml(p.discount_percent)}
        </div>
        <div class="promo-meta">
          <strong>${escapeHtml(p.name)}</strong>
          <span class="price">${formatMMK(p.price_mmk)}</span>
        </div>
      </button>`
      )
      .join('');

    dots.innerHTML = slides
      .map(
        (_, i) =>
          `<button type="button" class="promo-dot${i === 0 ? ' active' : ''}" data-promo-dot="${i}" aria-label="slide ${i + 1}"></button>`
      )
      .join('');

    showPromoSlide(0);
    if (slides.length > 1) startPromoTimer();
  }

  function bannerSlides() {
    return products.filter((p) => Number(p.on_banner) === 1);
  }

  function showPromoSlide(idx) {
    const slides = $$('.promo-slide');
    const dots = $$('.promo-dot');
    if (!slides.length) return;
    promoIndex = ((idx % slides.length) + slides.length) % slides.length;
    slides.forEach((el, i) => el.classList.toggle('active', i === promoIndex));
    dots.forEach((el, i) => el.classList.toggle('active', i === promoIndex));
  }

  function startPromoTimer() {
    stopPromoTimer();
    promoTimer = setInterval(() => {
      showPromoSlide(promoIndex + 1);
    }, 5000);
  }

  function stopPromoTimer() {
    if (promoTimer) {
      clearInterval(promoTimer);
      promoTimer = null;
    }
  }

  function scrollToProduct(productId) {
    const card = document.getElementById('product-' + productId);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlight');
    setTimeout(() => card.classList.remove('highlight'), 1600);
    const addBtn = card.querySelector('[data-add]');
    if (addBtn) {
      try { addBtn.focus({ preventScroll: true }); } catch (_) { addBtn.focus(); }
    }
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
      <article class="product-card" id="product-${p.id}" data-id="${p.id}">
        <div class="thumb-wrap">
          <img class="thumb" src="${imgUrl(p.image_path)}" alt="${escapeHtml(p.name)}" loading="lazy" />
          ${discountBadgeHtml(p.discount_percent)}
        </div>
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
    const promoSlide = e.target.closest('[data-promo-product]');
    if (promoSlide) {
      scrollToProduct(Number(promoSlide.dataset.promoProduct));
      return;
    }
    const promoDot = e.target.closest('[data-promo-dot]');
    if (promoDot) {
      showPromoSlide(Number(promoDot.dataset.promoDot));
      startPromoTimer();
      return;
    }
    if (e.target.closest('#promoPrev')) {
      showPromoSlide(promoIndex - 1);
      startPromoTimer();
      return;
    }
    if (e.target.closest('#promoNext')) {
      showPromoSlide(promoIndex + 1);
      startPromoTimer();
      return;
    }
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

    const nameVal = $('#customerName').value.trim();
    const phoneVal = $('#phone').value.trim();
    const addressVal = $('#address').value.trim();
    if (!nameVal || !phoneVal || !addressVal) {
      toast('အမည်၊ ဖုန်းနှင့် လိပ်စာ လိုအပ်သည်');
      btn.disabled = false;
      btn.textContent = 'အော်ဒါ အတည်ပြုမည်';
      return;
    }
    const fd = new FormData();
    fd.append('customer_name', nameVal);
    fd.append('phone', phoneVal);
    fd.append('address', addressVal);
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


  // ========== Spin wheel ==========

  function loadSpinSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SPIN_SESSION_KEY) || 'null');
      if (s && s.orderId) {
        spinUnlockedOrderId = String(s.orderId);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function saveSpinSession() {
    if (!spinUnlockedOrderId) {
      sessionStorage.removeItem(SPIN_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(
      SPIN_SESSION_KEY,
      JSON.stringify({ orderId: spinUnlockedOrderId })
    );
  }

  async function fetchSpinPrizes() {
    try {
      const res = await fetch('/api/spin/prizes');
      if (!res.ok) throw new Error('spin fetch failed');
      spinPrizes = await res.json();
    } catch (_) {
      spinPrizes = [];
    }
    renderSpinSection();
    if (spinPrizes.length && loadSpinSession()) {
      const oidEl = $('#spinOrderId');
      if (oidEl) oidEl.value = spinUnlockedOrderId;
      await unlockSpin(true);
    }
  }

  function renderSpinSection() {
    const section = $('#spinSection');
    if (!section) return;
    if (!spinPrizes.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    drawSpinWheel(spinRotation);
    updateSpinButton();
  }

  function updateSpinButton() {
    const btn = $('#spinBtn');
    const hint = $('#spinHint');
    if (!btn) return;
    const n = Math.max(0, Number(spinCredits) || 0);
    btn.textContent = 'ကံစမ်းမည် (' + n + ')';
    const canSpin = n >= 1 && !spinBusy && !!spinUnlockedOrderId;
    btn.disabled = !canSpin;
    btn.classList.toggle('ready', canSpin);
    btn.classList.toggle('dimmed', !canSpin);
    if (hint) {
      if (spinBusy) hint.textContent = 'လှည့်နေသည်…';
      else if (!spinUnlockedOrderId) {
        hint.textContent = 'အော်ဒါနံပါတ် ထည့်ပြီး ကံစမ်းခွင့် စစ်ပါ';
      } else if (n < 1) {
        hint.textContent = 'ကံစမ်းခွင့် ကုန်သွားပါပြီ — Admin ထံ ဆက်သွယ်ပါ';
      } else {
        hint.textContent = 'ကျန်ရှိသော အခွင့်: ' + n;
      }
    }
  }

  function drawSpinWheel(rotationDeg) {
    const canvas = $('#spinCanvas');
    if (!canvas || !spinPrizes.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const parentW = (canvas.parentElement && canvas.parentElement.clientWidth) || 360;
    const cssSize = Math.min(360, Math.floor(parentW * 0.92));
    const size = Math.max(240, cssSize);
    if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 6;
    const n = spinPrizes.length;
    const arc = (Math.PI * 2) / n;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    for (let i = 0; i < n; i++) {
      const startA = i * arc - Math.PI / 2;
      const endA = startA + arc;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startA, endA);
      ctx.closePath();
      ctx.fillStyle = SPIN_COLORS[i % SPIN_COLORS.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const label = String(spinPrizes[i].name || '');
      const mid = startA + arc / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 4;
      const maxLen = radius - 28;
      const fontSize = Math.min(15, Math.max(9, Math.floor(radius / (n > 8 ? 14 : 11))));
      ctx.font = '600 ' + fontSize + 'px "Noto Sans Myanmar","Pyidaungsu",system-ui,sans-serif';
      let t = label;
      while (ctx.measureText(t).width > maxLen && t.length > 1) t = t.slice(0, -1);
      if (t !== label && t.length > 2) t = t.slice(0, -1) + '…';
      ctx.fillText(t, radius - 12, 0);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(22, radius * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = '#0f0a1a';
    ctx.fill();
    ctx.strokeStyle = '#c4b5fd';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#e9d5ff';
    ctx.font = '700 ' + Math.max(10, Math.floor(radius * 0.08)) + 'px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText('SPIN', cx, cy);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.9)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  function animateSpinTo(targetIndex, durationMs) {
    return new Promise((resolve) => {
      const n = spinPrizes.length;
      const arcDeg = 360 / n;
      const segmentCenterFromStart = targetIndex * arcDeg + arcDeg / 2;
      const base = -segmentCenterFromStart;
      const current = ((spinRotation % 360) + 360) % 360;
      const baseNorm = ((base % 360) + 360) % 360;
      const adjust = (baseNorm - current + 360) % 360;
      const extra = 360 * (5 + Math.floor(Math.random() * 3));
      const targetRot = spinRotation + extra + adjust;
      const startRot = spinRotation;
      const t0 = performance.now();

      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      function frame(now) {
        const t = Math.min(1, (now - t0) / durationMs);
        spinRotation = startRot + (targetRot - startRot) * easeOutCubic(t);
        drawSpinWheel(spinRotation);
        if (t < 1) requestAnimationFrame(frame);
        else {
          spinRotation = targetRot;
          drawSpinWheel(spinRotation);
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  async function unlockSpin(silent) {
    const orderId = ($('#spinOrderId') && $('#spinOrderId').value.trim()) || spinUnlockedOrderId;
    const msg = $('#spinUnlockMsg');
    if (!orderId) {
      if (msg && !silent) msg.textContent = 'အော်ဒါနံပါတ် ထည့်ပါ';
      return;
    }
    try {
      const res = await fetch('/api/spin/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'missing_contact' || res.status === 400) {
          throw new Error(
            data.error ||
              'အော်ဒါ ဆက်သွယ်ရန် အချက်အလက် (အမည် / ဖုန်း / လိပ်စာ) မပြည့်စုံပါ — ငွေချေသည့်အခါ ဖြည့်ထားသော အချက်အလက် လိုအပ်သည်'
          );
        }
        throw new Error(data.error || 'မတွေ့ပါ');
      }
      spinUnlockedOrderId = data.orderId || orderId;
      spinCredits = Number(data.spinCredits) || 0;
      saveSpinSession();
      if (msg) {
        msg.textContent =
          spinCredits >= 1
            ? 'ကံစမ်းခွင့် ' + spinCredits + ' ကြိမ် ရှိသည် — ခလုတ် လင်းနေသည်'
            : 'အော်ဒါတွေ့ပါပြီ — ကံစမ်းခွင့် 0 (Admin က ထည့်ပေးမှ လှည့်နိုင်သည်)';
        msg.classList.toggle('ok', spinCredits >= 1);
      }
      updateSpinButton();
    } catch (err) {
      spinCredits = 0;
      spinUnlockedOrderId = '';
      saveSpinSession();
      if (msg) {
        msg.textContent = err.message || 'မရရှိနိုင်ပါ';
        msg.classList.remove('ok');
      }
      updateSpinButton();
    }
  }

  async function doSpin() {
    if (spinBusy || !spinPrizes.length) return;
    if (!spinUnlockedOrderId || spinCredits < 1) {
      updateSpinButton();
      toast('ကံစမ်းခွင့် မရှိပါ');
      return;
    }
    spinBusy = true;
    updateSpinButton();
    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: spinUnlockedOrderId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (typeof data.spinCredits === 'number') spinCredits = data.spinCredits;
        if (data.code === 'missing_contact') {
          throw new Error(
            data.error ||
              'အော်ဒါ ဆက်သွယ်ရန် အချက်အလက် (အမည် / ဖုန်း / လိပ်စာ) မပြည့်စုံပါ — ငွေချေသည့်အခါ ဖြည့်ထားသော အချက်အလက် လိုအပ်သည်'
          );
        }
        throw new Error(data.error || 'လှည့်မရပါ');
      }
      if (typeof data.spinCredits === 'number') spinCredits = data.spinCredits;

      let idx = spinPrizes.findIndex((p) => p.id === data.prizeId);
      if (idx < 0) {
        const r2 = await fetch('/api/spin/prizes');
        if (r2.ok) spinPrizes = await r2.json();
        drawSpinWheel(spinRotation);
        idx = spinPrizes.findIndex((p) => p.id === data.prizeId);
      }
      if (idx < 0) throw new Error('ဆု မတွေ့ပါ');

      await animateSpinTo(idx, 4200);
      showSpinResult(data);
      const msg = $('#spinUnlockMsg');
      if (msg) {
        msg.textContent = 'ကျန်ရှိသော အခွင့်: ' + spinCredits;
        msg.classList.toggle('ok', spinCredits >= 1);
      }
    } catch (err) {
      toast(err.message || 'အမှားဖြစ်နေသည်');
    } finally {
      spinBusy = false;
      updateSpinButton();
    }
  }

  function showSpinResult(data) {
    $('#spinResultName').textContent = data.name || '';
    const btn = $('#spinResultProductBtn');
    if (data.productId) {
      btn.classList.remove('hidden');
      btn.onclick = () => {
        closeOverlay('spinResultOverlay');
        scrollToProduct(Number(data.productId));
      };
    } else {
      btn.classList.add('hidden');
      btn.onclick = null;
    }
    openOverlay('spinResultOverlay');
  }

  const spinBtn = $('#spinBtn');
  if (spinBtn) spinBtn.addEventListener('click', () => doSpin());
  const unlockBtn = $('#spinUnlockBtn');
  if (unlockBtn) unlockBtn.addEventListener('click', () => unlockSpin(false));

  document.addEventListener('click', (e) => {
    if (e.target === $('#spinResultOverlay')) closeOverlay('spinResultOverlay');
  });

  window.addEventListener('resize', () => {
    if (!spinPrizes.length) return;
    drawSpinWheel(spinRotation);
  });

  updateCartCount();
  fetchProducts();
  fetchPayment();
  fetchSpinPrizes();
})();
