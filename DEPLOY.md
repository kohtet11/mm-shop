# Deploy MM Shop on Render / Render တွင် တင်ခြင်း

English first, then Myanmar. This keeps a **stable** `https://mm-shop.onrender.com` URL.

---

## English

### Same URL every time

Render assigns `https://<service-name>.onrender.com` from the Blueprint `name` (`mm-shop`).
That hostname **does not change** on redeploy, sleep/wake, or git push — only if you
**delete or rename** the service.

1. Put this folder on GitHub (private or public).
2. In [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
3. Connect the repo. Render reads `render.yaml` and creates the `mm-shop` web service.
4. First deploy: Render generates a random `ADMIN_PASSWORD` (see **Environment**).
5. Open `https://mm-shop.onrender.com` and `/admin`. **Change the admin password** after first login.

You can also create a Web Service manually: **Node**, build `npm install`, start `npm start`,
`NODE_VERSION=20`, set `ADMIN_PASSWORD` yourself. Render still injects `PORT`; the app already
listens on `process.env.PORT || 3847` and `0.0.0.0`.

### Paid Starter + persistent disk (default Blueprint)

Blueprint uses **Starter** (~$7/mo) + a **1GB disk** (~$0.25/GB-mo) so the service stays **always-on**
(no free-tier spin-down) and shop data survives restarts.

- Data lives under **`DATA_ROOT=/var/data`** → `data/shop.db` and `uploads/` on the mounted disk.
- A **payment method** is required on Render for Starter + disks.
- After you push these changes: **sync the Blueprint**, **or** manually set **Instance Type → Starter**,
  **Add Disk** mount `/var/data` size **1GB**, env **`DATA_ROOT=/var/data`**, then **redeploy**.
- Seed products still appear automatically if the DB is empty on boot.

### After first login

Change the admin password in `/admin` (or set a new `ADMIN_PASSWORD` in the Render dashboard
and restart). Do not leave the generated or default password in place.

---

## မြန်မာ

### URL မပြောင်းအောင်

Render က Blueprint ထဲက `name: mm-shop` ကိုသုံးပြီး `https://mm-shop.onrender.com` ပေးသည်။
Redeploy၊ sleep/wake၊ git push လုပ်လည်း **hostname မပြောင်းပါ**။ Service ကို ဖျက်/အမည်ပြောင်းမှသာ ပြောင်းသည်။

1. ဤဖိုလ်ဒါကို GitHub သို့ တင်ပါ (private သို့မဟုတ် public)။
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**။
3. Repo ချိတ်ပါ။ `render.yaml` ကို ဖတ်ပြီး `mm-shop` web service ဖန်တီးမည်။
4. ပထမဆုံး deploy တွင် Render က `ADMIN_PASSWORD` ကို ကျပန်းထုတ်ပေးသည် (**Environment** တွင် ကြည့်ပါ)။
5. `https://mm-shop.onrender.com` နှင့် `/admin` ဖွင့်ပါ။ **ပထမဝင်ပြီးနောက် admin စကားဝှက် ပြောင်းပါ**။

ကိုယ်တိုင် Web Service ဖန်တီးလျှင် — **Node**, build `npm install`, start `npm start`,
`NODE_VERSION=20`, `ADMIN_PASSWORD` ကိုယ်တိုင်သတ်မှတ်ပါ။ Render က `PORT` ထည့်ပေးပြီး
အက်ပ်က `process.env.PORT || 3847` နှင့် `0.0.0.0` တွင် နားထောင်ပြီးသားဖြစ်သည်။

### Paid Starter + persistent disk (Blueprint ပုံသေ)

Blueprint သည် **Starter** (~$7/mo) + **1GB disk** (~$0.25/GB-mo) သုံးသည် — instance **အမြဲဖွင့်**
(free tier spin-down မရှိ)၊ restart ပြီးနောက် ဆိုင်ဒေတာ မပျောက်။

- ဒေတာသည် **`DATA_ROOT=/var/data`** အောက်တွင် (`data/shop.db`, `uploads/`)။
- Render တွင် **payment method** လိုအပ်သည်။
- Push ပြီးနောက်: Blueprint **sync** လုပ်ပါ၊ သို့မဟုတ် ကိုယ်တိုင် **Instance Type → Starter**,
  **Add Disk** mount `/var/data` size **1GB**, env **`DATA_ROOT=/var/data`** သတ်မှတ်ပြီး **redeploy**။
- DB ဗလာဖြစ်ပါက seed ပစ္စည်းများ boot တွင် အလိုအလျောက် ပြန်ထည့်သည်။

### ပထမဝင်ပြီးနောက်

`/admin` တွင် စကားဝှက်ပြောင်းပါ (သို့မဟုတ် Render dashboard တွင် `ADMIN_PASSWORD` အသစ်သတ်မှတ်ပြီး restart)။
ထုတ်ပေးထားသော / default စကားဝှက်ကို မထားပါနှင့်။
