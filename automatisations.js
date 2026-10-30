// =====================================================================
// FroidPass — automatisations quotidiennes (Cloudflare Cron, chaque matin 7 h, heure du Bénin)
//
//  1. Rapport quotidien au fondateur (Telegram, ou e-mail en secours)
//  2. E-mails automatiques aux techniciens :
//     - bienvenue (inscrit depuis moins de 24 h)
//     - inactif (inscrit depuis 3 jours, aucun équipement)
//     - abonnement qui expire dans 7 jours, puis 1 jour
//     - abonnement expiré (la veille)
//     - chaque lundi : liste des entretiens à faire dans les 7 jours
//  Chaque e-mail n'est envoyé qu'une fois (table notifications_envoyees).
//
// Variables (Cloudflare > Worker > Paramètres > Variables et secrets) :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL           (obligatoires)
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID                          (rapport sur Telegram)
//   BREVO_API_KEY, EMAIL_EXPEDITEUR                               (e-mails aux techniciens)
//   ADMIN_EMAIL                                                   (rapport par e-mail si pas de Telegram)
//   ADMIN_KEY                                                     (déclenchement manuel : /api/automatisations?key=...)
// =====================================================================

const DAY = 864e5;
const FREQ = { split: [60, 90], cassette: [60, 90], groupe: [60, 90], chambre: [30, 30], vitrine: [60, 90] };
const TYPE_LABEL = { split: "Split", cassette: "Cassette / gainable", groupe: "Groupe extérieur", chambre: "Chambre froide", vitrine: "Vitrine réfrigérée" };
const isoDay = t => new Date(t).toISOString().slice(0, 10);
const fr = s => s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—";
const fcfa = n => Number(n || 0).toLocaleString("fr-FR").replace(/ | /g, " ") + " FCFA";
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

async function sb(env, path, method = "GET", body, prefer = "return=representation") {
  const r = await fetch(env.SUPABASE_URL + path, {
    method,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Supabase ${r.status} ${path} : ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}
const rest = (env, q, ...a) => sb(env, "/rest/v1/" + q, ...a);

async function loadData(env) {
  const [techs, eqs, ints, pays, users] = await Promise.all([
    rest(env, "techniciens?select=*"),
    rest(env, "equipements?select=id,technicien_id,client_id,emplacement,type,environnement,date_pose,created_at"),
    rest(env, "interventions?select=equipement_id,date,type,created_at"),
    rest(env, "paiements?select=*"),
    sb(env, "/auth/v1/admin/users?per_page=1000")
  ]);
  const emails = {};
  for (const u of users.users || []) emails[u.id] = { email: u.email, created_at: u.created_at };
  let clients = [];
  try { clients = await rest(env, "clients?select=id,nom"); } catch {}
  return { techs, eqs, ints, pays, emails, clients };
}

function nextDue(e, ints) {
  const last = ints.filter(i => i.equipement_id === e.id && i.type === "preventif").sort((a, b) => b.date.localeCompare(a.date))[0];
  const f = FREQ[e.type]?.[e.environnement === "cotier" ? 0 : 1] || 90;
  return Date.parse(last ? last.date : e.date_pose) + f * DAY;
}

// ---------------- Envois ----------------
async function telegram(env, html) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: html, parse_mode: "HTML", disable_web_page_preview: true })
  });
  if (!r.ok) throw new Error("Telegram " + r.status + " " + (await r.text()).slice(0, 160));
  return true;
}

async function email(env, to, subject, html) {
  if (!env.BREVO_API_KEY || !env.EMAIL_EXPEDITEUR || !to) return false;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "FroidPass", email: env.EMAIL_EXPEDITEUR }, to: [{ email: to }], subject, htmlContent: html })
  });
  if (!r.ok) throw new Error("Brevo " + r.status + " " + (await r.text()).slice(0, 160));
  return true;
}

