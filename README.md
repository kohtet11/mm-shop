# MM Shop — မြန်မာဘာသာ အွန်လိုင်းစတိုး

Node.js + Express + SQLite ဖြင့် တည်ဆောက်ထားသော ဘလိုင်ဘောက်စ် / စုဆောင်းပစ္စည်း အွန်လိုင်းဆိုင်။

## လိုအပ်ချက်

- Node.js 18+
- npm

## ထည့်သွင်းခြင်း & စတင်ခြင်း

```bash
cd /workspace/mm-shop
npm install
npm start
```

ဆာဗာသည် `0.0.0.0:PORT` တွင် နားထောင်သည် (default **PORT=3847**)။

- စတိုးဖရန့်: http://localhost:3847/
- Admin: http://localhost:3847/admin

### ပတ်ဝန်းကျင် ကိန်းရှင်များ

`.env.example` ကို ကူးယူ၍ `.env` ဖန်တီးနိုင်သည်:

```bash
cp .env.example .env
```

| Variable | Default | ဖော်ပြချက် |
|----------|---------|-----------|
| `ADMIN_PASSWORD` | `admin123` | Admin စကားဝှက် |
| `PORT` | `3847` | ဆာဗာ port |
| `DATA_ROOT` | `__dirname` (သို့ `/var/data` ရှိလျှင်) | SQLite + uploads အမြစ်လမ်းကြောင်း |

## Admin အသုံးပြုပုံ (အကျဉ်း)

1. `/admin` သို့ သွားပြီး စကားဝှက်ဖြင့် ဝင်ပါ (default: `admin123`)
2. **ပစ္စည်းများ** — ထည့် / ပြင် / ဖျက်၊ ပုံတင်၊ ဈေးနှုန်း (ကျပ်)、 active ဖွင့်/ပိတ်
3. **အော်ဒါများ** — အသစ်ဆုံး အရင်ပြသည်၊ စလစ်ကြည့်၊ အခြေအနေ ပြောင်းပါ  
   (`pending` → `paid_confirmed` → `shipped` / `cancelled`)
4. **ငွေပေးချေမှု** — ဘဏ်အမည်၊ အကောင့်နံပါတ်၊ အကောင့်အမည် ပြင်ပါ (checkout တွင် ပြမည်)

## ဖောက်သည် အသုံးပြုပုံ

1. ပင်မစာမျက်နှာတွင် ပစ္စည်းကြည့်ပြီး ခြင်းတောင်းထည့်ပါ
2. ဘဏ်သို့ လွှဲငွေလုပ်ပါ (ညွှန်ကြားချက် checkout တွင် ရှိသည်)
3. အမည်၊ ဖုန်း၊ လိပ်စာ ဖြည့်ပြီး **ငွေလွှဲစလစ်ပုံ** တင်ကာ အော်ဒါတင်ပါ
4. အော်ဒါနံပါတ် အတည်ပြုချက် ရရှိမည်

## ဖိုင်ဖွဲ့စည်းပုံ

```
mm-shop/
  server.js          # Express API + static
  data/shop.db       # SQLite (local; on Render under DATA_ROOT)
  uploads/products/  # ပစ္စည်းပုံများ
  uploads/slips/     # ငွေလွှဲစလစ်များ
  public/            # စတိုး + admin UI
```

## Deploy (Render)

See **[DEPLOY.md](DEPLOY.md)**. Blueprint default: **Starter** (~$7/mo) + **1GB disk** (~$0.25/GB-mo),
always-on, data under `/var/data` via `DATA_ROOT`. Needs a payment method on Render. After push,
sync Blueprint or manually set Starter + disk mount `/var/data` + `DATA_ROOT=/var/data`, then redeploy.

## API အကျဉ်း

**Public:** `GET /api/products`, `GET /api/settings/payment`, `POST /api/orders`  
**Admin (session cookie):** products CRUD, orders list/detail/status, settings

## မှတ်ချက်

- `better-sqlite3` native build မအောင်မြင်ပါက `sql.js` ကို fallback အဖြစ် ထည့်သွင်းနိုင်သည် (`npm install sql.js`)
- Seed ပစ္စည်း ၃ ခု (Skullpanda, Nommi, Zootopia) ပထမအကြိမ် စတင်ချိန်တွင် အလိုအလျောက် ထည့်သည်
- `DATA_ROOT` သတ်မှတ်ပါက `data/` နှင့် `uploads/` သည် ထိုလမ်းကြောင်းအောက်တွင် ရှိသည် (Render disk: `/var/data`)
