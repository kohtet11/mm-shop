(() => {
  const LS_NAME = 'mm_shop_chat_name';
  const LS_PHONE = 'mm_shop_chat_phone';
  const LS_ORDER = 'mm_shop_chat_order_id';
  const LS_THREAD = 'mm_shop_chat_thread_id';
  const LS_SEEN = 'mm_shop_chat_seen_id';
  const POLL_MS = 3500;

  const $ = (sel, el = document) => el.querySelector(sel);

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatChatTime(isoOrSql) {
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

  function loadIdentity() {
    return {
      name: localStorage.getItem(LS_NAME) || '',
      phone: localStorage.getItem(LS_PHONE) || '',
      orderId: localStorage.getItem(LS_ORDER) || '',
      threadId: localStorage.getItem(LS_THREAD) || '',
      seenId: Number(localStorage.getItem(LS_SEEN) || 0) || 0,
    };
  }

  function saveIdentity(partial) {
    if (partial.name !== undefined) localStorage.setItem(LS_NAME, partial.name);
    if (partial.phone !== undefined) localStorage.setItem(LS_PHONE, partial.phone);
    if (partial.orderId !== undefined) {
      if (partial.orderId) localStorage.setItem(LS_ORDER, partial.orderId);
      else localStorage.removeItem(LS_ORDER);
    }
    if (partial.threadId !== undefined) localStorage.setItem(LS_THREAD, String(partial.threadId));
    if (partial.seenId !== undefined) localStorage.setItem(LS_SEEN, String(partial.seenId));
  }

  function injectWidget() {
    if (document.getElementById('csChatRoot')) return;
    const root = document.createElement('div');
    root.id = 'csChatRoot';
    root.innerHTML = `
      <button type="button" class="cs-fab" id="csFab" aria-label="ကူညီရန်" aria-expanded="false">
        <span class="cs-fab-icon" aria-hidden="true">💬</span>
        <span class="cs-fab-badge hidden" id="csFabBadge"></span>
      </button>
      <section class="cs-panel" id="csPanel" hidden>
        <header class="cs-header">
          <div>
            <h2>ကူညီရန်</h2>
            <p class="cs-sub" id="csSub">Glow Gear — ဖောက်သည်ဝန်ဆောင်မှု</p>
          </div>
          <button type="button" class="cs-close" id="csClose" aria-label="ပိတ်ရန်">×</button>
        </header>
        <form class="cs-ident" id="csIdentForm">
          <p class="cs-hint">အမည်နှင့် ဖုန်းနံပါတ် ဖြည့်ပြီး စကားပြောနိုင်သည်</p>
          <label for="csName">အမည် *</label>
          <input id="csName" name="name" required autocomplete="name" maxlength="80" />
          <label for="csPhone">ဖုန်းနံပါတ် *</label>
          <input id="csPhone" name="phone" required autocomplete="tel" placeholder="09xxxxxxxxx" />
          <label for="csOrder">အော်ဒါနံပါတ် (ရွေးချယ်နိုင်)</label>
          <input id="csOrder" name="orderId" autocomplete="off" placeholder="MMxxxxxxxx" />
          <button type="submit" class="cs-btn" id="csIdentBtn">စကားပြောရန်</button>
          <p class="cs-error" id="csIdentError" hidden></p>
        </form>
        <div class="cs-thread hidden" id="csThread">
          <div class="cs-meta" id="csMeta"></div>
          <div class="cs-msgs" id="csMsgs" aria-live="polite"></div>
          <form class="cs-compose" id="csCompose">
            <label class="cs-order-inline" for="csOrderLive">
              အော်ဒါ
              <input id="csOrderLive" autocomplete="off" placeholder="ရွေးချယ်နိုင်" />
            </label>
            <div class="cs-compose-row">
              <textarea id="csBody" rows="2" required maxlength="2000" placeholder="မက်ဆေ့ချ် ရိုက်ပါ…"></textarea>
              <button type="submit" class="cs-btn" id="csSendBtn">မက်ဆေ့ချ် ပို့မည်</button>
            </div>
            <p class="cs-error" id="csSendError" hidden></p>
          </form>
        </div>
      </section>
    `;
    document.body.appendChild(root);
  }

  injectWidget();

  const fab = $('#csFab');
  const panel = $('#csPanel');
  const identForm = $('#csIdentForm');
  const threadEl = $('#csThread');
  const msgsEl = $('#csMsgs');
  const fabBadge = $('#csFabBadge');

  let open = false;
  let pollTimer = null;
  let sending = false;
  let lastRendered = '';
  let identity = loadIdentity();

  function setOpen(next) {
    open = next;
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    fab.classList.toggle('is-open', open);
    if (open) {
      fabBadge.classList.add('hidden');
      showView();
      startPoll();
    } else {
      stopPoll();
    }
  }

  function showView() {
    if (identity.name && identity.phone) {
      identForm.classList.add('hidden');
      threadEl.classList.remove('hidden');
      $('#csName').value = identity.name;
      $('#csPhone').value = identity.phone;
      $('#csOrder').value = identity.orderId || '';
      $('#csOrderLive').value = identity.orderId || '';
      $('#csMeta').innerHTML =
        '<strong>' +
        escapeHtml(identity.name) +
        '</strong> · ' +
        escapeHtml(identity.phone) +
        (identity.orderId
          ? ' · <span class="cs-oid">' + escapeHtml(identity.orderId) + '</span>'
          : '');
      ensureThread().then(() => pollMessages());
    } else {
      identForm.classList.remove('hidden');
      threadEl.classList.add('hidden');
      $('#csName').value = identity.name || '';
      $('#csPhone').value = identity.phone || '';
      $('#csOrder').value = identity.orderId || '';
    }
  }

  async function ensureThread() {
    if (!identity.name || !identity.phone) return null;
    const res = await fetch('/api/chat/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: identity.name,
        customer_phone: identity.phone,
        order_id: identity.orderId || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'ချတ် စတင်မရပါ');
    identity.threadId = String(data.id);
    saveIdentity({ threadId: identity.threadId });
    return data;
  }

  function renderMessages(messages, thread) {
    const list = Array.isArray(messages) ? messages : [];
    const key = list.map((m) => m.id).join(',') + ':' + (thread && thread.status);
    if (key === lastRendered) return;
    lastRendered = key;
    if (!list.length) {
      msgsEl.innerHTML = '<div class="cs-empty">မက်ဆေ့ချ် မရှိသေးပါ — စတင်မေးမြန်းပါ</div>';
    } else {
      msgsEl.innerHTML = list
        .map((m) => {
          const mine = m.sender === 'customer';
          return (
            '<div class="cs-msg ' +
            (mine ? 'mine' : 'admin') +
            '">' +
            '<div class="cs-bubble">' +
            escapeHtml(m.body) +
            '</div>' +
            '<div class="cs-time">' +
            (mine ? 'ကျွန်ုပ်' : 'စတိုး') +
            ' · ' +
            escapeHtml(formatChatTime(m.created_at)) +
            '</div></div>'
          );
        })
        .join('');
    }
    if (thread && thread.status === 'closed') {
      msgsEl.insertAdjacentHTML(
        'beforeend',
        '<div class="cs-closed">ဤချတ် ပိတ်ထားသည် — မက်ဆေ့ချ်ပို့လျှင် ပြန်ဖွင့်မည်</div>'
      );
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
    if (list.length) {
      const maxId = Math.max(...list.map((m) => Number(m.id) || 0));
      if (open) {
        identity.seenId = maxId;
        saveIdentity({ seenId: maxId });
      }
    }
  }

  function updateBadge(messages) {
    if (open) {
      fabBadge.classList.add('hidden');
      return;
    }
    const unseen = (messages || []).filter(
      (m) => m.sender === 'admin' && Number(m.id) > (identity.seenId || 0)
    ).length;
    if (unseen) {
      fabBadge.textContent = unseen > 9 ? '9+' : String(unseen);
      fabBadge.classList.remove('hidden');
    } else {
      fabBadge.classList.add('hidden');
    }
  }

  async function pollMessages() {
    if (!identity.threadId || !identity.phone) return;
    try {
      const qs = new URLSearchParams({ phone: identity.phone });
      const res = await fetch(
        '/api/chat/threads/' + encodeURIComponent(identity.threadId) + '/messages?' + qs
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 || res.status === 404) {
          identity.threadId = '';
          saveIdentity({ threadId: '' });
          if (open) await ensureThread();
        }
        return;
      }
      if (data.thread && data.thread.order_id && !identity.orderId) {
        identity.orderId = data.thread.order_id;
        saveIdentity({ orderId: identity.orderId });
        const live = $('#csOrderLive');
        if (live && !live.value) live.value = identity.orderId;
      }
      renderMessages(data.messages, data.thread);
      updateBadge(data.messages);
    } catch (_) {
      /* keep polling */
    }
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(pollMessages, POLL_MS);
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  fab.addEventListener('click', () => setOpen(!open));
  $('#csClose').addEventListener('click', () => setOpen(false));

  identForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#csIdentError');
    err.hidden = true;
    const name = $('#csName').value.trim();
    const phone = $('#csPhone').value.trim();
    const orderId = $('#csOrder').value.trim();
    if (!name || !phone) {
      err.textContent = 'အမည်နှင့် ဖုန်းနံပါတ် လိုအပ်သည်';
      err.hidden = false;
      return;
    }
    const btn = $('#csIdentBtn');
    btn.disabled = true;
    try {
      identity = { ...identity, name, phone, orderId };
      saveIdentity({ name, phone, orderId });
      await ensureThread();
      lastRendered = '';
      showView();
    } catch (ex) {
      err.textContent = ex.message || 'ချတ် စတင်မရပါ';
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $('#csCompose').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const err = $('#csSendError');
    err.hidden = true;
    const body = $('#csBody').value.trim();
    if (!body) return;
    const orderLive = $('#csOrderLive').value.trim();
    sending = true;
    $('#csSendBtn').disabled = true;
    try {
      if (orderLive !== (identity.orderId || '')) {
        identity.orderId = orderLive;
        saveIdentity({ orderId: orderLive });
        await ensureThread();
      } else if (!identity.threadId) {
        await ensureThread();
      }
      const res = await fetch(
        '/api/chat/threads/' + encodeURIComponent(identity.threadId) + '/messages',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: identity.phone, body }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ပို့မရပါ');
      $('#csBody').value = '';
      lastRendered = '';
      await pollMessages();
    } catch (ex) {
      err.textContent = ex.message || 'ပို့မရပါ';
      err.hidden = false;
    } finally {
      sending = false;
      $('#csSendBtn').disabled = false;
    }
  });

  $('#csBody').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#csCompose').requestSubmit();
    }
  });

  if (identity.threadId && identity.phone) {
    pollMessages();
  }
})();
