// FroidPass — Prévenir automatiquement les techniciens quand le responsable / directeur leur affecte des tâches
//   • e-mail (Brevo)                         : BREVO_API_KEY + EMAIL_EXPEDITEUR
//   • WhatsApp (API officielle WhatsApp Cloud) : WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (+ WHATSAPP_TEMPLATE, WHATSAPP_API_VERSION facultatifs)
//     Modèle de message Meta à faire approuver (catégorie « Utilitaire », langue fr) — voir GUIDE-WHATSAPP.md
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } });
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const PRIO = { basse: "Basse", normale: "Normale", haute: "Haute", urgente: "URGENTE" };
const fr = d => d ? String(d).slice(0, 10).split("-").reverse().join("/") : "à définir";

async function pg(env, path, { token, method = "GET", body } = {}) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + (token || env.SUPABASE_SERVICE_ROLE_KEY), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Base " + r.status + (j?.message ? " : " + j.message : ""));
  return j;
}

export async function notifierTaches(request, env) {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ envoyes: 0, raison: "configuration" });
  const mailOK = !!(env.BREVO_API_KEY && env.EMAIL_EXPEDITEUR), waOK = !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);
  if (!mailOK && !waOK) return json({ email: 0, whatsapp: 0, whatsapp_auto: false, email_auto: false });
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const user = token && await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token } }).then(r => r.ok ? r.json() : null);
  if (!user?.id) return json({ error: "Session expirée, reconnectez-vous" }, 401);
  if (await pg(env, "rpc/est_admin", { token, method: "POST", body: {} }) !== true) return json({ error: "Réservé au responsable ou au directeur" }, 403);

  const b = await request.json().catch(() => ({}));
  const ids = (Array.isArray(b.ot_ids) ? b.ot_ids : []).filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100);
  if (!ids.length) return json({ email: 0, whatsapp: 0, whatsapp_auto: waOK, email_auto: mailOK });
  // Lecture avec le jeton du responsable : la RLS limite aux OT de son organisation
  const ots = await pg(env, `ordres_travail?id=in.(${ids.join(",")})&assigne_a=not.is.null&select=id,numero,titre,description,type,priorite,date_prevue,assigne_a,clients(nom),equipements(emplacement,zone)`, { token });
  const chef = (await pg(env, `techniciens?id=eq.${user.id}&select=nom,entreprise`))[0] || {};
  const base = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const parTech = {};
  for (const o of ots) (parTech[o.assigne_a] ||= []).push(o);

  let email = 0, whatsapp = 0; const echecs = [];
  for (const [uid, liste] of Object.entries(parTech)) {
    if (uid === user.id) continue; // pas de notification à soi-même
    const m = (await pg(env, `membres?user_id=eq.${uid}&select=nom,telephone`))[0] || {};
    // ---- WhatsApp automatique (si l'API WhatsApp Cloud est configurée) ----
    if (waOK) {
      try { if (await envoyerWhatsApp(env, m, liste, chef, base)) whatsapp++; else echecs.push(`WhatsApp ${m.nom || ""} : numéro manquant`); }
      catch (e) { echecs.push(`WhatsApp ${m.nom || ""} : ${e.message}`); }
    }
    if (!mailOK) continue;
    const u = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }).then(r => r.ok ? r.json() : null);
    if (!u?.email) continue;
    const urgent = liste.some(o => o.priorite === "urgente");
    const lignes = liste.map(o => `<tr><td style="padding:8px;border-bottom:1px solid #e3e8ec"><b>OT-${String(o.numero).padStart(4, "0")}</b> · ${esc(o.titre)}${o.priorite === "urgente" || o.priorite === "haute" ? ` <b style="color:#d64545">(${PRIO[o.priorite]})</b>` : ""}<br><span style="color:#5b6b75;font-size:13px">${esc(o.clients?.nom || "Tâche générale")}${o.equipements ? " · " + esc(o.equipements.emplacement) : ""} · échéance ${fr(o.date_prevue)}</span>${o.description ? `<br><span style="font-size:13px">${esc(o.description).slice(0, 300)}</span>` : ""}</td><td style="padding:8px;border-bottom:1px solid #e3e8ec;text-align:right"><a href="${base}/app#ot-${o.id}" style="color:#ff6a3d">Ouvrir</a></td></tr>`).join("");
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "FroidPass", email: env.EMAIL_EXPEDITEUR }, to: [{ email: u.email, name: m.nom || "" }],
        ...(user.email ? { replyTo: { email: user.email, name: chef.nom || "Responsable" } } : {}),
        subject: `${urgent ? "🚨 URGENT — " : ""}${liste.length} nouvelle${liste.length > 1 ? "s" : ""} tâche${liste.length > 1 ? "s" : ""} assignée${liste.length > 1 ? "s" : ""} par ${chef.nom || "votre responsable"}`,
        htmlContent: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#0b2230"><h2>Bonjour ${esc((m.nom || "").split(" ")[0])},</h2>
          <p>${esc(chef.nom || "Votre responsable")}${chef.entreprise ? " (" + esc(chef.entreprise) + ")" : ""} vous a assigné ${liste.length > 1 ? "les tâches suivantes" : "la tâche suivante"} :</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">${lignes}</table>
          <p style="margin:22px 0"><a href="${base}/app#tableau" style="background:#ff6a3d;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Ouvrir mon espace</a></p>
          <p style="font-size:13px;color:#5b6b75">Ouvrez chaque tâche pour confirmer que vous l'avez vue. Avant toute intervention : consignation (NF C 18-510) et EPI.</p></div>`
      })
    });
    if (r.ok) email++; else echecs.push(`E-mail ${m.nom || ""} : ${r.status}`);
  }
  return json({ email, whatsapp, email_auto: mailOK, whatsapp_auto: waOK, echecs });
}

