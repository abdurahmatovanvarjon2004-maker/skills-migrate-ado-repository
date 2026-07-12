/* ============================================================
 *  NAVBATSIZ — send-sms Edge Function (Deno)
 *
 *  Talon o'zgarganda (Supabase Database Webhook: tickets INSERT/UPDATE)
 *  chaqiriladi va telefon RAQAMI kiritган mijozlarga Eskiz.uz orqali
 *  SMS yuboradi:
 *    - "navbatingiz yaqinlashdi" (oldida <= NEAR kishi qolganda)
 *    - "chaqirildingiz — <oyna> N ga o'ting" (status=serving bo'lganda)
 *
 *  send-push bilan bir xil xavfsiz uslub: payload'ga ISHONMAYDI — faqat
 *  branch_id'ni olib, navbatni service-role bilan O'ZI qayta o'qiydi.
 *  sms_near_at / sms_called_at (timestamptz) idempotentlikni ta'minlaydi.
 *
 *  Deploy:  supabase functions deploy send-sms --no-verify-jwt
 *  Secrets: ESKIZ_EMAIL + ESKIZ_PASSWORD (yoki ESKIZ_TOKEN), ESKIZ_FROM
 *  (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY avtomatik.)
 * ============================================================ */
import { createClient } from "npm:@supabase/supabase-js@2";

const NEAR = 2;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ESKIZ_BASE = Deno.env.get("ESKIZ_BASE") ?? "https://notify.eskiz.uz";
const ESKIZ_EMAIL = Deno.env.get("ESKIZ_EMAIL") ?? "";
const ESKIZ_PASSWORD = Deno.env.get("ESKIZ_PASSWORD") ?? "";
const ESKIZ_TOKEN_ENV = Deno.env.get("ESKIZ_TOKEN") ?? "";
const ESKIZ_FROM = Deno.env.get("ESKIZ_FROM") ?? "4546"; // Eskiz test-sender

type Row = Record<string, unknown>;

// Eskiz token: secret'da berilgan bo'lsa o'shani, aks holda login qilamiz.
// Iliq (warm) invokatsiyalar orasida keshlaymiz.
let cachedToken = ESKIZ_TOKEN_ENV;
async function eskizToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  if (!ESKIZ_EMAIL || !ESKIZ_PASSWORD) throw new Error("no_eskiz_credentials");
  const form = new FormData();
  form.append("email", ESKIZ_EMAIL);
  form.append("password", ESKIZ_PASSWORD);
  const r = await fetch(`${ESKIZ_BASE}/api/auth/login`, { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
  const token = j?.data?.token;
  if (!token) throw new Error("eskiz_login_failed");
  cachedToken = token;
  return token;
}

async function sendSms(token: string, phone: string, message: string): Promise<boolean> {
  const form = new FormData();
  form.append("mobile_phone", phone);
  form.append("message", message);
  form.append("from", ESKIZ_FROM);
  const r = await fetch(`${ESKIZ_BASE}/api/message/sms/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (r.status === 401) { cachedToken = ""; } // token eskirgan bo'lsa keyingi safar qayta login
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  try {
    const body = await req.json().catch(() => ({}));
    const rec = (body.record ?? body.old_record ?? {}) as Row;
    const branchId = rec.branch_id as string | undefined;
    if (!branchId) return json({ skipped: "no_branch" });
    if (!ESKIZ_TOKEN_ENV && !(ESKIZ_EMAIL && ESKIZ_PASSWORD)) {
      return json({ skipped: "no_eskiz" });
    }

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: branch } = await db.from("branches")
      .select("window_word").eq("id", branchId).maybeSingle();
    const windowWord = (branch?.window_word as string) ?? "Oyna";

    const { data: tickets } = await db.from("tickets")
      .select("id, tag, status, window_no, priority, created_at, phone, sms_near_at, sms_called_at")
      .eq("branch_id", branchId)
      .in("status", ["waiting", "serving"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    const list = tickets ?? [];
    const waiting = list.filter((t) => t.status === "waiting");
    // faqat telefoni bor va hali SMS kutayotgan talonlar
    const targets = list.filter((t) =>
      typeof t.phone === "string" && (t.phone as string).length >= 9 &&
      ((t.status === "serving" && !t.sms_called_at) ||
       (t.status === "waiting" && !t.sms_near_at))
    );
    if (targets.length === 0) return json({ sent: 0 });

    let token: string;
    try { token = await eskizToken(); } catch (e) { return json({ error: String((e as Error).message) }, 500); }

    let sent = 0;
    for (const t of targets) {
      let message: string | null = null;
      let patch: Row | null = null;

      if (t.status === "serving") {
        message = `Navbatsiz: navbatingiz keldi! ${t.tag} — ${windowWord} ${t.window_no ?? ""} ga o'ting.`.trim();
        patch = { sms_called_at: new Date().toISOString() };
      } else {
        const ahead = waiting.findIndex((w) => w.id === t.id);
        if (ahead >= 0 && ahead <= NEAR) {
          message = ahead === 0
            ? `Navbatsiz: navbatingiz yaqinlashdi! ${t.tag} — siz keyingisiz, tayyor turing.`
            : `Navbatsiz: navbatingiz yaqinlashdi! ${t.tag} — oldingizda ${ahead} kishi qoldi.`;
          patch = { sms_near_at: new Date().toISOString() };
        }
      }
      if (!message) continue;

      try {
        const ok = await sendSms(token, t.phone as string, message);
        if (ok && patch) {
          await db.from("tickets").update(patch).eq("id", t.id);
          sent++;
        }
      } catch (_e) { /* keyingi webhook'da qayta urinadi */ }
    }

    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
