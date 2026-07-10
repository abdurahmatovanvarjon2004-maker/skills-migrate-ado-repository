# Yangi kompaniyani ulash (onboarding)

Navbatsiz ko'p-kompaniyali: bitta tizim istalgan soha uchun ishlaydi
(klinika, bank, davlat xizmati, salon, avtoservis...). Yangi kompaniyani
ulash uchun **kodni o'zgartirish shart emas** — faqat ma'lumot qo'shiladi.

Ikki yo'l bor:
1. **Admin UI orqali** (tavsiya) — `admin.html` sahifasi (platforma admini uchun).
2. **SQL orqali** (quyida shablon) — Supabase SQL Editor'da.

---

## 0. Bir martalik tayyorgarlik: platforma admini

Yangi kompaniya faqat **platforma admini** tomonidan ochiladi. Birinchi
platforma adminini QO'LDA belgilang:

1. Supabase → Authentication → Users → o'zingizga email+parol bilan
   foydalanuvchi yarating (yoki mavjudini oling).
2. Uning `user_id`'sini oling (Users ro'yxatida ko'rinadi).
3. SQL Editor'da:
   ```sql
   insert into platform_admins (user_id) values ('<sizning-auth-user-id>');
   ```

Endi shu foydalanuvchi `admin.html`'ga kirib yangi kompaniya ocha oladi.

---

## 1. Admin UI orqali (tavsiya)

1. `admin.html`'ni oching → platforma admini email+parol bilan kiring.
2. **"Yangi kompaniya"** formasini to'ldiring:
   - Nom (masalan "Shifo klinikasi")
   - Slug (URL uchun, masalan `shifo-klinika`) — mijoz havolasi shunga bog'liq
   - Soha, joy/manzil
   - **Navbat so'zi** (Navbat / Talon) va **Oyna so'zi** (Kassa / Deraza /
     Stol / Usta / Post) — bu sohaga moslashadi
   - Brend rangi (ixtiyoriy), logotip URL (ixtiyoriy)
3. Kompaniya yaratilgach, unga **xizmatlar** (A/B/C...) va **oynalar**
   qo'shing.
4. **Xodim login'i** — ikki usul:

   **A) To'g'ridan-to'g'ri (tavsiya, Edge Function deploy qilingan bo'lsa):**
   admin UI'dagi "Xodimlar" kartasida email + parol + rol kiritib
   **"Akkaunt yaratish"** bosing — akkaunt yaratiladi va filialga
   biriktiriladi, xodim darhol panelga kira oladi.

   **B) Zaxira (qo'lda):** Supabase → Authentication → Users → xodimga
   email+parol yarating, so'ng `user_id`'sini admin UI'dagi zaxira
   formaga kiriting (rol: `admin` = sozlamalarni tahrirlaydi,
   `operator` = faqat navbat).

Xodim endi `panel.html`'ga kirib o'z kompaniyasini boshqaradi.
Mijoz `mijoz.html?b=<slug>`, TV-tablo `panel.html?view=tv&b=<slug>`.

---

## 2. SQL orqali (shablon)

Supabase → SQL Editor'da quyidagini moslab ishga tushiring:

```sql
-- 1) Kompaniya
insert into branches (name, place, slug, industry, ticket_word, window_word, brand_color, logo_url)
values ('Style barbershop', 'Asosiy zal', 'style-barber', 'salon', 'Navbat', 'Usta', null, null)
on conflict (slug) do nothing;

-- 2) Xizmatlar (kod A/B/C..., nom, izoh, tartib)
insert into services (branch_id, code, name, hint, sort)
select b.id, v.code, v.name, v.hint, v.sort
from branches b,
 (values ('A','Soch olish','Erkaklar',1),
         ('B','Soqol / parvarish','Beard care',2),
         ('C','Bolalar','Bolalar sartaroshligi',3)) v(code,name,hint,sort)
where b.slug='style-barber'
on conflict (branch_id, code) do nothing;

-- 3) Oynalar / stollar / ustalar
insert into windows (branch_id, no, label)
select b.id, g.n, 'Usta '||g.n
from branches b, generate_series(1,3) g(n)
where b.slug='style-barber'
on conflict (branch_id, no) do nothing;

-- 4) Xodimni biriktirish (auth user OLDIN yaratilgan bo'lsin)
insert into staff (user_id, branch_id, role)
select '<xodim-auth-user-id>', b.id, 'admin'
from branches b where b.slug='style-barber'
on conflict (user_id) do update set branch_id=excluded.branch_id, role=excluded.role;
```

> **Eslatma:** Xizmat kodlari (A/B/C...) talonida prefiks bo'ladi (A-001).
> Oyna soni panelda tanlanadigan oynalar sonini belgilaydi.

---

## Edge Function: `create-staff` (xodim akkauntini UI'dan yaratish)

Admin UI'dagi "Akkaunt yaratish" tugmasi ishlashi uchun bir marta deploy
qilinadi (aks holda zaxira/qo'lda usul ishlayveradi):

```bash
# Supabase CLI o'rnatilgan bo'lsin: https://supabase.com/docs/guides/cli
supabase login
supabase link --project-ref <SIZNING-PROJECT-REF>   # URL'dagi subdomen
supabase functions deploy create-staff
```

Qo'shimcha secret talab qilinmaydi — `SUPABASE_URL` va
`SUPABASE_SERVICE_ROLE_KEY` funksiya muhitiga avtomatik beriladi.

Sinov: admin.html → kompaniya tanlang → "Xodimlar" → email+parol →
"Akkaunt yaratish" → yangi xodim bilan panel.html'ga kirib ko'ring.
Xavfsizlik: funksiya chaqiruvchining JWT'sini tekshiradi — faqat
platforma admini yoki shu filialning 'admin'i akkaunt yarata oladi.

---

## Rollar

| Rol | Kim | Nima qila oladi |
|-----|-----|-----------------|
| **platforma admini** | siz (asoschi) | yangi kompaniya ochish, istalgan filialga xodim biriktirish |
| **filial admini** (`staff.role='admin'`) | kompaniya rahbari | o'z filiali xizmatlari/oynalari/matni/brendini tahrirlash, o'z filialiga xodim biriktirish |
| **operator** (`staff.role='operator'`) | oddiy xodim | navbatni boshqarish (chaqirish/bekor qilish) — sozlamalarga tegmaydi |

Har bir rol faqat O'Z doirasida ishlaydi (RLS + RPC ichidagi tekshiruv
bilan kafolatlanadi). Batafsil: `db/schema.sql` dagi `can_manage_branch`,
`is_platform_admin`, `create_branch`, `upsert_service` va h.k.
