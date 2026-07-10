/* ============================================================
 *  NAVBATSIZ — create-staff Edge Function (Deno)
 *
 *  Admin UI'dan xodimga email+parol akkaunt yaratish va filialga
 *  biriktirish. anon key bilan frontend'dan buni qilib bo'lmaydi —
 *  auth.admin API service_role kalitini talab qiladi, u esa faqat
 *  server tarafda (shu funksiyada) xavfsiz.
 *
 *  Ruxsat: chaqiruvchi (JWT) platforma admini YOKI maqsad filialning
 *  'admin' xodimi bo'lishi shart — db/schema.sql'dagi model bilan bir xil.
 *
 *  Deploy:  supabase functions deploy create-staff
 *  (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY muhitga avtomatik beriladi.)
 * ============================================================ */
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  try {
    // 1) Chaqiruvchini aniqlash (JWT majburiy)
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonRes({ error: "no_auth" }, 401);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: caller, error: uErr } = await service.auth.getUser(jwt);
    if (uErr || !caller?.user) return jsonRes({ error: "no_auth" }, 401);
    const uid = caller.user.id;

    // 2) Kiruvchi ma'lumot
    const { email, password, branch_id, role } = await req.json();
    if (!email || !password || !branch_id) return jsonRes({ error: "missing_fields" }, 400);
    if (String(password).length < 8) return jsonRes({ error: "weak_password" }, 400);
    const staffRole = role === "admin" ? "admin" : "operator";

    // 3) Ruxsat: platforma admini YOKI shu filialning 'admin'i
    const { data: pa } = await service
      .from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle();
    let allowed = !!pa;
    if (!allowed) {
      const { data: st } = await service
        .from("staff").select("branch_id, role").eq("user_id", uid).maybeSingle();
      allowed = !!st && st.branch_id === branch_id && st.role === "admin";
    }
    if (!allowed) return jsonRes({ error: "not_authorized" }, 403);

    // 4) Akkaunt yaratish + filialga biriktirish
    const { data: created, error: cErr } = await service.auth.admin.createUser({
      email: String(email).trim(),
      password: String(password),
      email_confirm: true,
    });
    if (cErr) {
      const msg = /already|registered|exists/i.test(cErr.message) ? "email_exists" : cErr.message;
      return jsonRes({ error: msg }, 400);
    }

    const { error: sErr } = await service.from("staff").upsert(
      { user_id: created.user.id, branch_id, role: staffRole },
      { onConflict: "user_id" },
    );
    if (sErr) return jsonRes({ error: sErr.message }, 400);

    return jsonRes({ user_id: created.user.id, role: staffRole });
  } catch (e) {
    return jsonRes({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
