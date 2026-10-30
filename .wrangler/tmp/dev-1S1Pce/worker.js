var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// functions/api/[[route]].js
var PLANS = {
  fondateur: { offre: "solo", montant: 15e3, jours: 90, fondateur: true, nom: "Membre fondateur (3 mois Solo)" },
  solo_mensuel: { offre: "solo", montant: 1e4, jours: 30, nom: "Solo 1 mois" },
  solo_annuel: { offre: "solo", montant: 1e5, jours: 365, nom: "Solo 12 mois" },
  pro_mensuel: { offre: "pro", montant: 2e4, jours: 30, nom: "Pro 1 mois" },
  pro_annuel: { offre: "pro", montant: 2e5, jours: 365, nom: "Pro 12 mois" },
  equipe_mensuel: { offre: "equipe", montant: 4e4, jours: 30, nom: "\xC9quipe 1 mois" }
};
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }), "json");
var fedaBase = /* @__PURE__ */ __name((env) => env.FEDAPAY_ENV === "live" ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1", "fedaBase");
var unwrap = /* @__PURE__ */ __name((j) => j?.["v1/transaction"] || j?.transaction || j, "unwrap");
async function feda(env, path, method = "GET", body) {
  const r = await fetch(fedaBase(env) + path, {
    method,
    headers: { Authorization: "Bearer " + env.FEDAPAY_SECRET_KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : void 0
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("FedaPay " + r.status + " : " + (j.message || JSON.stringify(j).slice(0, 200)));
  return j;
}
__name(feda, "feda");
async function db(env, path, method = "GET", body, extra = {}) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extra
    },
    body: body ? JSON.stringify(body) : void 0
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Base de donn\xE9es " + r.status + " : " + JSON.stringify(j).slice(0, 200));
  return j;
}
__name(db, "db");
async function currentUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: auth } });
  return r.ok ? r.json() : null;
}
__name(currentUser, "currentUser");
async function settle(env, fedapayId) {
  const rows = await db(env, `paiements?fedapay_id=eq.${Number(fedapayId)}&select=*`);
  const p = rows?.[0];
  if (!p) return { statut: "inconnu" };
  if (p.statut === "approuve") return { statut: "approuve" };
  const tx = unwrap(await feda(env, `/transactions/${Number(fedapayId)}`));
  if (tx.status === "approved") {
    if (Number(tx.amount) !== Number(p.montant)) throw new Error("Montant incoh\xE9rent");
    const upd = await db(env, `paiements?id=eq.${p.id}&statut=eq.en_attente`, "PATCH", { statut: "approuve" });
    if (!upd?.length) return { statut: "approuve" };
    const plan = PLANS[p.plan];
    const t = (await db(env, `techniciens?id=eq.${p.technicien_id}&select=*`))[0];
    const today = /* @__PURE__ */ new Date();
    today.setUTCHours(0, 0, 0, 0);
    const base = t.fin_abonnement && new Date(t.fin_abonnement) > today && t.offre === plan.offre ? new Date(t.fin_abonnement) : today;
    const fin = new Date(base.getTime() + plan.jours * 864e5).toISOString().slice(0, 10);
    const patch = { offre: plan.offre, fin_abonnement: fin };
    if (plan.fondateur) patch.fondateur = true;
    await db(env, `techniciens?id=eq.${p.technicien_id}`, "PATCH", patch);
    return { statut: "approuve", fin_abonnement: fin };
  }
  if (["declined", "canceled", "refunded"].includes(tx.status)) {
    await db(env, `paiements?id=eq.${p.id}&statut=eq.en_attente`, "PATCH", { statut: "echoue" });
    return { statut: "echoue" };
  }
  return { statut: "en_attente" };
}
__name(settle, "settle");
async function onRequest({ request, env, params }) {
  const route = (params.route || []).join("/");
  try {
    for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FEDAPAY_SECRET_KEY", "SITE_URL"])
      if (!env[k]) return json({ error: `Variable ${k} manquante c\xF4t\xE9 serveur` }, 500);
    if (route === "pay" && request.method === "POST") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Connexion requise" }, 401);
      const { plan } = await request.json().catch(() => ({}));
      const P = PLANS[plan];
      if (!P) return json({ error: "Offre inconnue" }, 400);
      const tech = (await db(env, `techniciens?id=eq.${user.id}&select=*`))[0];
      if (plan === "fondateur" && tech?.fondateur) return json({ error: "Offre fondateur d\xE9j\xE0 utilis\xE9e" }, 400);
      const nom = (tech?.nom || "Technicien").trim().split(/\s+/);
      const tx = unwrap(await feda(env, "/transactions", "POST", {
        description: `FroidPass \u2014 ${P.nom}`,
        amount: P.montant,
        currency: { iso: "XOF" },
        callback_url: env.SITE_URL.replace(/\/$/, "") + "/app.html",
        customer: { firstname: nom[0], lastname: nom.slice(1).join(" ") || nom[0], email: user.email }
      }));
      await db(env, "paiements", "POST", { technicien_id: user.id, fedapay_id: tx.id, plan, montant: P.montant });
      const tok = await feda(env, `/transactions/${tx.id}/token`, "POST");
      return json({ url: tok.url });
    }
    if (route === "verify" && request.method === "GET") {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "Connexion requise" }, 401);
      const id = new URL(request.url).searchParams.get("id");
      const rows = await db(env, `paiements?fedapay_id=eq.${Number(id)}&technicien_id=eq.${user.id}&select=id`);
      if (!rows?.length) return json({ statut: "inconnu" }, 404);
      return json(await settle(env, id));
    }
    if (route === "webhook" && request.method === "POST") {
      const ev = await request.json().catch(() => ({}));
      const id = ev?.entity?.id || ev?.data?.id || ev?.id;
      if (id) await settle(env, id);
      return json({ ok: true });
    }
    return json({ error: "Route inconnue" }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
__name(onRequest, "onRequest");

// automatisations.js
var DAY = 864e5;
var FREQ = { split: [60, 90], cassette: [60, 90], groupe: [60, 90], chambre: [30, 30], vitrine: [60, 90], vrv: [60, 90], cta: [30, 30], eau_glacee: [30, 30], clim_precision: [30, 30], frigo_medical: [30, 30], chambre_mortuaire: [30, 30], ventilation: [90, 90] };
var TYPE_LABEL = { split: "Split", cassette: "Cassette / gainable", groupe: "Groupe ext\xE9rieur", chambre: "Chambre froide", vitrine: "Vitrine r\xE9frig\xE9r\xE9e", vrv: "VRV / DRV", cta: "CTA", eau_glacee: "Groupe d'eau glac\xE9e", clim_precision: "Clim de pr\xE9cision", frigo_medical: "R\xE9frig\xE9rateur m\xE9dical", chambre_mortuaire: "Chambre mortuaire", ventilation: "Ventilation" };
var isoDay = /* @__PURE__ */ __name((t) => new Date(t).toISOString().slice(0, 10), "isoDay");
var fr = /* @__PURE__ */ __name((s) => s ? String(s).slice(0, 10).split("-").reverse().join("/") : "\u2014", "fr");
var fcfa = /* @__PURE__ */ __name((n) => Number(n || 0).toLocaleString("fr-FR").replace(/ | /g, " ") + " FCFA", "fcfa");
var esc = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m]), "esc");
async function sb(env, path, method = "GET", body, prefer = "return=representation") {
  const r = await fetch(env.SUPABASE_URL + path, {
    method,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : void 0
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Supabase ${r.status} ${path} : ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}
__name(sb, "sb");
var rest = /* @__PURE__ */ __name((env, q, ...a) => sb(env, "/rest/v1/" + q, ...a), "rest");
async function loadData(env) {
  const [techs, eqs, ints, pays, users] = await Promise.all([
    rest(env, "techniciens?select=*"),
    rest(env, "equipements?select=*"),
    rest(env, "interventions?select=equipement_id,date,type,created_at"),
    rest(env, "paiements?select=*"),
    sb(env, "/auth/v1/admin/users?per_page=1000")
  ]);
  const emails = {};
  for (const u of users.users || []) emails[u.id] = { email: u.email, created_at: u.created_at };
  let membres = [], ots = [];
  try {
    membres = await rest(env, "membres?select=*");
  } catch {
  }
  try {
    ots = await rest(env, "ordres_travail?select=*");
  } catch {
  }
  let sigs = [];
  try {
    sigs = await rest(env, "signalements?select=statut,created_at");
  } catch {
  }
  let clients = [];
  try {
    clients = await rest(env, "clients?select=id,nom");
  } catch {
  }
  return { techs, eqs, ints, pays, emails, clients, sigs, membres, ots };
}
__name(loadData, "loadData");
function nextDue(e, ints) {
  const last = ints.filter((i) => i.equipement_id === e.id && i.type === "preventif").sort((a, b) => b.date.localeCompare(a.date))[0];
  const f = e.frequence_jours || FREQ[e.type]?.[e.environnement === "cotier" ? 0 : 1] || 90;
  return Date.parse(last ? last.date : e.date_pose) + f * DAY;
}
__name(nextDue, "nextDue");
async function telegram(env, html) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: html, parse_mode: "HTML", disable_web_page_preview: true })
  });
  if (!r.ok) throw new Error("Telegram " + r.status + " " + (await r.text()).slice(0, 160));
  return true;
}
__name(telegram, "telegram");
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
__name(email, "email");
function gabarit(env, titre, corps, bouton, lien) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0b2230">
  <div style="background:#0b2230;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-size:20px;font-weight:bold">\u2733 FroidPass</div>
  <div style="border:1px solid #cfe2e6;border-top:0;padding:22px;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 12px;font-size:20px">${titre}</h2>${corps}
    ${bouton ? `<p style="margin:22px 0"><a href="${lien}" style="background:#ff6a3d;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${bouton}</a></p>` : ""}
    <p style="color:#7a929e;font-size:13px;margin-top:24px">Une question ? R\xE9pondez sur WhatsApp : +229 01 62 77 79 77</p>
  </div></div>`;
}
__name(gabarit, "gabarit");
async function once(env, technicien_id, type, ref, send) {
  const deja = await rest(env, `notifications_envoyees?technicien_id=eq.${technicien_id}&type=eq.${type}&ref=eq.${encodeURIComponent(ref)}&select=id`);
  if (deja.length) return false;
  const ok = await send();
  if (ok) await rest(env, "notifications_envoyees", "POST", { technicien_id, type, ref }, "return=minimal");
  return ok;
}
__name(once, "once");
async function runAutomatisations(env, { dryRun = false } = {}) {
  const now = Date.now();
  const _d = new Date(now + 36e5);
  const today = Date.UTC(_d.getUTCFullYear(), _d.getUTCMonth(), _d.getUTCDate());
  const isMonday = _d.getUTCDay() === 1;
  const SITE = (env.SITE_URL || "").replace(/\/$/, "");
  const APP = SITE + "/app";
  const { techs: tous, eqs, ints, pays, emails, sigs, membres, ots } = await loadData(env);
  const estMembre = new Set(membres.map((m) => m.user_id));
  const techs = tous.filter((t) => !estMembre.has(t.id));
  const log = { emails: [], erreurs: [] };
  const actifs = techs.filter((t) => t.offre !== "decouverte" && t.fin_abonnement && Date.parse(t.fin_abonnement) >= today);
  const send = /* @__PURE__ */ __name(async (t, type, ref, subject, html) => {
    const to = emails[t.id]?.email;
    if (dryRun) {
      log.emails.push(`${type} \u2192 ${to}`);
      return;
    }
    try {
      if (await once(env, t.id, type, ref, () => email(env, to, subject, html))) log.emails.push(`${type} \u2192 ${to}`);
    } catch (e) {
      log.erreurs.push(`${type} ${to} : ${e.message}`);
    }
  }, "send");
  for (const t of techs) {
    const prenom = esc((t.nom || "").split(" ")[0] || "");
    const created = Date.parse(t.created_at);
    const mesEqs = eqs.filter((e) => e.technicien_id === t.id);
    if (now - created < DAY)
      await send(t, "bienvenue", "1", "Bienvenue sur FroidPass \u2744\uFE0F", gabarit(
        env,
        `Bienvenue ${prenom} !`,
        `<p>Votre compte FroidPass est pr\xEAt. Pour bien d\xE9marrer, 3 \xE9tapes de 5 minutes :</p>
         <ol><li>Compl\xE9tez votre <b>profil</b> (nom, entreprise, WhatsApp) : il appara\xEEt sur vos carnets.</li>
         <li>Ajoutez un <b>client</b>, puis un <b>\xE9quipement</b> : le QR code est pr\xEAt.</li>
         <li>Collez l'\xE9tiquette et enregistrez votre prochaine intervention.</li></ol>
         <p>Votre offre gratuite inclut 10 \xE9quipements.</p>`,
        "Ouvrir FroidPass",
        APP
      ));
    if (now - created > 3 * DAY && now - created < 10 * DAY && mesEqs.length === 0)
      await send(t, "inactif", "j3", "Votre premier QR FroidPass en 5 minutes", gabarit(
        env,
        `${prenom}, il vous manque juste le premier \xE9quipement`,
        `<p>Vous n'avez encore enregistr\xE9 aucun \xE9quipement. Choisissez votre meilleur client et cr\xE9ez sa premi\xE8re fiche : vous aurez un QR \xE0 coller d\xE8s votre prochaine visite.</p>
         <p>C'est ce carnet qui vous permettra de lui proposer un <b>contrat d'entretien annuel</b>.</p>`,
        "Cr\xE9er mon premier \xE9quipement",
        APP + "#parc"
      ));
    if (t.offre !== "decouverte" && t.fin_abonnement) {
      const fin = Date.parse(t.fin_abonnement), jours = Math.round((fin - today) / DAY);
      if (jours === 7 || jours === 1)
        await send(
          t,
          "expire_j" + jours,
          t.fin_abonnement,
          `Votre abonnement FroidPass se termine dans ${jours} jour${jours > 1 ? "s" : ""}`,
          gabarit(
            env,
            `Votre abonnement se termine le ${fr(t.fin_abonnement)}`,
            `<p>Renouvelez par Mobile Money pour garder vos rappels clients, vos certificats et vos \xE9quipements au-del\xE0 de 10.</p>
           ${t.fondateur ? "<p>En tant que <b>membre fondateur</b>, votre prix reste bloqu\xE9 \xE0 10 000 FCFA/mois.</p>" : ""}
           <p>Astuce : l'abonnement annuel = 10 mois pay\xE9s pour 12.</p>`,
            "Renouveler",
            APP + "#abonnement"
          )
        );
      if (jours === -1)
        await send(t, "expire", t.fin_abonnement, "Votre abonnement FroidPass a expir\xE9", gabarit(
          env,
          "Votre abonnement a expir\xE9",
          `<p>Vos donn\xE9es sont conserv\xE9es, mais les rappels clients et les certificats sont suspendus. R\xE9activez en 1 minute par Mobile Money.</p>`,
          "R\xE9activer",
          APP + "#abonnement"
        ));
    }
    if (isMonday && mesEqs.length) {
      const dus = mesEqs.map((e) => ({ e, due: nextDue(e, ints) })).filter((x) => x.due < today + 8 * DAY).sort((a, b) => a.due - b.due);
      if (dus.length) {
        const lignes = dus.slice(0, 25).map(({ e, due }) => `<tr><td style="padding:6px;border-bottom:1px solid #e3eef0">${esc(e.emplacement)}</td><td style="padding:6px;border-bottom:1px solid #e3eef0">${TYPE_LABEL[e.type] || e.type}</td><td style="padding:6px;border-bottom:1px solid #e3eef0;color:${due < today ? "#d64545" : "#0b2230"}">${due < today ? "En retard" : fr(isoDay(due))}</td></tr>`).join("");
        await send(t, "hebdo", isoDay(today), `${dus.length} entretien(s) \xE0 faire cette semaine`, gabarit(
          env,
          `Votre semaine : ${dus.length} entretien(s)`,
          `<p>Voici les \xE9quipements \xE0 entretenir d'ici 7 jours. Envoyez les rappels \xE0 vos clients depuis FroidPass en un clic.</p>
           <table style="width:100%;border-collapse:collapse;font-size:14px">${lignes}</table>`,
          "Envoyer mes rappels",
          APP
        ));
      }
    }
  }
  if (isMonday) for (const m of membres) {
    const mes = ots.filter((o) => o.assigne_a === m.user_id && ["planifie", "en_cours"].includes(o.statut) && (!o.date_prevue || Date.parse(o.date_prevue) < today + 8 * DAY));
    if (!mes.length) continue;
    const lignes = mes.map((o) => `<tr><td style="padding:6px;border-bottom:1px solid #e3eef0">OT-${String(o.numero).padStart(4, "0")}</td><td style="padding:6px;border-bottom:1px solid #e3eef0">${esc(o.titre)}</td><td style="padding:6px;border-bottom:1px solid #e3eef0">${fr(o.date_prevue)}</td></tr>`).join("");
    await send({ id: m.user_id, nom: m.nom }, "hebdo_ot", isoDay(today), `${mes.length} intervention(s) \xE0 r\xE9aliser cette semaine`, gabarit(env, `Bonjour ${esc((m.nom || "").split(" ")[0])}, votre semaine`, `<table style="width:100%;border-collapse:collapse;font-size:14px">${lignes}</table>`, "Ouvrir mon espace", APP));
  }
  const h24 = now - DAY;
  const nouveaux = techs.filter((t) => Date.parse(t.created_at) > h24);
  const payes24 = pays.filter((p) => p.statut === "approuve" && Date.parse(p.created_at) > h24);
  const debutMois = Date.UTC(_d.getUTCFullYear(), _d.getUTCMonth(), 1);
  const payesMois = pays.filter((p) => p.statut === "approuve" && Date.parse(p.created_at) >= debutMois);
  const expirent = actifs.filter((t) => Date.parse(t.fin_abonnement) - today <= 7 * DAY);
  const ints24 = ints.filter((i) => Date.parse(i.created_at) > h24).length;
  const actifsSemaine = new Set(eqs.filter((e) => Date.parse(e.created_at) > now - 7 * DAY).map((e) => e.technicien_id)).size;
  const rapport = [
    `<b>\u2600\uFE0F FroidPass \u2014 rapport du ${fr(isoDay(today))}</b>`,
    ``,
    `\u{1F465} <b>${techs.length}</b> techniciens inscrits (<b>+${nouveaux.length}</b> en 24 h)`,
    nouveaux.length ? nouveaux.map((t) => `   \u2022 ${esc(t.nom || "?")} \u2014 ${esc(t.ville || "")} \u2014 ${esc(t.whatsapp || "")}`).join("\n") : null,
    `\u{1F4B3} <b>${actifs.length}</b> abonn\xE9s payants actifs (dont ${actifs.filter((t) => t.fondateur).length} fondateurs)`,
    `\u{1F4B0} Encaiss\xE9 24 h : <b>${fcfa(payes24.reduce((s, p) => s + p.montant, 0))}</b> (${payes24.length} paiement(s))`,
    `\u{1F4C5} Encaiss\xE9 ce mois : <b>${fcfa(payesMois.reduce((s, p) => s + p.montant, 0))}</b>`,
    `\u23F3 Expirent sous 7 j : <b>${expirent.length}</b>${expirent.length ? " \u2014 " + expirent.map((t) => esc(t.nom)).join(", ") : ""}`,
    `\u{1F9CA} ${eqs.length} \xE9quipements \xB7 ${ints24} intervention(s) en 24 h \xB7 ${actifsSemaine} technicien(s) actifs cette semaine`,
    `\u{1F6E0} OT ouverts : <b>${ots.filter((o) => ["demande", "planifie", "en_cours"].includes(o.statut)).length}</b> \xB7 termin\xE9s en 24 h : ${ots.filter((o) => o.statut === "termine" && Date.parse(o.date_fin) > h24).length} \xB7 \xE9quipes : ${new Set(membres.map((m) => m.org_id)).size} (${membres.length} membres)`,
    `\u{1F6A8} Signalements de panne ouverts : <b>${sigs.filter((x) => x.statut !== "resolu").length}</b> (dont ${sigs.filter((x) => Date.parse(x.created_at) > h24).length} en 24 h)`,
    `\u2709\uFE0F E-mails envoy\xE9s aujourd'hui : ${log.emails.length}${!env.BREVO_API_KEY ? " (e-mails non configur\xE9s)" : ""}`,
    log.erreurs.length ? `\u26A0\uFE0F Erreurs : ${log.erreurs.length}
${log.erreurs.slice(0, 5).map(esc).join("\n")}` : null
  ].filter((l) => l !== null).join("\n");
  if (!dryRun) {
    try {
      const viaTg = await telegram(env, rapport);
      if (!viaTg && env.ADMIN_EMAIL) await email(env, env.ADMIN_EMAIL, `FroidPass \u2014 rapport du ${fr(isoDay(today))}`, `<pre style="font-family:Arial;font-size:14px;white-space:pre-wrap">${rapport}</pre>`);
    } catch (e) {
      log.erreurs.push("rapport : " + e.message);
    }
  }
  return { rapport, ...log };
}
__name(runAutomatisations, "runAutomatisations");

