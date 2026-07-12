/* ============================================================
 *  NAVBATSIZ — Supabase ulanish moduli (barcha sahifalar uchun umumiy)
 *  Fayl: navbatsiz-db.js — uchala HTML shu faylni ulaydi.
 *
 *  1) Supabase'da loyiha oching (supabase.com) → SQL Editor'da
 *     db/schema.sql ni ishga tushiring.
 *  2) Settings → API bo'limidan URL va anon key ni oling.
 *  3) Quyidagi ikki qatorni to'ldiring:
 * ============================================================ */
const SUPABASE_URL = 'https://SIZNING-LOYIHA.supabase.co';
const SUPABASE_ANON_KEY = 'SIZNING_ANON_KEY';

// Web Push (ixtiyoriy): VAPID public key. Bo'sh/placeholder bo'lsa push
// UI'si umuman ko'rinmaydi. Yaratish: npx web-push generate-vapid-keys
// (public shu yerga, private -> Supabase secrets, docs/ONBOARDING.md).
export const VAPID_PUBLIC_KEY = '';

// Standart muassasa (branch) slug — mijoz sahifasi ?b= bermasa shu ochiladi.
export const DEFAULT_BRANCH_SLUG = 'shifo-klinika';

/* ---- Quyisini o'zgartirish shart emas ---- */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 5 } }
});

/* ============================================================
 *  Ticket shakli moslamasi (CLAUDE.md "ma'lumot shartnomasi")
 *  DB qatori  -> panel/mijoz kutadigan { id, tag, name, svc, t, win, status }
 *  svc (xizmat kodi) tag prefiksidan olinadi: "A-001" -> "A".
 * ============================================================ */
export function mapTicket(row) {
  if (!row) return null;
  const tag = row.tag || '';
  return {
    id: row.id,
    tag: tag,
    name: row.name || '',
    svc: tag.indexOf('-') > 0 ? tag.slice(0, tag.indexOf('-')) : tag,
    t: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    win: row.window_no || null,
    status: row.status || 'waiting',
    priority: row.priority || 0,
    token: row.access_token || null   // faqat o'z talonida / xodim o'qishida bo'ladi
  };
}
// RPC natijasi ba'zan massiv (setof/returns table), ba'zan bitta obyekt.
function firstRow(data) { return Array.isArray(data) ? (data[0] || null) : (data || null); }

/* ============================================================
 *  MUASSASALAR (branches) + xizmatlar (services) + oynalar (windows)
 * ============================================================ */
// Barcha faol muassasalar (mijoz sahifasidagi tanlagich uchun).
export async function loadBranches() {
  const { data, error } = await sb
    .from('branches').select('*').eq('active', true).order('name');
  if (error) throw error;
  return data || [];
}

// Bitta muassasa + uning xizmatlari, slug bo'yicha (mijoz ?b=slug).
export async function loadBranch(slug = DEFAULT_BRANCH_SLUG) {
  const { data: branch, error } = await sb
    .from('branches').select('*').eq('slug', slug).single();
  if (error) throw error;
  const { data: services } = await sb
    .from('services').select('*').eq('branch_id', branch.id).eq('active', true).order('sort');
  return { branch, services: services || [] };
}

// Login qilgan xodimning O'Z filiali (staff jadvalidan) + xizmatlari.
// Xodim biriktirilmagan bo'lsa null qaytadi.
export async function loadStaffBranch() {
  const { data: row, error } = await sb.from('staff').select('branch_id').maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const { data: branch, error: bErr } = await sb
    .from('branches').select('*').eq('id', row.branch_id).single();
  if (bErr) throw bErr;
  const { data: services } = await sb
    .from('services').select('*').eq('branch_id', row.branch_id).eq('active', true).order('sort');
  return { branch, services: services || [] };
}

// Filial oynalari/stollari (bo'lmasa panel standart 3 tani ishlatadi).
export async function loadWindows(branchId) {
  const { data } = await sb
    .from('windows').select('*').eq('branch_id', branchId).eq('active', true).order('no');
  return data || [];
}

/* ============================================================
 *  TALONLAR (tickets)
 * ============================================================ */
