(() => {
  const CART_KEY = 'mm_shop_cart';
  const MY_ORDERS_KEY = 'mm_shop_my_orders';
  const MY_ORDERS_MAX = 20;
  let products = [];
  let customBannerSlides = [];
  let storeCategories = [];
  let productQuery = '';
  let productCategory = 'blind_box';
  let cart = loadCart();
  let payment = null;
  let myOrdersPollTimer = null;
  let promoTimer = null;
  let promoIndex = 0;
  let spinPrizes = [];
  let spinRotation = 0;
  let spinBusy = false;
  let spinCredits = 0;
  let spinExpired = false;
  let spinLocked = false;
  let spinCompleted = false;
  let spinUnlockedOrderId = '';
  let spinBuyProduct = null;
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

  function buyerSpinWinsHtml(plays, opts) {
    const list = Array.isArray(plays) ? plays : [];
    if (!list.length) return '';
    const linkProducts = !!(opts && opts.linkProducts);
    const items = list
      .map((p) => {
        const name = p.name || p.prize_name || '';
        const when = formatOrderDate(p.created_at);
        const pid = p.product_id != null && p.product_id !== '' ? Number(p.product_id) : NaN;
        const hasPid = Number.isFinite(pid);
        const prodLabel = p.product_name
          ? escapeHtml(p.product_name)
          : hasPid
            ? 'ပစ္စည်း #' + pid
            : '—';
        const prodHtml =
          linkProducts && hasPid
            ? `<button type="button" class="linkish" data-goto-product="${pid}">ရရှိသောပစ္စည်း: ${prodLabel}</button>`
            : `<span class="hint">ရရှိသောပစ္စည်း: ${prodLabel}</span>`;
        return `<li><strong>${escapeHtml(name)}</strong> ${prodHtml}<span class="hint">${escapeHtml(when)}</span></li>`;
      })
      .join('');
    return `<div class="buyer-spin-wins"><div class="buyer-spin-wins-title">စပင်ရရှိမှုများ</div><ul>${items}</ul></div>`;
  }

  function renderSpinUnlockWins(plays) {
    const box = $('#spinWinsBox');
    const list = $('#spinWinsList');
    if (!box || !list) return;
    const rows = Array.isArray(plays) ? plays : [];
    if (!rows.length) {
      list.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    list.innerHTML = rows
      .map((p) => {
        const name = p.name || p.prize_name || '';
        const when = formatOrderDate(p.created_at);
        const pid = p.product_id != null && p.product_id !== '' ? Number(p.product_id) : NaN;
        const hasPid = Number.isFinite(pid);
        const prodLabel = p.product_name
          ? escapeHtml(p.product_name)
          : hasPid
            ? 'ပစ္စည်း #' + pid
            : '—';
        const prodHtml = hasPid
          ? `<button type="button" class="linkish" data-goto-product="${pid}">ရရှိသောပစ္စည်း: ${prodLabel}</button>`
          : `<span class="hint">ရရှိသောပစ္စည်း: ${prodLabel}</span>`;
        return `<li><strong>${escapeHtml(name)}</strong> ${prodHtml}<span class="hint">${escapeHtml(when)}</span></li>`;
      })
      .join('');
    box.classList.remove('hidden');
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
            ${buyerSpinWinsHtml(data.spin_plays, { linkProducts: true })}
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

  function renderCategoryChips() {
    const nav = $('#categoryChips');
    if (!nav) return;
    const allActive = productCategory === 'all';
    let html =
      `<button type="button" class="chip${allActive ? ' active' : ''}" data-category="all"${allActive ? ' aria-current="true"' : ''}>အားလုံး</button>`;
    for (const c of storeCategories) {
      const slug = String(c.slug || '');
      if (!slug) continue;
      const on = productCategory === slug;
      const label = escapeHtml(c.name || slug);
      html +=
        `<button type="button" class="chip${on ? ' active' : ''}" data-category="${escapeHtml(slug)}"${on ? ' aria-current="true"' : ''}>${label}</button>`;
    }
    nav.innerHTML = html;
    syncCategoryChips();
  }

  async function fetchCategories() {
    try {
      const res = await fetch('/api/categories');
      const list = await res.json();
      storeCategories = Array.isArray(list) ? list : [];
    } catch (_) {
      storeCategories = [];
    }
    if (
      productCategory !== 'all' &&
      storeCategories.length &&
      !storeCategories.some((c) => c.slug === productCategory)
    ) {
      productCategory = 'blind_box';
    }
    renderCategoryChips();
  }

  async function fetchBannerSlides() {
    try {
      const res = await fetch('/api/banner-slides');
      const list = await res.json();
      customBannerSlides = Array.isArray(list) ? list.filter((b) => Number(b.active) === 1) : [];
    } catch (_) {
      customBannerSlides = [];
    }
  }

  async function fetchProducts() {
    const res = await fetch('/api/products');
    const list = await res.json();
    products = Array.isArray(list)
      ? list.filter((p) => !Number(p && p.is_spin_credit))
      : [];
    syncCartPricesFromProducts();
    await fetchBannerSlides();
    renderPromoCarousel();
    renderProducts();
  }

  function syncCartPricesFromProducts() {
    if (!cart.length || !products.length) return;
    let changed = false;
    for (const item of cart) {
      const p = products.find((x) => x.id === item.product_id);
      if (!p) continue;
      const { sale, pct, original } = salePriceParts(p);
      if (
        Number(item.price_mmk) !== sale ||
        Number(item.discount_percent) !== pct ||
        Number(item.list_price_mmk) !== original
      ) {
        item.price_mmk = sale;
        item.discount_percent = pct;
        item.list_price_mmk = original;
        changed = true;
      }
    }
    if (changed) saveCart();
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

  function authenticityBadgeHtml(p) {
    // Authenticity chips are Blind box only
    if (!p || String(p.category || '') !== 'blind_box') return '';
    const raw = String(p.authenticity != null ? p.authenticity : 'authentic').trim();
    const a = raw.toLowerCase();
    if (a === 'copy' || a === 'replica' || a === 'fake') {
      return '<span class="auth-badge copy">Copy</span>';
    }
    if (!raw || a === 'authentic' || a === 'original' || a === 'auth') {
      return '<span class="auth-badge authentic">Authentic</span>';
    }
    return `<span class="auth-badge custom">${escapeHtml(raw)}</span>`;
  }


  function salePriceParts(p) {
    const pct = Number(p.discount_percent) || 0;
    const original = Number(p.price_mmk) || 0;
    if (pct <= 0 || pct >= 100) {
      return { pct: 0, sale: original, original };
    }
    // ရောင်းဈေး (price_mmk) ထဲကနေ % လျှော့ → လက်ခံ/ပေးရမည့်ဈေး
    const sale = Math.max(0, Math.round(original * (1 - pct / 100)));
    return { pct, sale, original };
  }

  function productPriceHtml(p, asSpan) {
    const { pct, sale, original } = salePriceParts(p);
    const Tag = asSpan ? 'span' : 'div';
    if (pct <= 0) {
      return `<${Tag} class="price">${formatMMK(sale)}</${Tag}>`;
    }
    return `<${Tag} class="price price-sale-wrap"><span class="price-original">${formatMMK(original)}</span><span class="price-sale">${formatMMK(sale)}</span></${Tag}>`;
  }

  function discountBadgeHtml(pct) {
    const n = Number(pct) || 0;
    if (n <= 0) return '';
    return `<span class="discount-badge">${n}% OFF</span>`;
  }

  function gamePromoSlideHtml(active) {
    return `
      <button type="button" class="promo-slide promo-slide-game${active ? ' active' : ''}" data-promo-category="spin_game" aria-label="Game — စပင်ဘီး ကံစမ်းမည်">
        <div class="promo-media">
          <img src="/assets/samples/spin-wheel-banner.svg" alt="Game spin wheel" loading="lazy" />
        </div>
        <div class="promo-meta">
          <strong>Game — စပင်ဘီး ကံစမ်းမည်</strong>
          <span class="price">Play now</span>
        </div>
      </button>`;
  }

  function customBannerSlideHtml(b, active) {
    const src = imgUrl(b.image_url || b.image_path);
    return `
      <button type="button" class="promo-slide promo-slide-custom${active ? ' active' : ''}" data-promo-banner="${b.id}" aria-label="Announcement banner">
        <div class="promo-media">
          <img src="${src}" alt="Announcement" loading="lazy" />
        </div>
      </button>`;
  }

  function renderPromoCarousel() {
    const wrap = $('#promoCarousel');
    const track = $('#promoTrack');
    const dots = $('#promoDots');
    if (!wrap || !track || !dots) return;

    stopPromoTimer();
    const productSlides = products.filter((p) => Number(p.on_banner) === 1);
    const customSlides = Array.isArray(customBannerSlides) ? customBannerSlides : [];
    // Game + custom announcement banners + product on_banner slides
    const totalSlides = 1 + customSlides.length + productSlides.length;

    wrap.hidden = false;
    wrap.classList.add('ready');
    promoIndex = 0;

    const customHtml = customSlides.map((b) => customBannerSlideHtml(b, false)).join('');

    const productHtml = productSlides
      .map(
        (p) => `
      <button type="button" class="promo-slide" data-promo-product="${p.id}" aria-label="${escapeHtml(p.name)}">
        <div class="promo-media">
          <img src="${imgUrl(p.image_path)}" alt="${escapeHtml(p.name)}" loading="lazy" />
          ${authenticityBadgeHtml(p)}
          ${discountBadgeHtml(p.discount_percent)}
        </div>
        <div class="promo-meta">
          <strong>${escapeHtml(p.name)}</strong>
          ${productPriceHtml(p, true)}
        </div>
      </button>`
      )
      .join('');

    track.innerHTML = gamePromoSlideHtml(true) + customHtml + productHtml;

    dots.innerHTML = Array.from({ length: totalSlides }, (_, i) =>
      `<button type="button" class="promo-dot${i === 0 ? ' active' : ''}" data-promo-dot="${i}" aria-label="slide ${i + 1}"></button>`
    ).join('');

    showPromoSlide(0);
    if (totalSlides > 1) startPromoTimer();
  }

  function bannerSlides() {
    return products.filter((p) => Number(p.on_banner) === 1);
  }

  function openGameCategoryFromPromo() {
    productCategory = 'spin_game';
    syncCategoryChips();
    renderProducts();
    const section = $('#spinSection');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
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


  function openProductDetail(productId) {
    const p = products.find((x) => Number(x.id) === Number(productId));
    const body = $('#productDetailBody');
    const title = $('#productDetailTitle');
    if (!p || !body) return;
    const stock = productStock(p);
    const out = stock <= 0;
    if (title) title.textContent = p.name || 'ပစ္စည်း အသေးစိတ်';
    body.innerHTML = `
      <div class="product-detail-media">
        <img src="${imgUrl(p.image_path)}" alt="${escapeHtml(p.name)}" />
        ${authenticityBadgeHtml(p)}
        ${discountBadgeHtml(p.discount_percent)}
        ${out ? '<span class="stock-badge">စတော့ကုန် / Out of stock</span>' : ''}
      </div>
      <div class="product-detail-info">
        <h3>${escapeHtml(p.name)}</h3>
        <div class="product-detail-meta">
          ${authenticityBadgeHtml(p)}
          ${discountBadgeHtml(p.discount_percent)}
          ${out ? '<span class="badge spin-expired">စတော့ကုန်</span>' : '<span class="hint">ကျန် ' + stock + '</span>'}
        </div>
        ${productPriceHtml(p, false)}
        <div class="product-detail-desc">${escapeHtml(p.description || 'အချက်အလက် မရှိပါ')}</div>
        <div class="product-detail-actions">
          <button type="button" class="btn btn-primary" data-detail-add="${p.id}" ${
            out ? 'disabled aria-disabled="true"' : ''
          }>${out ? 'စတော့ကုန်' : 'ခြင်းတောင်းထည့်မည်'}</button>
          <button type="button" class="btn btn-outline" data-close="productDetailOverlay">ပိတ်မည်</button>
        </div>
      </div>`;
    openOverlay('productDetailOverlay');
  }

  function scrollToProduct(productId) {
    const p = products.find((x) => Number(x.id) === Number(productId));
    if (p) {
      const cat = String(p.category || 'other');
      if (productCategory !== 'all' && productCategory !== cat) {
        productCategory = cat;
        syncCategoryChips();
      }
      if (productQuery) {
        productQuery = '';
        const searchEl = $('#productSearch');
        if (searchEl) searchEl.value = '';
      }
      renderProducts();
    }
    const card = document.getElementById('product-' + productId);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlight');
    setTimeout(() => card.classList.remove('highlight'), 1600);
    openProductDetail(productId);
  }

  function productStock(p) {
    const n = Number(p && p.stock);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeSearch(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function productMatchesQuery(p, q) {
    if (!q) return true;
    const name = String(p && p.name ? p.name : '').toLowerCase();
    const desc = String(p && p.description ? p.description : '').toLowerCase();
    return name.includes(q) || desc.includes(q);
  }

  function productMatchesCategory(p, cat) {
    if (!cat || cat === 'all') return true;
    return String(p && p.category ? p.category : 'other') === cat;
  }

  function visibleProducts() {
    const q = normalizeSearch(productQuery);
    return products.filter((p) => {
      if (!productMatchesCategory(p, productCategory)) return false;
      if (q && !productMatchesQuery(p, q)) return false;
      return true;
    });
  }

  function syncCategoryChips() {
    $$('#categoryChips [data-category]').forEach((btn) => {
      const on = btn.dataset.category === productCategory;
      btn.classList.toggle('active', on);
      if (on) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  function renderProducts() {
    const grid = $('#productsGrid');
    if (!grid) return;
    syncCategoryChips();
    renderSpinSection();
    const searchBox = $('#productSearchBox');
    if (searchBox) searchBox.hidden = productCategory === 'spin_game';
    // Spin wheel category: spin UI is the page content; keep product grid empty
    if (productCategory === 'spin_game') {
      grid.innerHTML = '';
      return;
    }
    if (!products.length) {
      grid.innerHTML = '<div class="empty">ပစ္စည်း မရှိသေးပါ</div>';
      return;
    }
    const q = normalizeSearch(productQuery);
    const shown = visibleProducts();
    if (!shown.length) {
      grid.innerHTML = q
        ? '<div class="empty">ပစ္စည်း မတွေ့ပါ</div>'
        : '<div class="empty">ဤအမျိုးအစားတွင် ပစ္စည်း မရှိသေးပါ</div>';
      return;
    }
    grid.innerHTML = shown
      .map((p) => {
        const stock = productStock(p);
        const out = stock <= 0;
        return `
      <article class="product-card${out ? ' out-of-stock' : ''}" id="product-${p.id}" data-id="${p.id}">
        <div class="thumb-wrap">
          <img class="thumb" src="${imgUrl(p.image_path)}" alt="${escapeHtml(p.name)}" loading="lazy" />
          ${authenticityBadgeHtml(p)}
          ${discountBadgeHtml(p.discount_percent)}
          ${out ? '<span class="stock-badge">စတော့ကုန် / Out of stock</span>' : ''}
        </div>
        <div class="body">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="desc">${escapeHtml(p.description || '')}</div>
          ${productPriceHtml(p, false)}
          <div class="actions">
            <button type="button" class="btn btn-primary" data-add="${p.id}" ${
              out ? 'disabled aria-disabled="true"' : ''
            }>${out ? 'စတော့ကုန်' : 'ခြင်းတောင်းထည့်မည်'}</button>
          </div>
        </div>
      </article>`;
      })
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
    const stock = productStock(p);
    if (stock <= 0) {
      toast('စတော့ကုန် / Out of stock');
      return;
    }
    const existing = cart.find((x) => x.product_id === productId);
    const nextQty = (existing ? existing.quantity : 0) + 1;
    if (nextQty > stock) {
      toast('စတော့ မလောက်ပါ (ကျန် ' + stock + ')');
      return;
    }
    const { sale, pct } = salePriceParts(p);
    if (existing) {
      existing.quantity = nextQty;
      existing.price_mmk = sale;
      existing.list_price_mmk = Number(p.price_mmk) || sale;
      existing.discount_percent = pct;
    } else {
      cart.push({
        product_id: p.id,
        name: p.name,
        price_mmk: sale,
        list_price_mmk: Number(p.price_mmk) || sale,
        discount_percent: pct,
        image_path: p.image_path,
        is_spin_credit: productIsSpinCredit(p) ? 1 : 0,
        quantity: 1,
      });
    }
    saveCart();
    toast('ခြင်းတောင်းထဲ ထည့်ပြီးပါပြီ');
  }

  function setQty(productId, qty) {
    const item = cart.find((x) => x.product_id === productId);
    if (!item) return;
    const p = products.find((x) => x.id === productId);
    const stock = p ? productStock(p) : Infinity;
    let next = Math.max(1, qty);
    if (Number.isFinite(stock) && next > stock) {
      next = Math.max(1, stock);
      toast('စတော့ မလောက်ပါ (ကျန် ' + stock + ')');
    }
    item.quantity = next;
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

  function productIsSpinCredit(p) {
    return !!(p && Number(p.is_spin_credit) === 1);
  }

  function cartItemIsSpinCredit(item) {
    if (!item) return false;
    if (item.is_spin_credit != null) return Number(item.is_spin_credit) === 1;
    const p = products.find((x) => x.id === item.product_id);
    return productIsSpinCredit(p);
  }

  function cartIsSpinOnly() {
    return cart.length > 0 && cart.every(cartItemIsSpinCredit);
  }

  function syncCheckoutAddressFields() {
    const spinOnly = cartIsSpinOnly();
    const group = $('#addressGroup');
    const addr = $('#address');
    const mark = $('#addressRequiredMark');
    const hint = $('#spinCheckoutHint');
    if (addr) {
      addr.required = true;
      addr.setAttribute('required', 'required');
    }
    if (mark) mark.classList.remove('hidden');
    // Spin-credit carts: show shipping hint; address still required for prize delivery
    if (hint) hint.classList.toggle('hidden', !spinOnly);
    if (group) group.classList.remove('spin-optional');
  }


  function cartUnitPriceHtml(i) {
    const pct = Number(i.discount_percent) || 0;
    const sale = Number(i.price_mmk) || 0;
    const list = Number(i.list_price_mmk) || sale;
    if (pct <= 0 || list <= sale) return formatMMK(sale);
    return (
      '<span class="price-original">' +
      formatMMK(list) +
      '</span> <span class="price-sale">' +
      formatMMK(sale) +
      '</span>'
    );
  }

  function cartLineTotalHtml(i) {
    const pct = Number(i.discount_percent) || 0;
    const sale = Number(i.price_mmk) || 0;
    const list = Number(i.list_price_mmk) || sale;
    const qty = Number(i.quantity) || 0;
    if (pct <= 0 || list <= sale) return formatMMK(sale * qty);
    return (
      '<span class="price-original">' +
      formatMMK(list * qty) +
      '</span> <span class="price-sale">' +
      formatMMK(sale * qty) +
      '</span>'
    );
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
            <div class="hint">${cartUnitPriceHtml(i)}</div>
            <div class="qty-row">
              <button type="button" data-dec="${i.product_id}">−</button>
              <span>${i.quantity}</span>
              <button type="button" data-inc="${i.product_id}">+</button>
            </div>
          </div>
          <div>
            <div>${cartLineTotalHtml(i)}</div>
            <button type="button" class="btn btn-sm btn-outline" data-remove="${i.product_id}" style="margin-top:0.4rem">ဖယ်မည်</button>
          </div>
        </div>`
        )
        .join('');
    }
    $('#cartTotal').textContent = formatMMK(cartTotal());
    $('#checkoutTotal').textContent = formatMMK(cartTotal());
  }

  function paymentInstructionsHtml() {
    if (!payment) return '<div>ငွေလွှဲညွှန်ကြားချက် ဖတ်နေသည်…</div>';
    const mmqr = payment.mmqr_url
      ? `<div class="mmqr-box">
          <div><strong>MMQR ဖြင့် ငွေလွှဲရန်</strong></div>
          <img class="mmqr-img" src="${escapeHtml(payment.mmqr_url)}" alt="MMQR" />
        </div>`
      : '';
    return `
      <div><strong>ဘဏ်လွှဲငွေ ညွှန်ကြားချက်</strong></div>
      <div>ဘဏ်အမည် — ${escapeHtml(payment.bank_name || '-')}</div>
      <div>အကောင့်နံပါတ် — <strong>${escapeHtml(payment.account_number || '-')}</strong></div>
      <div>အကောင့်အမည် — ${escapeHtml(payment.account_name || '-')}</div>
      <div class="hint" style="margin-top:0.4rem">${escapeHtml(payment.payment_note || '')}</div>
      ${mmqr}
    `;
  }

  function renderPayment() {
    const html = paymentInstructionsHtml();
    const a = $('#payInstructions');
    if (a) a.innerHTML = html;
    const b = $('#spinPayInstructions');
    if (b) b.innerHTML = html;
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
    const catBtn = e.target.closest('#categoryChips [data-category]');
    if (catBtn) {
      productCategory = catBtn.dataset.category || 'all';
      syncCategoryChips();
      renderProducts();
      return;
    }
    const promoBanner = e.target.closest('[data-promo-banner]');
    if (promoBanner) {
      // Image-only announcement slide — click is a no-op
      return;
    }
    const promoGame = e.target.closest('[data-promo-category]');
    if (promoGame) {
      openGameCategoryFromPromo();
      return;
    }
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
    const detailAdd = e.target.closest('[data-detail-add]');
    if (detailAdd) {
      if (detailAdd.disabled) return;
      addToCart(Number(detailAdd.dataset.detailAdd));
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      addToCart(Number(add.dataset.add));
      return;
    }
    const card = e.target.closest('.product-card[data-id]');
    if (card && !e.target.closest('[data-add]')) {
      openProductDetail(Number(card.dataset.id));
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
    const goto = e.target.closest('[data-goto-product]');
    if (goto) {
      const pid = Number(goto.dataset.gotoProduct);
      closeOverlay('cartOverlay');
      scrollToProduct(pid);
      return;
    }
    if (e.target === $('#cartOverlay')) {
      closeOverlay('cartOverlay');
      stopMyOrdersPolling();
    }
    if (e.target === $('#checkoutOverlay')) closeOverlay('checkoutOverlay');
    if (e.target === $('#productDetailOverlay')) closeOverlay('productDetailOverlay');
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
    syncCheckoutAddressFields();
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

  function getSpinBuyUnitPrice() {
    return spinBuyProduct ? Number(spinBuyProduct.price_mmk) || 0 : 0;
  }

  function updateSpinPurchaseTotal() {
    const qtyEl = $('#spinBuyQty');
    let qty = qtyEl ? parseInt(qtyEl.value, 10) : 1;
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    qty = Math.min(99, qty);
    const totalEl = $('#spinPurchaseTotal');
    if (totalEl) totalEl.textContent = formatMMK(getSpinBuyUnitPrice() * qty);
  }

  function syncSpinBuyRow() {
    const row = $('#spinBuyRow');
    const hint = $('#spinBuyPriceHint');
    if (!row) return;
    if (!spinBuyProduct) {
      row.hidden = true;
      return;
    }
    row.hidden = false;
    if (hint) {
      hint.textContent =
        (spinBuyProduct.name || 'ကံစမ်းခွင့်') +
        ' — ' +
        formatMMK(spinBuyProduct.price_mmk) +
        ' / ကြိမ်';
    }
  }

  async function fetchSpinBuyProduct() {
    try {
      const res = await fetch('/api/spin/product');
      if (!res.ok) {
        spinBuyProduct = null;
      } else {
        spinBuyProduct = await res.json();
      }
    } catch (_) {
      spinBuyProduct = null;
    }
    renderSpinSection();
  }

  function renderSpinSection() {
    const section = $('#spinSection');
    if (!section) return;
    // Spin UI lives under Spin wheel category only — never on home / other chips
    const onSpinCat = productCategory === 'spin_game';
    const hasContent = !!(spinPrizes.length || spinBuyProduct);
    if (!onSpinCat || !hasContent) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    syncSpinBuyRow();
    if (spinPrizes.length) drawSpinWheel(spinRotation);
    updateSpinButton();
  }

  function applySpinStateFromApi(data) {
    if (!data || typeof data !== 'object') return;
    if (data.credits != null) spinCredits = Number(data.credits) || 0;
    else if (typeof data.spinCredits === 'number') spinCredits = data.spinCredits;
    if (typeof data.expired === 'boolean') spinExpired = data.expired;
    if (typeof data.locked === 'boolean') spinLocked = data.locked;
    if (typeof data.spinCompleted === 'boolean') spinCompleted = data.spinCompleted;
    else if (data.spin_completed != null) spinCompleted = Number(data.spin_completed) === 1;
  }

  function updateSpinButton() {
    const btn = $('#spinBtn');
    const hint = $('#spinHint');
    if (!btn) return;
    const n = Math.max(0, Number(spinCredits) || 0);
    const expired = !!spinExpired && !!spinUnlockedOrderId;
    const completed = !!spinCompleted && !!spinUnlockedOrderId;
    if (completed) btn.textContent = 'ပြီးဆုံး';
    else if (expired) btn.textContent = 'သက်တမ်းကုန်ဆုံး';
    else btn.textContent = 'ကံစမ်းမည် (' + n + ')';
    const canSpin = n >= 1 && !spinBusy && !!spinUnlockedOrderId && !expired && !completed;
    btn.disabled = !canSpin;
    btn.classList.toggle('ready', canSpin);
    btn.classList.toggle('dimmed', !canSpin);
    btn.classList.toggle('spin-expired', expired && !completed);
    btn.classList.toggle('spin-completed', completed);
    if (hint) {
      if (spinBusy) hint.textContent = 'လှည့်နေသည်…';
      else if (!spinUnlockedOrderId) {
        hint.textContent = 'အော်ဒါနံပါတ် ထည့်ပြီး ကံစမ်းခွင့် စစ်ပါ';
      } else if (completed) {
        hint.textContent = 'ပြီးဆုံး — ဆုရရှိမှု ကိုင်တွယ်ပြီးပါပြီ';
      } else if (expired) {
        hint.textContent = 'သက်တမ်းကုန်ဆုံး — ကံစမ်းခွင့် အားလုံး အသုံးပြုပြီးပါပြီ';
      } else if (n < 1) {
        hint.textContent = 'ကံစမ်းခွင့် မရှိသေးပါ — Admin က သတ်မှတ်ပေးမှ လှည့်နိုင်သည်';
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
      applySpinStateFromApi(data);
      saveSpinSession();
      if (msg) {
        if (spinCompleted) {
          msg.textContent = 'ပြီးဆုံး — ဆုရရှိမှု ကိုင်တွယ်ပြီးပါပြီ';
          msg.classList.add('ok');
        } else if (spinExpired) {
          msg.textContent = 'သက်တမ်းကုန်ဆုံး — ကံစမ်းခွင့် အားလုံး အသုံးပြုပြီးပါပြီ';
          msg.classList.remove('ok');
        } else if (spinCredits >= 1) {
          msg.textContent =
            'ကံစမ်းခွင့် ' + spinCredits + ' ကြိမ် ရှိသည် — ခလုတ် လင်းနေသည်';
          msg.classList.add('ok');
        } else {
          msg.textContent =
            'အော်ဒါတွေ့ပါပြီ — ကံစမ်းခွင့် မရှိသေးပါ (Admin က သတ်မှတ်ပေးမှ လှည့်နိုင်သည်)';
          msg.classList.remove('ok');
        }
      }
      renderSpinUnlockWins(data.spin_plays);
      updateSpinButton();
    } catch (err) {
      spinCredits = 0;
      spinExpired = false;
      spinLocked = false;
      spinCompleted = false;
      spinUnlockedOrderId = '';
      saveSpinSession();
      renderSpinUnlockWins([]);
      if (msg) {
        msg.textContent = err.message || 'မရရှိနိုင်ပါ';
        msg.classList.remove('ok');
      }
      updateSpinButton();
    }
  }

  async function doSpin() {
    if (spinBusy || !spinPrizes.length) return;
    if (!spinUnlockedOrderId || spinCredits < 1 || spinExpired) {
      updateSpinButton();
      toast(spinExpired ? 'သက်တမ်းကုန်ဆုံး' : 'ကံစမ်းခွင့် မရှိပါ');
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
        applySpinStateFromApi(data);
        if (data.code === 'missing_contact') {
          throw new Error(
            data.error ||
              'အော်ဒါ ဆက်သွယ်ရန် အချက်အလက် (အမည် / ဖုန်း / လိပ်စာ) မပြည့်စုံပါ — ငွေချေသည့်အခါ ဖြည့်ထားသော အချက်အလက် လိုအပ်သည်'
          );
        }
        throw new Error(data.error || 'လှည့်မရပါ');
      }
      applySpinStateFromApi(data);

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
      renderSpinUnlockWins(data.spin_plays);
      const msg = $('#spinUnlockMsg');
      if (msg) {
        if (spinExpired) {
          msg.textContent = 'သက်တမ်းကုန်ဆုံး — ကံစမ်းခွင့် အားလုံး အသုံးပြုပြီးပါပြီ';
          msg.classList.remove('ok');
        } else {
          msg.textContent = 'ကျန်ရှိသော အခွင့်: ' + spinCredits;
          msg.classList.toggle('ok', spinCredits >= 1);
        }
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

  const searchEl = $('#productSearch');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      productQuery = searchEl.value || '';
      renderProducts();
    });
  }

  function openSpinPurchase() {
    if (!spinBuyProduct) {
      toast('ကံစမ်းခွင့် ပစ္စည်း မရရှိနိုင်ပါ');
      return;
    }
    const formView = $('#spinPurchaseFormView');
    const success = $('#spinPurchaseSuccess');
    if (formView) formView.classList.remove('hidden');
    if (success) success.classList.add('hidden');
    const form = $('#spinPurchaseForm');
    if (form) form.reset();
    const qty = $('#spinBuyQty');
    if (qty) qty.value = '1';
    const hint = $('#spinPurchaseProductHint');
    if (hint) {
      hint.textContent =
        (spinBuyProduct.name || '') + ' — ' + formatMMK(spinBuyProduct.price_mmk) + ' / ကြိမ်';
    }
    renderPayment();
    updateSpinPurchaseTotal();
    openOverlay('spinPurchaseOverlay');
  }

  const spinBuyBtn = $('#spinBuyBtn');
  if (spinBuyBtn) spinBuyBtn.addEventListener('click', openSpinPurchase);

  const spinBuyQty = $('#spinBuyQty');
  if (spinBuyQty) {
    spinBuyQty.addEventListener('input', updateSpinPurchaseTotal);
    spinBuyQty.addEventListener('change', updateSpinPurchaseTotal);
  }

  const spinPurchaseForm = $('#spinPurchaseForm');
  if (spinPurchaseForm) {
    spinPurchaseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#spinPurchaseSubmitBtn');
      const nameVal = ($('#spinBuyName') && $('#spinBuyName').value.trim()) || '';
      const phoneVal = ($('#spinBuyPhone') && $('#spinBuyPhone').value.trim()) || '';
      const addressVal = ($('#spinBuyAddress') && $('#spinBuyAddress').value.trim()) || '';
      let qty = $('#spinBuyQty') ? parseInt($('#spinBuyQty').value, 10) : 1;
      if (!Number.isFinite(qty) || qty < 1) qty = 1;
      qty = Math.min(99, qty);
      const slipInput = $('#spinBuySlip');
      const slip = slipInput && slipInput.files && slipInput.files[0];
      if (!nameVal || !phoneVal || !addressVal) {
        toast('အမည်၊ ဖုန်းနှင့် လိပ်စာ လိုအပ်သည်');
        return;
      }
      if (!slip) {
        toast('ငွေလွှဲစလစ် ပုံတင်ပါ');
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'တင်နေသည်…';
      }
      const fd = new FormData();
      fd.append('name', nameVal);
      fd.append('phone', phoneVal);
      fd.append('address', addressVal);
      fd.append('qty', String(qty));
      fd.append('slip', slip);
      try {
        const res = await fetch('/api/spin/purchase', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'မအောင်မြင်ပါ');
        const orderId = data.orderId || data.order_id;
        rememberOrder(orderId, phoneVal);
        const oidEl = $('#spinPurchaseOrderId');
        if (oidEl) oidEl.textContent = orderId;
        const trackLink = $('#spinPurchaseTrackLink');
        if (trackLink) {
          trackLink.href =
            '/track?id=' +
            encodeURIComponent(orderId) +
            '&phone=' +
            encodeURIComponent(phoneVal);
        }
        const formView = $('#spinPurchaseFormView');
        const success = $('#spinPurchaseSuccess');
        if (formView) formView.classList.add('hidden');
        if (success) success.classList.remove('hidden');
        const unlockOid = $('#spinOrderId');
        if (unlockOid) unlockOid.value = orderId;
        fetchSpinBuyProduct();
      } catch (err) {
        toast(err.message || 'အမှားဖြစ်နေသည်');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'ဝယ်ယူမည် အတည်ပြု';
        }
      }
    });
  }

  const spinPurchaseDoneBtn = $('#spinPurchaseDoneBtn');
  if (spinPurchaseDoneBtn) {
    spinPurchaseDoneBtn.addEventListener('click', () => closeOverlay('spinPurchaseOverlay'));
  }

  const spinPurchaseUseOrderBtn = $('#spinPurchaseUseOrderBtn');
  if (spinPurchaseUseOrderBtn) {
    spinPurchaseUseOrderBtn.addEventListener('click', async () => {
      const oid = ($('#spinPurchaseOrderId') && $('#spinPurchaseOrderId').textContent.trim()) || '';
      closeOverlay('spinPurchaseOverlay');
      const unlockOid = $('#spinOrderId');
      if (unlockOid && oid) unlockOid.value = oid;
      productCategory = 'spin_game';
      renderProducts();
      const section = $('#spinSection');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (oid) await unlockSpin(false);
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target === $('#spinPurchaseOverlay')) closeOverlay('spinPurchaseOverlay');
  });

  updateCartCount();
  fetchCategories().then(() => fetchProducts());
  fetchPayment();
  fetchSpinPrizes();
  fetchSpinBuyProduct();
})();
