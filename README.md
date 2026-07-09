# Navbatsiz

Navbat boshqarish platformasi — telefondan masofadan raqamli navbat olish (klinika,
bank, davlat xizmatlari, salon, avtoservis uchun universal).

## Tuzilishi

| Fayl | Vazifasi |
|------|----------|
| `public/index.html` | Marketing sayt (UZ/RU, sohalar demo, ariza formasi) |
| `public/panel.html` | Xodim admin-paneli + TV-tablo |
| `public/mijoz.html` | Mijoz: navbat olish (mobil) |
| `public/navbatsiz-db.js` | Supabase ulanish moduli (hali ulanmagan) |
| `db/schema.sql` | Supabase baza sxemasi (multi-tenant) |
| `docs/TASKS.md` | Ustuvorlik tartibidagi ish ro'yxati |
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
5. `docs/TASKS.md` #2 bo'yicha sahifalarni ulang.

> Eslatma: hozir panel/mijoz localStorage bilan ishlaydi (demo). Haqiqiy ko'p qurilmali
> ishlash uchun `docs/TASKS.md` dagi vazifalarni bajaring — xavfsizlik (#1) birinchi.

## Holat

- [x] Marketing sayt (UZ/RU, sohalar demo)
- [x] Admin-panel + TV-tablo (localStorage demo)
- [x] Mijoz sahifasi (localStorage demo)
- [x] Supabase sxemasi + ulanish moduli (yozilgan)
- [ ] Sahifalarni Supabase'ga ulash
- [ ] Admin-panel autentifikatsiyasi
- [ ] RLS'ni toraytirish
- [ ] Panel/mijozga UZ/RU