// Faol talonlar (waiting + serving) — panel to'g'ridan-to'g'ri jadvaldan
// o'qiydi (RLS: faqat xodimning o'z filiali). Ism (name) bilan keladi.
export async function loadTickets(branchId) {
  const { data, error } = await sb.from('tickets')
    .select('*').eq('branch_id', branchId)
    .in('status', ['waiting', 'serving'])
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapTicket);
}

// Ommaviy navbat (login talab qilmaydi, PII'siz) — TV-tablo va mijozning
// "oldimda nechta kishi" ko'rinishi shundan foydalanadi. Ism QAYTMAYDI.
export async function loadQueuePublic(branchId) {
  const { data, error } = await sb.rpc('get_queue_public', { p_branch: branchId });
  if (error) throw error;
  return (data || []).map(mapTicket);
}

// Mijoz push obunasini saqlash (talon token'i + brauzer PushSubscription).
export async function savePushSubscription(token, sub) {
  const j = sub.toJSON ? sub.toJSON() : sub;
  const keys = j.keys || {};
  const { error } = await sb.rpc('save_push_subscription', {
    p_token: token, p_endpoint: j.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth
  });
  if (error) throw error;
}

// Mijoz o'z taloni (ism bilan) — faqat access_token orqali, login'siz.
export async function getTicketByToken(token) {
  if (!token) return null;
  const { data, error } = await sb.rpc('get_ticket_by_token', { p_token: token });
  if (error) throw error;
  return mapTicket(firstRow(data));
}

// Bugungi barcha talonlar (real statistika uchun): soatlik oqim va
// o'rtacha kutish shulardan hisoblanadi. Faqat xodim (RLS: o'z filiali).
export async function loadTodayStats(branchId) {
  const today = new Date(); today.setHours(0,0,0,0);
  const { data, error } = await sb.from('tickets')
    .select('created_at, called_at, done_at, status')
    .eq('branch_id', branchId)
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Bugun yakunlangan (statistika uchun)
export async function countDone(branchId) {
  const today = new Date(); today.setHours(0,0,0,0);
  const { count } = await sb.from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId).eq('status','done')
    .gte('done_at', today.toISOString());
  return count || 0;
}

/* ============================================================
 *  AMALLAR (RPC) — barchasi mapTicket bilan qaytaradi (yoki xato tashlaydi)
 * ============================================================ */
// Talon olish (mijoz yoki panel qo'lda). phone — ixtiyoriy (SMS uchun).
// Natija: yangi talon (token bilan).
export async function takeTicket(serviceId, name, phone) {
  const { data, error } = await sb.rpc('take_ticket',
    { p_service: serviceId, p_name: name || '', p_phone: phone || '' });
  if (error) throw error;
  return mapTicket(firstRow(data));
}
// Keyingi (eng oldin turgan) talonni chaqirish. Navbat bo'sh bo'lsa null.
export async function callNext(branchId, win) {
  const { data, error } = await sb.rpc('call_next', { p_branch: branchId, p_window: win });
  if (error) throw error;
  return mapTicket(firstRow(data));
}
// Aniq talonni chaqirish (ro'yxatdagi tugma orqali).
export async function callTicket(ticketId, win) {
  const { data, error } = await sb.rpc('call_ticket', { p_ticket: ticketId, p_window: win });
  if (error) throw error;
  return mapTicket(firstRow(data));
}
export async function finishTicket(ticketId) {
  const { error } = await sb.rpc('finish_ticket', { p_ticket: ticketId });
  if (error) throw error;
}
// Bekor qilish: xodim (token'siz) YOKI mijoz o'z token'i bilan.
export async function cancelTicket(ticketId, token = null) {
  const { error } = await sb.rpc('cancel_ticket', { p_ticket: ticketId, p_token: token });
  if (error) throw error;
}
export async function noshowTicket(ticketId) {
  const { error } = await sb.rpc('noshow_ticket', { p_ticket: ticketId });
  if (error) throw error;
}

/* ============================================================
 *  KOMPANIYA BOSHQARUVI (admin.html + panel sozlamalari)
 * ============================================================ */
