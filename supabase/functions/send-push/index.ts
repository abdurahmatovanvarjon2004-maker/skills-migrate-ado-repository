/* ============================================================
 *  NAVBATSIZ — send-push Edge Function (Deno)
 *
 *  Talon o'zgarganda (Supabase Database Webhook: tickets INSERT/UPDATE)
 *  chaqiriladi. Mijozning brauzer obunasiga Web Push yuboradi:
 *    - "navbatingiz yaqinlashdi" (oldida <= NEAR kishi qolganda)
 *    - "chaqirildingiz — <oyna> N ga o'ting" (status=serving bo'lganda)
 *
 *  MUHIM: kiruvchi payload'ga ISHONMAYDI — webhook faqat qaysi FILIAL
 *  o'zgarganini bildiradi; funksiya navbatni service-role bilan O'ZI
 *  qayta o'qiydi. notified_* bayroqlari bir xil xabar ikki marta
 *  ketmasligini kafolatlaydi (webhook har UPDATE'da otiladi).
 *
 *  Deploy:  supabase functions deploy send-push --no-verify-jwt
 *  Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
 *  (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY avtomatik beriladi.)
 * ============================================================ */
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const NEAR = 2; // oldida shuncha (yoki kam) kishi qolganda "yaqinlashdi"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@navbatsiz.uz";
// Push URL'lardagi domen — mijoz sahifasi shu yerda (Netlify domeningiz).
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://navbatsiz.uz";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

type Row = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  try {
    const body = await req.json().catch(() => ({}));
    // Webhook payload'idan faqat FILIAL id'sini olamiz (unga ISHONMAYMIZ,
    // faqat qaysi navbatni tekshirishni bilish uchun).
    const rec = (body.record ?? body.old_record ?? {}) as Row;
    const branchId = rec.branch_id as string | undefined;
    if (!branchId) return json({ skipped: "no_branch" });
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ skipped: "no_vapid" });

    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // Filial (oyna so'zi + slug push matni/URL uchun)
    const { data: branch } = await db.from("branches")
      .select("slug, window_word").eq("id", branchId).maybeSingle();
    const slug = (branch?.slug as string) ?? "";
    const windowWord = (branch?.window_word as string) ?? "Oyna";

    // Filialning faol navbati (tartib: get_queue_public bilan bir xil)
    const { data: tickets } = await db.from("tickets")
      .select("id, tag, status, window_no, priority, created_at, access_token")
      .eq("branch_id", branchId)
      .in("status", ["waiting", "serving"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });
    const list = tickets ?? [];
    const waiting = list.filter((t) => t.status === "waiting");

    // Faqat obunasi bor talonlar
    const ids = list.map((t) => t.id as string);
    if (ids.length === 0) return json({ sent: 0 });
    const { data: subs } = await db.from("push_subscriptions")
      .select("*").in("ticket_id", ids);
    if (!subs || subs.length === 0) return json({ sent: 0 });

    let sent = 0;
    for (const sub of subs) {
      const t = list.find((x) => x.id === sub.ticket_id);
      if (!t) continue;

      let payload: { title: string; body: string; url: string; tag: string } | null = null;
      let patch: Row | null = null;

      if (t.status === "serving" && !sub.notified_called) {
        payload = {
          title: "Navbatingiz keldi!",
          body: `${t.tag} — ${windowWord} ${t.window_no ?? ""} ga o'ting`.trim(),
          url: `${SITE_URL}/mijoz.html?b=${slug}&t=${t.access_token}`,
          tag: `called-${t.id}`,
        };
        patch = { notified_called: true };
      } else if (t.status === "waiting" && !sub.notified_near) {
        const ahead = waiting.findIndex((w) => w.id === t.id);
        if (ahead >= 0 && ahead <= NEAR) {
          payload = {
            title: "Navbatingiz yaqinlashdi",
            body: ahead === 0
              ? `${t.tag} — siz keyingisiz, tayyor turing`
              : `${t.tag} — oldingizda ${ahead} kishi qoldi`,
            url: `${SITE_URL}/mijoz.html?b=${slug}&t=${t.access_token}`,
            tag: `near-${t.id}`,
          };
          patch = { notified_near: true };
        }
      }

      if (!payload) continue;

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        if (patch) await db.from("push_subscriptions").update(patch).eq("id", sub.id);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        // Obuna o'lgan (410 Gone / 404) -> o'chiramiz
        if (code === 404 || code === 410) {
          await db.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
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