function gabarit(env, titre, corps, bouton, lien) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0b2230">
  <div style="background:#0b2230;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-size:20px;font-weight:bold">✳ FroidPass</div>
  <div style="border:1px solid #cfe2e6;border-top:0;padding:22px;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 12px;font-size:20px">${titre}</h2>${corps}
    ${bouton ? `<p style="margin:22px 0"><a href="${lien}" style="background:#ff6a3d;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${bouton}</a></p>` : ""}
    <p style="color:#7a929e;font-size:13px;margin-top:24px">Une question ? Répondez sur WhatsApp : +229 01 62 77 79 77</p>
  </div></div>`;
}

// Envoie un message une seule fois (clé unique technicien + type + ref)
async function once(env, technicien_id, type, ref, send) {
  const deja = await rest(env, `notifications_envoyees?technicien_id=eq.${technicien_id}&type=eq.${type}&ref=eq.${encodeURIComponent(ref)}&select=id`);
  if (deja.length) return false;
  const ok = await send();
  if (ok) await rest(env, "notifications_envoyees", "POST", { technicien_id, type, ref }, "return=minimal");
  return ok;
}

// ---------------- Programme principal ----------------
export async function runAutomatisations(env, { dryRun = false } = {}) {
  const now = Date.now();
  const _d = new Date(now + 3600e3); // heure du Bénin (UTC+1)
  const today = Date.UTC(_d.getUTCFullYear(), _d.getUTCMonth(), _d.getUTCDate());
  const isMonday = _d.getUTCDay() === 1;
  const SITE = (env.SITE_URL || "").replace(/\/$/, "");
  const APP = SITE + "/app";
  const { techs, eqs, ints, pays, emails } = await loadData(env);
  const log = { emails: [], erreurs: [] };

  const actifs = techs.filter(t => t.offre !== "decouverte" && t.fin_abonnement && Date.parse(t.fin_abonnement) >= today);
  const send = async (t, type, ref, subject, html) => {
    const to = emails[t.id]?.email;
    if (dryRun) { log.emails.push(`${type} → ${to}`); return; }
    try { if (await once(env, t.id, type, ref, () => email(env, to, subject, html))) log.emails.push(`${type} → ${to}`); }
    catch (e) { log.erreurs.push(`${type} ${to} : ${e.message}`); }
  };

  for (const t of techs) {
    const prenom = esc((t.nom || "").split(" ")[0] || "");
    const created = Date.parse(t.created_at);
    const mesEqs = eqs.filter(e => e.technicien_id === t.id);

    // Bienvenue
    if (now - created < DAY)
      await send(t, "bienvenue", "1", "Bienvenue sur FroidPass ❄️", gabarit(env, `Bienvenue ${prenom} !`,
        `<p>Votre compte FroidPass est prêt. Pour bien démarrer, 3 étapes de 5 minutes :</p>
         <ol><li>Complétez votre <b>profil</b> (nom, entreprise, WhatsApp) : il apparaît sur vos carnets.</li>
         <li>Ajoutez un <b>client</b>, puis un <b>équipement</b> : le QR code est prêt.</li>
         <li>Collez l'étiquette et enregistrez votre prochaine intervention.</li></ol>
         <p>Votre offre gratuite inclut 10 équipements.</p>`, "Ouvrir FroidPass", APP));

    // Inactif après 3 jours
    if (now - created > 3 * DAY && now - created < 10 * DAY && mesEqs.length === 0)
      await send(t, "inactif", "j3", "Votre premier QR FroidPass en 5 minutes", gabarit(env, `${prenom}, il vous manque juste le premier équipement`,
        `<p>Vous n'avez encore enregistré aucun équipement. Choisissez votre meilleur client et créez sa première fiche : vous aurez un QR à coller dès votre prochaine visite.</p>
         <p>C'est ce carnet qui vous permettra de lui proposer un <b>contrat d'entretien annuel</b>.</p>`, "Créer mon premier équipement", APP + "#parc"));

    // Expiration
    if (t.offre !== "decouverte" && t.fin_abonnement) {
      const fin = Date.parse(t.fin_abonnement), jours = Math.round((fin - today) / DAY);
      if (jours === 7 || jours === 1)
        await send(t, "expire_j" + jours, t.fin_abonnement, `Votre abonnement FroidPass se termine dans ${jours} jour${jours > 1 ? "s" : ""}`,
          gabarit(env, `Votre abonnement se termine le ${fr(t.fin_abonnement)}`,
          `<p>Renouvelez par Mobile Money pour garder vos rappels clients, vos certificats et vos équipements au-delà de 10.</p>
           ${t.fondateur ? "<p>En tant que <b>membre fondateur</b>, votre prix reste bloqué à 10 000 FCFA/mois.</p>" : ""}
           <p>Astuce : l'abonnement annuel = 10 mois payés pour 12.</p>`, "Renouveler", APP + "#abonnement"));
      if (jours === -1)
        await send(t, "expire", t.fin_abonnement, "Votre abonnement FroidPass a expiré", gabarit(env, "Votre abonnement a expiré",
          `<p>Vos données sont conservées, mais les rappels clients et les certificats sont suspendus. Réactivez en 1 minute par Mobile Money.</p>`, "Réactiver", APP + "#abonnement"));
    }

    // Lundi : entretiens de la semaine
    if (isMonday && mesEqs.length) {
      const dus = mesEqs.map(e => ({ e, due: nextDue(e, ints) })).filter(x => x.due < today + 8 * DAY).sort((a, b) => a.due - b.due);
      if (dus.length) {
        const lignes = dus.slice(0, 25).map(({ e, due }) => `<tr><td style="padding:6px;border-bottom:1px solid #e3eef0">${esc(e.emplacement)}</td><td style="padding:6px;border-bottom:1px solid #e3eef0">${TYPE_LABEL[e.type] || e.type}</td><td style="padding:6px;border-bottom:1px solid #e3eef0;color:${due < today ? "#d64545" : "#0b2230"}">${due < today ? "En retard" : fr(isoDay(due))}</td></tr>`).join("");
        await send(t, "hebdo", isoDay(today), `${dus.length} entretien(s) à faire cette semaine`, gabarit(env, `Votre semaine : ${dus.length} entretien(s)`,
          `<p>Voici les équipements à entretenir d'ici 7 jours. Envoyez les rappels à vos clients depuis FroidPass en un clic.</p>
           <table style="width:100%;border-collapse:collapse;font-size:14px">${lignes}</table>`, "Envoyer mes rappels", APP));
      }
    }
  }

  // ---------- Rapport au fondateur ----------
  const h24 = now - DAY;
  const nouveaux = techs.filter(t => Date.parse(t.created_at) > h24);
  const payes24 = pays.filter(p => p.statut === "approuve" && Date.parse(p.created_at) > h24);
  const debutMois = Date.UTC(_d.getUTCFullYear(), _d.getUTCMonth(), 1);
  const payesMois = pays.filter(p => p.statut === "approuve" && Date.parse(p.created_at) >= debutMois);
  const expirent = actifs.filter(t => Date.parse(t.fin_abonnement) - today <= 7 * DAY);
  const ints24 = ints.filter(i => Date.parse(i.created_at) > h24).length;
  const actifsSemaine = new Set(eqs.filter(e => Date.parse(e.created_at) > now - 7 * DAY).map(e => e.technicien_id)).size;

  const rapport = [
    `<b>☀️ FroidPass — rapport du ${fr(isoDay(today))}</b>`,
    ``,
    `👥 <b>${techs.length}</b> techniciens inscrits (<b>+${nouveaux.length}</b> en 24 h)`,
    nouveaux.length ? nouveaux.map(t => `   • ${esc(t.nom || "?")} — ${esc(t.ville || "")} — ${esc(t.whatsapp || "")}`).join("\n") : null,
    `💳 <b>${actifs.length}</b> abonnés payants actifs (dont ${actifs.filter(t => t.fondateur).length} fondateurs)`,
    `💰 Encaissé 24 h : <b>${fcfa(payes24.reduce((s, p) => s + p.montant, 0))}</b> (${payes24.length} paiement(s))`,
    `📅 Encaissé ce mois : <b>${fcfa(payesMois.reduce((s, p) => s + p.montant, 0))}</b>`,
    `⏳ Expirent sous 7 j : <b>${expirent.length}</b>${expirent.length ? " — " + expirent.map(t => esc(t.nom)).join(", ") : ""}`,
    `🧊 ${eqs.length} équipements · ${ints24} intervention(s) en 24 h · ${actifsSemaine} technicien(s) actifs cette semaine`,
    `✉️ E-mails envoyés aujourd'hui : ${log.emails.length}${!env.BREVO_API_KEY ? " (e-mails non configurés)" : ""}`,
    log.erreurs.length ? `⚠️ Erreurs : ${log.erreurs.length}\n${log.erreurs.slice(0, 5).map(esc).join("\n")}` : null
  ].filter(l => l !== null).join("\n");

  if (!dryRun) {
    try {
      const viaTg = await telegram(env, rapport);
      if (!viaTg && env.ADMIN_EMAIL) await email(env, env.ADMIN_EMAIL, `FroidPass — rapport du ${fr(isoDay(today))}`, `<pre style="font-family:Arial;font-size:14px;white-space:pre-wrap">${rapport}</pre>`);
    } catch (e) { log.erreurs.push("rapport : " + e.message); }
  }
  return { rapport, ...log };
}