// signalements.js
var json2 = /* @__PURE__ */ __name((d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } }), "json");
var clean = /* @__PURE__ */ __name((v, n) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n), "clean");
async function rest2(env, q, method = "GET", body) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + q, {
    method,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : void 0
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Base " + r.status);
  return j;
}
__name(rest2, "rest");
async function signaler(request, env) {
  if (request.method !== "POST") return json2({ error: "M\xE9thode non autoris\xE9e" }, 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json2({ error: "Service indisponible (configuration serveur)" }, 503);
  const b = await request.json().catch(() => ({}));
  const code = clean(b.code, 40), description = clean(b.description, 1e3), nom = clean(b.nom, 80), telephone = clean(b.telephone, 30);
  if (!/^[a-z0-9]{6,40}$/i.test(code)) return json2({ error: "QR invalide" }, 400);
  if (description.length < 3) return json2({ error: "D\xE9crivez le probl\xE8me en quelques mots" }, 400);
  const eq = (await rest2(env, `equipements?code_public=eq.${code}&select=id,technicien_id,emplacement,client_id,criticite`))[0];
  if (!eq) return json2({ error: "\xC9quipement introuvable" }, 404);
  const depuis = new Date(Date.now() - 36e5).toISOString();
  const recents = await rest2(env, `signalements?equipement_id=eq.${eq.id}&created_at=gte.${encodeURIComponent(depuis)}&select=id`);
  if (recents.length >= 5) return json2({ error: "Ce probl\xE8me a d\xE9j\xE0 \xE9t\xE9 signal\xE9, le service est pr\xE9venu." }, 429);
  await rest2(env, "signalements", "POST", { technicien_id: eq.technicien_id, equipement_id: eq.id, description, nom, telephone });
  try {
    if (env.BREVO_API_KEY && env.EMAIL_EXPEDITEUR) {
      const users = await fetch(env.SUPABASE_URL + "/auth/v1/admin/users/" + eq.technicien_id, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } }).then((r) => r.json());
      const site = (await rest2(env, `clients?id=eq.${eq.client_id}&select=nom`))[0];
      const esc2 = /* @__PURE__ */ __name((s) => s.replace(/&/g, "&amp;"), "esc");
      if (users?.email) await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: "FroidPass", email: env.EMAIL_EXPEDITEUR },
          to: [{ email: users.email }],
          subject: `${eq.criticite === "critique" ? "\u{1F6A8} URGENT \u2014 " : "\u{1F6A8} "}Panne signal\xE9e : ${eq.emplacement} (${site?.nom || ""})`,
          htmlContent: `<div style="font-family:Arial"><h2>Panne signal\xE9e</h2><p><b>${esc2(eq.emplacement)}</b> \u2014 ${esc2(site?.nom || "")}${eq.criticite === "critique" ? " \u2014 <b style='color:#d64545'>\xE9quipement critique</b>" : ""}</p>
            <p style="background:#fff4ec;padding:12px;border-radius:8px">${esc2(description)}</p><p>Signal\xE9 par : ${esc2(nom || "\u2014")} ${esc2(telephone)}</p>
            <p><a href="${(env.SITE_URL || "").replace(/\/$/, "")}/app#tableau" style="background:#ff6a3d;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Ouvrir FroidPass</a></p></div>`
        })
      });
    }
  } catch (e) {
    console.error("Alerte e-mail :", e.message);
  }
  return json2({ ok: true });
}
__name(signaler, "signaler");

// worker.js
var json3 = /* @__PURE__ */ __name((d, s = 200) => new Response(JSON.stringify(d, null, 2), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } }), "json");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/automatisations") {
      if (!env.ADMIN_KEY || url.searchParams.get("key") !== env.ADMIN_KEY) return json3({ error: "Cl\xE9 invalide" }, 403);
      try {
        return json3(await runAutomatisations(env, { dryRun: url.searchParams.get("test") === "1" }));
      } catch (e) {
        return json3({ error: e.message }, 500);
      }
    }
    if (url.pathname === "/api/signaler") return signaler(request, env).catch((e) => json3({ error: e.message }, 500));
    if (url.pathname.startsWith("/api/")) {
      const route = url.pathname.slice(5).split("/").filter(Boolean);
      return onRequest({ request, env, params: { route } });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomatisations(env).catch((e) => console.error("Automatisations :", e.message)));
  }
};

// ../../../tmp/wr/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../tmp/wr/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ogVli9/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../tmp/wr/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ogVli9/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
