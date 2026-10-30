// =====================================================================
// FroidPass — application technicien
// =====================================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = window.FROIDPASS_CONFIG || {};
const $view = document.getElementById("view");
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("VOTRE-PROJET");
const sb = configured ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

// ---------- Règles métier : fréquences préventives (jours) ----------
const TYPES = {
  split:    { label: "Split mural / console", ic: "❄️", cotier: 60, interieur: 90, pts: "Filtres, évaporateur, évacuation des condensats, HP/BP, intensité" },
  cassette: { label: "Cassette / gainable", ic: "🌀", cotier: 60, interieur: 90, pts: "Bac et pompe de relevage, filtres, équilibrage" },
  groupe:   { label: "Groupe extérieur", ic: "🔆", cotier: 60, interieur: 90, pts: "Corrosion ailettes condenseur, serrage bornes, condensateur" },
  chambre:  { label: "Chambre froide", ic: "🧊", cotier: 30, interieur: 30, pts: "Joints de porte, dégivrage, consigne, alarme" },
  vitrine:  { label: "Armoire / vitrine réfrigérée", ic: "🥶", cotier: 60, interieur: 90, pts: "Condenseur, joints, thermostat" },
  // Grands sites / hôpitaux (fréquences de départ, à ajuster selon le fabricant et les procédures du site)
  vrv:               { label: "VRV / DRV (unité extérieure)", ic: "🏢", cotier: 60, interieur: 90, pts: "Échangeurs, pressions, intensité, communication des unités, corrosion" },
  cta:               { label: "Centrale de traitement d'air (CTA)", ic: "🌬️", cotier: 30, interieur: 30, pts: "Filtres (perte de charge), courroies, batteries, bac à condensats, hygiène" },
  eau_glacee:        { label: "Groupe d'eau glacée", ic: "💧", cotier: 30, interieur: 30, pts: "Pressions, températures départ/retour, débit, compresseurs, traitement d'eau" },
  clim_precision:    { label: "Climatisation de précision (salle serveur)", ic: "🖥️", cotier: 30, interieur: 30, pts: "Consigne température/humidité, filtres, alarmes, redondance" },
  frigo_medical:     { label: "Réfrigérateur médical / vaccins / labo", ic: "💉", cotier: 30, interieur: 30, pts: "Température 2–8 °C, enregistreur, alarme, joints, dégivrage" },
  chambre_mortuaire: { label: "Chambre mortuaire", ic: "🏥", cotier: 30, interieur: 30, pts: "Température, groupe froid, joints, alarme, hygiène" },
  ventilation:       { label: "Ventilation / extraction", ic: "🌀", cotier: 90, interieur: 90, pts: "Moteur, courroies, filtres, débit, bruit" }
};
const CRIT = { normale: { label: "Normale", cls: "" }, haute: { label: "Haute", cls: "p-warn" }, critique: { label: "Critique", cls: "p-bad" } };
const PLANS = [
  { id: "fondateur",      nom: "Membre fondateur", prix: 15000, detail: "3 mois de Solo, puis prix bloqué à 10 000 FCFA", hot: true },
  { id: "solo_mensuel",   nom: "Solo · 1 mois",  prix: 10000,  detail: "60 équipements, relances, certificat" },
  { id: "solo_annuel",    nom: "Solo · 12 mois", prix: 100000, detail: "10 mois payés pour 12" },
  { id: "pro_mensuel",    nom: "Pro · 1 mois",   prix: 20000,  detail: "Équipements illimités" },
  { id: "pro_annuel",     nom: "Pro · 12 mois",  prix: 200000, detail: "10 mois payés pour 12" },
  { id: "equipe_mensuel", nom: "Équipe · 1 mois", prix: 40000, detail: "Illimité, multi-sites, planning général" }
];
const DAY = 864e5;
const _n = new Date();
const TODAY = Date.UTC(_n.getFullYear(), _n.getMonth(), _n.getDate());
const iso = t => new Date(t).toISOString().slice(0, 10);
const fr = s => s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—";
const fcfa = n => Number(n).toLocaleString("fr-FR").replace(/ | /g, " ") + " FCFA";
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const waNum = s => String(s || "").replace(/\D/g, "");

let S = { user: null, tech: null, clients: [], eqs: [], ints: [], pays: [], sigs: [] };

// ---------- Outils ----------
let tt;
function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), 3200); }
function modal(html) { document.getElementById("modal").innerHTML = html ? `<div class="modal" data-close>${html}</div>` : ""; }
document.addEventListener("click", e => { if (e.target.matches("[data-close]")) modal(""); });
const publicUrl = code => location.origin + "/e.html?c=" + code;
const client = id => S.clients.find(c => c.id === id) || {};
const intsOf = id => S.ints.filter(x => x.equipement_id === id).sort((a, b) => b.date.localeCompare(a.date));
const freq = e => e.frequence_jours || (TYPES[e.type] || TYPES.split)[e.environnement];
function nextDue(e) {
  const last = intsOf(e.id).find(x => x.type === "preventif");
  return iso(Date.parse(last ? last.date : e.date_pose) + freq(e) * DAY);
}
function status(e) {
  const d = Math.round((Date.parse(nextDue(e)) - TODAY) / DAY);
  if (d < 0) return { cls: "p-bad", txt: `En retard de ${-d} j`, d };
  if (d <= 14) return { cls: "p-warn", txt: `Dû dans ${d} j`, d };
  return { cls: "p-ok", txt: `À jour · ${d} j`, d };
}
function flags(x) {
  const out = [];
  if (x.t_soufflage != null && x.t_reprise != null) {
    const dt = Number(x.t_reprise) - Number(x.t_soufflage);
    if (dt < 8) out.push(`Écart reprise/soufflage de ${dt.toFixed(1)} °C, plutôt faible : vérifier l'encrassement de l'évaporateur et la charge en fluide (mesure de surchauffe). Indication à confirmer sur place.`);
  }
  if (/corros/i.test(x.observations || "")) out.push("Corrosion signalée : prévoir un traitement anticorrosion et rapprocher le contrôle.");
  return out;
}
function offreActive() {
  const t = S.tech; if (!t) return "decouverte";
  return t.offre !== "decouverte" && t.fin_abonnement && Date.parse(t.fin_abonnement) >= TODAY ? t.offre : "decouverte";
}
const peutRelancer = () => offreActive() !== "decouverte";
// Profil : "technicien" (prestataire qui entretient le parc de ses clients) ou "entreprise" (gère ses propres sites)
const isEnt = () => S.tech?.profil === "entreprise";
const W = () => isEnt()
  ? { client: "site", clients: "sites", Clients: "Sites", nouveauClient: "Nouveau site", nomClient: "Nom du site", phNom: "Siège, Agence Akpakpa, Usine…", contact: "Responsable du site ou prestataire", waContact: "WhatsApp du responsable / prestataire", relance: "Demander l'intervention (WhatsApp)", signataire: "Le responsable maintenance" }
  : { client: "client", clients: "clients", Clients: "Clients", nouveauClient: "Nouveau client", nomClient: "Nom de l'établissement", phNom: "Hôtel, clinique, restaurant…", contact: "Personne à contacter", waContact: "WhatsApp du client", relance: "Préparer le message WhatsApp", signataire: "Le technicien" };
function majMenu() { const a = document.querySelector('#menu a[data-v="clients"]'); if (a) a.textContent = W().Clients; }

// ---------- Données ----------
async function loadAll() {
  const [t, c, e, i, p] = await Promise.all([
    sb.from("techniciens").select("*").eq("id", S.user.id).single(),
    sb.from("clients").select("*").order("nom"),
    sb.from("equipements").select("*").order("created_at"),
    sb.from("interventions").select("*").order("date", { ascending: false }),
    sb.from("paiements").select("*").order("created_at", { ascending: false })
  ]);
  for (const r of [t, c, e, i, p]) if (r.error) throw r.error;
  const sg = await sb.from("signalements").select("*").order("created_at", { ascending: false });
  S.sigs = sg.error ? [] : sg.data;
  S.tech = t.data; S.clients = c.data; S.eqs = e.data; S.ints = i.data; S.pays = p.data;
}

// ---------- Routage ----------
async function route() {
  if (!configured) return renderNotConfigured();
  const h = (location.hash || "#tableau").slice(1);
  if (!S.user) { document.getElementById("menu").hidden = true; return renderAuth(h.startsWith("inscription") ? "inscription" : "connexion", h === "inscription-entreprise" ? "entreprise" : "technicien"); }
  majMenu();
  document.getElementById("menu").hidden = false;
  document.querySelectorAll("#menu a").forEach(a => a.classList.toggle("cur", h.startsWith(a.dataset.v) || (h.startsWith("eq-") && a.dataset.v === "parc")));
  window.scrollTo(0, 0);
  if (h.startsWith("eq-")) return renderEq(h.slice(3));
  if (h.startsWith("cert-")) return renderCert(h.slice(5));
  if (h.startsWith("rapport-")) return renderRapport(h.slice(8));
  if (h.startsWith("siteqr-")) return renderSiteQR(h.slice(7));
  if (h === "etiquettes") return renderLabels();
  if (h === "rapport-global") return renderRapportGlobal();
  if (h === "planning") return renderPlanning();
  if (h === "parc") return renderParc();
  if (h === "clients") return renderClients();
  if (h === "abonnement") return renderAbo();
  if (h === "profil") return renderProfil();
  return renderTableau();
}
window.addEventListener("hashchange", route);

