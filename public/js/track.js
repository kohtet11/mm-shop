(() => {
  const $ = (sel, el = document) => el.querySelector(sel);

  const STATUS_LABELS = {
    pending: 'စောင့်ဆိုင်းဆဲ',
    paid_confirmed: 'ငွေပေးချေမှု အတည်ပြုပြီး',
    shipped: 'ပို့ဆောင်ပြီး',
    cancelled: 'ပယ်ဖျက်ပြီး',
  };

  function formatMMK(n) {
    return Number(n || 0).toLocaleString('en-US') + ' ကျပ်';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '-';
    // DB stores UTC-ish sqlite datetime; show as-is with label
    const s = String(iso).replace('T', ' ').replace('Z', '');
    return s + ' (UTC)';
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
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
    document.title = 'အော်ဒါအခြေအနေ စစ်ရန် — ' + name;
  }

  async function loadBranding() {
    try {
      const res = await fetch('/api/settings/public');
      if (res.ok) applyBranding(await res.json());
    } catch (_) {}
  }
  loadBranding();

  // Prefill from query string
  const params = new URLSearchParams(location.search);
  const prefillId = params.get('id') || params.get('orderId') || '';
  if (prefillId) $('#orderId').value = prefillId;

  $('#trackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderId = $('#orderId').value.trim();
    const phone = $('#phone').value.trim();
    const btn = $('#trackBtn');
    const errEl = $('#trackError');
    const resultEl = $('#trackResult');

    errEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'စစ်ဆေးနေသည်…';

    try {
      const qs = new URLSearchParams({ id: orderId, phone });
      const res = await fetch('/api/orders/track?' + qs.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errEl.textContent = data.error || 'အော်ဒါ မတွေ့ပါ';
        errEl.classList.remove('hidden');
        return;
      }

      $('#resultOrderId').textContent = data.order_id;
      const status = data.status || 'pending';
      const badge = $('#resultStatus');
      badge.textContent = STATUS_LABELS[status] || status;
      badge.className = 'badge ' + status;

      $('#resultCreated').textContent = formatTime(data.created_at);
      $('#resultSlip').textContent = data.slip_received
        ? 'ရရှိပြီး ✓'
        : 'မရရှိသေး';
      $('#resultTotal').textContent = formatMMK(data.total_mmk);

      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        $('#resultItems').innerHTML = '<div class="empty">ပစ္စည်း မရှိပါ</div>';
      } else {
        $('#resultItems').innerHTML = items
          .map(
            (it) => `
          <div class="track-item">
            <div>
              <strong>${escapeHtml(it.product_name)}</strong>
              <div class="hint">× ${escapeHtml(it.quantity)} · ${formatMMK(it.unit_price_mmk)}</div>
            </div>
            <div>${formatMMK((it.unit_price_mmk || 0) * (it.quantity || 0))}</div>
          </div>`
          )
          .join('');
      }

      resultEl.classList.remove('hidden');
      // Keep id in URL for sharing own lookup
      const next = new URL(location.href);
      next.searchParams.set('id', data.order_id);
      history.replaceState(null, '', next.pathname + '?' + next.searchParams.toString());
    } catch (err) {
      toast(err.message || 'အမှားဖြစ်နေသည်');
      errEl.textContent = 'ချိတ်ဆက်မှု အမှားဖြစ်နေသည်';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'စစ်ဆေးမည်';
    }
  });
})();
