# Navbatsiz — ish ro'yxati (ustuvorlik tartibida)

Har bir vazifadan keyin to'xtab, nima o'zgarganini va qanday sinashni qisqa yoz, so'ng commit qil.

---

## 1-USTUVORLIK — XAVFSIZLIK (real foydalanuvchiga chiqishdan oldin shart)

### 1.1 Admin-panel autentifikatsiyasi
`panel.html`da hech qanday himoya yo'q — URL'ni bilgan har kim navbatni boshqara oladi.
- Supabase Auth (email+parol yoki magic link) qo'sh.
- Login qilmagan foydalanuvchiga panel ko'rinmasin; faqat TV-tablo ko'rinishi ochiq
  bo'lishi mumkin (u faqat o'qiydi).

### 1.2 RLS'ni toraytirish (`db/schema.sql`)
Hozir `create policy "read tickets" ... using (true)` — hamma hammaning talonini,
MIJOZ ISMI bilan birga o'qiy oladi. Buni tuzat:
- Mijoz faqat o'z talonini ko'rsin (qisqa token/kod orqali — 8.x bilan bog'liq).
- TV-tablo/panel uchun faqat ommaviy maydonlar (tag, status, window_no) chiqadigan
  alohida `view` yoki `security definer` RPC yasa — ism kabi shaxsiy ma'lumot
  ommaviy o'qishda KO'RINMASIN.
- Panel autentifikatsiyadan o'tgan xodimning faqat O'Z filiali ma'lumotini ko'rsin.

### 1.3 take_ticket flood himoyasi (`db/schema.sql`)
`take_ticket`da spam himoyasi yo'q — skript bilan minglab soxta talon yaratish mumkin.
- Sessiya/IP asosida oddiy throttling (bir manbadan daqiqasiga N ta talon).

---

## 2-USTUVORLIK — HAQIQIY BACKENDGA ULASH

### 2.1 panel.html + mijoz.html ni Supabase'ga ulash
`navbatsiz-db.js` allaqachon yozilgan (take_ticket, call_next, call_ticket,
finish_ticket, cancel_ticket, noshow_ticket, subscribe, loadBranch, loadTickets).
- Ikkala fayldagi localStorage mantiqini shu modul chaqiruvlariga almashtir.
- `subscribe()` (real-time) bilan ulab qo'y — ikki xil qurilma (mijoz telefoni,
  klinika kompyuteri) HAQIQATDA bir-birini ko'rsin.
- CLAUDE.md dagi "localStorage ma'lumot shartnomasi" va Ticket shaklini saqla.

### 2.2 Filialni Supabase'dan yuklash
Hozir filial `localStorage['navbatsiz_branch']` orqali. Endi `branches` jadvalidan
slug bo'yicha yuklansin. Mijoz sahifasidagi mavjud `?b=slug` patternini shunga ula.

---

## 3-USTUVORLIK — IZCHILLIK

### 3.1 Panel/mijozga UZ/RU til almashtirgichi
Hozir faqat `index.html`da bor. `index.html`dagi i18n patternini (RU lug'at +
TreeWalker + `data-nolang` + `applyLang`) `panel.html` va `mijoz.html`ga ham qo'sh.
Tanlov `localStorage['nlang']`da — uchala sahifada bir xil kalit.

---

## 4-USTUVORLIK — AMALIY ISHLASH

### 4.1 TV-tablo uchun to'g'ridan-to'g'ri URL
Hozir tablo faqat panel ichida `F` tugmasi bilan ochiladi — klaviaturasiz televizorda
ishlamaydi. `panel.html?view=tv&b=<slug>` kabi URL yasa; ochilganda avtomatik to'liq
ekranli tablo rejimida tursin (login talab qilmasin — faqat o'qiydi).

### 4.2 Mijoz navbatini tiklash
Sahifa yopilsa yoki boshqa qurilmadan kirilsa, mijoz o'z navbatini yo'qotadi
(holat faqat localStorage'da). Har talonga qisqa tiklash kodi/havola qo'sh —
istalgan qurilmadan holatni qayta ochish mumkin bo'lsin. (1.2 bilan bog'liq: shu
token mijozga o'z talonini ko'rish huquqini beradi.)

### 4.3 Tarmoq xatolari
Supabase so'rovlariga try/catch va foydalanuvchiga tushunarli holat qo'sh
("Aloqa uzildi, qayta urinilmoqda..."). Ulanish tiklanganda avtomatik qayta yuklansin.

---

## Keyinroq (ixtiyoriy, hozir shart emas)
- SMS xabar (Eskiz.uz) — navbat yaqinlashganda.
- Bir nechta filial bitta muassasa uchun; xodim rollari.
- PWA (telefonga o'rnatiladigan).
- Domen (navbatsiz.uz) + og:image to'liq URL.