// ---------- Écrans ----------
function renderNotConfigured() {
  $view.innerHTML = `<div class="panel auth"><h3>Configuration requise</h3>
  <p class="m">Renseignez SUPABASE_URL et SUPABASE_ANON_KEY dans <span class="mono">config.js</span> (voir le guide de mise en ligne).</p></div>`;
}

function renderAuth(mode, profilInit = "technicien") {
  const ins = mode === "inscription";
  $view.innerHTML = `<div class="panel auth">
    <h3 style="font-size:24px">${ins ? "Créer mon compte FroidPass" : "Connexion"}</h3>
    <form class="form" id="authForm" style="grid-template-columns:1fr">
      ${ins ? `<label>Je suis…<select class="field" name="profil" id="profilSel">
        <option value="technicien" ${profilInit === "technicien" ? "selected" : ""}>Technicien / prestataire de maintenance</option>
        <option value="entreprise" ${profilInit === "entreprise" ? "selected" : ""}>Chef d'entreprise / gestionnaire de sites</option><option value="entreprise">Responsable maintenance (hôpital, grand site)</option></select></label>
      <label>Nom complet<input class="field" name="nom" required></label>
      <label>Entreprise<input class="field" name="entreprise" placeholder="Nom de votre entreprise (facultatif)"></label>
      <label>Numéro WhatsApp<input class="field" name="whatsapp" placeholder="+229 01 XX XX XX XX" required></label>
      <label>Ville<select class="field" name="ville"><option>Cotonou</option><option>Abomey-Calavi</option><option>Porto-Novo</option><option>Autre</option></select></label>` : ""}
      <label>E-mail<input class="field" type="email" name="email" required autocomplete="email"></label>
      <label>Mot de passe<input class="field" type="password" name="password" minlength="8" required autocomplete="${ins ? "new-password" : "current-password"}"></label>
      <button class="btn btn-hot" type="submit">${ins ? "Créer mon compte gratuit" : "Se connecter"}</button>
    </form>
    <p class="m" style="margin-top:14px">${ins ? `Déjà inscrit ? <a href="#connexion">Se connecter</a>` : `Pas encore de compte ? <a href="#inscription">Créer un compte gratuit</a> · <a href="#" id="reset">Mot de passe oublié</a>`}</p>
  </div>`;
  document.getElementById("authForm").onsubmit = async ev => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target)); const b = ev.target.querySelector("button"); b.disabled = true;
    try {
      if (ins) {
        const { data, error } = await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { nom: f.nom, whatsapp: f.whatsapp, ville: f.ville, entreprise: f.entreprise || "", profil: f.profil || "technicien" }, emailRedirectTo: location.origin + "/app.html" } });
        if (error) throw error;
        if (!data.session) { $view.innerHTML = `<div class="panel auth"><h3>Vérifiez votre e-mail</h3><p class="m">Un lien de confirmation a été envoyé à ${esc(f.email)}. Cliquez dessus puis revenez vous connecter.</p></div>`; return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) throw error;
      }
    } catch (e) { toast(e.message.includes("Invalid login") ? "E-mail ou mot de passe incorrect" : e.message); b.disabled = false; }
  };
  const r = document.getElementById("reset");
  if (r) r.onclick = async e => {
    e.preventDefault(); const email = document.querySelector("[name=email]").value;
    if (!email) return toast("Saisissez d'abord votre e-mail");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/app.html#profil" });
    toast(error ? error.message : "E-mail de réinitialisation envoyé");
  };
}

function renderTableau() {
  const sts = S.eqs.map(status);
  const late = sts.filter(s => s.d < 0).length, soon = sts.filter(s => s.d >= 0 && s.d <= 14).length;
  const relances = [...S.eqs].sort((a, b) => status(a).d - status(b).d).filter(e => status(e).d <= 14);
  const visites = S.eqs.reduce((n, e) => n + Math.round(365 / freq(e)), 0);
  const w = W(), pctParc = S.eqs.length ? Math.round(100 * (S.eqs.length - late) / S.eqs.length) : 0;
  $view.innerHTML = `
  <h1 style="font-size:30px;margin-bottom:6px">Bonjour ${esc((S.tech.nom || "").split(" ")[0])}</h1>
  <p class="m" style="margin-bottom:16px">Offre : <b>${labelOffre()}</b>${S.tech.fondateur ? " · Membre fondateur" : ""}</p>
  ${sigsHTML(S.sigs.filter(x => x.statut !== "resolu"), true)}
  ${!S.tech.whatsapp || !S.tech.nom ? `<div class="panel" style="border-color:var(--heat)">Complétez votre <a href="#profil">profil</a> (nom, entreprise, WhatsApp) : ces informations apparaissent sur vos carnets QR et vos certificats.</div>` : ""}
  <div class="kpis">
    <div class="kpi"><b>${S.clients.length}</b><span>${w.clients}</span></div>
    <div class="kpi"><b>${S.eqs.length}</b><span>équipements</span></div>
    <div class="kpi alert"><b>${late}</b><span>entretiens en retard</span></div>
    <div class="kpi"><b>${soon}</b><span>à faire sous 14 jours</span></div>
  </div>
  <div class="grid2">
    <div class="panel"><h3>${isEnt() ? "Entretiens à planifier" : "Relances à envoyer"}</h3>
      ${relances.length ? relances.map(e => `<div style="padding:10px 0;border-top:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(client(e.client_id).nom)}</b><span class="pill ${status(e).cls}">${status(e).txt}</span></div>
        <div class="m">${esc(e.emplacement)} · ${TYPES[e.type].label}</div>
        <button class="btn btn-teal btn-sm" style="margin-top:8px" data-relance="${e.id}">${w.relance}</button></div>`).join("")
      : `<p class="empty">Aucune relance dans les 14 prochains jours.</p>`}
    </div>
    <div>
      ${isEnt() ? `<div class="panel" style="background:var(--ink);color:#eaf7f9;border:0"><h3>Conformité du parc</h3>
        <p style="color:#a9c9d0;font-size:14.5px"><b style="color:#fff;font-size:26px">${pctParc} %</b> de vos équipements sont à jour sur ${S.clients.length} site(s). Le parc représente <b style="color:#fff">${visites} visites préventives par an</b> : la base pour piloter votre budget et vos prestataires.</p></div>`
      : `<div class="panel" style="background:var(--ink);color:#eaf7f9;border:0"><h3>Argument contrat annuel</h3>
        <p style="color:#a9c9d0;font-size:14.5px">Votre parc représente <b style="color:#fff">${visites} visites préventives par an</b>. C'est la base chiffrée de vos propositions de contrat d'entretien.</p></div>`}
      <div class="panel"><h3>Démarrer</h3>
        <button class="btn btn-hot" style="width:100%;margin-bottom:8px" data-addeq>+ Nouvel équipement</button>
        <a class="btn btn-ghost" style="width:100%" href="#clients">+ ${w.nouveauClient}</a></div>
    </div>
  </div>
  ${vueSites()}`;
}

function eqRow(e) {
  const s = status(e), t = TYPES[e.type];
  return `<a class="row" href="#eq-${e.id}"><div class="ic">${t.ic}</div>
    <div><div class="t">${esc(e.emplacement)}</div><div class="m">${esc(client(e.client_id).nom)}${e.zone ? " · " + esc(e.zone) : ""} · ${t.label} · ${esc(e.marque)} ${esc(e.puissance)}</div></div>
    <span>${e.criticite === "critique" ? '<span class="pill p-bad" style="margin-right:4px">Critique</span>' : ""}<span class="pill ${s.cls}">${s.txt}</span></span></a>`;
}