// Joriy foydalanuvchi konteksti: { is_admin, branch_id, role } yoki null.
export async function myContext() {
  const { data, error } = await sb.rpc('my_context');
  if (error) throw error;
  return firstRow(data);
}
// Filial xizmatlari (admin tahrirlashi uchun — active bo'lmaganlar ham).
export async function loadServicesAll(branchId) {
  const { data, error } = await sb.from('services').select('*').eq('branch_id', branchId).order('sort');
  if (error) throw error;
  return data || [];
}
export async function loadWindowsAll(branchId) {
  const { data, error } = await sb.from('windows').select('*').eq('branch_id', branchId).order('no');
  if (error) throw error;
  return data || [];
}
// Yangi kompaniya (faqat platforma admini).
export async function createBranch(b) {
  const { data, error } = await sb.rpc('create_branch', {
    p_name: b.name, p_slug: b.slug, p_place: b.place || '', p_industry: b.industry || 'other',
    p_ticket_word: b.ticket_word || 'Navbat', p_window_word: b.window_word || 'Oyna',
    p_brand_color: b.brand_color || '', p_logo_url: b.logo_url || ''
  });
  if (error) throw error;
  return firstRow(data);
}
export async function upsertService(branchId, s) {
  const { data, error } = await sb.rpc('upsert_service', {
    p_branch: branchId, p_code: s.code, p_name: s.name, p_hint: s.hint || '',
    p_sort: s.sort || 0, p_active: s.active !== false
  });
  if (error) throw error;
  return firstRow(data);
}
export async function upsertWindow(branchId, w) {
  const { data, error } = await sb.rpc('upsert_window', {
    p_branch: branchId, p_no: w.no, p_label: w.label || '', p_active: w.active !== false
  });
  if (error) throw error;
  return firstRow(data);
}
export async function updateBranchSettings(branchId, b) {
  const { data, error } = await sb.rpc('update_branch_settings', {
    p_branch: branchId, p_name: b.name, p_place: b.place || '',
    p_ticket_word: b.ticket_word || 'Navbat', p_window_word: b.window_word || 'Oyna',
    p_brand_color: b.brand_color || '', p_logo_url: b.logo_url || '', p_active: b.active !== false
  });
  if (error) throw error;
  return firstRow(data);
}
export async function assignStaff(userId, branchId, role) {
  const { error } = await sb.rpc('assign_staff', { p_user: userId, p_branch: branchId, p_role: role || 'operator' });
  if (error) throw error;
}
// Xodimga email+parol akkaunt yaratish (create-staff Edge Function orqali).
// Funksiya deploy qilinmagan bo'lsa xato tashlaydi — UI qo'lda usulga yo'naltiradi.
export async function createStaffAccount(email, password, branchId, role) {
  const { data, error } = await sb.functions.invoke('create-staff', {
    body: { email, password, branch_id: branchId, role: role || 'operator' }
  });
  if (error) {
    let msg = error.message || 'function_error';
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* ---- Autentifikatsiya (panel.html uchun — xodim login/logout) ----
 * Xodim akkauntlari Supabase dashboard (Authentication → Users) orqali
 * qo'lda yaratiladi — bu yerda o'z-o'ziga ro'yxatdan o'tish yo'q. */
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
export async function signOut() {
  await sb.auth.signOut();
}
export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}
// Sessiya o'zgarsa (login/logout/token yangilanishi) callback chaqiriladi.
export function onAuthChange(callback) {
  const { data } = sb.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}

/* ---- Real-time: talonlar o'zgarsa callback chaqiriladi ----
 * onStatus (ixtiyoriy) — kanal holati ('SUBSCRIBED'/'CHANNEL_ERROR'/...)
 * o'zgarsa chaqiriladi (tarmoq uzilishini bilish uchun, TASKS 4.3). */
export function subscribe(branchId, onChange, onStatus) {
  return sb.channel('tickets-' + branchId)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: 'branch_id=eq.' + branchId },
        onChange)
    .subscribe(onStatus ? (status) => onStatus(status) : undefined);
}
// Xizmatlar/oynalar o'zgarsa (admin.html'da tahrirlansa) panel yangilanishi
// uchun — services jadvaliga alohida obuna.
export function subscribeServices(branchId, onChange) {
  return sb.channel('services-' + branchId)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'services', filter: 'branch_id=eq.' + branchId },
        onChange)
    .subscribe();
}

// Kanalni to'xtatish (filial almashganda eski obunani yopish uchun).
export function unsubscribe(channel) {
  if (channel) { try { sb.removeChannel(channel); } catch (e) {} }
}
