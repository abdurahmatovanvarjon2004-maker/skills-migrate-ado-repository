# Navbatsiz — loyiha konteksti (Claude Code uchun)

> Bu faylni Claude Code avtomatik o'qiydi. Har doim shu kontekstga tayan.
> Muloqot o'zbek tilida (foydalanuvchi shunday afzal ko'radi). Kod izohlari o'zbekcha.

## Loyiha nima

**Navbatsiz** — navbat boshqarish platformasi (O'zbekiston). Foydalanuvchi telefondan
masofadan raqamli navbat oladi, navbati yaqinlashganda push-xabar oladi, kelganda QR bilan
tasdiqlaydi. Muassasa xodimi paneldan navbatni boshqaradi, TV-tabloda navbat ko'rinadi.

**Universal:** bitta tizim turli soha uchun ishlaydi — klinika, bank, davlat xizmatlari
markazi, salon, avtoservis. Har soha "ticket_word" (Navbat/Talon) va "window_word"
(Kassa/Deraza/Stol/Usta/Post) kabi matnlar bilan moslashadi, KOD O'ZGARMAYDI.

Asoschi: Abduraxmatov Anvarjon (2026 bitiruvchi, Toshkent).

## Repo tuzilishi

```
public/
  index.html          # Marketing sayt (landing) — UZ/RU, sohalar demo, ariza formasi
  panel.html          # Xodim admin-paneli + TV-tablo (bir faylda)
  mijoz.html          # Mijoz: navbat olish sahifasi (mobil)
  navbatsiz-db.js     # Supabase ulanish moduli (YOZILGAN, lekin HALI ULANMAGAN)
  og.png              # Ijtimoiy ulashish rasmi (index.html shunga bog'liq)
assets/               # logotip (svg) va app-ikonka (png)
db/
  schema.sql          # Supabase ma'lumotlar bazasi sxemasi (multi-tenant)
docs/
  TASKS.md            # Ustuvorlik tartibidagi ish ro'yxati — SHUNDAN BOSHLA
README.md             # Odam uchun tez boshlash / deploy
netlify.toml          # Deploy sozlamasi (publish = public)
```

## HOZIRGI HOLAT (muhim!)

- **panel.html va mijoz.html HALI localStorage bilan ishlaydi** — ya'ni faqat BITTA
  brauzer ichida sinxron (demo uchun). Alohida qurilmalar bir-birini KO'RMAYDI.
- **navbatsiz-db.js yozilgan, lekin hech qayerda ulanmagan.** Uni sinab ko'rish
  imkoni bo'lmagan (Supabase tashqarida edi).
- **Autentifikatsiya YO'Q** — panel.html'ni URL bilan ochgan har kim boshqaradi.
- Sxemadagi RLS "read tickets using(true)" — hamma hammaning talonini (ism bilan)
  o'qiy oladi. Bu tuzatilishi kerak.

Batafsil vazifalar: `docs/TASKS.md`.

## Texnik konventsiyalar

- **Har bir sahifa — bitta HTML fayl** (inline CSS + JS). Tashqi build yo'q, framework yo'q.
  Yangi kutubxona qo'shishdan oldin so'ra.
- **Statik sayt** — Netlify'ga `public/` papka deploy qilinadi.
- **Dizayn tokenlari** (uchala faylda `:root` da bir xil bo'lishi SHART):
  - `--bg:#08181B` `--card:#0E2429` `--ink:#EDF5F1` `--muted:#8FA8A0`
  - `--mint:#37D9A0` (zumrad) `--amber/--cyan:#F5B63F` (oltin) `--violet:#177E76` (chuqur teal)
  - `--grad:linear-gradient(115deg,#F7C948,#F5A83B,#E58E2F)` (oltin — kamalak EMAS)
  - Shriftlar: `--disp:'Unbounded'` (sarlavha), `--body:'Golos Text'`, `--mono:'IBM Plex Mono'` (raqamlar)
  - MUHIM: eski neon ranglar (#34F5C5, #22D3EE, #8B7CFF) qaytib kelmasin — bu "AI dizayn" belgisi.
- **i18n patterni** (hozir faqat index.html'da): `var RU={...}` lug'at + TreeWalker matn
  almashtirish + `data-nolang` (dinamik/raqamli elementlarni chetlab o'tish uchun) +
  `applyLang(lang)`. Tanlov `localStorage['nlang']` da saqlanadi. Panel/mijozga ham
  shu patternni qo'shish kerak (TASKS.md #6).

## localStorage ma'lumot shartnomasi (Supabase migratsiyasidan oldin O'QI)

panel.html va mijoz.html ayni SHU kalitlar va shakl orqali gaplashadi:

- `navbatsiz_branch` — tanlangan soha slug: `clinic|bank|gov|salon|auto`
- `navbatsiz_q_<branch>` — o'sha filial navbati (JSON):
  ```
  { counters:{A:0,B:0,...}, waiting:[Ticket], now:Ticket|null, served:int, win:int }
  ```
- `navbatsiz_q_<branch>_ping` — cross-tab yangilanish signali (timestamp)
- `navbatsiz_my_<branch>` — mijozning o'z taloni (Ticket)

**Ticket shakli** (panel va mijozda bir xil bo'lishi shart):
```
{ id, tag:"A-001", name, svc:"A", t:<ms>, win?, status? }
```
tag = xizmat kodi + '-' + 3 xonali raqam (A-001). Sohaning xizmatlari (svc kodlari
A/B/C/D) uchala faylda `INDUSTRIES` konfiguratsiyasida takrorlanadi — ular
db/schema.sql dagi services jadvaliga mos.

Supabase'ga o'tkazganda: bu localStorage mantiqini navbatsiz-db.js chaqiruvlariga
almashtir (take_ticket / call_next / call_ticket / finish_ticket / cancel_ticket /
subscribe). Ticket shakli va sohalar mantiqini SAQLA.

## Ishlatish (lokal)

Statik fayllar — hech narsa kompilyatsiya qilinmaydi:
```
# eng oddiy: public/index.html ni brauzerda ochish
# yoki lokal server:
npx serve public        # (internet kerak, ixtiyoriy)
```
Demo sinash: panel.html va mijoz.html ni ikki tabda oching, ikkalasida bir xil sohani
tanlang, mijozda navbat oling — panelda ko'rinadi (bitta brauzer ichida).

## Deploy

Netlify: repo'ni ulang yoki `public/` papkani drag-drop qiling. `netlify.toml` publish
katalogini `public` ga yo'naltiradi. Domen ulangach: index.html dagi
`<meta property="og:image" content="og.png">` ni to'liq URL'ga o'zgartir
(masalan `https://navbatsiz.uz/og.png`) — Telegram to'liq manzil talab qiladi.

## Ishlash tartibi (Claude Code uchun)

1. Avval `docs/TASKS.md` ni o'qi — ustuvorlik tartibi shu yerda.
2. Katta o'zgarishlardan oldin Plan rejimida reja ko'rsat.
3. Har vazifadan keyin: o'zgargan fayllar + qanday sinash mumkinligini qisqa yoz, so'ng commit qil.
4. **Maxfiy qiymatlar** (Supabase URL, anon key) kerak bo'lsa — to'g'ridan-to'g'ri so'ra, taxmin qilma.
   Ularni kodga hardcode qilma; `.env` yoki foydalanuvchi to'ldiradigan joyni ko'rsat.
5. Xavfsizlik vazifalari (TASKS #1–3) birinchi — ishlayotgan demo ularsiz ham ko'rinadi,
   lekin real foydalanuvchiga chiqishdan oldin shart.