function renderParc() {
  const sorted = [...S.eqs].sort((a, b) => status(a).d - status(b).d);
  $view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <h1 style="font-size:28px">Mon parc</h1>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-ghost btn-sm" href="#etiquettes">Imprimer les étiquettes QR</a><button class="btn btn-ghost btn-sm" id="csv">Exporter (CSV)</button><button class="btn btn-hot btn-sm" data-addeq>+ Équipement</button></div></div>
    <div class="panel"><input class="field" id="q" placeholder="Rechercher (client, emplacement, marque…)" style="margin-bottom:8px">
    <div id="list">${sorted.map(eqRow).join("") || `<p class="empty">Aucun équipement. Commencez par créer un client, puis un équipement.</p>`}</div></div>`;
  document.getElementById("q").oninput = ev => {
    const q = ev.target.value.toLowerCase();
    document.getElementById("list").innerHTML = sorted.filter(e => (e.emplacement + client(e.client_id).nom + e.marque).toLowerCase().includes(q)).map(eqRow).join("");
  };
  document.getElementById("csv").onclick = exportCsv;
}

function measHTML(x) {
  const m = [];
  if (x.hp != null) m.push(`HP ${x.hp} bar`); if (x.bp != null) m.push(`BP ${x.bp} bar`); if (x.intensite != null) m.push(`I ${x.intensite} A`);
  if (x.t_soufflage != null) m.push(`Souffl. ${x.t_soufflage} °C`); if (x.t_reprise != null) m.push(`Rep. ${x.t_reprise} °C`);
  return m.length ? `<div class="meas">${m.map(v => `<span>${v}</span>`).join("")}</div>` : "";
}

function renderEq(id) {
  const e = S.eqs.find(x => x.id === id);
  if (!e) { $view.innerHTML = `<p class="empty">Équipement introuvable. <a href="#parc">Retour</a></p>`; return; }
  const s = status(e), t = TYPES[e.type], list = intsOf(e.id);
  $view.innerHTML = `<a href="#parc" class="m">← Retour au parc</a>
  <div class="grid2" style="margin-top:10px">
    <div class="panel">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="font-size:23px">${t.ic} ${esc(e.emplacement)}</h3><span>${e.criticite && e.criticite !== "normale" ? `<span class="pill ${CRIT[e.criticite].cls}" style="margin-right:6px">Criticité ${CRIT[e.criticite].label.toLowerCase()}</span>` : ""}<span class="pill ${s.cls}">${s.txt}</span></span></div>
      <p class="m">${esc(client(e.client_id).nom)} · ${t.label} · ${esc(e.marque)} ${esc(e.puissance)} · <span class="mono">${esc(e.fluide)}</span> · ${e.environnement === "cotier" ? "côtier" : "intérieur"}</p>
      <p style="margin:10px 0 16px;font-size:14px">Fréquence : <b>${freq(e)} jours</b>${e.frequence_jours ? " (personnalisée)" : ""} · Prochain entretien : <b class="mono">${fr(nextDue(e))}</b><br><span class="m">Points de contrôle : ${t.pts}</span></p>
      <h3>Nouvelle intervention</h3>
      <div class="ai"><b style="font-size:14.5px">Saisie rapide</b>
        <p class="m" style="margin:4px 0 8px">Écrivez comme vous parlez, l'application remplit la fiche.</p>
        <textarea class="field" id="dict" rows="2" placeholder="Préventif, filtres nettoyés, HP 27 bars, BP 8,5, intensité 6,3 A, soufflage 14, reprise 25"></textarea>
        <button class="btn btn-teal btn-sm" style="margin-top:8px" id="parse">Remplir la fiche</button></div>
      <form class="form" id="intForm">
        <label>Date<input class="field" type="date" name="date" value="${iso(TODAY)}" required></label>
        <label>Type<select class="field" name="type"><option value="preventif">Préventif</option><option value="curatif">Curatif</option></select></label>
        <label>HP (bar)<input class="field mono" name="hp" inputmode="decimal"></label>
        <label>BP (bar)<input class="field mono" name="bp" inputmode="decimal"></label>
        <label>Intensité absorbée (A)<input class="field mono" name="intensite" inputmode="decimal"></label>
        <label>T soufflage (°C)<input class="field mono" name="t_soufflage" inputmode="decimal"></label>
        <label>T reprise (°C)<input class="field mono" name="t_reprise" inputmode="decimal"></label>
        <label class="full">Observations<textarea class="field" name="observations" rows="2"></textarea></label>
        <div class="full"><button class="btn btn-hot" type="submit">Enregistrer l'intervention</button></div>
      </form>
    </div>
    <div>
      <div class="panel"><h3>Étiquette QR</h3>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div class="qr" id="qr"></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <a class="btn btn-ghost btn-sm" href="${publicUrl(e.code_public)}" target="_blank" rel="noopener">Voir le carnet public</a>
          <a class="btn btn-ghost btn-sm" href="#cert-${e.id}">Certificat d'entretien</a>
          <button class="btn btn-teal btn-sm" data-relance="${e.id}">Relance WhatsApp</button>
          <button class="btn btn-ghost btn-sm" id="delEq" style="color:var(--bad)">Supprimer</button></div></div></div>
      ${sigsHTML(S.sigs.filter(x => x.equipement_id === e.id && x.statut !== "resolu"))}
      <div class="panel"><h3>Historique</h3><div class="hist">${list.length ? list.map(x => `
        <div class="it"><b class="mono" style="font-size:13.5px">${fr(x.date)}</b> · <b>${x.type === "preventif" ? "Préventif" : "Curatif"}</b>
          <button class="btn btn-sm noprint" style="padding:0 6px;color:var(--mute);background:none" data-delint="${x.id}" title="Supprimer">✕</button>
          <div class="m">${esc(x.observations)}</div>${measHTML(x)}${flags(x).map(f => `<div class="flag">⚠ ${f}</div>`).join("")}</div>`).join("")
        : `<p class="empty">Aucune intervention.</p>`}</div></div>
    </div>
  </div>`;
  if (window.QRCode) new QRCode(document.getElementById("qr"), { text: publicUrl(e.code_public), width: 128, height: 128, colorDark: "#0b2230", colorLight: "#ffffff" });
  document.getElementById("parse").onclick = parseDict;
  document.getElementById("intForm").onsubmit = async ev => {
    ev.preventDefault();
    const o = Object.fromEntries(new FormData(ev.target));
    for (const k of ["hp", "bp", "intensite", "t_soufflage", "t_reprise"]) o[k] = o[k] === "" ? null : Number(String(o[k]).replace(",", "."));
    const b = ev.target.querySelector("button"); b.disabled = true;
    const { error } = await sb.from("interventions").insert({ ...o, equipement_id: e.id });
    if (error) { toast(error.message); b.disabled = false; return; }
    await loadAll(); renderEq(e.id); toast("Intervention enregistrée · prochain entretien recalculé");
  };
  document.getElementById("delEq").onclick = () => confirmBox(`Supprimer « ${esc(e.emplacement)} » et tout son historique ?`, async () => {
    const { error } = await sb.from("equipements").delete().eq("id", e.id);
    if (error) return toast(error.message);
    await loadAll(); location.hash = "parc"; toast("Équipement supprimé");
  });
  document.querySelectorAll("[data-delint]").forEach(btn => btn.onclick = () => confirmBox("Supprimer cette intervention ?", async () => {
    const { error } = await sb.from("interventions").delete().eq("id", btn.dataset.delint);
    if (error) return toast(error.message);
    await loadAll(); renderEq(e.id);
  }));
}

function parseDict() {
  const t = document.getElementById("dict").value.replace(/(\d),(\d)/g, "$1.$2");
  const f = document.getElementById("intForm");
  const grab = re => { const m = t.match(re); return m ? m[1] : ""; };
  f.hp.value = grab(/\bHP\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  f.bp.value = grab(/\bBP\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  f.intensite.value = grab(/intensit[ée]\s*[:=]?\s*(\d+(?:\.\d+)?)/i) || grab(/(\d+(?:\.\d+)?)\s*A\b/);
  f.t_soufflage.value = grab(/souffl\w*\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  f.t_reprise.value = grab(/reprise\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  f.type.value = /curatif|panne|d[ée]pannage/i.test(t) ? "curatif" : "preventif";
  const obs = t.split(/[,;]|\.(?!\d)/).map(s => s.trim()).filter(s => s && !/\b(HP|BP)\b|intensit|souffl|reprise|^pr[ée]ventif$|^curatif$/i.test(s));
  f.observations.value = obs.map(s => s[0].toUpperCase() + s.slice(1)).join(". ") + (obs.length ? "." : "");
  toast("Fiche remplie : vérifiez avant d'enregistrer");
}

function confirmBox(msg, ok) {
  modal(`<div class="panel"><p style="margin-bottom:14px">${msg}</p><div style="display:flex;gap:8px"><button class="btn btn-hot" id="cOk">Confirmer</button><button class="btn btn-ghost" data-close>Annuler</button></div></div>`);
  document.getElementById("cOk").onclick = () => { modal(""); ok(); };
}

function openAddEq() {
  if (!S.clients.length) { location.hash = "clients"; toast("Créez d'abord un client"); return; }
  modal(`<div class="panel"><h3>Nouvel équipement</h3><form class="form" id="eqForm">
    <label class="full">Client<select class="field" name="client_id">${S.clients.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join("")}</select></label>
    <label>Zone (facultatif)<input class="field" name="zone" list="zones" placeholder="Bâtiment A, Restaurant…"><datalist id="zones">${[...new Set(S.eqs.map(e => e.zone).filter(Boolean))].map(z => `<option value="${esc(z)}">`).join("")}</datalist></label>
    <label>Emplacement<input class="field" name="emplacement" placeholder="Ex. Chambre 12, Cuisine" required></label>
    <label>Type<select class="field" name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select></label>
    <label>Criticité<select class="field" name="criticite"><option value="normale">Normale</option><option value="haute">Haute</option><option value="critique">Critique (bloc, pharmacie, serveur…)</option></select></label>
    <label>Fréquence personnalisée (jours)<input class="field" name="frequence_jours" type="number" min="7" max="730" placeholder="Auto selon le type"></label>
    <label>Environnement<select class="field" name="environnement"><option value="cotier">Côtier / exposé</option><option value="interieur">Intérieur protégé</option></select></label>
    <label>Marque<input class="field" name="marque"></label>
    <label>Puissance<input class="field" name="puissance" placeholder="12 000 BTU, 3,5 kW…"></label>
    <label>Fluide frigorigène<select class="field" name="fluide"><option>R410A</option><option>R32</option><option>R22</option><option>R404A</option><option>R134a</option><option>R290</option><option>Autre</option></select></label>
    <label>Date de pose<input class="field" type="date" name="date_pose" value="${iso(TODAY)}"></label>
    <div class="full" style="display:flex;gap:8px"><button class="btn btn-hot" type="submit">Créer et générer le QR</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div>
  </form></div>`);
  document.getElementById("eqForm").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target));
    if (!o.zone) delete o.zone;
    if (o.criticite === "normale") delete o.criticite;
    if (!o.frequence_jours) delete o.frequence_jours; else o.frequence_jours = Number(o.frequence_jours);
    const { data, error } = await sb.from("equipements").insert(o).select().single();
    if (error) { toast(error.message.startsWith("QUOTA") ? error.message.replace("QUOTA: ", "") : error.message); return; }
    modal(""); await loadAll(); location.hash = "eq-" + data.id; toast("Équipement créé · QR prêt");
  };
}

function relance(id) {
  if (!peutRelancer()) { location.hash = "abonnement"; toast("Les relances clients sont incluses à partir de l'offre Solo"); return; }
  const e = S.eqs.find(x => x.id === id), c = client(e.client_id), s = status(e);
  const msg = isEnt()
    ? `Bonjour ${c.contact || ""},\n\nL'entretien préventif de l'équipement « ${e.emplacement} » (${TYPES[e.type].label}) du site ${c.nom} ${s.d < 0 ? "est en retard depuis le " + fr(nextDue(e)) : "est prévu le " + fr(nextDue(e))}.\n\nMerci de planifier l'intervention et de me confirmer la date. Points de contrôle : ${TYPES[e.type].pts}.\n\nFiche de l'équipement : ${publicUrl(e.code_public)}\n\n${S.tech.nom}${S.tech.entreprise ? " — " + S.tech.entreprise : ""}`
    : `Bonjour ${c.contact || ""},\n\nC'est ${S.tech.nom}${S.tech.entreprise ? " (" + S.tech.entreprise + ")" : ""}. L'entretien préventif de votre équipement « ${e.emplacement} » ${s.d < 0 ? "est en retard depuis le " + fr(nextDue(e)) : "est prévu le " + fr(nextDue(e))}.\n\nUn entretien régulier évite les pannes et protège votre compresseur, surtout avec l'air salin. Quel créneau vous convient cette semaine ?\n\nVotre carnet d'entretien : ${publicUrl(e.code_public)}`;
  modal(`<div class="panel"><h3>Message pour ${esc(c.nom)}</h3><p class="m">Destinataire : ${esc(c.whatsapp || "numéro non renseigné")}</p>
    <div class="msgbox" id="msgTxt">${esc(msg)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${c.whatsapp ? `<a class="btn btn-teal btn-sm" href="https://wa.me/${waNum(c.whatsapp)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Ouvrir dans WhatsApp</a>` : ""}
      <button class="btn btn-ghost btn-sm" id="cp">Copier</button><button class="btn btn-ghost btn-sm" data-close>Fermer</button></div></div>`);
  document.getElementById("cp").onclick = async () => { try { await navigator.clipboard.writeText(msg); toast("Message copié"); } catch { toast("Sélectionnez le texte pour le copier"); } };
}

function renderClients() {
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:14px">${W().Clients}</h1>
  <div class="grid2"><div class="panel">${S.clients.map(c => {
    const n = S.eqs.filter(e => e.client_id === c.id).length, st = statsSite(c);
    return `<div class="row" style="cursor:default"><div class="ic">🏢</div><div><div class="t">${esc(c.nom)} ${st.pct == null ? "" : `<span class="pill ${st.pct >= 90 ? "p-ok" : st.pct >= 70 ? "p-warn" : "p-bad"}">${st.pct} % à jour</span>`}${st.late ? ` <span class="pill p-bad">${st.late} en retard</span>` : ""}</div><div class="m">${esc(c.contact)} · ${esc(c.whatsapp)} · ${n} équipement(s) · prochain entretien ${fr(st.prochain)}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><a class="btn btn-teal btn-sm" href="#rapport-${c.id}">Rapport du site</a><a class="btn btn-ghost btn-sm" href="#siteqr-${c.id}">QR du site</a><button class="btn btn-ghost btn-sm" data-delcli="${c.id}" style="color:var(--bad)">Supprimer</button></div></div>`;
  }).join("") || `<p class="empty">Aucun ${W().client} pour l'instant.</p>`}</div>
  <div class="panel"><h3>${W().nouveauClient}</h3><form class="form" id="cliForm" style="grid-template-columns:1fr">
    <label>${W().nomClient}<input class="field" name="nom" placeholder="${W().phNom}" required></label>
    <label>${W().contact}<input class="field" name="contact" placeholder="M. / Mme …"></label>
    <label>${W().waContact}<input class="field" name="whatsapp" placeholder="+229 01 XX XX XX XX"></label>
    <button class="btn btn-hot" type="submit">Ajouter</button></form></div></div>`;
  document.getElementById("cliForm").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target));
    const { error } = await sb.from("clients").insert(o);
    if (error) return toast(error.message);
    await loadAll(); renderClients(); toast(isEnt() ? "Site ajouté" : "Client ajouté");
  };
  document.querySelectorAll("[data-delcli]").forEach(b => b.onclick = () => confirmBox(`Supprimer ce ${W().client} et tous ses équipements ?`, async () => {
    const { error } = await sb.from("clients").delete().eq("id", b.dataset.delcli);
    if (error) return toast(error.message);
    await loadAll(); renderClients();
  }));
}

function labelOffre() {
  const o = offreActive();
  const n = { decouverte: "Découverte (gratuite, 10 équipements)", solo: "Solo", pro: "Pro", equipe: "Équipe" }[o];
  return o === "decouverte" ? n : `${n} · jusqu'au ${fr(S.tech.fin_abonnement)}`;
}

function renderAbo() {
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:6px">Abonnement</h1>
  <p class="m" style="margin-bottom:16px">Offre actuelle : <b>${labelOffre()}</b>${S.tech.fondateur ? " · Membre fondateur (prix bloqué à 10 000 FCFA)" : ""}</p>
  <div class="plans">${PLANS.filter(p => !(p.id === "fondateur" && S.tech.fondateur)).map(p => `<div class="plan ${p.hot ? "hot" : ""}"><b>${p.nom}</b><div class="amt">${fcfa(p.prix)}</div>
    <p class="m" style="min-height:40px">${p.detail}</p><button class="btn ${p.hot ? "btn-hot" : "btn-teal"} btn-sm" style="width:100%;margin-top:8px" data-pay="${p.id}">Payer par Mobile Money</button></div>`).join("")}</div>
  <p class="m" style="margin-top:12px">Paiement sécurisé par FedaPay : MTN MoMo, Moov Money, Celtiis Cash. Votre abonnement est activé automatiquement après confirmation.</p>
  <div class="panel" style="margin-top:16px"><h3>Historique des paiements</h3>${S.pays.length ? S.pays.map(p => `<div class="row" style="cursor:default;grid-template-columns:1fr auto auto"><span>${fr(p.created_at)} · ${esc(p.plan)}</span><b>${fcfa(p.montant)}</b><span class="pill ${p.statut === "approuve" ? "p-ok" : p.statut === "echoue" ? "p-bad" : "p-warn"}">${{ approuve: "Payé", echoue: "Échoué", en_attente: "En attente" }[p.statut]}</span></div>`).join("") : `<p class="empty">Aucun paiement.</p>`}</div>`;
  document.querySelectorAll("[data-pay]").forEach(b => b.onclick = () => payer(b.dataset.pay, b));
}

async function payer(plan, btn) {
  btn.disabled = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch("/api/pay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ plan }) });
    const j = await r.json();
    if (!r.ok || !j.url) throw new Error(j.error || "Paiement indisponible pour le moment");
    location.href = j.url;
  } catch (e) { toast(e.message); btn.disabled = false; }
}

async function verifierRetourPaiement() {
  const p = new URLSearchParams(location.search);
  const id = p.get("id"); if (!id) return;
  history.replaceState(null, "", location.pathname + "#abonnement");
  const { data: { session } } = await sb.auth.getSession();
  try {
    const r = await fetch("/api/verify?id=" + encodeURIComponent(id), { headers: { Authorization: "Bearer " + session.access_token } });
    const j = await r.json();
    toast(j.statut === "approuve" ? "Paiement confirmé · abonnement activé" : "Paiement non confirmé pour l'instant");
  } catch { toast("Vérification du paiement impossible, réessayez plus tard"); }
  await loadAll();
}

function renderProfil() {
  const t = S.tech;
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:14px">Profil</h1>
  <div class="grid2"><div class="panel"><h3>Vos informations (affichées sur vos carnets et certificats)</h3>
    <form class="form" id="pf">
      <label>Nom complet<input class="field" name="nom" value="${esc(t.nom)}" required></label>
      <label>Entreprise<input class="field" name="entreprise" value="${esc(t.entreprise)}"></label>
      <label>WhatsApp<input class="field" name="whatsapp" value="${esc(t.whatsapp)}"></label>
      <label>Ville<input class="field" name="ville" value="${esc(t.ville)}"></label>
      <label class="full">Type de compte<select class="field" name="profil"><option value="technicien" ${t.profil !== "entreprise" ? "selected" : ""}>Technicien / prestataire de maintenance</option><option value="entreprise" ${t.profil === "entreprise" ? "selected" : ""}>Chef d'entreprise / gestionnaire de sites</option></select></label>
      <div class="full"><button class="btn btn-hot" type="submit">Enregistrer</button></div></form></div>
  <div class="panel"><h3>Compte</h3><p class="m">${esc(S.user.email)}</p>
    <form class="form" id="pw" style="grid-template-columns:1fr;margin-top:10px"><label>Nouveau mot de passe<input class="field" type="password" name="password" minlength="8" autocomplete="new-password"></label><button class="btn btn-ghost btn-sm" type="submit">Changer le mot de passe</button></form>
    <button class="btn btn-ghost btn-sm" id="out" style="margin-top:14px">Se déconnecter</button>
    <p class="m" style="margin-top:14px">Besoin d'aide ? <a href="https://wa.me/${CFG.WHATSAPP_FROIDPASS}" target="_blank" rel="noopener">WhatsApp FroidPass</a></p></div></div>`;
  document.getElementById("pf").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target));
    if (S.tech.profil === undefined) delete o.profil; // base pas encore mise à jour
    const { error } = await sb.from("techniciens").update(o).eq("id", S.user.id);
    if (error) return toast(error.message);
    await loadAll(); toast("Profil enregistré");
  };
  document.getElementById("pw").onsubmit = async ev => {
    ev.preventDefault(); const { error } = await sb.auth.updateUser({ password: new FormData(ev.target).get("password") });
    toast(error ? error.message : "Mot de passe modifié"); ev.target.reset();
  };
  document.getElementById("out").onclick = () => sb.auth.signOut();
}

