import { envoyerPush, responsablesOrg } from "./push.js";
// FroidPass — réception des signalements de panne envoyés depuis le carnet public (QR)
// Création côté serveur uniquement (clé service_role), avec limite anti-abus, puis alerte e-mail au responsable.
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } });
const clean = (v, n) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n);

async function rest(env, q, method = "GET", body) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + q, {
    method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Base " + r.status);
  return j;
}

export async function signaler(request, env) {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Service indisponible (configuration serveur)" }, 503);
  const b = await request.json().catch(() => ({}));
  const code = clean(b.code, 40), description = clean(b.description, 1000), nom = clean(b.nom, 80), telephone = clean(b.telephone, 30);
  if (!/^[a-z0-9]{6,40}$/i.test(code)) return json({ error: "QR invalide" }, 400);
  if (description.length < 3) return json({ error: "Décrivez le problème en quelques mots" }, 400);

  const eq = (await rest(env, `equipements?code_public=eq.${code}&select=id,technicien_id,emplacement,client_id,criticite`))[0];
  if (!eq) return json({ error: "Équipement introuvable" }, 404);

  // Anti-abus : 5 signalements maximum par équipement et par heure
  const depuis = new Date(Date.now() - 3600e3).toISOString();
  const recents = await rest(env, `signalements?equipement_id=eq.${eq.id}&created_at=gte.${encodeURIComponent(depuis)}&select=id`);
  if (recents.length >= 5) return json({ error: "Ce problème a déjà été signalé, le service est prévenu." }, 429);

  await rest(env, "signalements", "POST", { technicien_id: eq.technicien_id, equipement_id: eq.id, description, nom, telephone });
  // Notification immédiate sur le téléphone des responsables
  await envoyerPush(env, await responsablesOrg(env, eq.technicien_id), { titre: `${eq.criticite === "critique" ? "🚨 URGENT — " : "🚨 "}Panne signalée : ${eq.emplacement}`, corps: description.slice(0, 160), url: "/app#tableau", tag: "signalement-" + eq.id, urgent: eq.criticite === "critique" });

  // Alerte immédiate par e-mail au responsable (si Brevo est configuré)
  try {
    if (env.BREVO_API_KEY && env.EMAIL_EXPEDITEUR) {
      const users = await fetch(env.SUPABASE_URL + "/auth/v1/admin/users/" + eq.technicien_id, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }).then(r => r.json());
      const site = (await rest(env, `clients?id=eq.${eq.client_id}&select=nom`))[0];
      const esc = s => s.replace(/&/g, "&amp;");
      if (users?.email) await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "FroidPass", email: env.EMAIL_EXPEDITEUR }, to: [{ email: users.email }],
          subject: `${eq.criticite === "critique" ? "🚨 URGENT — " : "🚨 "}Panne signalée : ${eq.emplacement} (${site?.nom || ""})`,
          htmlContent: `<div style="font-family:Arial"><h2>Panne signalée</h2><p><b>${esc(eq.emplacement)}</b> — ${esc(site?.nom || "")}${eq.criticite === "critique" ? " — <b style='color:#d64545'>équipement critique</b>" : ""}</p>
            <p style="background:#fff4ec;padding:12px;border-radius:8px">${esc(description)}</p><p>Signalé par : ${esc(nom || "—")} ${esc(telephone)}</p>
            <p><a href="${(env.SITE_URL || "").replace(/\/$/, "")}/app#tableau" style="background:#ff6a3d;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Ouvrir FroidPass</a></p></div>`
        })
      });
    }
  } catch (e) { console.error("Alerte e-mail :", e.message); }
  return json({ ok: true });
}
