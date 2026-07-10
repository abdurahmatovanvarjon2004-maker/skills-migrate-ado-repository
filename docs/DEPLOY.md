# Ishga tushirish (deploy) qo'llanmasi

Navbatsiz'ni haqiqiy muhitga chiqarish: Supabase (backend) + Netlify
(statik sayt). Taxminan 20–30 daqiqa.

---

## 1. Supabase (backend)

1. [supabase.com](https://supabase.com) da yangi loyiha oching
   (region: eng yaqini, masalan Frankfurt).
2. **SQL Editor** → `db/schema.sql` faylining TO'LIQ matnini joylang → Run.
   (Xavfsiz qayta ishga tushirish mumkin — sxema idempotent.)
3. **Settings → API** dan ikkita qiymatni oling:
   - `Project URL` (masalan `https://abcdefgh.supabase.co`)
   - `anon public` key
4. `public/navbatsiz-db.js` boshidagi ikki qatorga yozing:
   ```js
   const SUPABASE_URL = 'https://SIZNING-LOYIHA.supabase.co';
   const SUPABASE_ANON_KEY = 'SIZNING_ANON_KEY';
   ```
   > anon key — ochiq (public) kalit, uni frontend'da saqlash normal.
   > `service_role` kalitini esa HECH QACHON frontend'ga qo'ymang.

### 1.1 Platforma admini (bir marta)

1. **Authentication → Users → Add user** — o'zingizga email+parol.
2. Ro'yxatda `user_id` (UUID) ni nusxalang.
3. SQL Editor'da:
   ```sql
   insert into platform_admins (user_id) values ('<user-id>');
   ```

### 1.2 Birinchi kompaniya

`admin.html`ni oching (lokal yoki deploy'dan keyin) → platforma admini
bilan kiring → kompaniya, xizmatlar, oynalar yarating. Batafsil:
`docs/ONBOARDING.md`.

### 1.3 Xodim

- Authentication → Users → xodimga email+parol yarating.
- `user_id`ni `admin.html`dagi "Xodimlar" kartasiga kiriting
  (yoki Edge Function deploy qilingan bo'lsa email+parol bilan
  to'g'ridan-to'g'ri — ONBOARDING.md'ga qarang).

---

## 2. Netlify (sayt)

**A usul (tavsiya):** repo'ni Netlify'ga ulang — `netlify.toml`
publish katalogini `public`ga o'zi yo'naltiradi. Har push avtomatik
deploy bo'ladi.

**B usul:** [app.netlify.com/drop](https://app.netlify.com/drop) ga
`public/` papkani sudrab tashlang.

Domen ulangach:
- `public/index.html`dagi `<meta property="og:image" content="og.png">`
  ni to'liq URL'ga o'zgartiring (masalan `https://navbatsiz.uz/og.png`) —
  Telegram to'liq manzil talab qiladi.

---

## 3. Smoke-test (har deploy'dan keyin, ~5 daqiqa)

Ikki qurilma (yoki brauzer + telefon) bilan:

| # | Qadam | Kutilgan natija |
|---|-------|-----------------|
| 1 | `panel.html` oching | Login ekrani (panel yashirin) |
| 2 | Noto'g'ri parol | "Email yoki parol noto'g'ri" xatosi |
| 3 | To'g'ri xodim bilan kiring | O'z filiali nomi, xizmatlar, navbat ko'rinadi |
| 4 | Telefonda `mijoz.html?b=<slug>` → talon oling | Talon raqami + tiklash havolasi chiqadi |
| 5 | Panelda talon ko'rinadimi? | Real-time'da (1–2 soniyada) paydo bo'ladi |
| 6 | Panelda "Keyingisini chaqirish" | Telefonda "Navbatingiz keldi!" banneri (≤4 s) |
| 7 | `panel.html?view=tv&b=<slug>` (login'siz) | Tablo ochiladi, ismlar KO'RINMAYDI |
| 8 | Tiklash havolasini boshqa brauzerda oching | Talon holati qayta ochiladi |
| 9 | Bir qurilmadan ketma-ket 6+ talon oling | 6-chisida "Juda ko'p urinish" xatosi (rate-limit) |
| 10 | Panel "Chiqish" | Login ekraniga qaytadi |

Xavfsizlik tekshiruvi (ixtiyoriy, curl bilan):
```bash
# anon to'g'ridan-to'g'ri tickets o'qiy olmasligi kerak (bo'sh [] qaytadi):
curl "https://<PROJECT>.supabase.co/rest/v1/tickets?select=*" \
  -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"

# ommaviy navbat esa ishlaydi va ISM QAYTARMAYDI:
curl "https://<PROJECT>.supabase.co/rest/v1/rpc/get_queue_public" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"p_branch":"<BRANCH_UUID>"}'
```

---

## Muammolar

| Belgi | Sabab / yechim |
|-------|----------------|
| Panel login'dan o'tmayapti | `navbatsiz-db.js`da URL/key to'g'rimi? Brauzer konsolida xato bormi? |
| Login o'tdi, "Sizga filial biriktirilmagan" | Xodim `staff` jadvaliga qo'shilmagan — ONBOARDING.md 1.3 |
| Mijoz talon ololmayapti (rate_limited) | Bir IP'dan daqiqasiga 5 ta chegara — 1 daqiqa kuting |
| TV/mijoz yangilanmayapti | Ular 4 soniyalik so'rov bilan ishlaydi — kuting; konsolda xato bormi? |
| Panel real-time ishlamayapti | Supabase → Database → Replication'da `tickets` publikatsiyada bormi? (schema.sql buni o'zi qo'shadi) |