function renderCert(id) {
  const e = S.eqs.find(x => x.id === id);
  if (!e) { $view.innerHTML = `<p class="empty">Introuvable.</p>`; return; }
  if (!peutRelancer()) { location.hash = "abonnement"; toast("Le certificat PDF est inclus à partir de l'offre Solo"); return; }
  const t = TYPES[e.type], c = client(e.client_id), list = intsOf(e.id);
  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px"><a class="btn btn-ghost btn-sm" href="#eq-${e.id}">← Retour</a><button class="btn btn-hot btn-sm" onclick="print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="cert"><div class="ch"><div><div class="disp" style="font-size:27px;font-weight:800">Certificat d'entretien</div>
    <div class="m">N° FP-${e.code_public.toUpperCase()}-${iso(TODAY).replace(/-/g, "")}</div></div>
    <div style="text-align:right;font-size:14px"><b>${esc(S.tech.entreprise || S.tech.nom)}</b><br>${esc(S.tech.nom)}<br><span class="mono">${esc(S.tech.whatsapp)}</span></div></div>
  <table><tr><th>Client</th><td>${esc(c.nom)}</td><th>Emplacement</th><td>${esc(e.emplacement)}</td></tr>
    <tr><th>Équipement</th><td>${t.label}</td><th>Marque / puissance</th><td>${esc(e.marque)} · ${esc(e.puissance)}</td></tr>
    <tr><th>Fluide</th><td>${esc(e.fluide)}</td><th>Date de pose</th><td>${fr(e.date_pose)}</td></tr>
    <tr><th>Fréquence préventive</th><td>${freq(e)} jours</td><th>Prochaine échéance</th><td>${fr(nextDue(e))}</td></tr></table>
  <h3 style="margin-top:24px;font-size:17px">Historique des interventions</h3>
  <table><tr><th>Date</th><th>Type</th><th>Mesures</th><th>Observations</th></tr>
  ${list.map(x => `<tr><td class="mono">${fr(x.date)}</td><td>${x.type === "preventif" ? "Préventif" : "Curatif"}</td><td class="mono" style="font-size:12px">${[x.hp != null && "HP " + x.hp, x.bp != null && "BP " + x.bp, x.intensite != null && "I " + x.intensite + " A", x.t_soufflage != null && "Ts " + x.t_soufflage + " °C", x.t_reprise != null && "Tr " + x.t_reprise + " °C"].filter(Boolean).join(" · ") || "—"}</td><td>${esc(x.observations)}</td></tr>`).join("") || `<tr><td colspan="4">Aucune intervention</td></tr>`}</table>
  <div class="sig"><div>Le technicien<br><b style="color:var(--ink)">${esc(S.tech.nom)}</b></div><div>Le client<br><b style="color:var(--ink)">${esc(c.contact || c.nom)}</b></div></div>
  <p class="m" style="margin-top:20px">Carnet en ligne : ${esc(publicUrl(e.code_public))} · Généré par FroidPass</p></div>`;
}

function renderLabels() {
  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap"><a class="btn btn-ghost btn-sm" href="#parc">← Retour</a><button class="btn btn-hot btn-sm" onclick="print()">Imprimer les étiquettes</button>
    <span class="m">Format 5 × 5 cm. Imprimez sur vinyle adhésif anti-UV pour les équipements extérieurs.</span></div>
    <div id="labels">${S.eqs.map(e => `<div class="label"><b>${esc(e.emplacement)}</b><div id="lq-${e.id}"></div><span>${esc(S.tech.entreprise || S.tech.nom)} · ${esc(S.tech.whatsapp)}<br>Scannez · FroidPass</span></div>`).join("") || `<p class="empty">Aucun équipement.</p>`}</div>`;
  if (window.QRCode) S.eqs.forEach(e => new QRCode(document.getElementById("lq-" + e.id), { text: publicUrl(e.code_public), width: 110, height: 110, colorDark: "#0b2230", colorLight: "#ffffff" }));
}

