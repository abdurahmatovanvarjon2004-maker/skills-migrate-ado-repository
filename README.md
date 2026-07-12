# Navbatsiz

Navbat boshqarish platformasi — telefondan masofadan raqamli navbat olish (klinika,
bank, davlat xizmatlari, salon, avtoservis uchun universal).

## Tuzilishi

| Fayl | Vazifasi |
|------|----------|
| `public/index.html` | Marketing sayt (UZ/RU, sohalar demo, ariza formasi) |
| `public/panel.html` | Xodim admin-paneli + TV-tablo |
| `public/admin.html` | Kompaniya onboarding + boshqaruv konsoli |
| `public/mijoz.html` | Mijoz: navbat olish (mobil) |
| `public/navbatsiz-db.js` | Supabase ulanish moduli (hali ulanmagan) |
| `db/schema.sql` | Supabase baza sxemasi (multi-tenant) |
| `docs/TASKS.md` | Ustuvorlik tartibidagi ish ro'yxati |
| `docs/ONBOARDING.md` | Yangi kompaniyani ulash qo'llanmasi |
| `CLAUDE.md` | Loyiha konteksti (Claude Code o'qiydi) |

## Tez boshlash (lokal)

Kompilyatsiya yo'q — statik HTML:

```bash
# variant 1: public/index.html ni brauzerda oching
# variant 2: lokal server
npx serve public
```

**Demo sinash:** `panel.html` va `mijoz.html` ni ikki tabda oching → ikkalasida bir xil
sohani tanlang → mijozda navbat oling → panelda ko'rinadi (hozir bitta brauzer ichida
localStorage orqali sinxron).

## Deploy (Netlify)

Repo'ni Netlify'ga ulang yoki `public/` papkani drag-drop qiling. `netlify.toml`
publish katalogini `public` ga yo'naltiradi.

Domen ulangach: `public/index.html` dagi `og:image` ni to'liq URL'ga o'zgartiring
(masalan `https://navbatsiz.uz/og.png`).

## Supabase (haqiqiy backend)

1. supabase.com da loyiha oching.
2. SQL Editor'da `db/schema.sql` ni ishga tushiring.
3. Settings → API dan URL va anon key oling.
4. `public/navbatsiz-db.js` dagi `SUPABASE_URL` va `SUPABASE_ANON_KEY` ni to'ldiring.
5. **Xodim yarating:** Authentication → Users → email+parol bilan foydalanuvchi qo'shing,
   so'ng SQL Editor'da uni filialга biriktiring:
   ```sql
   insert into staff (user_id, branch_id)
   values ('<user-id>', (select id from branches where slug='shifo-klinika'));
   ```
6. Panel'ni oching → xodim login qiladi → o'z filiali navbatini boshqaradi.
   Mijoz `mijoz.html?b=<slug>` orqali navbat oladi. TV-tablo: `panel.html?view=tv&b=<slug>`.

> Endi panel va mijoz Supabase orqali **haqiqatda** bir-birini ko'radi (ikki xil qurilma).
> Panel real-time bilan yangilanadi; ochiq TV-tablo va mijoz sahifasi davriy so'rov bilan.

## Holat

- [x] Marketing sayt (UZ/RU, sohalar demo)
- [x] Admin-panel + TV-tablo
- [x] Mijoz sahifasi
- [x] Supabase sxemasi + ulanish moduli
- [x] Sahifalarni Supabase'ga ulash (real-time / poll)
- [x] Admin-panel autentifikatsiyasi (email+parol)
- [x] RLS'ni toraytirish (xodim/mijoz ajratildi, PII himoyasi, flood himoyasi)
- [x] Panel/mijozga UZ/RU til almashtirgichi
- [x] TV-tablo to'g'ridan-to'g'ri URL + to'liq ekran (`?view=tv&b=<slug>`)
- [x] Mijoz navbatini boshqa qurilmadan tiklash (`?b=<slug>&t=<token>` havola)
- [x] Tarmoq xatolarida foydalanuvchiga xabar (banner / ulanish nuqtasi)
- [x] Kompaniya onboarding: rollar + boshqaruv RPC'lari (`db/schema.sql`)
- [x] Onboarding + boshqaruv konsoli (`admin.html`)
- [x] Har-kompaniya brendi (logo + rang) mijoz va TV'da
- [x] Onboarding qo'llanmasi (`docs/ONBOARDING.md`)
- [x] Landing'dan jonli demo havolalari + deploy qo'llanmasi (`docs/DEPLOY.md`)
- [x] Panelda "Kelmadi" (no_show), real statistika, xizmatlar jonli yangilanishi
- [x] Haqiqiy QR kodlar (TV'da mijoz havolasi, mijozda talon QR'i) — `public/qr.js`
- [x] PWA: mijoz sahifasi telefonga o'rnatiladi, offline ochiladi
- [x] Xodim akkauntini admin UI'dan yaratish (`supabase/functions/create-staff`)
- [x] Push-xabar: sahifa yopiq bo'lsa ham "navbatingiz yaqinlashdi/chaqirildingiz" (`supabase/functions/send-push` + Web Push)
- [ ] Haqiqiy Supabase'da yakuniy smoke-test (DEPLOY.md bo'yicha)
