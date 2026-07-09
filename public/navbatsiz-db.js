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

// Qaysi muassasa (branch) slug bilan ishlayapmiz:
const BRANCH_SLUG = 'shifo-klinika';

/* ---- Quyisini o'zgartirish shart emas ---- */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 5 } }
});

// Branch + services ni bir marta yuklab olamiz
export async function loadBranch() {
  const { data: branch, error } = await sb
    .from('branches').select('*').eq('slug', BRANCH_SLUG).single();
  if (error) throw error;
  const { data: services } = await sb
    .from('services').select('*').eq('branch_id', branch.id).order('sort');
  return { branch, services: services || [] };
}

// Barcha faol talonlarni olish (waiting + serving)
export async function loadTickets(branchId) {
  const { data } = await sb.from('tickets')
    .select('*').eq('branch_id', branchId)
    .in('status', ['waiting', 'serving'])
    .order('created_at', { ascending: true });
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

/* ---- Amallar (RPC) ---- */
export const takeTicket   = (serviceId, name) => sb.rpc('take_ticket',   { p_service: serviceId, p_name: name || '' });
export const callNext     = (branchId, win)   => sb.rpc('call_next',     { p_branch: branchId, p_window: win });
export const callTicket   = (ticketId, win)   => sb.rpc('call_ticket',   { p_ticket: ticketId, p_window: win });
export const finishTicket = (ticketId)        => sb.rpc('finish_ticket', { p_ticket: ticketId });
export const cancelTicket = (ticketId)        => sb.rpc('cancel_ticket', { p_ticket: ticketId });

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

/* ---- Real-time: talonlar o'zgarsa callback chaqiriladi ---- */
export function subscribe(branchId, onChange) {
  return sb.channel('tickets-' + branchId)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: 'branch_id=eq.' + branchId },
        onChange)
    .subscribe();
}