function exportCsv() {
  const rows = [["client", "emplacement", "type", "marque", "puissance", "fluide", "environnement", "date_pose", "prochain_entretien", "intervention_date", "intervention_type", "hp", "bp", "intensite", "t_soufflage", "t_reprise", "observations"]];
  for (const e of S.eqs) {
    const base = [client(e.client_id).nom, e.emplacement, TYPES[e.type].label, e.marque, e.puissance, e.fluide, e.environnement, e.date_pose, nextDue(e)];
    const li = intsOf(e.id);
    if (!li.length) rows.push([...base, "", "", "", "", "", "", "", ""]);
    for (const x of li) rows.push([...base, x.date, x.type, x.hp, x.bp, x.intensite, x.t_soufflage, x.t_reprise, x.observations]);
  }
  const csv = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `froidpass-export-${iso(TODAY)}.csv`; a.click();
}

// ---------- Délégation des boutons communs ----------
document.addEventListener("click", e => {
  const r = e.target.closest("[data-relance]"); if (r) relance(r.dataset.relance);
  if (e.target.closest("[data-addeq]")) openAddEq();
});

// ---------- Démarrage ----------
async function start() {
  if (!configured) return route();
  // setTimeout : évite d'appeler Supabase à l'intérieur du rappel d'authentification (blocage connu)
  sb.auth.onAuthStateChange((_ev, session) => setTimeout(() => onSession(session), 0));
}
async function onSession(session) {
  {
    const was = S.user?.id;
    S.user = session?.user || null;
    if (S.user && S.user.id !== was) {
      try { await loadAll(); } catch (e) { toast("Erreur de chargement : " + e.message); }
      await verifierRetourPaiement();
      if (["#connexion", "#inscription", ""].includes(location.hash)) location.hash = "tableau";
    }
    route();
  }
}
start();


