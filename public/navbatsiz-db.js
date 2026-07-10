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

// Mijoz o'z taloni (ism bilan) — faqat access_token orqali, login'siz.
export async function getTicketByToken(token) {
  if (!token) return null;
  const { data, error } = await sb.rpc('get_ticket_by_token', { p_token: token });
  if (error) throw error;
  return mapTicket(firstRow(data));
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
// Talon olish (mijoz yoki panel qo'lda). Natija: yangi talon (token bilan).
export async function takeTicket(serviceId, name) {
  const { data, error } = await sb.rpc('take_ticket', { p_service: serviceId, p_name: name || '' });
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
// Kanalni to'xtatish (filial almashganda eski obunani yopish uchun).
export function unsubscribe(channel) {
  if (channel) { try { sb.removeChannel(channel); } catch (e) {} }
}
