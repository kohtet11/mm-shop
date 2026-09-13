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
    // Keep the fixed Glow Gear full-width banner; do not swap in admin logo_url.
    const name = (s && s.shop_name) || 'Glow Gear';
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

      const spinBox = $('#resultSpinBox');
      const spinStatus = $('#resultSpinStatus');
      if (spinBox && spinStatus) {
        const isSpin = !!(data.is_spin_order || Number(data.spin_completed) === 1 || data.spin_locked || Number(data.spin_credits) > 0 || data.spin_expired);
        if (isSpin) {
          spinBox.classList.remove('hidden');
          if (Number(data.spin_completed) === 1) {
            spinStatus.innerHTML = '<span class="badge spin-completed">ပြီးဆုံး</span>';
          } else if (data.spin_expired) {
            spinStatus.innerHTML =
              '<span class="badge spin-expired">သက်တမ်းကုန်ဆုံး</span>' +
              ' <span class="hint">ကျန်အခွင့်: ' +
              escapeHtml(Number(data.spin_credits) || 0) +
              '</span>';
          } else {
            spinStatus.innerHTML =
              '<span class="badge pending">ကံစမ်းခွင့်</span> ' +
              '<span class="hint">ကျန်: ' +
              escapeHtml(Number(data.spin_credits) || 0) +
              '</span>';
          }
        } else {
          spinBox.classList.add('hidden');
          spinStatus.textContent = '';
        }
      }

      const winsBox = $('#resultSpinWins');
      const winsList = $('#resultSpinWinsList');
      const plays = Array.isArray(data.spin_plays) ? data.spin_plays : [];
      if (winsBox && winsList) {
        if (plays.length) {
          winsList.innerHTML = plays
            .map((p) => {
              const name = p.name || p.prize_name || '';
              const prod = p.product_name
                ? escapeHtml(p.product_name)
                : p.product_id
                  ? 'ပစ္စည်း #' + escapeHtml(p.product_id)
                  : '—';
              return (
                '<li>' +
                '<strong>' +
                escapeHtml(name) +
                '</strong>' +
                '<div class="hint">ရရှိသောပစ္စည်း: ' +
                prod +
                '</div>' +
                '<div class="hint">' +
                escapeHtml(formatTime(p.created_at)) +
                '</div>' +
                '</li>'
              );
            })
            .join('');
          winsBox.classList.remove('hidden');
        } else {
          winsList.innerHTML = '';
          winsBox.classList.add('hidden');
        }
      }

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