// =====================================================================
// RAPPORT DE SITE (un rapport global par client) + QR du site
// =====================================================================
let periodeRapport = 1; // en mois
function renderRapport(clientId) {
  const c = S.clients.find(x => x.id === clientId);
  if (!c) { $view.innerHTML = `<p class="empty">Client introuvable. <a href="#clients">Retour</a></p>`; return; }
  if (!peutRelancer()) { location.hash = "abonnement"; toast("Le rapport de site est inclus à partir de l'offre Solo"); return; }
  const now = new Date(TODAY);
  const debut = periodeRapport === 1 ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) : TODAY - periodeRapport * 30 * DAY;
  const moisNom = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  const libellePeriode = periodeRapport === 1 ? `${moisNom[now.getUTCMonth()]} ${now.getUTCFullYear()}` : `du ${fr(iso(debut))} au ${fr(iso(TODAY))}`;
  const eqs = S.eqs.filter(e => e.client_id === c.id).sort((a, b) => (a.zone || "").localeCompare(b.zone || "") || a.emplacement.localeCompare(b.emplacement, "fr", { numeric: true }));
  const sts = eqs.map(e => ({ e, s: status(e) }));
  const nbOk = sts.filter(x => x.s.d > 14).length, nbSoon = sts.filter(x => x.s.d >= 0 && x.s.d <= 14).length, nbLate = sts.filter(x => x.s.d < 0).length;
  const pct = eqs.length ? Math.round(100 * (nbOk + nbSoon) / eqs.length) : 0;
  const intsPeriode = S.ints.filter(i => eqs.some(e => e.id === i.equipement_id) && Date.parse(i.date) >= debut && Date.parse(i.date) <= TODAY).sort((a, b) => b.date.localeCompare(a.date));
  const eqOf = id => eqs.find(e => e.id === id);
  const anomalies = intsPeriode.flatMap(i => flags(i).map(f => ({ i, f })));
  const planning = sts.filter(x => x.s.d <= 31).sort((a, b) => a.s.d - b.s.d);
  const lastPrev = e => (intsOf(e.id).find(x => x.type === "preventif") || {}).date;
  const zones = [...new Set(eqs.map(e => e.zone || ""))];
  const ligneEq = ({ e, s }) => `<tr><td>${esc(e.emplacement)}</td><td>${TYPES[e.type].label}</td><td>${esc(e.marque)} ${esc(e.puissance)}</td><td class="mono">${fr(lastPrev(e))}</td><td class="mono">${fr(nextDue(e))}</td><td><span class="pill ${s.cls}">${s.d < 0 ? "En retard" : s.d <= 14 ? "Bientôt" : "À jour"}</span></td></tr>`;

  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      <a class="btn btn-ghost btn-sm" href="#clients">← ${W().Clients}</a>
      <select class="field" id="per" style="width:auto;padding:7px 10px"><option value="1">Mois en cours</option><option value="3">3 derniers mois</option><option value="6">6 derniers mois</option><option value="12">12 derniers mois</option></select>
      <button class="btn btn-hot btn-sm" onclick="print()">Imprimer / Enregistrer en PDF</button>
      <a class="btn btn-ghost btn-sm" href="#siteqr-${c.id}">QR du site</a>
      ${c.whatsapp ? `<a class="btn btn-teal btn-sm" target="_blank" rel="noopener" href="https://wa.me/${waNum(c.whatsapp)}?text=${encodeURIComponent(`Bonjour ${c.contact || ""}, voici l'état de maintenance de vos équipements (${eqs.length} équipements, ${pct} % à jour) : ${siteUrl(c)}\n\nJe vous remets le rapport détaillé de ${libellePeriode} en PDF. ${S.tech.nom}`)}">Envoyer le lien au client</a>` : ""}
    </div>
  <div class="cert">
    <div class="ch"><div><div class="disp" style="font-size:26px;font-weight:800">Rapport de maintenance</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px">${esc(c.nom)}</div><div class="m">Période : ${libellePeriode}</div></div>
      <div style="text-align:right;font-size:14px"><b>${esc(S.tech.entreprise || S.tech.nom)}</b><br>${esc(S.tech.nom)}<br><span class="mono">${esc(S.tech.whatsapp)}</span><br><span class="m">Édité le ${fr(iso(TODAY))}</span></div></div>

    <h3 style="font-size:17px">1. Synthèse</h3>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0 6px">
      ${[[eqs.length, "équipements"], [pct + " %", "du parc à jour"], [nbOk, "à jour"], [nbSoon, "bientôt dus"], [nbLate, "en retard"]].map(([v, l], k) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center"><div class="disp" style="font-size:24px;font-weight:800;color:${k === 4 && nbLate ? "var(--bad)" : "var(--ink)"}">${v}</div><div class="m" style="font-size:12.5px">${l}</div></div>`).join("")}
    </div>
    <p style="font-size:14px">${intsPeriode.length} intervention(s) sur la période (${intsPeriode.filter(i => i.type === "preventif").length} préventive(s), ${intsPeriode.filter(i => i.type === "curatif").length} curative(s)) · ${anomalies.length} anomalie(s) relevée(s).</p>

    <h3 style="font-size:17px;margin-top:22px">2. État du parc</h3>
    ${zones.map(z => `${zones.length > 1 || z ? `<div style="font-weight:600;margin-top:10px">${esc(z || "Sans zone")}</div>` : ""}
      <table><tr><th>Emplacement</th><th>Type</th><th>Marque / puissance</th><th>Dernier entretien</th><th>Prochain</th><th>Statut</th></tr>
      ${sts.filter(x => (x.e.zone || "") === z).map(ligneEq).join("")}</table>`).join("") || `<p class="empty">Aucun équipement.</p>`}

    <h3 style="font-size:17px;margin-top:22px">3. Interventions de la période</h3>
    <table><tr><th>Date</th><th>Équipement</th><th>Type</th><th>Mesures</th><th>Observations</th></tr>
    ${intsPeriode.map(x => `<tr><td class="mono">${fr(x.date)}</td><td>${esc(eqOf(x.equipement_id).emplacement)}</td><td>${x.type === "preventif" ? "Préventif" : "Curatif"}</td><td class="mono" style="font-size:12px">${[x.hp != null && "HP " + x.hp, x.bp != null && "BP " + x.bp, x.intensite != null && "I " + x.intensite + " A", x.t_soufflage != null && "Ts " + x.t_soufflage + " °C", x.t_reprise != null && "Tr " + x.t_reprise + " °C"].filter(Boolean).join(" · ") || "—"}</td><td>${esc(x.observations)}</td></tr>`).join("") || `<tr><td colspan="5">Aucune intervention sur la période</td></tr>`}</table>

    <h3 style="font-size:17px;margin-top:22px">4. Anomalies et recommandations</h3>
    ${anomalies.length ? `<table><tr><th>Date</th><th>Équipement</th><th>Constat / recommandation</th></tr>${anomalies.map(({ i, f }) => `<tr><td class="mono">${fr(i.date)}</td><td>${esc(eqOf(i.equipement_id).emplacement)}</td><td>${f}</td></tr>`).join("")}</table>` : `<p style="font-size:14px">Aucune anomalie relevée sur la période.</p>`}
    ${nbLate ? `<p style="font-size:14px;margin-top:8px"><b>Recommandation :</b> planifier rapidement l'entretien des ${nbLate} équipement(s) en retard.</p>` : ""}

    <h3 style="font-size:17px;margin-top:22px">5. Planning des 30 prochains jours</h3>
    ${planning.length ? `<table><tr><th>Date prévue</th><th>Équipement</th><th>Type</th><th>Points de contrôle</th></tr>${planning.map(({ e, s }) => `<tr><td class="mono" style="color:${s.d < 0 ? "var(--bad)" : "inherit"}">${s.d < 0 ? "En retard (" + fr(nextDue(e)) + ")" : fr(nextDue(e))}</td><td>${esc(e.emplacement)}${e.zone ? " · " + esc(e.zone) : ""}</td><td>${TYPES[e.type].label}</td><td style="font-size:12.5px">${TYPES[e.type].pts}</td></tr>`).join("")}</table>` : `<p style="font-size:14px">Aucun entretien prévu dans les 30 prochains jours.</p>`}

    <div class="sig"><div>${W().signataire}<br><b style="color:var(--ink)">${esc(S.tech.nom)}</b></div><div>${isEnt() ? "Le responsable du site" : "Pour le client"}<br><b style="color:var(--ink)">${esc(c.contact || c.nom)}</b></div></div>
    <p class="m" style="margin-top:18px">État du parc en ligne : ${esc(siteUrl(c))} · Généré par FroidPass</p>
  </div>`;
  const sel = document.getElementById("per"); sel.value = String(periodeRapport);
  sel.onchange = () => { periodeRapport = Number(sel.value); renderRapport(clientId); };
}

const siteUrl = c => location.origin + "/s.html?c=" + (c.code_public || "");

function renderSiteQR(clientId) {
  const c = S.clients.find(x => x.id === clientId);
  if (!c) { $view.innerHTML = `<p class="empty">Client introuvable.</p>`; return; }
  if (!peutRelancer()) { location.hash = "abonnement"; toast("Le QR du site est inclus à partir de l'offre Solo"); return; }
  if (!c.code_public) { $view.innerHTML = `<div class="panel"><h3>Mise à jour de la base nécessaire</h3><p class="m">Exécutez le fichier <span class="mono">supabase/rapport-site.sql</span> dans Supabase (SQL Editor), puis rechargez la page.</p></div>`; return; }
  const n = S.eqs.filter(e => e.client_id === c.id).length;
  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap"><a class="btn btn-ghost btn-sm" href="#clients">← ${W().Clients}</a><button class="btn btn-hot btn-sm" onclick="print()">Imprimer l'affiche</button><a class="btn btn-ghost btn-sm" href="${siteUrl(c)}" target="_blank" rel="noopener">Voir la page du site</a><a class="btn btn-ghost btn-sm" href="#rapport-${c.id}">Rapport du site</a></div>
  <div class="cert" style="text-align:center;max-width:620px">
    <div class="disp" style="font-size:30px;font-weight:800">${esc(c.nom)}</div>
    <p style="font-size:18px;margin:6px 0 18px">Suivi de maintenance des équipements de froid et de climatisation</p>
    <div class="qr" id="siteqr" style="padding:16px"></div>
    <p style="font-size:17px;margin-top:16px"><b>Scannez pour voir l'état des ${n} équipements</b><br>derniers et prochains entretiens</p>
    <p class="m" style="margin-top:18px">Maintenance assurée par <b>${esc(S.tech.entreprise || S.tech.nom)}</b> · ${esc(S.tech.whatsapp)}</p>
    <p class="m" style="font-size:12px;margin-top:8px">FroidPass</p>
  </div>`;
  if (window.QRCode) new QRCode(document.getElementById("siteqr"), { text: siteUrl(c), width: 240, height: 240, colorDark: "#0b2230", colorLight: "#ffffff" });
}


// =====================================================================
// VUE MULTI-SITES (tableau de bord) + RAPPORT CONSOLIDÉ TOUS SITES
// =====================================================================
function statsSite(c) {
  const eqs = S.eqs.filter(e => e.client_id === c.id), st = eqs.map(status);
  const late = st.filter(x => x.d < 0).length, soon = st.filter(x => x.d >= 0 && x.d <= 14).length;
  const pct = eqs.length ? Math.round(100 * (eqs.length - late) / eqs.length) : null;
  const prochain = eqs.map(nextDue).sort()[0];
  const ints30 = S.ints.filter(i => eqs.some(e => e.id === i.equipement_id) && Date.parse(i.date) >= TODAY - 30 * DAY).length;
  return { eqs: eqs.length, late, soon, pct, prochain, ints30 };
}
function vueSites() {
  if (S.clients.length < 1) return "";
  const rows = S.clients.map(c => ({ c, s: statsSite(c) })).sort((a, b) => (a.s.pct ?? 101) - (b.s.pct ?? 101));
  return `<div class="panel" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
    <h3 style="margin:0">Vue ${isEnt() ? "multi-sites" : "par client"}</h3><span style="display:flex;gap:6px"><a class="btn btn-teal btn-sm" href="#planning">Planning préventif</a><a class="btn btn-ghost btn-sm" href="#rapport-global">Rapport consolidé</a></span></div>
    <div style="overflow-x:auto"><table class="tbl"><tbody>
    <tr><th>${W().Clients.slice(0, -1)}</th><th>Équipements</th><th>À jour</th><th>En retard</th><th>Interventions 30 j</th><th>Prochain entretien</th><th></th></tr>
    ${rows.map(({ c, s }) => `<tr><td><b>${esc(c.nom)}</b></td><td>${s.eqs}</td><td>${s.pct == null ? "—" : `<span class="pill ${s.pct >= 90 ? "p-ok" : s.pct >= 70 ? "p-warn" : "p-bad"}">${s.pct} %</span>`}</td><td style="color:${s.late ? "var(--bad)" : "inherit"}">${s.late}</td><td>${s.ints30}</td><td class="mono">${fr(s.prochain)}</td><td><a href="#rapport-${c.id}">Rapport</a></td></tr>`).join("")}
    </tbody></table></div></div>`;
}
function renderRapportGlobal() {
  if (!peutRelancer()) { location.hash = "abonnement"; toast("Le rapport consolidé est inclus à partir de l'offre Solo"); return; }
  const rows = S.clients.map(c => ({ c, s: statsSite(c) }));
  const tot = rows.reduce((a, { s }) => ({ eqs: a.eqs + s.eqs, late: a.late + s.late, soon: a.soon + s.soon, ints30: a.ints30 + s.ints30 }), { eqs: 0, late: 0, soon: 0, ints30: 0 });
  const pct = tot.eqs ? Math.round(100 * (tot.eqs - tot.late) / tot.eqs) : 0;
  const retards = S.eqs.filter(e => status(e).d < 0).sort((a, b) => status(a).d - status(b).d);
  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px"><a class="btn btn-ghost btn-sm" href="#tableau">← Tableau</a><button class="btn btn-hot btn-sm" onclick="print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="cert"><div class="ch"><div><div class="disp" style="font-size:26px;font-weight:800">Rapport consolidé de maintenance</div>
    <div class="m">${rows.length} ${W().clients} · édité le ${fr(iso(TODAY))}</div></div>
    <div style="text-align:right;font-size:14px"><b>${esc(S.tech.entreprise || S.tech.nom)}</b><br>${esc(S.tech.nom)}</div></div>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
    ${[[rows.length, W().clients], [tot.eqs, "équipements"], [pct + " %", "parc à jour"], [tot.late, "en retard"], [tot.ints30, "interventions 30 j"]].map(([v, l], k) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center"><div class="disp" style="font-size:24px;font-weight:800;color:${k === 3 && tot.late ? "var(--bad)" : "var(--ink)"}">${v}</div><div class="m" style="font-size:12.5px">${l}</div></div>`).join("")}
  </div>
  <h3 style="font-size:17px">Par ${W().client}</h3>
  <table><tr><th>${W().Clients.slice(0, -1)}</th><th>Équipements</th><th>À jour</th><th>Bientôt</th><th>En retard</th><th>Interventions 30 j</th><th>Prochain entretien</th></tr>
  ${rows.map(({ c, s }) => `<tr><td>${esc(c.nom)}</td><td>${s.eqs}</td><td>${s.pct == null ? "—" : s.pct + " %"}</td><td>${s.soon}</td><td>${s.late}</td><td>${s.ints30}</td><td class="mono">${fr(s.prochain)}</td></tr>`).join("")}</table>
  <h3 style="font-size:17px;margin-top:22px">Équipements en retard (${retards.length})</h3>
  ${retards.length ? `<table><tr><th>${W().Clients.slice(0, -1)}</th><th>Équipement</th><th>Type</th><th>Échéance dépassée</th></tr>${retards.map(e => `<tr><td>${esc(client(e.client_id).nom)}</td><td>${esc(e.emplacement)}${e.zone ? " · " + esc(e.zone) : ""}</td><td>${TYPES[e.type].label}</td><td class="mono" style="color:var(--bad)">${fr(nextDue(e))}</td></tr>`).join("")}</table>` : `<p style="font-size:14px">Aucun équipement en retard. ✅</p>`}
  <p class="m" style="margin-top:18px">Généré par FroidPass</p></div>`;
}


// =====================================================================
// SIGNALEMENTS DE PANNE (envoyés par le personnel du site via le QR)
// =====================================================================
function sigsHTML(list, global = false) {
  if (!list.length) return "";
  const eqOf = id => S.eqs.find(e => e.id === id) || {};
  return `<div class="panel" style="border:2px solid var(--bad)"><h3>🚨 ${list.length} signalement(s) de panne ${global ? "à traiter" : "ouvert(s)"}</h3>
  ${list.map(x => { const e = eqOf(x.equipement_id); return `<div style="padding:10px 0;border-top:1px solid var(--line)">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${global ? `<a href="#eq-${e.id}">${esc(e.emplacement || "?")}</a> · ${esc(client(e.client_id).nom || "")}` : "Signalement"}</b><span class="m">${fr(x.created_at)} · ${x.statut === "nouveau" ? "Nouveau" : "En cours"}</span></div>
    <div style="margin:4px 0">${esc(x.description)}</div>
    <div class="m">${esc(x.nom)} ${x.telephone ? "· " + esc(x.telephone) : ""}</div>
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      ${x.telephone ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/${waNum(x.telephone)}?text=${encodeURIComponent("Bonjour, nous avons bien reçu votre signalement concernant « " + (e.emplacement || "") + " ». Intervention en cours de planification.")}">Répondre</a>` : ""}
      ${x.statut === "nouveau" ? `<button class="btn btn-teal btn-sm" data-sig="${x.id}" data-st="en_cours">Prendre en charge</button>` : ""}
      <button class="btn btn-hot btn-sm" data-sig="${x.id}" data-st="resolu">Marquer résolu</button></div></div>`; }).join("")}</div>`;
}
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-sig]"); if (!b) return;
  b.disabled = true;
  const patch = { statut: b.dataset.st }; if (b.dataset.st === "resolu") patch.resolu_at = new Date().toISOString();
  const { error } = await sb.from("signalements").update(patch).eq("id", b.dataset.sig);
  if (error) { toast(error.message); b.disabled = false; return; }
  await loadAll(); route(); toast(b.dataset.st === "resolu" ? "Signalement résolu · pensez à enregistrer l'intervention curative" : "Signalement pris en charge");
});


// =====================================================================
// PLANNING GÉNÉRAL DE MAINTENANCE PRÉVENTIVE (tous les sites)
// =====================================================================
let PL = { horizon: 60, site: "", crit: "" };
function occurrences(horizonJours) {
  const fin = TODAY + horizonJours * DAY, out = [];
  for (const e of S.eqs) {
    if (PL.site && e.client_id !== PL.site) continue;
    if (PL.crit && (e.criticite || "normale") !== PL.crit) continue;
    const f = freq(e) * DAY; let d = Date.parse(nextDue(e));
    if (d < TODAY) { out.push({ e, d, retard: true }); d = TODAY + f; }  // en retard : à faire maintenant, puis le cycle reprend
    for (; d <= fin; d += f) out.push({ e, d, retard: false });
  }
  return out.sort((a, b) => (b.retard - a.retard) || a.d - b.d || ((b.e.criticite === "critique") - (a.e.criticite === "critique")));
}
function lundi(t) { const x = new Date(t), j = (x.getUTCDay() + 6) % 7; return t - j * DAY; }
function renderPlanning() {
  const occ = occurrences(PL.horizon), retards = occ.filter(o => o.retard), avenir = occ.filter(o => !o.retard);
  const semaines = {}; for (const o of avenir) (semaines[lundi(o.d)] ||= []).push(o);
  const parSite = S.clients.map(c => ({ c, n: occ.filter(o => o.e.client_id === c.id).length, r: retards.filter(o => o.e.client_id === c.id).length })).filter(x => x.n);
  const charge = Object.keys(semaines).map(Number).sort((a, b) => a - b);
  const maxSem = Math.max(1, ...charge.map(k => semaines[k].length));
  const ligne = o => `<tr><td class="mono" style="color:${o.retard ? "var(--bad)" : "inherit"}">${o.retard ? "En retard (" + fr(nextDue(o.e)) + ")" : fr(iso(o.d))}</td><td>${esc(client(o.e.client_id).nom)}</td><td><a href="#eq-${o.e.id}">${esc(o.e.emplacement)}</a>${o.e.zone ? `<div class="m">${esc(o.e.zone)}</div>` : ""}</td><td>${TYPES[o.e.type]?.label || o.e.type}</td><td>${o.e.criticite && o.e.criticite !== "normale" ? `<span class="pill ${CRIT[o.e.criticite].cls}">${CRIT[o.e.criticite].label}</span>` : "—"}</td><td style="font-size:12.5px">${TYPES[o.e.type]?.pts || ""}</td></tr>`;
  const entete = `<tr><th>Date</th><th>${W().Clients.slice(0, -1)}</th><th>Équipement</th><th>Type</th><th>Criticité</th><th>Points de contrôle</th></tr>`;
  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
      <h1 style="font-size:28px;margin-right:auto">Planning préventif</h1>
      <select class="field" id="plH" style="width:auto;padding:7px 10px"><option value="30">30 jours</option><option value="60">60 jours</option><option value="90">90 jours</option><option value="180">6 mois</option><option value="365">12 mois</option></select>
      <select class="field" id="plS" style="width:auto;padding:7px 10px"><option value="">Tous les ${W().clients}</option>${S.clients.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join("")}</select>
      <select class="field" id="plC" style="width:auto;padding:7px 10px"><option value="">Toutes criticités</option><option value="critique">Critique</option><option value="haute">Haute</option><option value="normale">Normale</option></select>
      <button class="btn btn-ghost btn-sm" id="plCsv">Exporter (Excel)</button>
      <button class="btn btn-hot btn-sm" onclick="print()">Imprimer</button></div>
  <div class="cert" style="max-width:none">
    <div class="ch"><div><div class="disp" style="font-size:24px;font-weight:800">Planning de maintenance préventive</div>
      <div class="m">${PL.site ? esc(client(PL.site).nom) : `Tous les ${W().clients} (${S.clients.length})`} · du ${fr(iso(TODAY))} au ${fr(iso(TODAY + PL.horizon * DAY))}</div></div>
      <div style="text-align:right;font-size:14px"><b>${esc(S.tech.entreprise || S.tech.nom)}</b><br><span class="m">Édité le ${fr(iso(TODAY))}</span></div></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
      ${[[occ.length, "interventions planifiées"], [retards.length, "en retard"], [occ.filter(o => o.e.criticite === "critique").length, "sur équipements critiques"], [parSite.length, W().clients + " concernés"]].map(([v, l], k) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center"><div class="disp" style="font-size:24px;font-weight:800;color:${k === 1 && v ? "var(--bad)" : "var(--ink)"}">${v}</div><div class="m" style="font-size:12.5px">${l}</div></div>`).join("")}
    </div>
    ${charge.length ? `<h3 style="font-size:16px">Charge par semaine</h3>
    <div style="display:flex;align-items:flex-end;gap:6px;height:110px;margin:8px 0 4px;border-bottom:1px solid var(--line)">${charge.map(k => `<div title="${semaines[k].length} intervention(s)" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%"><span style="font-size:11px">${semaines[k].length}</span><div style="width:100%;max-width:38px;height:${Math.round(85 * semaines[k].length / maxSem)}%;background:var(--teal);border-radius:4px 4px 0 0"></div></div>`).join("")}</div>
    <div style="display:flex;gap:6px">${charge.map(k => `<div style="flex:1;text-align:center;font-size:10.5px;color:var(--mute)">${fr(iso(k)).slice(0, 5)}</div>`).join("")}</div>` : ""}
    ${parSite.length > 1 ? `<h3 style="font-size:16px;margin-top:18px">Par ${W().client}</h3><table><tr><th>${W().Clients.slice(0, -1)}</th><th>Interventions planifiées</th><th>Dont en retard</th></tr>${parSite.map(x => `<tr><td>${esc(x.c.nom)}</td><td>${x.n}</td><td style="color:${x.r ? "var(--bad)" : "inherit"}">${x.r}</td></tr>`).join("")}</table>` : ""}
    ${retards.length ? `<h3 style="font-size:16px;margin-top:18px;color:var(--bad)">À rattraper immédiatement (${retards.length})</h3><table>${entete}${retards.map(ligne).join("")}</table>` : ""}
    ${charge.map(k => `<h3 style="font-size:16px;margin-top:18px">Semaine du ${fr(iso(k))} <span class="m">· ${semaines[k].length} intervention(s)</span></h3><table>${entete}${semaines[k].map(ligne).join("")}</table>`).join("") || (retards.length ? "" : `<p class="empty">Aucun entretien prévu sur la période.</p>`)}
    <p class="m" style="margin-top:18px">Dates calculées à partir du dernier entretien préventif et de la fréquence de chaque équipement. Généré par FroidPass.</p>
  </div>`;
  const h = document.getElementById("plH"), si = document.getElementById("plS"), cr = document.getElementById("plC");
  h.value = String(PL.horizon); si.value = PL.site; cr.value = PL.crit;
  h.onchange = () => { PL.horizon = Number(h.value); renderPlanning(); };
  si.onchange = () => { PL.site = si.value; renderPlanning(); };
  cr.onchange = () => { PL.crit = cr.value; renderPlanning(); };
  document.getElementById("plCsv").onclick = () => {
    const rows = [["date", "statut", "site", "zone", "equipement", "type", "criticite", "points_de_controle"], ...occ.map(o => [o.retard ? nextDue(o.e) : iso(o.d), o.retard ? "en retard" : "planifié", client(o.e.client_id).nom, o.e.zone || "", o.e.emplacement, TYPES[o.e.type]?.label || o.e.type, o.e.criticite || "normale", TYPES[o.e.type]?.pts || ""])];
    const csv = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `planning-preventif-${iso(TODAY)}.csv`; a.click();
  };
}