// Numéro international sans « + » (Bénin : 229 + 10 chiffres commençant par 01)
export function numeroWA(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^01\d{8}$/.test(d)) d = "229" + d;          // 01 XX XX XX XX → +229
  else if (/^\d{8}$/.test(d)) d = "22901" + d;     // ancien format à 8 chiffres
  return d.length >= 10 ? d : null;
}
// Texte d'un paramètre de modèle WhatsApp : pas de retour à la ligne ni de tabulation, 4 espaces max
const param = t => String(t ?? "").replace(/[\n\r\t]+/g, " ").replace(/ {4,}/g, " ").trim().slice(0, 900) || "-";

async function envoyerWhatsApp(env, m, liste, chef, base) {
  const to = numeroWA(m.telephone); if (!to) return false;
  const tri = [...liste].sort((a, b) => String(a.date_prevue || "9").localeCompare(String(b.date_prevue || "9")));
  const resume = tri.slice(0, 5).map(o => `OT-${String(o.numero).padStart(4, "0")} ${o.titre}${o.clients?.nom ? " (" + o.clients.nom + ")" : ""}${o.priorite === "urgente" ? " URGENT" : ""}`).join(" ; ") + (liste.length > 5 ? ` ; et ${liste.length - 5} autre(s)` : "");
  const r = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION || "v23.0"}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST", headers: { Authorization: "Bearer " + env.WHATSAPP_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: { name: env.WHATSAPP_TEMPLATE || "nouvelle_tache", language: { code: "fr" }, components: [{ type: "body", parameters: [
        { type: "text", text: param((m.nom || "").split(" ")[0] || "technicien") },   // {{1}} prénom
        { type: "text", text: param(chef.nom || "Votre responsable") },              // {{2}} responsable
        { type: "text", text: param(String(liste.length)) },                         // {{3}} nombre de tâches
        { type: "text", text: param(resume) },                                       // {{4}} liste
        { type: "text", text: param(tri[0]?.date_prevue ? tri[0].date_prevue.split("-").reverse().join("/") : "à définir") }, // {{5}} 1re échéance
        { type: "text", text: param(base + "/app#tableau") }                         // {{6}} lien
      ] }] }
    })
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error?.message || "erreur " + r.status); }
  return true;
}
