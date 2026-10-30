// FroidPass — envoi du rapport mensuel d'un site au client par e-mail (réservé au responsable / directeur)
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } });
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
import { periode } from "./public/periodes.js";

// Appel PostgREST, soit avec le jeton de l'utilisateur (RLS appliquée), soit avec la clé service_role
async function pg(env, path, { token, method = "GET", body } = {}) {
  const key = token ? null : env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method, headers: { apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + (token || key), "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Base " + r.status + (j?.message ? " : " + j.message : ""));
  return j;
}

export async function envoyerRapport(request, env) {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Service indisponible (configuration serveur)" }, 503);
  if (!env.BREVO_API_KEY || !env.EMAIL_EXPEDITEUR) return json({ error: "L'envoi d'e-mails n'est pas encore configuré (Brevo). Utilisez WhatsApp ou copiez le lien." }, 503);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Connexion requise" }, 401);
  const user = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token } }).then(r => r.ok ? r.json() : null);
  if (!user?.id) return json({ error: "Session expirée, reconnectez-vous" }, 401);

  const b = await request.json().catch(() => ({}));
  const mois = String(b.mois || ""), clientId = String(b.client_id || "");
  const P = periode(mois);
  if (!P) return json({ error: "Période invalide" }, 400);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Client invalide" }, 400);

  // Droits : l'utilisateur doit être responsable/directeur de l'organisation qui possède ce client
  const admin = await pg(env, "rpc/est_admin", { token, method: "POST", body: {} });
  if (admin !== true) return json({ error: "Seul le responsable ou le directeur peut envoyer le rapport au client" }, 403);
  const c = (await pg(env, `clients?id=eq.${clientId}&select=id,nom,contact,email,code_rapport,technicien_id`, { token }))[0];
  if (!c) return json({ error: "Client introuvable" }, 404);
  const dest = String(b.email || c.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) return json({ error: "Ajoutez l'adresse e-mail du client (bouton Modifier dans Clients)" }, 400);

  const me = (await pg(env, `techniciens?id=eq.${user.id}&select=nom`))[0];
  const site = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const res = await envoyerEmailRapport(env, { c, mois, dest, signataire: me?.nom, replyTo: user.email, site });
  if (res.erreur) return json({ error: res.erreur }, res.statut || 502);
  await pg(env, "rapports_envoyes", { method: "POST", body: { technicien_id: c.technicien_id, client_id: c.id, mois, canal: "email", destinataire: dest, envoye_par: user.id, envoye_par_nom: me?.nom || "" } });
  return json({ ok: true, destinataire: dest });
}

// Construit et envoie l'e-mail du rapport (utilisé par l'envoi manuel et par l'envoi automatique quotidien)
export async function envoyerEmailRapport(env, { c, mois, dest, signataire, replyTo, site }) {
  const P = periode(mois);
  const r = await pg(env, "rpc/get_rapport", { method: "POST", body: { p_code: c.code_rapport, p_mois: mois } });
  if (!r) return { erreur: "Rapport introuvable", statut: 404 };
  const pr = r.prestataire || {}, libelle = P.lib;
  const ints = r.interventions || [], prev = ints.filter(i => i.type === "preventif").length;
  const nbPhotos = ints.reduce((n, i) => n + (Array.isArray(i.photos) ? i.photos.length : 0), 0);
  const lien = `${site}/r?c=${c.code_rapport}&m=${mois}`;
  const expediteur = pr.entreprise || pr.nom || "Votre service maintenance";
  const kpi = (v, l) => `<td style="border:1px solid #e3e8ec;border-radius:8px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:800">${v}</div><div style="font-size:12px;color:#5b6b75">${l}</div></td>`;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: expediteur.slice(0, 70), email: env.EMAIL_EXPEDITEUR }, to: [{ email: dest, name: c.contact || c.nom }],
      ...(replyTo ? { replyTo: { email: replyTo, name: signataire || expediteur } } : {}),
      subject: `${P.titre} — ${libelle} — ${c.nom}`,
      htmlContent: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#0b2230">
        <h2 style="margin-bottom:4px">${esc(P.titre)} — ${esc(libelle)}</h2><p style="margin-top:0;color:#5b6b75">${esc(c.nom)}</p>
        <p>Bonjour ${esc(c.contact || "")},</p><p>Veuillez trouver ci-dessous la synthèse de la maintenance de vos équipements pour la période : ${esc(libelle)}.</p>
        <table style="width:100%;border-collapse:separate;border-spacing:6px"><tr>${kpi((r.equipements || []).length, "équipements suivis")}${kpi(ints.length, "interventions")}${kpi(prev, "préventives")}${kpi(r.signalements, "pannes signalées")}</tr></table>
        <p style="text-align:center;margin:22px 0"><a href="${lien}" style="background:#ff6a3d;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Consulter le rapport complet</a></p>
        ${nbPhotos ? `<p style="font-size:14px">📷 ${nbPhotos} photo(s) des pièces défectueuses et remplacées sont incluses dans le rapport.</p>` : ""}
        <p style="font-size:13px;color:#5b6b75">Le rapport détaillé (interventions, mesures, photos, état du parc, prochains entretiens) peut être imprimé ou enregistré en PDF depuis ce lien.</p>
        <p>Cordialement,<br><b>${esc(signataire || pr.nom)}</b><br>${esc(expediteur)} ${esc(pr.whatsapp || "")}</p>
        <p style="font-size:11px;color:#9aa7ae">Envoyé avec FroidPass</p></div>`
    })
  });
  if (!res.ok) return { erreur: "Échec de l'envoi de l'e-mail (" + res.status + ")", statut: 502 };
  return { ok: true };
}
