// =====================================================================
// FroidPass — application technicien
// =====================================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { periode, dernieresPeriodes, TYPES_PERIODE } from "./periodes.js?v=1";

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
  { id: "equipe_mensuel", nom: "Équipe · 1 mois", prix: 40000, detail: "Équipe (responsable + techniciens), multi-sites, GMAO complète" }
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
// Fréquence par défaut selon l'emplacement : près de la mer (le plus court), dehors loin de la mer (intermédiaire), à l'abri
const ENV = { cotier: ["Près de la mer (air salé)", "près de la mer"], exterieur: ["Loin de la mer, dehors (soleil, pluie, poussière)", "dehors, loin de la mer"], interieur: ["À l'intérieur, à l'abri (pièce fermée, local technique)", "à l'intérieur, à l'abri"] };
const freqDefaut = (type, env) => { const t = TYPES[type] || TYPES.split; return env === "cotier" ? t.cotier : env === "exterieur" ? Math.round((t.cotier + t.interieur) / 30) * 15 : t.interieur; };
const freq = e => e.frequence_jours || freqDefaut(e.type, e.environnement);
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
const isAdmin = () => S.role !== "technicien";
const nomMembre = uid => (S.membres || []).find(m => m.user_id === uid)?.nom || (uid === S.orgId ? (S.tech?.nom || "Responsable") : "");
const W = () => isEnt()
  ? { client: "site", clients: "sites", Clients: "Sites", nouveauClient: "Nouveau site", nomClient: "Nom du site", phNom: "Siège, Agence Akpakpa, Usine…", contact: "Responsable du site ou prestataire", waContact: "WhatsApp du responsable / prestataire", relance: "Demander l'intervention (WhatsApp)", signataire: "Le responsable maintenance" }
  : { client: "client", clients: "clients", Clients: "Clients", nouveauClient: "Nouveau client", nomClient: "Nom de l'établissement", phNom: "Hôtel, clinique, restaurant…", contact: "Personne à contacter", waContact: "WhatsApp du client", relance: "Préparer le message WhatsApp", signataire: "Le technicien" };
function majMenu() { const a = document.querySelector('#menu a[data-v="clients"]'); if (a) a.textContent = W().Clients; }

// ---------- Données ----------
async function loadAll() {
  // Équipe : accepter une invitation en attente, puis déterminer l'organisation et le rôle
  if (!S.invChecked) { S.invChecked = true; try { const r = await sb.rpc("accepter_invitation"); if (r.data?.statut === "acceptee") toast("Bienvenue dans l'équipe !"); } catch {} }
  const mb = await sb.from("membres").select("*");
  S.membres = mb.error ? [] : mb.data;
  S.moi = S.membres.find(m => m.user_id === S.user.id) || null;
  S.role = S.moi ? S.moi.role : "admin";
  S.orgId = S.moi ? S.moi.org_id : S.user.id;
  const [t, c, e, i, p] = await Promise.all([
    sb.from("techniciens").select("*"),
    sb.from("clients").select("*").order("nom"),
    sb.from("equipements").select("*").order("created_at"),
    sb.from("interventions").select("*").order("date", { ascending: false }),
    sb.from("paiements").select("*").order("created_at", { ascending: false })
  ]);
  for (const r of [t, c, e, i, p]) if (r.error) throw r.error;
  t.data = t.data.find(x => x.id === S.orgId) || t.data.find(x => x.id === S.user.id);
  S.me = (await sb.from("techniciens").select("*").eq("id", S.user.id).single()).data || t.data;
  S.invitations = [];
  if (S.role === "admin") { const iv = await sb.from("invitations").select("*").order("created_at", { ascending: false }); S.invitations = iv.error ? [] : iv.data; }
  const sg = await sb.from("signalements").select("*").order("created_at", { ascending: false });
  S.sigs = sg.error ? [] : sg.data;
  S.rapports = [];
  if (S.role === "admin") { const rp = await sb.from("rapports_envoyes").select("*").order("created_at", { ascending: false }); S.rapports = rp.error ? [] : rp.data; }
  // Module GMAO (tolérant si la mise à jour SQL n'est pas encore faite)
  const [o, pc, cs] = await Promise.all([
    sb.from("ordres_travail").select("*").order("created_at", { ascending: false }),
    sb.from("pieces").select("*").order("designation"),
    sb.from("consommations").select("*").order("created_at", { ascending: false })
  ]);
  S.gmao = !o.error; S.ots = o.error ? [] : o.data; S.pieces = pc.error ? [] : pc.data; S.consos = cs.error ? [] : cs.data;
  S.tech = t.data; S.clients = c.data; S.eqs = e.data; S.ints = i.data; S.pays = p.data;
}

// =====================================================================
// PHOTOS DES PIÈCES (défectueuses / remplacées) — compressées puis stockées dans Supabase Storage
// =====================================================================
const PHOTO_CAT = { defectueuse: ["Pièce défectueuse", "p-bad"], remplacee: ["Pièce remplacée (neuve)", "p-ok"], avant: ["Avant intervention", "p-warn"], apres: ["Après intervention", "p-ok"], autre: ["Autre", ""] };
const MAX_PHOTOS = 6;
const photoUrl = p => CFG.SUPABASE_URL + "/storage/v1/object/public/photos/" + p.split("/").map(encodeURIComponent).join("/");
// mode "app" : boutons d'analyse IA (et validation pour le responsable) · mode "rapport" : seulement les analyses validées
function photosHTML(list, it, mode = "app") {
  if (!Array.isArray(list) || !list.length) return "";
  const fig = (ph, k) => { const c = PHOTO_CAT[ph.categorie] || PHOTO_CAT.autre; return `<figure><a href="${photoUrl(ph.path)}" target="_blank" rel="noopener"><img loading="lazy" src="${photoUrl(ph.path)}" alt="${esc(c[0])}"></a><figcaption><span class="pill ${c[1]}">${c[0]}</span>${ph.legende ? " " + esc(ph.legende) : ""}</figcaption>${it && mode === "app" && !ph.analyse ? `<button class="btn btn-ghost btn-sm noprint ia-btn" data-ia="${it.id}:${k}">🤖 Analyser avec l'IA</button>` : ""}</figure>`; };
  const analyses = list.map((ph, k) => ({ ph, k })).filter(({ ph }) => ph.analyse && (mode === "app" || ph.analyse.valide));
  return `<div class="ph-grid">${list.map(fig).join("")}</div>${analyses.map(({ ph, k }) => `<div class="ia-box ${ph.analyse.valide ? "ok" : ""}">
    <div class="ia-h"><b>${ph.analyse.valide ? "Diagnostic de la pièce" : "🤖 Analyse IA"} — photo ${k + 1}${ph.legende ? " (" + esc(ph.legende) + ")" : ""}</b>
    ${mode === "app" ? `<span class="pill ${ph.analyse.valide ? "p-ok" : "p-warn"}">${ph.analyse.valide ? "Validée · visible dans le rapport client" : "À valider par le responsable"}</span>` : `<span class="m">validé par le responsable maintenance</span>`}</div>
    <div class="ia-t">${esc(ph.analyse.texte)}</div>
    ${mode === "app" ? `<div class="noprint" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${isAdmin() ? `${ph.analyse.valide ? `<button class="btn btn-ghost btn-sm" data-iaval="${it.id}:${k}:0">Retirer du rapport</button>` : `<button class="btn btn-teal btn-sm" data-iaval="${it.id}:${k}:1">✔ Valider pour le rapport</button>`}<button class="btn btn-ghost btn-sm" data-iaedit="${it.id}:${k}">Corriger</button>` : ""}<button class="btn btn-ghost btn-sm" data-ia="${it.id}:${k}">Relancer l'analyse</button></div>
    <p class="m" style="font-size:11.5px;margin-top:6px">Aide au diagnostic générée par IA (${esc(ph.analyse.modele || "")}, ${fr(ph.analyse.date)}). À confirmer par une mesure réelle avant toute décision.</p>` : ""}</div>`).join("")}`;
}
// Actions IA (délégation : les boutons sont générés dans plusieurs écrans)
async function majPhotosIntervention(id, fn) {
  const it = S.ints.find(x => x.id === id); if (!it) return;
  const photos = JSON.parse(JSON.stringify(it.photos || [])); fn(photos);
  const { error } = await sb.from("interventions").update({ photos }).eq("id", id);
  if (error) throw error;
  await loadAll(); route();
}
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-ia],[data-iaval],[data-iaedit]"); if (!b) return;
  if (b.dataset.ia) {
    const [id, k] = b.dataset.ia.split(":"); b.disabled = true; const lib = b.textContent; b.textContent = "Analyse en cours… (10-30 s)";
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch("/api/analyser-photo", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ intervention_id: id, index: Number(k) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Analyse impossible");
      await loadAll(); route(); toast(`Analyse terminée${j.restant != null ? ` · ${j.restant} analyse(s) restante(s) aujourd'hui` : ""}${isAdmin() ? "" : " · le responsable doit la valider"}`);
    } catch (e) { toast(e.message); b.disabled = false; b.textContent = lib; }
  } else if (b.dataset.iaval) {
    const [id, k, v] = b.dataset.iaval.split(":");
    try { await majPhotosIntervention(id, ph => { ph[k].analyse.valide = v === "1"; ph[k].analyse.valide_par = (S.me || S.tech).nom; }); toast(v === "1" ? "Diagnostic validé · il apparaîtra dans le rapport client" : "Diagnostic retiré du rapport client"); } catch (e) { toast(e.message); }
  } else if (b.dataset.iaedit) {
    const [id, k] = b.dataset.iaedit.split(":"), ph = (S.ints.find(x => x.id === id)?.photos || [])[k]; if (!ph?.analyse) return;
    modal(`<div class="panel"><h3>Corriger le diagnostic</h3><p class="m">Corrigez ou complétez l'analyse (mesures réelles, référence exacte…) puis validez-la pour le rapport client.</p>
      <textarea class="field" id="iaTxt" rows="14" style="margin-top:8px">${esc(ph.analyse.texte)}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-hot" id="iaOk">Enregistrer et valider</button><button class="btn btn-ghost" data-close>Annuler</button></div></div>`);
    document.getElementById("iaOk").onclick = async () => {
      const t = document.getElementById("iaTxt").value.trim().slice(0, 4000); if (!t) return;
      try { modal(""); await majPhotosIntervention(id, p => { Object.assign(p[k].analyse, { texte: t, valide: true, corrige: true, valide_par: (S.me || S.tech).nom }); }); toast("Diagnostic corrigé et validé"); } catch (e) { toast(e.message); }
    };
  }
});
const photosChampHTML = () => `<div class="full ph-champ"><b style="font-size:14px">📷 Photos des pièces</b> <span class="m">(pièce défectueuse, pièce remplacée, avant / après · ${MAX_PHOTOS} max · compressées automatiquement)</span>
  <div class="ph-list"></div><label class="btn btn-ghost btn-sm" style="cursor:pointer;margin-top:6px">+ Ajouter des photos<input type="file" accept="image/*" multiple hidden></label></div>`;
// Branche le champ photos d'un formulaire ; renvoie une fonction qui téléverse et donne la liste à enregistrer
function brancherPhotos(form, equipementId) {
  const box = form.querySelector(".ph-champ"); if (!box) return async () => [];
  const items = [], list = box.querySelector(".ph-list"), input = box.querySelector("input[type=file]");
  const draw = () => {
    list.innerHTML = items.map((it, k) => `<div class="ph-in" data-k="${k}"><img src="${it.url}" alt=""><select class="field" data-cat>${Object.entries(PHOTO_CAT).map(([v, [l]]) => `<option value="${v}" ${v === it.categorie ? "selected" : ""}>${l}</option>`).join("")}</select><input class="field" data-leg placeholder="Légende (ex. condensateur 35 µF gonflé)" value="${esc(it.legende)}"><button type="button" class="btn btn-ghost btn-sm" data-rmph>✕</button></div>`).join("");
    box.querySelector("label.btn").hidden = items.length >= MAX_PHOTOS;
  };
  input.onchange = () => {
    for (const f of [...input.files]) {
      if (items.length >= MAX_PHOTOS) { toast(`${MAX_PHOTOS} photos maximum par intervention`); break; }
      if (!f.type.startsWith("image/")) continue;
      const prec = items[items.length - 1];
      items.push({ file: f, url: URL.createObjectURL(f), categorie: prec?.categorie === "defectueuse" ? "remplacee" : "defectueuse", legende: "" });
    }
    input.value = ""; draw();
  };
  list.oninput = list.onchange = ev => { const row = ev.target.closest(".ph-in"); if (!row) return; const it = items[row.dataset.k]; if (ev.target.matches("[data-cat]")) it.categorie = ev.target.value; if (ev.target.matches("[data-leg]")) it.legende = ev.target.value.slice(0, 140); };
  list.onclick = ev => { if (!ev.target.matches("[data-rmph]")) return; items.splice(ev.target.closest(".ph-in").dataset.k, 1); draw(); };
  return async () => {
    const out = [];
    for (const [k, it] of items.entries()) {
      toast(`Envoi des photos… ${k + 1}/${items.length}`);
      const blob = await compresserImage(it.file);
      const path = `${S.orgId}/${equipementId || "sans-equipement"}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw new Error("Envoi de la photo impossible : " + error.message + (/bucket|not found/i.test(error.message) ? " (exécutez la mise à jour SQL des photos dans Supabase)" : ""));
      out.push({ path, categorie: it.categorie, legende: it.legende.trim() });
    }
    return out;
  };
}
async function compresserImage(file, max = 1280, qualite = 0.72) {
  let img;
  try { img = await createImageBitmap(file); }
  catch { img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Format de photo non pris en charge (utilisez JPEG ou PNG)")); i.src = URL.createObjectURL(file); }); }
  const r = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement("canvas");
  cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error("Compression de la photo impossible")), "image/jpeg", qualite));
}
async function supprimerPhotos(list) { if (Array.isArray(list) && list.length) await sb.storage.from("photos").remove(list.map(p => p.path)).catch(() => {}); }
// Section « Photos des pièces » pour les rapports (une ligne par intervention qui a des photos)
function sectionPhotos(ints, nomEq, titre) {
  const l = ints.filter(i => Array.isArray(i.photos) && i.photos.length);
  if (!l.length) return "";
  return `<h3 style="font-size:17px;margin-top:22px">${titre}</h3>${l.map(i => `<div class="ph-bloc"><div style="font-size:13.5px;font-weight:600;margin-top:8px">${fr(i.date)} · ${esc(nomEq(i))} · ${i.type === "preventif" ? "Préventif" : "Curatif"}</div>${photosHTML(i.photos, i, "rapport")}</div>`).join("")}`;
}

// ---------- Routage ----------
async function route() {
  if (!configured) return renderNotConfigured();
  const h = (location.hash || "#tableau").slice(1);
  if (!S.user) { document.getElementById("menu").hidden = true; return renderAuth(h.startsWith("inscription") ? "inscription" : "connexion", h === "inscription-entreprise" ? "entreprise" : "technicien"); }
  majMenu();
  document.getElementById("menu").hidden = false;
  document.querySelectorAll("#menu a").forEach(a => a.classList.toggle("cur", h === a.dataset.v || h.startsWith(a.dataset.v + "-") || (h.startsWith("eq-") && a.dataset.v === "parc") || (["rapport", "siteqr"].some(x => h.startsWith(x)) && a.dataset.v === "clients")));
  window.scrollTo(0, 0);
  majMenuRole();
  if (!isAdmin() && ["abonnement", "indicateurs", "rapport-global", "equipe", "stock-edit"].some(x => h.startsWith(x))) { location.hash = "tableau"; return; }
  if (h === "equipe") return renderEquipe();
  if (h.startsWith("eq-")) return renderEq(h.slice(3));
  if (h.startsWith("cert-")) return renderCert(h.slice(5));
  if (h.startsWith("rapport-")) return renderRapport(h.slice(8));
  if (h.startsWith("siteqr-")) return renderSiteQR(h.slice(7));
  if (h === "etiquettes") return renderLabels();
  if (h === "rapport-global") return renderRapportGlobal();
  if (h === "planning") return renderPlanning();
  if (h.startsWith("ot-bon-")) return renderBon(h.slice(7));
  if (h === "affectation") return isAdmin() ? renderAffectation() : (location.hash = "ot");
  if (h.startsWith("ot-")) return renderOTDetail(h.slice(3));
  if (h === "ot") return renderOT();
  if (h === "stock") return renderStock();
  if (h === "indicateurs") return renderIndicateurs();
  if (h === "aide") return renderAide();
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
  if (!isAdmin()) return renderMonEspace();
  const sts = S.eqs.map(status);
  const late = sts.filter(s => s.d < 0).length, soon = sts.filter(s => s.d >= 0 && s.d <= 14).length;
  const relances = [...S.eqs].sort((a, b) => status(a).d - status(b).d).filter(e => status(e).d <= 14);
  const visites = S.eqs.reduce((n, e) => n + Math.round(365 / freq(e)), 0);
  const w = W(), pctParc = S.eqs.length ? Math.round(100 * (S.eqs.length - late) / S.eqs.length) : 0;
  $view.innerHTML = `
  <h1 style="font-size:30px;margin-bottom:6px">Bonjour ${esc(((S.me || S.tech).nom || "").split(" ")[0])}</h1>
  <p class="m" style="margin-bottom:16px">Offre : <b>${labelOffre()}</b>${S.tech.fondateur ? " · Membre fondateur" : ""}</p>
  ${sigsHTML(S.sigs.filter(x => x.statut !== "resolu"), true)}
  ${(() => { const et = etapesDemarrage(); return et.every(x => x.ok) ? "" : `<div class="panel" style="border:2px solid var(--teal)"><h3>Premiers pas : ${et.filter(x => x.ok).length}/${et.length}</h3><div style="display:flex;gap:8px;flex-wrap:wrap">${et.map((x, k) => `<a href="${x.l}" class="pill ${x.ok ? "p-ok" : ""}" style="text-decoration:none;padding:7px 12px;${x.ok ? "" : "border:1.5px solid var(--line)"}">${x.ok ? "✓" : k + 1 + "."} ${x.t}</a>`).join("")}</div></div>`; })()}
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

// ---------- Pannes par équipement ----------
// Une panne = une intervention curative (saisie directe ou OT curatif clôturé). Les signalements QR sont comptés à part.
const SEUIL_REPETITIVE = 3; // pannes sur 12 mois → panne répétitive
function pannesEq(id, debut = -Infinity, fin = Infinity) {
  const l = S.ints.filter(i => i.equipement_id === id && i.type === "curatif" && Date.parse(i.date) >= debut && Date.parse(i.date) <= fin).sort((a, b) => b.date.localeCompare(a.date));
  const sigs = (S.sigs || []).filter(x => x.equipement_id === id && Date.parse(x.created_at) >= debut && Date.parse(x.created_at) <= fin + DAY).length;
  return { n: l.length, derniere: l[0]?.date || null, sigs, liste: l };
}
const pannes12 = id => pannesEq(id, TODAY - 365 * DAY, TODAY + DAY);
// MTBF d'un équipement (jours) : durée d'observation (depuis la pose, 12 mois max) / nombre de pannes
const mtbfEq = e => { const p = pannes12(e.id); if (!p.n) return null; const obs = Math.min(365, Math.max(1, Math.round((TODAY - Date.parse(e.date_pose || e.created_at || iso(TODAY))) / DAY))); return Math.round(obs / p.n); };
const pillPannes = e => { const p = pannes12(e.id); return p.n ? `<span class="pill ${p.n >= SEUIL_REPETITIVE ? "p-bad" : "p-warn"}" style="margin-right:4px" title="Pannes sur les 12 derniers mois">🔧 ${p.n} panne${p.n > 1 ? "s" : ""}</span>` : ""; };

function eqRow(e) {
  const s = status(e), t = TYPES[e.type];
  return `<a class="row" href="#eq-${e.id}"><div class="ic">${t.ic}</div>
    <div><div class="t">${esc(e.emplacement)}</div><div class="m">${esc(client(e.client_id).nom)}${e.zone ? " · " + esc(e.zone) : ""} · ${t.label} · ${esc(e.marque)} ${esc(e.puissance)}</div></div>
    <span>${pillPannes(e)}${e.criticite === "critique" ? '<span class="pill p-bad" style="margin-right:4px">Critique</span>' : ""}<span class="pill ${s.cls}">${s.txt}</span></span></a>`;
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
      <p class="m">${esc(client(e.client_id).nom)} · ${t.label} · ${esc(e.marque)} ${esc(e.puissance)} · <span class="mono">${esc(e.fluide)}</span> · ${(ENV[e.environnement] || ENV.cotier)[1]}</p>
      <p style="margin:10px 0 16px;font-size:14px">Fréquence : <b>${freq(e)} jours</b>${e.frequence_jours ? " (personnalisée)" : ""} · Prochain entretien : <b class="mono">${fr(nextDue(e))}</b><br><span class="m">Points de contrôle : ${t.pts}</span></p>
      ${(() => { const p12 = pannes12(e.id), tot = pannesEq(e.id), m = mtbfEq(e); return `<div class="pannes-eq ${p12.n >= SEUIL_REPETITIVE ? "alerte" : ""}">
        <div><b>${p12.n}</b><span>panne${p12.n > 1 ? "s" : ""} sur 12 mois</span></div><div><b>${tot.n}</b><span>au total</span></div><div><b>${tot.sigs}</b><span>signalement${tot.sigs > 1 ? "s" : ""} QR</span></div><div><b>${m ? m + " j" : "—"}</b><span>entre 2 pannes (MTBF)</span></div></div>
        ${tot.derniere ? `<p class="m" style="margin:-6px 0 12px">Dernière panne : ${fr(tot.derniere)}</p>` : ""}
        ${p12.n >= SEUIL_REPETITIVE ? `<div class="flag" style="margin-bottom:12px">⚠ Panne répétitive (${p12.n} en 12 mois) : rechercher la cause racine (alimentation, charge en fluide, encrassement, installation), rapprocher le préventif ou chiffrer le remplacement.</div>` : ""}`; })()}
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
        ${photosChampHTML()}
        <div class="full"><button class="btn btn-hot" type="submit">Enregistrer l'intervention</button></div>
      </form>
    </div>
    <div>
      <div class="panel"><h3>Étiquette QR</h3>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div class="qr" id="qr"></div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <a class="btn btn-ghost btn-sm" href="${publicUrl(e.code_public)}" target="_blank" rel="noopener">Voir le carnet public</a>
          <a class="btn btn-ghost btn-sm" href="#cert-${e.id}">Certificat d'entretien</a>
          <a class="btn btn-ghost btn-sm" href="/depannage?marque=${encodeURIComponent(["Gree","LG","Samsung","Daikin","Midea"].find(m => (e.marque || "").toLowerCase().includes(m.toLowerCase())) || "*")}">Dépannage / codes erreur</a>
          <button class="btn btn-teal btn-sm" data-relance="${e.id}">Relance WhatsApp</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-sm" id="delEq" style="color:var(--bad)">Supprimer</button>` : ""}</div></div></div>
      ${sigsHTML(S.sigs.filter(x => x.equipement_id === e.id && x.statut !== "resolu"))}
      <div class="panel"><h3>Historique</h3><div class="hist">${list.length ? list.map(x => `
        <div class="it"><b class="mono" style="font-size:13.5px">${fr(x.date)}</b> · <b>${x.type === "preventif" ? "Préventif" : "Curatif"}</b>
          <button class="btn btn-sm noprint" style="padding:0 6px;color:var(--mute);background:none" data-delint="${x.id}" title="Supprimer" ${isAdmin() ? "" : "hidden"}>✕</button>
          <div class="m">${esc(x.observations)}</div>${measHTML(x)}${photosHTML(x.photos, x)}${flags(x).map(f => `<div class="flag">⚠ ${f}</div>`).join("")}</div>`).join("")
        : `<p class="empty">Aucune intervention.</p>`}</div></div>
    </div>
  </div>`;
  if (window.QRCode) new QRCode(document.getElementById("qr"), { text: publicUrl(e.code_public), width: 128, height: 128, colorDark: "#0b2230", colorLight: "#ffffff" });
  document.getElementById("parse").onclick = parseDict;
  const envoyerPhotos = brancherPhotos(document.getElementById("intForm"), e.id);
  document.getElementById("intForm").onsubmit = async ev => {
    ev.preventDefault();
    const o = Object.fromEntries([...new FormData(ev.target)].filter(([k]) => !k.startsWith("ph")));
    for (const k of ["hp", "bp", "intensite", "t_soufflage", "t_reprise"]) o[k] = o[k] === "" ? null : Number(String(o[k]).replace(",", "."));
    const b = ev.target.querySelector("button[type=submit]"); b.disabled = true;
    let photos = [];
    try { photos = await envoyerPhotos(); } catch (err) { toast(err.message); b.disabled = false; return; }
    const { error } = await sb.from("interventions").insert({ ...o, equipement_id: e.id, ...(photos.length ? { photos } : {}) });
    if (error) { await supprimerPhotos(photos); toast(error.message); b.disabled = false; return; }
    await loadAll(); renderEq(e.id); toast("Intervention enregistrée · prochain entretien recalculé");
  };
  if (document.getElementById("delEq")) document.getElementById("delEq").onclick = () => confirmBox(`Supprimer « ${esc(e.emplacement)} » et tout son historique ?`, async () => {
    const { error } = await sb.from("equipements").delete().eq("id", e.id);
    if (error) return toast(error.message);
    await loadAll(); location.hash = "parc"; toast("Équipement supprimé");
  });
  document.querySelectorAll("[data-delint]").forEach(btn => btn.onclick = () => confirmBox("Supprimer cette intervention (et ses photos) ?", async () => {
    const ph = (S.ints.find(x => x.id === btn.dataset.delint) || {}).photos;
    const { error } = await sb.from("interventions").delete().eq("id", btn.dataset.delint);
    if (error) return toast(error.message);
    await supprimerPhotos(ph);
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
    <label class="full">Où est installé l'équipement ? <span class="m">(split, cassette, VRV : là où se trouve l'unité extérieure)</span><select class="field" name="environnement" required><option value="">— Choisir —</option>${Object.entries(ENV).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select><span class="m" id="envAide"></span></label>
    <label>Marque<input class="field" name="marque"></label>
    <label>Puissance<input class="field" name="puissance" placeholder="12 000 BTU, 3,5 kW…"></label>
    <label>Fluide frigorigène<select class="field" name="fluide"><option>R410A</option><option>R32</option><option>R22</option><option>R404A</option><option>R134a</option><option>R290</option><option>Autre</option></select></label>
    <label>Date de pose<input class="field" type="date" name="date_pose" value="${iso(TODAY)}"></label>
    <div class="full" style="display:flex;gap:8px"><button class="btn btn-hot" type="submit">Créer et générer le QR</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div>
  </form></div>`);
  // Emplacement proposé : celui déjà utilisé le plus souvent pour ce client (modifiable) ; fréquence affichée en direct
  const fEq = document.getElementById("eqForm"), envAide = () => { const v = fEq.environnement.value; document.getElementById("envAide").textContent = v ? `Entretien préventif conseillé : tous les ${freqDefaut(fEq.type.value, v)} jours` : ""; };
  const envClient = () => { const n = {}; S.eqs.filter(e => e.client_id === fEq.client_id.value).forEach(e => n[e.environnement] = (n[e.environnement] || 0) + 1); const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0]; fEq.environnement.value = best ? best[0] : ""; envAide(); };
  fEq.client_id.onchange = envClient; fEq.environnement.onchange = envAide; fEq.type.onchange = envAide; envClient();
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
    : `Bonjour ${c.contact || ""},\n\nC'est ${S.tech.nom}${S.tech.entreprise ? " (" + S.tech.entreprise + ")" : ""}. L'entretien préventif de votre équipement « ${e.emplacement} » ${s.d < 0 ? "est en retard depuis le " + fr(nextDue(e)) : "est prévu le " + fr(nextDue(e))}.\n\nUn entretien régulier évite les pannes et protège votre compresseur, surtout avec l'air salé. Quel créneau vous convient cette semaine ?\n\nVotre carnet d'entretien : ${publicUrl(e.code_public)}`;
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
    return `<div class="row" style="cursor:default"><div class="ic">🏢</div><div><div class="t">${esc(c.nom)} ${st.pct == null ? "" : `<span class="pill ${st.pct >= 90 ? "p-ok" : st.pct >= 70 ? "p-warn" : "p-bad"}">${st.pct} % à jour</span>`}${st.late ? ` <span class="pill p-bad">${st.late} en retard</span>` : ""}</div><div class="m">${esc(c.contact)} · ${esc(c.whatsapp)}${c.email ? " · " + esc(c.email) : ""} · ${n} équipement(s) · prochain entretien ${fr(st.prochain)}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><a class="btn btn-teal btn-sm" href="#rapport-${c.id}">Rapport du site</a><a class="btn btn-ghost btn-sm" href="#siteqr-${c.id}">QR du site</a>${isAdmin() ? `<button class="btn btn-ghost btn-sm" data-editcli="${c.id}">Modifier</button><button class="btn btn-ghost btn-sm" data-delcli="${c.id}" style="color:var(--bad)">Supprimer</button>` : ""}</div></div>`;
  }).join("") || `<p class="empty">Aucun ${W().client} pour l'instant.</p>`}</div>
  <div class="panel" ${isAdmin() ? "" : "hidden"}><h3>${W().nouveauClient}</h3><form class="form" id="cliForm" style="grid-template-columns:1fr">
    <label>${W().nomClient}<input class="field" name="nom" placeholder="${W().phNom}" required></label>
    <label>${W().contact}<input class="field" name="contact" placeholder="M. / Mme …"></label>
    <label>${W().waContact}<input class="field" name="whatsapp" placeholder="+229 01 XX XX XX XX"></label>
    <label>E-mail du client (pour recevoir le rapport mensuel)<input class="field" name="email" type="email" placeholder="contact@exemple.com"></label>
    <button class="btn btn-hot" type="submit">Ajouter</button></form></div></div>`;
  document.getElementById("cliForm").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target));
    if (!o.email) delete o.email;
    const { error } = await sb.from("clients").insert(o);
    if (error) return toast(error.message);
    await loadAll(); renderClients(); toast(isEnt() ? "Site ajouté" : "Client ajouté");
  };
  document.querySelectorAll("[data-editcli]").forEach(b => b.onclick = () => openEditClient(b.dataset.editcli, renderClients));
  document.querySelectorAll("[data-delcli]").forEach(b => b.onclick = () => confirmBox(`Supprimer ce ${W().client} et tous ses équipements ?`, async () => {
    const { error } = await sb.from("clients").delete().eq("id", b.dataset.delcli);
    if (error) return toast(error.message);
    await loadAll(); renderClients();
  }));
}

function openEditClient(id, apres) {
  const c = S.clients.find(x => x.id === id); if (!c) return;
  modal(`<div class="panel"><h3>Modifier ${esc(c.nom)}</h3><form class="form" id="ecForm" style="grid-template-columns:1fr">
    <label>${W().nomClient}<input class="field" name="nom" value="${esc(c.nom)}" required></label>
    <label>${W().contact}<input class="field" name="contact" value="${esc(c.contact)}"></label>
    <label>${W().waContact}<input class="field" name="whatsapp" value="${esc(c.whatsapp)}"></label>
    <label>E-mail du client<input class="field" name="email" type="email" value="${esc(c.email)}" placeholder="contact@exemple.com"></label>
    <div style="display:flex;gap:8px"><button class="btn btn-hot" type="submit">Enregistrer</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form></div>`);
  document.getElementById("ecForm").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target)); o.email = o.email.trim() || null;
    const { error } = await sb.from("clients").update(o).eq("id", c.id);
    if (error) return toast(error.message);
    modal(""); await loadAll(); apres(); toast("Modifications enregistrées");
  };
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
  const t = S.me || S.tech;
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:14px">Profil</h1>
  ${isAdmin() ? `<div class="panel" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b style="margin-right:auto">Organisation : ${esc(S.tech.entreprise || S.tech.nom)} · offre ${labelOffre()}</b><a class="btn btn-teal btn-sm" href="#abonnement">Abonnement</a><a class="btn btn-ghost btn-sm" href="#equipe">Équipe</a></div>` : `<div class="panel"><b>Membre de l'équipe ${esc(S.tech.entreprise || S.tech.nom)}</b> · rôle : technicien</div>`}
  <div class="grid2"><div class="panel"><h3>Vos informations${isAdmin() ? " (affichées sur vos carnets et certificats)" : ""}</h3>
    <form class="form" id="pf">
      <label>Nom complet<input class="field" name="nom" value="${esc(t.nom)}" required></label>
      <label>Entreprise<input class="field" name="entreprise" value="${esc(t.entreprise)}"></label>
      <label>WhatsApp<input class="field" name="whatsapp" value="${esc(t.whatsapp)}"></label>
      <label>Ville<input class="field" name="ville" value="${esc(t.ville)}"></label>
      ${isAdmin() ? `<label class="full">Type de compte<select class="field" name="profil"><option value="technicien" ${t.profil !== "entreprise" ? "selected" : ""}>Technicien / prestataire de maintenance</option><option value="entreprise" ${t.profil === "entreprise" ? "selected" : ""}>Chef d'entreprise / gestionnaire de sites</option></select></label>` : ""}
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
    <tr><th>Fréquence préventive</th><td>${freq(e)} jours</td><th>Prochaine échéance</th><td>${fr(nextDue(e))}</td></tr>
    <tr><th>Pannes (12 derniers mois)</th><td>${pannes12(e.id).n}</td><th>Pannes au total</th><td>${pannesEq(e.id).n}</td></tr></table>
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
  const rows = [["client", "emplacement", "type", "marque", "puissance", "fluide", "environnement", "date_pose", "prochain_entretien", "pannes_12_mois", "pannes_total", "intervention_date", "intervention_type", "hp", "bp", "intensite", "t_soufflage", "t_reprise", "observations"]];
  for (const e of S.eqs) {
    const base = [client(e.client_id).nom, e.emplacement, TYPES[e.type].label, e.marque, e.puissance, e.fluide, e.environnement, e.date_pose, nextDue(e), pannes12(e.id).n, pannesEq(e.id).n];
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
    </div>
  ${isAdmin() ? panneauEnvoi(c) : ""}
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

    ${(() => { const fin = TODAY + DAY, l = eqs.map(e => ({ e, p: pannesEq(e.id, debut, fin), a: pannes12(e.id).n })).filter(x => x.p.n || x.p.sigs).sort((a, b) => b.p.n - a.p.n || b.p.sigs - a.p.sigs);
      return `<h3 style="font-size:17px;margin-top:22px">Pannes par équipement</h3>${l.length ? `<table><tr><th>Équipement</th><th>Pannes sur la période</th><th>Signalements QR</th><th>Dernière panne</th><th>Pannes sur 12 mois</th></tr>${l.map(({ e, p, a }) => `<tr><td>${esc(e.emplacement)}${e.zone ? " · " + esc(e.zone) : ""}</td><td><b>${p.n}</b></td><td>${p.sigs}</td><td class="mono">${fr(p.derniere)}</td><td>${a}${a >= SEUIL_REPETITIVE ? ' <span class="pill p-bad">répétitive</span>' : ""}</td></tr>`).join("")}<tr><td><b>Total</b></td><td><b>${l.reduce((t, x) => t + x.p.n, 0)}</b></td><td><b>${l.reduce((t, x) => t + x.p.sigs, 0)}</b></td><td></td><td></td></tr></table>` : `<p style="font-size:14px">Aucune panne sur la période. ✅</p>`}`; })()}
    ${sectionPhotos(intsPeriode, i => eqOf(i.equipement_id).emplacement, "Photos des pièces défectueuses et remplacées")}

    <h3 style="font-size:17px;margin-top:22px">4. Anomalies et recommandations</h3>
    ${anomalies.length ? `<table><tr><th>Date</th><th>Équipement</th><th>Constat / recommandation</th></tr>${anomalies.map(({ i, f }) => `<tr><td class="mono">${fr(i.date)}</td><td>${esc(eqOf(i.equipement_id).emplacement)}</td><td>${f}</td></tr>`).join("")}</table>` : `<p style="font-size:14px">Aucune anomalie relevée sur la période.</p>`}
    ${eqs.filter(e => pannes12(e.id).n >= SEUIL_REPETITIVE).map(e => `<p style="font-size:14px;margin-top:8px"><b>Panne répétitive :</b> ${esc(e.emplacement)} (${pannes12(e.id).n} pannes en 12 mois) — recherche de cause racine et étude de remplacement recommandées.</p>`).join("")}
    ${nbLate ? `<p style="font-size:14px;margin-top:8px"><b>Recommandation :</b> planifier rapidement l'entretien des ${nbLate} équipement(s) en retard.</p>` : ""}

    <h3 style="font-size:17px;margin-top:22px">5. Planning des 30 prochains jours</h3>
    ${planning.length ? `<table><tr><th>Date prévue</th><th>Équipement</th><th>Type</th><th>Points de contrôle</th></tr>${planning.map(({ e, s }) => `<tr><td class="mono" style="color:${s.d < 0 ? "var(--bad)" : "inherit"}">${s.d < 0 ? "En retard (" + fr(nextDue(e)) + ")" : fr(nextDue(e))}</td><td>${esc(e.emplacement)}${e.zone ? " · " + esc(e.zone) : ""}</td><td>${TYPES[e.type].label}</td><td style="font-size:12.5px">${TYPES[e.type].pts}</td></tr>`).join("")}</table>` : `<p style="font-size:14px">Aucun entretien prévu dans les 30 prochains jours.</p>`}

    <div class="sig"><div>${W().signataire}<br><b style="color:var(--ink)">${esc(S.tech.nom)}</b></div><div>${isEnt() ? "Le responsable du site" : "Pour le client"}<br><b style="color:var(--ink)">${esc(c.contact || c.nom)}</b></div></div>
    <p class="m" style="margin-top:18px">État du parc en ligne : ${esc(siteUrl(c))} · Généré par FroidPass</p>
  </div>`;
  const sel = document.getElementById("per"); sel.value = String(periodeRapport);
  sel.onchange = () => { periodeRapport = Number(sel.value); renderRapport(clientId); };
  if (isAdmin()) brancherEnvoi(c, clientId);
}

// ---------- Envoi du rapport mensuel au client (responsable / directeur uniquement) ----------
let moisEnvoi = null, typeEnvoi = "mensuel";
const libMois = v => { const P = periode(v); return P ? P.lib : v; };
const typeDe = v => { const P = periode(v); return P ? TYPES_PERIODE[P.type] : ""; };
const rapportUrl = (c, mois) => location.origin + "/r?c=" + (c.code_rapport || "") + "&m=" + mois;
function resumeMois(c, mois) {
  const P = periode(mois), d = P.debut, f = P.fin;
  const ids = S.eqs.filter(e => e.client_id === c.id).map(e => e.id);
  const ints = S.ints.filter(i => ids.includes(i.equipement_id) && Date.parse(i.date) >= d && Date.parse(i.date) < f);
  return { nbEq: ids.length, nbInt: ints.length, nbPrev: ints.filter(i => i.type === "preventif").length };
}
function panneauEnvoi(c) {
  const liste = dernieresPeriodes(typeEnvoi);
  if (!liste.some(x => x.code === moisEnvoi)) moisEnvoi = liste[0].code;
  if (!c.code_rapport) return `<div class="panel noprint"><h3>Envoyer le rapport mensuel au client</h3><p class="m">Mise à jour de la base requise : exécutez <b>supabase/mise-a-jour-rapports.sql</b> dans Supabase pour activer l'envoi.</p></div>`;
  const hist = (S.rapports || []).filter(r => r.client_id === c.id);
  return `<div class="panel noprint" id="envoi"><h3>Envoyer un rapport au client</h3>
    <p class="m" style="margin-bottom:10px">Rapport mensuel, trimestriel, semestriel ou annuel. Le client reçoit un lien (sans compte) qu'il peut consulter, imprimer ou enregistrer en PDF.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select class="field" id="typeEnv" style="width:auto;padding:7px 10px">${Object.entries(TYPES_PERIODE).map(([k, l]) => `<option value="${k}" ${k === typeEnvoi ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="field" id="moisEnv" style="width:auto;padding:7px 10px">${liste.map(o => `<option value="${o.code}" ${o.code === moisEnvoi ? "selected" : ""}>${o.lib}</option>`).join("")}</select>
      <button class="btn btn-hot btn-sm" id="envMail">✉️ Envoyer par e-mail${c.email ? "" : " (ajouter l'e-mail)"}</button>
      <button class="btn btn-teal btn-sm" id="envWa">💬 Envoyer par WhatsApp${c.whatsapp ? "" : " (ajouter le numéro)"}</button>
      <button class="btn btn-ghost btn-sm" id="envCp">Copier le lien</button>
      <a class="btn btn-ghost btn-sm" id="envVoir" target="_blank" rel="noopener" href="${rapportUrl(c, moisEnvoi)}">Aperçu client</a>
    </div>
    <p class="m" style="margin-top:8px">Destinataires : ${c.email ? "✉️ " + esc(c.email) : "e-mail non renseigné"} · ${c.whatsapp ? "💬 " + esc(c.whatsapp) : "WhatsApp non renseigné"} · <a href="javascript:void 0" id="envEdit">modifier</a></p>
    <div style="margin-top:12px"><b style="font-size:14px">Historique des envois</b>${hist.length ? `<table class="tbl" style="margin-top:6px"><tr><th>Date</th><th>Rapport</th><th>Période</th><th>Canal</th><th>Destinataire</th><th>Envoyé par</th></tr>${hist.slice(0, 12).map(r => `<tr><td class="mono">${fr(r.created_at)}</td><td>${typeDe(r.mois)}</td><td>${libMois(r.mois)}</td><td>${r.canal === "email" ? "✉️ E-mail" : "💬 WhatsApp"}</td><td>${esc(r.destinataire)}</td><td>${esc(r.envoye_par_nom)}</td></tr>`).join("")}</table>` : `<p class="m">Aucun rapport envoyé à ce ${W().client} pour l'instant.</p>`}</div></div>`;
}
async function journaliserEnvoi(c, canal, destinataire) {
  const { error } = await sb.from("rapports_envoyes").insert({ client_id: c.id, mois: moisEnvoi, canal, destinataire, envoye_par: S.user.id, envoye_par_nom: (S.me || S.tech).nom || "" });
  if (error) console.warn(error.message);
}
function brancherEnvoi(c, clientId) {
  const $ = id => document.getElementById(id); if (!$("envoi")) return;
  const rerender = () => renderRapport(clientId);
  $("typeEnv").onchange = ev => { typeEnvoi = ev.target.value; moisEnvoi = null; rerender(); };
  $("moisEnv").onchange = ev => { moisEnvoi = ev.target.value; $("envVoir").href = rapportUrl(c, moisEnvoi); };
  $("envEdit").onclick = () => openEditClient(c.id, rerender);
  $("envCp").onclick = async () => { try { await navigator.clipboard.writeText(rapportUrl(c, moisEnvoi)); toast("Lien du rapport copié"); } catch { toast(rapportUrl(c, moisEnvoi)); } };
  $("envWa").onclick = async () => {
    if (!c.whatsapp) return openEditClient(c.id, rerender);
    const r = resumeMois(c, moisEnvoi), qui = (S.me || S.tech).nom;
    const txt = `Bonjour ${c.contact || ""},\n\nVoici le ${periode(moisEnvoi).titre.toLowerCase()} pour ${c.nom} (${libMois(moisEnvoi)}) : ${r.nbEq} équipement(s) suivis, ${r.nbInt} intervention(s) dont ${r.nbPrev} préventive(s).\n\nRapport complet (consultable et imprimable en PDF) :\n${rapportUrl(c, moisEnvoi)}\n\nCordialement,\n${qui}${S.tech.entreprise ? " — " + S.tech.entreprise : ""}`;
    window.open(`https://wa.me/${waNum(c.whatsapp)}?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
    await journaliserEnvoi(c, "whatsapp", c.whatsapp); await loadAll(); rerender(); toast("WhatsApp ouvert · envoi enregistré dans l'historique");
  };
  $("envMail").onclick = () => {
    if (!c.email) return openEditClient(c.id, rerender);
    confirmBox(`Envoyer le ${periode(moisEnvoi).titre.toLowerCase()} (<b>${libMois(moisEnvoi)}</b>) à <b>${esc(c.email)}</b> ?`, async () => {
      const btn = $("envMail"); if (btn) { btn.disabled = true; btn.textContent = "Envoi…"; }
      try {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch("/api/envoyer-rapport", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ client_id: c.id, mois: moisEnvoi }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Envoi impossible");
        await loadAll(); rerender(); toast("Rapport envoyé à " + j.destinataire);
      } catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = "✉️ Envoyer par e-mail"; } }
    });
  };
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

// =====================================================================
// GMAO — ORDRES DE TRAVAIL (OT)
// Circuit : Demande → Planifié → En cours → Terminé (ou Annulé)
// =====================================================================
const OT_TYPES = { preventif: "Préventif", curatif: "Curatif (panne)", inspection: "Inspection", amelioration: "Amélioration", tache: "Tâche (hors équipement)" };
const PRIO = { basse: { l: "Basse", c: "" }, normale: { l: "Normale", c: "p-ok" }, haute: { l: "Haute", c: "p-warn" }, urgente: { l: "Urgente", c: "p-bad" } };
const STATUTS = { demande: "Demande", planifie: "Planifié", en_cours: "En cours", termine: "Terminé", annule: "Annulé" };
const otNum = o => "OT-" + String(o.numero || 0).padStart(4, "0");
const eqById = id => S.eqs.find(e => e.id === id);
const fcfa2 = n => Number(n || 0).toLocaleString("fr-FR").replace(/ | /g, " ") + " FCFA";
const coutPieces = o => (S.consos || []).filter(c => c.ordre_id === o.id).reduce((t, c) => t + c.quantite * c.prix_unitaire, 0);
const otEnRetard = o => ["demande", "planifie"].includes(o.statut) && o.date_prevue && Date.parse(o.date_prevue) < TODAY;
function besoinMaj(nom) {
  $view.innerHTML = `<div class="panel"><h3>Activer le module ${nom}</h3><p class="m">Exécutez une fois le fichier <span class="mono">supabase/mise-a-jour-gmao.sql</span> dans Supabase (SQL Editor → Run), puis rechargez la page.</p></div>`;
}

function carteOT(o) {
  const e = eqById(o.equipement_id);
  return `<a href="#ot-${o.id}" class="panel" style="display:block;text-decoration:none;padding:12px 14px;margin-bottom:8px;${otEnRetard(o) ? "border-color:var(--bad)" : ""}">
    <div style="display:flex;justify-content:space-between;gap:6px"><span class="mono m">${otNum(o)}</span><span class="pill ${PRIO[o.priorite].c}">${PRIO[o.priorite].l}</span></div>
    <div class="t" style="margin:4px 0 2px">${esc(o.titre)}</div>
    <div class="m">${esc(client(o.client_id).nom || "")}${e ? " · " + esc(e.emplacement) : ""}</div>
    <div class="m" style="margin-top:4px">${OT_TYPES[o.type]}${o.date_prevue ? ` · <span style="color:${otEnRetard(o) ? "var(--bad)" : "inherit"}">${fr(o.date_prevue)}</span>` : ""}${o.assigne_a ? " · 👤 " + esc(nomMembre(o.assigne_a) || o.intervenant) : o.intervenant ? " · " + esc(o.intervenant) : ""}${o.assigne_a && ["planifie", "en_cours"].includes(o.statut) ? (o.assigne_a === S.user.id && !o.vu_le && !isAdmin() ? ' <span class="pill p-bad">Nouveau</span>' : isAdmin() && o.assigne_a !== S.user.id ? (o.vu_le ? ' <span title="Vu par le technicien">👁</span>' : ' <span class="m" title="Pas encore consulté par le technicien">· non lu</span>') : "") : ""}</div></a>`;
}

let OTF = { q: "", site: "" };
function renderOT() {
  if (!S.gmao) return besoinMaj("Travaux");
  const filt = S.ots.filter(o => (!OTF.site || o.client_id === OTF.site) && (!OTF.q || (o.titre + otNum(o) + (eqById(o.equipement_id)?.emplacement || "") + o.intervenant).toLowerCase().includes(OTF.q.toLowerCase())));
  const col = (st, titre, aide) => {
    let l = filt.filter(o => o.statut === st);
    if (st === "termine") l = l.filter(o => Date.parse(o.date_fin || o.created_at) > TODAY - 30 * DAY);
    l.sort((a, b) => (otEnRetard(b) - otEnRetard(a)) || (["urgente", "haute", "normale", "basse"].indexOf(a.priorite) - ["urgente", "haute", "normale", "basse"].indexOf(b.priorite)) || String(a.date_prevue || "9").localeCompare(String(b.date_prevue || "9")));
    return `<div style="background:var(--ice);border-radius:14px;padding:12px;min-width:0"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><b>${titre}</b><span class="m">${l.length}</span></div><p class="m" style="font-size:12px;margin-bottom:8px">${aide}</p>${l.map(carteOT).join("") || `<p class="empty" style="padding:6px">—</p>`}</div>`;
  };
  const retard = S.ots.filter(otEnRetard).length;
  $view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <div><h1 style="font-size:28px">${isAdmin() ? "Travaux (ordres de travail)" : "Mes travaux"}</h1><p class="m">Chaque intervention suit 4 étapes : demande, planification, réalisation, clôture.${retard ? ` <b style="color:var(--bad)">${retard} OT en retard.</b>` : ""}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${isAdmin() ? `<a class="btn btn-teal btn-sm" href="#affectation">👥 Affecter des tâches</a><button class="btn btn-ghost btn-sm" id="genOT">Générer les OT préventifs (30 j)</button>` : ""}<button class="btn btn-hot btn-sm" id="newOT">${isAdmin() ? "+ Nouvel OT" : "+ Signaler un besoin"}</button></div></div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap"><input class="field" id="otq" placeholder="Rechercher (titre, n°, équipement, intervenant)" style="max-width:340px" value="${esc(OTF.q)}">
      <select class="field" id="ots" style="width:auto"><option value="">Tous les ${W().clients}</option>${S.clients.map(c => `<option value="${c.id}" ${OTF.site === c.id ? "selected" : ""}>${esc(c.nom)}</option>`).join("")}</select></div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px" class="kanban">
      ${col("demande", "1. Demandes", "À planifier : pannes signalées, besoins")}${col("planifie", "2. Planifiés", "Date et intervenant fixés")}${col("en_cours", "3. En cours", "Intervention démarrée")}${col("termine", "4. Terminés", "30 derniers jours")}
    </div>
    <style>@media(max-width:900px){.kanban{grid-template-columns:1fr 1fr!important}}@media(max-width:560px){.kanban{grid-template-columns:1fr!important}}</style>`;
  document.getElementById("newOT").onclick = () => openOTForm({});
  if (document.getElementById("genOT")) document.getElementById("genOT").onclick = genererOTPreventifs;
  const q = document.getElementById("otq"); q.oninput = () => { OTF.q = q.value; const pos = q.selectionStart; renderOT(); const n = document.getElementById("otq"); n.focus(); n.setSelectionRange(pos, pos); };
  document.getElementById("ots").onchange = ev => { OTF.site = ev.target.value; renderOT(); };
}

function openOTForm(pre) {
  if (!S.gmao) return besoinMaj("Travaux");
  if (!S.clients.length) { location.hash = "clients"; toast(`Créez d'abord un ${W().client}`); return; }
  const cid = pre.client_id || (pre.equipement_id ? eqById(pre.equipement_id)?.client_id : "") || S.clients[0].id;
  const eqOpts = c => `<option value="">— Aucun équipement précis —</option>` + S.eqs.filter(e => e.client_id === c).map(e => `<option value="${e.id}" ${pre.equipement_id === e.id ? "selected" : ""}>${esc(e.emplacement)}${e.zone ? " · " + esc(e.zone) : ""}</option>`).join("");
  modal(`<div class="panel"><h3>Nouvel ordre de travail</h3><form class="form" id="otForm">
    <label>${W().Clients.slice(0, -1)}<select class="field" name="client_id" id="otCli">${isAdmin() ? `<option value="">— Aucun (tâche générale) —</option>` : ""}${S.clients.map(c => `<option value="${c.id}" ${c.id === cid ? "selected" : ""}>${esc(c.nom)}</option>`).join("")}</select></label>
    <label>Équipement<select class="field" name="equipement_id" id="otEq">${eqOpts(cid)}</select></label>
    <label class="full">Titre<input class="field" name="titre" required maxlength="200" value="${esc(pre.titre || "")}" placeholder="Ex. Ne refroidit plus, entretien trimestriel…"></label>
    <label>Type<select class="field" name="type">${Object.entries(OT_TYPES).map(([k, v]) => `<option value="${k}" ${(pre.type || "curatif") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label>Priorité<select class="field" name="priorite">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${(pre.priorite || "normale") === k ? "selected" : ""}>${v.l}</option>`).join("")}</select></label>
    <label class="full">Description<textarea class="field" name="description" rows="2">${esc(pre.description || "")}</textarea></label>
    ${isAdmin() ? `<label>Date prévue (facultatif)<input class="field" type="date" name="date_prevue" value="${pre.date_prevue || ""}"></label>
    <label>Assigner à<select class="field" name="assigne_a">${optsAssign(pre.assigne_a)}</select></label>
    <label>Intervenant externe (facultatif)<input class="field" name="intervenant" value="${esc(pre.intervenant || "")}" placeholder="Prestataire, sous-traitant…"></label>
    <label>Téléphone de l'intervenant<input class="field" name="intervenant_tel" placeholder="+229 01 …"></label>` : `<p class="m full">Votre demande sera transmise au responsable, qui la planifiera.</p>`}
    <div class="full" style="display:flex;gap:8px"><button class="btn btn-hot" type="submit">Créer l'OT</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div>
  </form></div>`);
  document.getElementById("otCli").onchange = ev => { document.getElementById("otEq").innerHTML = eqOpts(ev.target.value); };
  document.getElementById("otForm").onsubmit = async ev => {
    ev.preventDefault(); const b = ev.target.querySelector("button[type=submit]"); b.disabled = true;
    const o = Object.fromEntries(new FormData(ev.target));
    for (const k of ["client_id", "equipement_id", "date_prevue", "assigne_a"]) if (!o[k]) o[k] = null;
    if (!o.client_id && !isAdmin()) { toast(`Choisissez un ${W().client}`); b.disabled = false; return; }
    if (o.assigne_a) o.assigne_le = new Date().toISOString();
    if (o.assigne_a && !o.intervenant) { o.intervenant = nomMembre(o.assigne_a); o.intervenant_tel = o.intervenant_tel || (S.membres.find(m => m.user_id === o.assigne_a)?.telephone || ""); }
    o.statut = isAdmin() && (o.date_prevue || o.assigne_a) ? "planifie" : "demande";
    if (!isAdmin()) delete o.assigne_a;
    if (pre.signalement_id) o.signalement_id = pre.signalement_id;
    const { data, error } = await sb.from("ordres_travail").insert(o).select().single();
    if (error) { toast(error.message); b.disabled = false; return; }
    if (pre.signalement_id) await sb.from("signalements").update({ statut: "en_cours" }).eq("id", pre.signalement_id);
    modal(""); await loadAll(); location.hash = "ot-" + data.id; toast(`${otNum(data)} créé`);
    if (data.assigne_a && data.assigne_a !== S.user.id) notifierAffectation([data.id]);
  };
}

async function majOT(id, patch, msg) {
  const { error } = await sb.from("ordres_travail").update(patch).eq("id", id);
  if (error) { toast(error.message); return false; }
  await loadAll(); renderOTDetail(id); if (msg) toast(msg); return true;
}

function renderOTDetail(id) {
  if (!S.gmao) return besoinMaj("Travaux");
  const o = S.ots.find(x => x.id === id);
  if (!o) { $view.innerHTML = `<p class="empty">OT introuvable. <a href="#ot">Retour</a></p>`; return; }
  const e = eqById(o.equipement_id), c = client(o.client_id), conso = S.consos.filter(x => x.ordre_id === o.id);
  const etapes = ["demande", "planifie", "en_cours", "termine"], idx = etapes.indexOf(o.statut);
  const msgWA = `Bonjour ${o.intervenant || ""},\n\nOrdre de travail ${otNum(o)} — ${o.titre}\n${W().Clients.slice(0, -1)} : ${c.nom}${e ? "\nÉquipement : " + e.emplacement + " (" + (TYPES[e.type]?.label || e.type) + ")" : ""}\nPriorité : ${PRIO[o.priorite].l}${o.date_prevue ? "\nDate prévue : " + fr(o.date_prevue) : ""}${o.description ? "\n\n" + o.description : ""}${e ? "\n\nFiche de l'équipement : " + publicUrl(e.code_public) : ""}\n\nMerci de confirmer.`;
  $view.innerHTML = `<a href="#ot" class="m">← Travaux</a>
  <div class="grid2" style="margin-top:10px"><div>
    <div class="panel">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><span class="mono m">${otNum(o)}</span><h3 style="font-size:22px;margin-top:2px">${esc(o.titre)}</h3></div>
        <span><span class="pill ${PRIO[o.priorite].c}">${PRIO[o.priorite].l}</span> <span class="pill ${o.statut === "termine" ? "p-ok" : o.statut === "annule" ? "" : otEnRetard(o) ? "p-bad" : "p-warn"}">${STATUTS[o.statut]}${otEnRetard(o) ? " · en retard" : ""}</span></span></div>
      <div style="display:flex;gap:4px;margin:14px 0">${etapes.map((s2, k) => `<div style="flex:1;text-align:center;font-size:12px;padding:6px 2px;border-radius:8px;background:${o.statut === "annule" ? "var(--ice)" : k <= idx ? "var(--teal)" : "var(--ice)"};color:${o.statut !== "annule" && k <= idx ? "#fff" : "var(--ink2)"}">${k + 1}. ${STATUTS[s2]}</div>`).join("")}</div>
      <table class="tbl" style="font-size:14.5px"><tbody>
        <tr><td class="m">${W().Clients.slice(0, -1)}</td><td>${esc(c.nom || "")}</td></tr>
        <tr><td class="m">Équipement</td><td>${e ? `<a href="#eq-${e.id}">${esc(e.emplacement)}</a> · ${TYPES[e.type]?.label || ""}${e.criticite === "critique" ? ' <span class="pill p-bad">Critique</span>' : ""}` : "—"}</td></tr>
        <tr><td class="m">Type</td><td>${OT_TYPES[o.type]}</td></tr>
        <tr><td class="m">Date prévue</td><td>${fr(o.date_prevue)}</td></tr>
        <tr><td class="m">Assigné à</td><td>${o.assigne_a ? "👤 " + esc(nomMembre(o.assigne_a)) + (o.assigne_a !== S.user.id || isAdmin() ? `<br><span class="m">${o.assigne_le ? "Affecté le " + fr(o.assigne_le) + " · " : ""}${o.vu_le ? "👁 vu par le technicien le " + fr(o.vu_le) + " à " + new Date(o.vu_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "pas encore consulté par le technicien"}</span>` : "") + (isAdmin() && o.assigne_a !== S.user.id && ["planifie", "en_cours"].includes(o.statut) ? ` <button class="btn btn-ghost btn-sm" id="aRelance">Renvoyer la notification</button>` : "") : "—"}${o.intervenant && o.intervenant !== nomMembre(o.assigne_a) ? " · " + esc(o.intervenant) : ""} ${esc(o.intervenant_tel || "")}</td></tr>
        <tr><td class="m">Créé le</td><td>${fr(o.created_at)}${o.date_debut ? " · démarré le " + fr(o.date_debut) : ""}${o.date_fin ? " · terminé le " + fr(o.date_fin) : ""}</td></tr>
      </tbody></table>
      ${o.description ? `<p style="margin-top:12px"><b>Description</b><br>${esc(o.description)}</p>` : ""}
      ${o.compte_rendu ? `<p style="margin-top:12px"><b>Compte rendu</b><br>${esc(o.compte_rendu)}</p>` : ""}
      ${(() => { const it = S.ints.find(i => i.id === o.intervention_id); return it ? photosHTML(it.photos, it) : ""; })()}
    </div>
    <div id="otAction"></div>
  </div><div>
    <div class="panel"><h3>Actions</h3><div style="display:flex;flex-direction:column;gap:8px">
      ${o.statut === "demande" && isAdmin() ? `<button class="btn btn-teal" id="aPlan">Planifier et assigner</button>` : ""}
      ${o.statut === "demande" && !isAdmin() ? `<p class="m">En attente de planification par le responsable.</p>` : ""}
      ${o.statut === "planifie" && (isAdmin() || o.assigne_a === S.user.id) ? `<button class="btn btn-teal" id="aStart">Démarrer l'intervention</button>` : ""}
      ${o.statut === "planifie" && isAdmin() ? `<button class="btn btn-ghost btn-sm" id="aPlan">Modifier la planification</button>` : ""}
      ${o.statut === "en_cours" ? `<button class="btn btn-hot" id="aEnd">Terminer et rédiger le compte rendu</button>` : ""}
      ${(o.intervenant_tel) && !["termine", "annule"].includes(o.statut) ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/${waNum(o.intervenant_tel)}?text=${encodeURIComponent(msgWA)}">Envoyer l'OT à l'intervenant (WhatsApp)</a>` : ""}
      <a class="btn btn-ghost btn-sm" href="#ot-bon-${o.id}">Bon de travail (PDF)</a>
      ${e ? `<a class="btn btn-ghost btn-sm" href="/depannage?marque=${encodeURIComponent(["Gree", "LG", "Samsung", "Daikin", "Midea"].find(m => (e.marque || "").toLowerCase().includes(m.toLowerCase())) || "*")}">Aide au dépannage</a>` : ""}
      ${!["termine", "annule"].includes(o.statut) && isAdmin() ? `<button class="btn btn-ghost btn-sm" id="aCancel" style="color:var(--bad)">Annuler l'OT</button>` : ""}
    </div></div>
    <div class="panel"><h3>Pièces et coûts</h3>
      ${conso.length ? `<table class="tbl"><tbody><tr><th>Pièce</th><th>Qté</th><th>Montant</th></tr>${conso.map(x => { const p = S.pieces.find(pp => pp.id === x.piece_id) || {}; return `<tr><td>${esc(p.designation || "?")}</td><td>${x.quantite} ${p.unite || ""}</td><td>${fcfa2(x.quantite * x.prix_unitaire)}</td></tr>`; }).join("")}</tbody></table>` : `<p class="m">Aucune pièce utilisée.</p>`}
      <p style="margin-top:8px;font-size:14px">Main d'œuvre : <b>${fcfa2(o.cout_main_oeuvre)}</b>${o.duree_heures ? ` (${o.duree_heures} h)` : ""}<br>Pièces : <b>${fcfa2(coutPieces(o))}</b><br>Total : <b>${fcfa2((o.cout_main_oeuvre || 0) + coutPieces(o))}</b></p>
    </div>
  </div></div>`;
  const q = sel => document.getElementById(sel);
  // Accusé de lecture : le technicien assigné ouvre sa tâche
  if (o.assigne_a === S.user.id && !o.vu_le && !(isAdmin() && !S.moi)) { o.vu_le = new Date().toISOString(); sb.from("ordres_travail").update({ vu_le: o.vu_le }).eq("id", o.id).then(() => {}); }
  if (q("aRelance")) q("aRelance").onclick = () => notifierAffectation([o.id]);
  if (q("aPlan")) q("aPlan").onclick = () => {
    q("otAction").innerHTML = `<div class="panel"><h3>Planifier</h3><form class="form" id="fPlan">
      <label>Date prévue<input class="field" type="date" name="date_prevue" required value="${o.date_prevue || iso(TODAY)}"></label>
      <label>Assigner à<select class="field" name="assigne_a">${optsAssign(o.assigne_a)}</select></label>
      <label>Intervenant (nom affiché)<input class="field" name="intervenant" value="${esc(o.intervenant || "")}" placeholder="Rempli automatiquement si assigné"></label>
      <label>Téléphone<input class="field" name="intervenant_tel" value="${esc(o.intervenant_tel || "")}"></label>
      <label>Priorité<select class="field" name="priorite">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${o.priorite === k ? "selected" : ""}>${v.l}</option>`).join("")}</select></label>
      <div class="full"><button class="btn btn-teal" type="submit">Enregistrer</button></div></form></div>`;
    q("fPlan").onsubmit = ev => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); f.assigne_a = f.assigne_a || null;
      if (f.assigne_a) { f.intervenant = f.intervenant || nomMembre(f.assigne_a); f.intervenant_tel = f.intervenant_tel || (S.membres.find(m => m.user_id === f.assigne_a)?.telephone || ""); }
      const change = f.assigne_a && f.assigne_a !== o.assigne_a;
      if (change) { f.assigne_le = new Date().toISOString(); f.vu_le = null; }
      majOT(o.id, { ...f, statut: "planifie" }, "OT planifié").then(ok => { if (ok && change && f.assigne_a !== S.user.id) notifierAffectation([o.id]); }); };
  };
  if (q("aStart")) q("aStart").onclick = () => majOT(o.id, { statut: "en_cours", date_debut: new Date().toISOString() }, "Intervention démarrée");
  if (q("aCancel")) q("aCancel").onclick = () => confirmBox(`Annuler ${otNum(o)} ?`, () => majOT(o.id, { statut: "annule" }, "OT annulé"));
  if (q("aEnd")) q("aEnd").onclick = () => formTerminer(o);
}

function formTerminer(o) {
  const e = eqById(o.equipement_id);
  const heures = o.date_debut ? Math.max(0.5, Math.round((Date.now() - Date.parse(o.date_debut)) / 36e5 * 2) / 2) : "";
  const ligneP = () => `<div class="pl" style="display:grid;grid-template-columns:1fr 90px 32px;gap:6px;margin-bottom:6px"><select class="field" name="piece">${`<option value="">— Pièce —</option>` + S.pieces.map(p => `<option value="${p.id}">${esc(p.designation)} (stock ${p.stock} ${p.unite})</option>`).join("")}</select><input class="field" name="qte" type="number" step="0.01" min="0" placeholder="Qté"><button type="button" class="btn btn-ghost btn-sm" data-rm>✕</button></div>`;
  document.getElementById("otAction").innerHTML = `<div class="panel" style="border:2px solid var(--heat)"><h3>Terminer l'intervention</h3><form class="form" id="fEnd">
    <label class="full">Compte rendu (travaux réalisés, constats)<textarea class="field" name="compte_rendu" rows="3" required placeholder="Ex. Filtres nettoyés, condensateur ventilateur remplacé, essais OK."></textarea></label>
    ${e ? `<label>HP (bar)<input class="field mono" name="hp" inputmode="decimal"></label><label>BP (bar)<input class="field mono" name="bp" inputmode="decimal"></label>
    <label>Intensité (A)<input class="field mono" name="intensite" inputmode="decimal"></label><label>T soufflage (°C)<input class="field mono" name="t_soufflage" inputmode="decimal"></label>
    <label>T reprise (°C)<input class="field mono" name="t_reprise" inputmode="decimal"></label>` : ""}
    <label>Durée (heures)<input class="field" name="duree_heures" type="number" step="0.5" min="0" value="${heures}"></label>
    <label>Coût main d'œuvre (FCFA)<input class="field" name="cout_main_oeuvre" type="number" min="0" step="500" value="0"></label>
    <div class="full"><b style="font-size:14px">Pièces utilisées</b> <span class="m">(décomptées automatiquement du stock)</span><div id="pls" style="margin-top:6px">${S.pieces.length ? ligneP() : `<p class="m">Aucune pièce en stock. <a href="#stock">Ajouter des pièces</a></p>`}</div>${S.pieces.length ? `<button type="button" class="btn btn-ghost btn-sm" id="addP">+ Ajouter une pièce</button>` : ""}</div>
    ${e ? photosChampHTML() : ""}
    <div class="full"><button class="btn btn-hot" type="submit">Clôturer l'OT</button></div></form></div>`;
  const pls = document.getElementById("pls");
  if (document.getElementById("addP")) document.getElementById("addP").onclick = () => pls.insertAdjacentHTML("beforeend", ligneP());
  pls.onclick = ev => { if (ev.target.matches("[data-rm]")) ev.target.closest(".pl").remove(); };
  document.getElementById("otAction").scrollIntoView({ behavior: "smooth" });
  const envoyerPhotos = brancherPhotos(document.getElementById("fEnd"), e?.id);
  document.getElementById("fEnd").onsubmit = async ev => {
    ev.preventDefault(); const b = ev.target.querySelector("button[type=submit]"); b.disabled = true;
    const f = Object.fromEntries(new FormData(ev.target)), num = k => f[k] === "" || f[k] == null ? null : Number(String(f[k]).replace(",", "."));
    try {
      // 0. Photos des pièces (téléversées en premier : rien n'est enregistré si l'envoi échoue)
      const photos = e ? await envoyerPhotos() : [];
      // 1. Pièces consommées
      const lignes = [...pls.querySelectorAll(".pl")].map(l => ({ piece_id: l.querySelector("[name=piece]").value, quantite: Number(l.querySelector("[name=qte]").value) })).filter(l => l.piece_id && l.quantite > 0);
      if (lignes.length) {
        const { error } = await sb.from("consommations").insert(lignes.map(l => ({ ...l, ordre_id: o.id, prix_unitaire: S.pieces.find(p => p.id === l.piece_id).prix_unitaire })));
        if (error) throw error;
      }
      // 2. Historique de l'équipement (carnet QR), avec les photos des pièces
      let intervention_id = null;
      if (e) {
        const { data, error } = await sb.from("interventions").insert({ ...(photos.length ? { photos } : {}), equipement_id: e.id, date: iso(TODAY), type: ["preventif", "inspection"].includes(o.type) ? "preventif" : "curatif", observations: `${otNum(o)} — ${f.compte_rendu}`, hp: num("hp"), bp: num("bp"), intensite: num("intensite"), t_soufflage: num("t_soufflage"), t_reprise: num("t_reprise") }).select().single();
        if (error) throw error; intervention_id = data.id;
      }
      // 3. Clôture de l'OT (+ signalement résolu)
      const { error } = await sb.from("ordres_travail").update({ statut: "termine", date_fin: new Date().toISOString(), compte_rendu: f.compte_rendu, duree_heures: num("duree_heures"), cout_main_oeuvre: num("cout_main_oeuvre") || 0, intervention_id, date_debut: o.date_debut || new Date().toISOString() }).eq("id", o.id);
      if (error) throw error;
      if (o.signalement_id) await sb.from("signalements").update({ statut: "resolu", resolu_at: new Date().toISOString() }).eq("id", o.signalement_id);
      await loadAll(); renderOTDetail(o.id); toast(`${otNum(o)} terminé${e ? " · carnet de l'équipement mis à jour" : ""}`);
    } catch (err) { toast(err.message); b.disabled = false; }
  };
}

async function genererOTPreventifs() {
  if (!S.gmao) return besoinMaj("Travaux");
  const save = { ...PL }; PL.site = ""; PL.crit = "";
  const occ = occurrences(30); Object.assign(PL, save);
  const existe = (e, d) => S.ots.some(o => o.equipement_id === e.id && ["preventif", "inspection"].includes(o.type) && o.statut !== "annule" && o.statut !== "termine" && o.date_prevue && Math.abs(Date.parse(o.date_prevue) - d) < freq(e) * DAY / 2);
  const aCreer = []; for (const x of occ) { const d = x.retard ? TODAY : x.d; if (!existe(x.e, d) && !aCreer.some(a => a.equipement_id === x.e.id && Math.abs(Date.parse(a.date_prevue) - d) < freq(x.e) * DAY / 2)) aCreer.push({ client_id: x.e.client_id, equipement_id: x.e.id, titre: `Entretien préventif — ${TYPES[x.e.type]?.label || x.e.type}`, description: `Points de contrôle : ${TYPES[x.e.type]?.pts || ""}`, type: "preventif", priorite: x.e.criticite === "critique" ? "haute" : x.retard ? "haute" : "normale", statut: "planifie", date_prevue: iso(d) }); }
  if (!aCreer.length) return toast("Tous les entretiens des 30 prochains jours ont déjà un OT");
  confirmBox(`Créer <b>${aCreer.length}</b> ordre(s) de travail préventif(s) pour les 30 prochains jours (retards inclus, à la date du jour) ?`, async () => {
    const { error } = await sb.from("ordres_travail").insert(aCreer);
    if (error) return toast(error.message);
    await loadAll(); location.hash = "ot"; renderOT(); toast(`${aCreer.length} OT préventifs créés`);
  });
}

function renderBon(id) {
  const o = (S.ots || []).find(x => x.id === id);
  if (!o) { $view.innerHTML = `<p class="empty">OT introuvable.</p>`; return; }
  const e = eqById(o.equipement_id), c = client(o.client_id), conso = S.consos.filter(x => x.ordre_id === o.id);
  $view.innerHTML = `<div class="noprint" style="display:flex;gap:8px;margin-bottom:14px"><a class="btn btn-ghost btn-sm" href="#ot-${o.id}">← Retour</a><button class="btn btn-hot btn-sm" onclick="print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="cert"><div class="ch"><div><div class="disp" style="font-size:26px;font-weight:800">Bon de travail ${otNum(o)}</div><div class="m">${OT_TYPES[o.type]} · priorité ${PRIO[o.priorite].l.toLowerCase()} · ${STATUTS[o.statut]}</div></div>
    <div style="text-align:right;font-size:14px"><b>${esc(S.tech.entreprise || S.tech.nom)}</b><br>${esc(S.tech.nom)}<br><span class="mono">${esc(S.tech.whatsapp)}</span></div></div>
  <table><tr><th>${W().Clients.slice(0, -1)}</th><td>${esc(c.nom || "")}</td><th>Date prévue</th><td>${fr(o.date_prevue)}</td></tr>
    <tr><th>Équipement</th><td>${e ? esc(e.emplacement) + (e.zone ? " · " + esc(e.zone) : "") : "—"}</td><th>Type d'équipement</th><td>${e ? TYPES[e.type]?.label || "" : "—"}</td></tr>
    <tr><th>Marque / puissance</th><td>${e ? esc(e.marque) + " " + esc(e.puissance) : "—"}</td><th>Fluide</th><td>${e ? esc(e.fluide) : "—"}</td></tr>
    <tr><th>Intervenant</th><td>${esc(o.intervenant || "")}</td><th>Début / fin</th><td>${fr(o.date_debut)} / ${fr(o.date_fin)}</td></tr></table>
  <h3 style="font-size:16px;margin-top:18px">Travail demandé</h3><p style="border:1px solid var(--line);padding:10px;min-height:50px">${esc(o.titre)}${o.description ? "<br>" + esc(o.description) : ""}</p>
  ${e ? `<p class="m" style="margin-top:6px">Points de contrôle : ${TYPES[e.type]?.pts || ""}</p>` : ""}
  <h3 style="font-size:16px;margin-top:18px">Sécurité</h3><p style="font-size:13.5px">☐ Consignation électrique réalisée (NF C 18-510) &nbsp; ☐ EPI portés &nbsp; ☐ Zone balisée &nbsp; ☐ Fluides : récupération conforme</p>
  <h3 style="font-size:16px;margin-top:18px">Compte rendu</h3><p style="border:1px solid var(--line);padding:10px;min-height:90px">${esc(o.compte_rendu || "")}</p>
  ${(() => { const it = S.ints.find(i => i.id === o.intervention_id); return it?.photos?.length ? `<h3 style="font-size:16px;margin-top:18px">Photos des pièces</h3>${photosHTML(it.photos, it, "rapport")}` : ""; })()}
  <h3 style="font-size:16px;margin-top:18px">Pièces utilisées</h3><table><tr><th>Désignation</th><th>Quantité</th><th>Prix unitaire</th><th>Montant</th></tr>
  ${conso.map(x => { const p = S.pieces.find(pp => pp.id === x.piece_id) || {}; return `<tr><td>${esc(p.designation || "")}</td><td>${x.quantite} ${p.unite || ""}</td><td>${fcfa2(x.prix_unitaire)}</td><td>${fcfa2(x.quantite * x.prix_unitaire)}</td></tr>`; }).join("") || `<tr><td colspan="4" style="height:60px"></td></tr>`}</table>
  <p style="margin-top:10px;font-size:14px">Durée : ${o.duree_heures ?? "……"} h · Main d'œuvre : ${fcfa2(o.cout_main_oeuvre)} · Pièces : ${fcfa2(coutPieces(o))} · <b>Total : ${fcfa2((o.cout_main_oeuvre || 0) + coutPieces(o))}</b></p>
  <div class="sig"><div>L'intervenant<br><b style="color:var(--ink)">${esc(o.intervenant || "")}</b></div><div>Le responsable du ${W().client}<br><b style="color:var(--ink)">${esc(c.contact || "")}</b></div></div>
  <p class="m" style="margin-top:16px">Généré par FroidPass</p></div>`;
}

// =====================================================================
// GMAO — STOCK DE PIÈCES ET CONSOMMABLES
// =====================================================================
function renderStock() {
  if (!S.gmao) return besoinMaj("Stock");
  const alertes = S.pieces.filter(p => Number(p.stock) <= Number(p.stock_min));
  const valeur = S.pieces.reduce((t, p) => t + Math.max(0, p.stock) * p.prix_unitaire, 0);
  const conso30 = S.consos.filter(c => Date.parse(c.created_at) > TODAY - 30 * DAY);
  $view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:12px"><div><h1 style="font-size:28px">Stock</h1><p class="m">Pièces de rechange et consommables (filtres, condensateurs, fluides…). Le stock baisse automatiquement quand une pièce est utilisée sur un OT.</p></div>${isAdmin() ? `<button class="btn btn-hot btn-sm" id="addPiece">+ Nouvelle pièce</button>` : ""}</div>
  <div class="kpis"><div class="kpi"><b>${S.pieces.length}</b><span>articles</span></div><div class="kpi ${alertes.length ? "alert" : ""}"><b>${alertes.length}</b><span>sous le seuil d'alerte</span></div><div class="kpi"><b style="font-size:22px">${fcfa2(valeur)}</b><span>valeur du stock</span></div><div class="kpi"><b style="font-size:22px">${fcfa2(conso30.reduce((t, c) => t + c.quantite * c.prix_unitaire, 0))}</b><span>consommé sur 30 jours</span></div></div>
  <div class="panel" style="overflow-x:auto">${S.pieces.length ? `<table class="tbl"><tbody><tr><th>Désignation</th><th>Réf.</th><th>Stock</th><th>Seuil</th><th>Prix unit.</th><th>Emplacement</th><th></th></tr>
    ${S.pieces.map(p => `<tr><td><b>${esc(p.designation)}</b></td><td class="mono">${esc(p.reference)}</td><td><span class="pill ${Number(p.stock) <= Number(p.stock_min) ? "p-bad" : "p-ok"}">${p.stock} ${p.unite}</span></td><td>${p.stock_min}</td><td>${fcfa2(p.prix_unitaire)}</td><td>${esc(p.emplacement)}</td>
      <td style="white-space:nowrap">${isAdmin() ? `<button class="btn btn-teal btn-sm" data-in="${p.id}">+ Entrée</button> <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Modifier</button>` : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">Aucune pièce. Ajoutez vos consommables courants : filtres, condensateurs, fluide R410A / R32 (en kg), courroies, pompes de relevage…</p>`}</div>`;
  if (document.getElementById("addPiece")) document.getElementById("addPiece").onclick = () => formPiece({});
  document.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => formPiece(S.pieces.find(p => p.id === b.dataset.edit)));
  document.querySelectorAll("[data-in]").forEach(b => b.onclick = () => {
    const p = S.pieces.find(x => x.id === b.dataset.in);
    modal(`<div class="panel"><h3>Entrée en stock : ${esc(p.designation)}</h3><form class="form" id="fIn" style="grid-template-columns:1fr"><label>Quantité reçue (${p.unite})<input class="field" name="q" type="number" step="0.01" min="0.01" required></label><div style="display:flex;gap:8px"><button class="btn btn-hot" type="submit">Ajouter au stock</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form></div>`);
    document.getElementById("fIn").onsubmit = async ev => { ev.preventDefault(); const q = Number(new FormData(ev.target).get("q")); const { error } = await sb.from("pieces").update({ stock: Number(p.stock) + q }).eq("id", p.id); if (error) return toast(error.message); modal(""); await loadAll(); renderStock(); toast("Stock mis à jour"); };
  });
}
function formPiece(p) {
  modal(`<div class="panel"><h3>${p.id ? "Modifier la pièce" : "Nouvelle pièce"}</h3><form class="form" id="fP">
    <label class="full">Désignation<input class="field" name="designation" required value="${esc(p.designation || "")}" placeholder="Ex. Condensateur 35 µF, Filtre G4, Fluide R32"></label>
    <label>Référence<input class="field" name="reference" value="${esc(p.reference || "")}"></label>
    <label>Unité<select class="field" name="unite">${["u", "kg", "L", "m", "boîte"].map(u => `<option ${p.unite === u ? "selected" : ""}>${u}</option>`).join("")}</select></label>
    <label>Stock actuel<input class="field" name="stock" type="number" step="0.01" value="${p.stock ?? 0}"></label>
    <label>Seuil d'alerte<input class="field" name="stock_min" type="number" step="0.01" value="${p.stock_min ?? 0}"></label>
    <label>Prix unitaire (FCFA)<input class="field" name="prix_unitaire" type="number" min="0" value="${p.prix_unitaire ?? 0}"></label>
    <label>Emplacement<input class="field" name="emplacement" value="${esc(p.emplacement || "")}" placeholder="Magasin, véhicule…"></label>
    <div class="full" style="display:flex;gap:8px"><button class="btn btn-hot" type="submit">Enregistrer</button>${p.id ? `<button class="btn btn-ghost" type="button" id="delP" style="color:var(--bad)">Supprimer</button>` : ""}<button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form></div>`);
  document.getElementById("fP").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target)); for (const k of ["stock", "stock_min", "prix_unitaire"]) o[k] = Number(o[k] || 0);
    const { error } = p.id ? await sb.from("pieces").update(o).eq("id", p.id) : await sb.from("pieces").insert(o);
    if (error) return toast(error.message); modal(""); await loadAll(); renderStock(); toast("Pièce enregistrée");
  };
  if (document.getElementById("delP")) document.getElementById("delP").onclick = async () => {
    const { error } = await sb.from("pieces").delete().eq("id", p.id);
    if (error) return toast(error.message.includes("foreign") ? "Pièce déjà utilisée sur un OT : mettez plutôt son stock à 0" : error.message);
    modal(""); await loadAll(); renderStock();
  };
}

// =====================================================================
// GMAO — INDICATEURS DE MAINTENANCE
// =====================================================================
let IND = 90;
function renderIndicateurs() {
  const debut = TODAY - IND * DAY, dans = t => t && Date.parse(t) >= debut && Date.parse(t) <= TODAY + DAY;
  const ots = S.ots || [];
  const prevDus = ots.filter(o => ["preventif", "inspection"].includes(o.type) && o.statut !== "annule" && o.date_prevue && dans(o.date_prevue) && Date.parse(o.date_prevue) <= TODAY);
  const prevFaits = prevDus.filter(o => o.statut === "termine");
  const tauxPrev = prevDus.length ? Math.round(100 * prevFaits.length / prevDus.length) : null;
  const pannesInt = S.ints.filter(i => i.type === "curatif" && dans(i.date));
  const nbPannes = pannesInt.length + ots.filter(o => o.type === "curatif" && o.statut === "termine" && !o.intervention_id && dans(o.date_fin)).length;
  const curTermines = ots.filter(o => o.type === "curatif" && o.statut === "termine" && dans(o.date_fin));
  const durees = curTermines.map(o => o.duree_heures != null ? Number(o.duree_heures) : (o.date_debut ? (Date.parse(o.date_fin) - Date.parse(o.date_debut)) / 36e5 : null)).filter(x => x != null);
  const mttr = durees.length ? (durees.reduce((a, b) => a + b, 0) / durees.length) : null;
  const mtbf = nbPannes ? Math.round(S.eqs.length * IND / nbPannes) : null;
  const termines = ots.filter(o => o.statut === "termine" && dans(o.date_fin));
  const coutParSite = S.clients.map(c => { const l = termines.filter(o => o.client_id === c.id); return { c, mo: l.reduce((t, o) => t + (o.cout_main_oeuvre || 0), 0), pc: l.reduce((t, o) => t + coutPieces(o), 0), n: l.length }; }).filter(x => x.n);
  const totalCout = coutParSite.reduce((t, x) => t + x.mo + x.pc, 0);
  const partPrev = termines.length ? Math.round(100 * termines.filter(o => ["preventif", "inspection"].includes(o.type)).length / termines.length) : null;
  const tousPannes = S.eqs.map(e => ({ e, n: pannesInt.filter(i => i.equipement_id === e.id).length, sigs: (S.sigs || []).filter(x => x.equipement_id === e.id && dans(x.created_at)).length, a: pannes12(e.id).n, m: mtbfEq(e) })).filter(x => x.n || x.sigs).sort((a, b) => b.n - a.n || b.sigs - a.sigs);
  const top = tousPannes.filter(x => x.n).slice(0, 5);
  const late = S.eqs.filter(e => status(e).d < 0).length, conf = S.eqs.length ? Math.round(100 * (S.eqs.length - late) / S.eqs.length) : null;
  const sigOuverts = (S.sigs || []).filter(x => x.statut !== "resolu").length;
  const kpi = (v, l, aide, alerte) => `<div class="kpi ${alerte ? "alert" : ""}"><b>${v}</b><span>${l}</span><p class="m" style="font-size:12px;margin-top:6px">${aide}</p></div>`;
  $view.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:12px"><div><h1 style="font-size:28px">Indicateurs de maintenance</h1><p class="m">Pour piloter la maintenance et justifier les budgets. Chaque indicateur est expliqué en une ligne.</p></div>
    <span class="noprint" style="display:flex;gap:8px"><select class="field" id="indP" style="width:auto"><option value="30">30 jours</option><option value="90">90 jours</option><option value="180">6 mois</option><option value="365">12 mois</option></select><button class="btn btn-ghost btn-sm" onclick="print()">Imprimer</button></span></div>
  ${!S.gmao ? `<div class="panel" style="border-color:var(--heat)">Pour des indicateurs complets (OT, coûts, MTTR), activez le module GMAO : exécutez <span class="mono">supabase/mise-a-jour-gmao.sql</span> dans Supabase.</div>` : ""}
  <div class="kpis">
    ${kpi(conf == null ? "—" : conf + " %", "parc à jour", "Part des équipements dont l'entretien préventif n'est pas en retard.", conf != null && conf < 80)}
    ${kpi(tauxPrev == null ? "—" : tauxPrev + " %", "préventif réalisé", "OT préventifs terminés / OT préventifs prévus sur la période.", tauxPrev != null && tauxPrev < 80)}
    ${kpi(nbPannes, "pannes", "Interventions curatives sur la période.", false)}
    ${kpi(sigOuverts, "signalements ouverts", "Pannes signalées par QR, pas encore résolues.", sigOuverts > 0)}
  </div>
  <div class="kpis">
    ${kpi(mttr == null ? "—" : mttr.toFixed(1) + " h", "MTTR", "Temps moyen de réparation d'une panne (plus c'est bas, mieux c'est).", false)}
    ${kpi(mtbf == null ? "—" : mtbf + " j", "MTBF", "Temps moyen entre deux pannes, par équipement (plus c'est haut, mieux c'est).", false)}
    ${kpi(partPrev == null ? "—" : partPrev + " %", "part du préventif", "Part du préventif dans les OT terminés. Objectif courant : plus de 70 %.", partPrev != null && partPrev < 50)}
    ${kpi(`<span style="font-size:22px">${fcfa2(totalCout)}</span>`, "coût de maintenance", "Main d'œuvre + pièces des OT terminés sur la période.", false)}
  </div>
  <div class="grid2">
    <div class="panel"><h3>Coûts par ${W().client}</h3>${coutParSite.length ? `<table class="tbl"><tbody><tr><th>${W().Clients.slice(0, -1)}</th><th>OT</th><th>Main d'œuvre</th><th>Pièces</th><th>Total</th></tr>${coutParSite.map(x => `<tr><td>${esc(x.c.nom)}</td><td>${x.n}</td><td>${fcfa2(x.mo)}</td><td>${fcfa2(x.pc)}</td><td><b>${fcfa2(x.mo + x.pc)}</b></td></tr>`).join("")}</tbody></table>` : `<p class="m">Aucun OT terminé sur la période.</p>`}</div>
    <div class="panel"><h3>Équipements les plus en panne</h3>${top.length ? top.map(x => `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;font-size:14px"><a href="#eq-${x.e.id}">${esc(x.e.emplacement)}</a><span class="m">${esc(client(x.e.client_id).nom || "")} · <b>${x.n}</b></span></div><div style="height:8px;background:var(--ice);border-radius:4px"><div style="height:8px;width:${Math.round(100 * x.n / top[0].n)}%;background:var(--bad);border-radius:4px"></div></div></div>`).join("") + `<p class="m" style="margin-top:8px">Un équipement qui tombe souvent en panne : vérifier la cause racine, rapprocher le préventif, ou envisager son remplacement.</p>` : `<p class="m">Aucune panne enregistrée sur la période. ✅</p>`}</div>
  </div>
  <div class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><h3>Nombre de pannes par équipement</h3>${tousPannes.length ? `<button class="btn btn-ghost btn-sm noprint" id="csvPannes">Exporter (CSV)</button>` : ""}</div>
    ${tousPannes.length ? `<table class="tbl"><tbody><tr><th>Équipement</th><th>${W().Clients.slice(0, -1)}</th><th>Pannes (période)</th><th>Signalements QR</th><th>Pannes 12 mois</th><th>MTBF</th><th>Dernière panne</th></tr>${tousPannes.map(x => `<tr><td><a href="#eq-${x.e.id}">${esc(x.e.emplacement)}</a>${x.e.criticite === "critique" ? ' <span class="pill p-bad">Critique</span>' : ""}</td><td>${esc(client(x.e.client_id).nom || "")}</td><td><b>${x.n}</b></td><td>${x.sigs}</td><td>${x.a}${x.a >= SEUIL_REPETITIVE ? ' <span class="pill p-bad">répétitive</span>' : ""}</td><td>${x.m ? x.m + " j" : "—"}</td><td class="mono">${fr(pannesEq(x.e.id).derniere)}</td></tr>`).join("")}</tbody></table>
    <p class="m" style="margin-top:8px">Panne répétitive = ${SEUIL_REPETITIVE} pannes ou plus sur 12 mois. Les équipements sans panne ni signalement sur la période ne sont pas listés.</p>` : `<p class="m">Aucune panne ni signalement sur la période. ✅</p>`}</div>`;
  if (document.getElementById("csvPannes")) document.getElementById("csvPannes").onclick = () => {
    const rows = [["equipement", "zone", "site", "type", "criticite", "pannes_periode", "signalements_periode", "pannes_12_mois", "mtbf_jours", "derniere_panne"], ...tousPannes.map(x => [x.e.emplacement, x.e.zone || "", client(x.e.client_id).nom || "", TYPES[x.e.type]?.label || x.e.type, x.e.criticite || "normale", x.n, x.sigs, x.a, x.m ?? "", pannesEq(x.e.id).derniere || ""])];
    const csv = "\ufeff" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `pannes-par-equipement-${iso(TODAY)}.csv`; a.click();
  };
  const s2 = document.getElementById("indP"); s2.value = String(IND); s2.onchange = () => { IND = Number(s2.value); renderIndicateurs(); };
}

// =====================================================================
// AIDE — premiers pas + lexique simple
// =====================================================================
function etapesDemarrage() {
  return [
    { ok: !!(S.tech.nom && S.tech.whatsapp), t: "Compléter mon profil", l: "#profil" },
    { ok: S.clients.length > 0, t: `Créer mon premier ${W().client}`, l: "#clients" },
    { ok: S.eqs.length > 0, t: "Enregistrer un équipement (le QR est créé)", l: "#parc" },
    { ok: S.ints.length > 0 || (S.ots || []).some(o => o.statut === "termine"), t: "Enregistrer une intervention ou clôturer un OT", l: "#ot" },
    { ok: (S.pieces || []).length > 0, t: "Ajouter mes pièces courantes au stock", l: "#stock" }
  ];
}
function renderAide() {
  const et = etapesDemarrage();
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:12px">Aide</h1>
  <div class="grid2"><div>
    <div class="panel"><h3>Premiers pas (${et.filter(x => x.ok).length}/${et.length})</h3>${et.map((x, k) => `<a href="${x.l}" class="row" style="grid-template-columns:auto 1fr"><span class="pill ${x.ok ? "p-ok" : ""}" style="min-width:34px;justify-content:center">${x.ok ? "✓" : k + 1}</span><span>${x.t}</span></a>`).join("")}</div>
    <div class="panel"><h3>Le circuit d'une intervention</h3><ol style="padding-left:20px;line-height:1.8">
      <li><b>Demande</b> : une panne est signalée (par QR, par téléphone) ou un besoin apparaît → <a href="#ot">Travaux</a>, « + Nouvel OT ».</li>
      <li><b>Planification</b> : on fixe la date et l'intervenant, on lui envoie l'OT par WhatsApp.</li>
      <li><b>Réalisation</b> : « Démarrer l'intervention » sur place, puis consulter l'aide au <a href="/depannage">dépannage</a> si besoin.</li>
      <li><b>Clôture</b> : compte rendu, mesures, pièces utilisées. Le carnet QR de l'équipement et le stock se mettent à jour tout seuls.</li></ol>
      <p class="m">Le préventif : chaque mois, cliquez sur « Générer les OT préventifs » dans Travaux. FroidPass crée les OT à partir du planning.</p></div>
  </div><div>
    <div class="panel"><h3>Lexique</h3><table class="tbl" style="white-space:normal"><tbody>
      ${[["GMAO", "Gestion de la maintenance assistée par ordinateur : l'outil qui organise toutes les interventions."], ["OT", "Ordre de travail : la fiche d'une intervention, de la demande à la clôture."], ["Préventif", "Entretien fait avant la panne, à date fixe, pour l'éviter."], ["Curatif", "Réparation après une panne."], ["Criticité", "Importance de l'équipement : une panne d'un équipement critique (bloc, pharmacie, serveur) passe en priorité."], ["MTTR", "Temps moyen pour réparer une panne."], ["MTBF", "Temps moyen entre deux pannes d'un même équipement."], ["Seuil d'alerte", "Quantité minimale en stock avant de recommander une pièce."], ["Cause racine", "La vraie origine d'une panne, à traiter pour qu'elle ne revienne pas."]].map(([a, b]) => `<tr><td style="white-space:nowrap"><b>${a}</b></td><td style="white-space:normal">${b}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="panel"><h3>Besoin d'aide ?</h3><p class="m">Écrivez-nous sur WhatsApp, nous répondons rapidement.</p><a class="btn btn-teal btn-sm" style="margin-top:8px" target="_blank" rel="noopener" href="https://wa.me/${CFG.WHATSAPP_FROIDPASS}?text=${encodeURIComponent("Bonjour FroidPass, j'ai une question sur l'application.")}">WhatsApp FroidPass</a></div>
  </div></div>`;
}


// =====================================================================
// AFFECTATION DES TÂCHES (responsable / directeur)
// =====================================================================
const assignables = () => [...(!S.moi ? [{ user_id: S.user.id, nom: (S.tech.nom || "Moi") + " (moi)", role: "admin", telephone: S.tech.whatsapp }] : []), ...(S.membres || [])];
const telMembre = uid => (S.membres || []).find(m => m.user_id === uid)?.telephone || "";
// Prévient le(s) technicien(s) : e-mail + WhatsApp automatiques si configurés, sinon WhatsApp en un clic
async function notifierAffectation(ids) {
  const ots = ids.map(id => S.ots.find(o => o.id === id)).filter(o => o && o.assigne_a && o.assigne_a !== S.user.id);
  if (!ots.length) return;
  let res = {};
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch("/api/notifier-taches", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ ot_ids: ots.map(o => o.id) }) });
    res = await r.json().catch(() => ({}));
  } catch { res = {}; }
  const parTech = {}; ots.forEach(o => (parTech[o.assigne_a] ||= []).push(o));
  const lignes = Object.entries(parTech).map(([uid, l]) => {
    const tel = waNum(telMembre(uid)), nom = nomMembre(uid) || "Technicien";
    const txt = `Bonjour ${nom.split(" ")[0]},\n\n${(S.me || S.tech).nom} vous a assigné ${l.length > 1 ? l.length + " tâches" : "une tâche"} :\n${l.map(o => `• ${otNum(o)} — ${o.titre}${client(o.client_id).nom ? " (" + client(o.client_id).nom + ")" : ""}${o.date_prevue ? " — pour le " + fr(o.date_prevue) : ""}${o.priorite === "urgente" ? " — URGENT" : ""}`).join("\n")}\n\nDétails et compte rendu dans votre espace : ${location.origin}/app#tableau`;
    return `<div class="row" style="cursor:default;grid-template-columns:1fr auto"><div><div class="t">👤 ${esc(nom)} · ${l.length} tâche(s)</div><div class="m">${tel ? esc(telMembre(uid)) : "numéro WhatsApp non renseigné (page Équipe)"}</div></div>${tel ? `<a class="btn btn-teal btn-sm" target="_blank" rel="noopener" href="https://wa.me/${tel}?text=${encodeURIComponent(txt)}">${res.whatsapp_auto ? "Renvoyer sur WhatsApp" : "Envoyer sur WhatsApp"}</a>` : ""}</div>`;
  }).join("");
  const etat = [res.email_auto ? `✉️ E-mail envoyé automatiquement (${res.email || 0})` : "✉️ E-mail automatique non configuré", res.whatsapp_auto ? `💬 WhatsApp envoyé automatiquement (${res.whatsapp || 0})` : "💬 WhatsApp automatique non configuré : envoyez en un clic ci-dessous"].join("<br>");
  modal(`<div class="panel"><h3>Prévenir ${Object.keys(parTech).length > 1 ? "les techniciens" : "le technicien"}</h3><p class="m" style="margin-bottom:10px">${etat}${(res.echecs || []).length ? `<br><span style="color:var(--bad)">${res.echecs.map(esc).join("<br>")}</span>` : ""}</p>${lignes}
    <div style="margin-top:12px"><button class="btn btn-ghost" data-close>Fermer</button></div></div>`);
}

function renderAffectation() {
  if (!S.gmao) return besoinMaj("Travaux");
  const gens = assignables(), debutMois = Date.UTC(new Date(TODAY).getUTCFullYear(), new Date(TODAY).getUTCMonth(), 1);
  const charge = gens.map(g => { const l = S.ots.filter(o => o.assigne_a === g.user_id); const af = l.filter(o => ["planifie", "en_cours"].includes(o.statut));
    return { g, af: af.length, ret: af.filter(otEnRetard).length, enc: af.filter(o => o.statut === "en_cours").length, nl: af.filter(o => !o.vu_le && g.user_id !== S.user.id).length, fin: l.filter(o => o.statut === "termine" && Date.parse(o.date_fin) >= debutMois).length }; });
  const ouverts = S.ots.filter(o => ["demande", "planifie"].includes(o.statut)).sort((a, b) => (!!a.assigne_a - !!b.assigne_a) || (["urgente", "haute", "normale", "basse"].indexOf(a.priorite) - ["urgente", "haute", "normale", "basse"].indexOf(b.priorite)) || String(a.date_prevue || "9").localeCompare(String(b.date_prevue || "9")));
  const optsG = sel => `<option value="">— Non assigné —</option>` + gens.map(g => `<option value="${g.user_id}" ${sel === g.user_id ? "selected" : ""}>${esc(g.nom || "Membre")}</option>`).join("");
  $view.innerHTML = `<a href="#ot" class="m">← Travaux</a>
  <h1 style="font-size:28px;margin:6px 0 4px">Affecter des tâches</h1>
  <p class="m" style="margin-bottom:14px">Créez une tâche pour un technicien ou répartissez les OT en attente. Chaque technicien est prévenu (e-mail / WhatsApp) et vous voyez quand il a consulté sa tâche.</p>
  ${!(S.membres || []).some(m => m.role === "technicien") ? `<div class="panel" style="border-color:var(--heat)">Aucun technicien dans l'équipe pour l'instant. <a href="#equipe">Inviter un technicien</a></div>` : ""}
  <div class="grid2"><div class="panel"><h3>Nouvelle tâche</h3><form class="form" id="fTache">
      <label class="full">Tâche à réaliser<input class="field" name="titre" required maxlength="200" placeholder="Ex. Nettoyer les filtres du bloc B, inventaire du stock, relever les compteurs…"></label>
      <label>Assigner à<select class="field" name="assigne_a" required>${optsG("").replace("— Non assigné —", "— Choisir —")}</select></label>
      <label>Échéance<input class="field" type="date" name="date_prevue" value="${iso(TODAY + DAY)}" required></label>
      <label>Type<select class="field" name="type">${Object.entries(OT_TYPES).map(([k, v]) => `<option value="${k}" ${k === "tache" ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Priorité<select class="field" name="priorite">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${k === "normale" ? "selected" : ""}>${v.l}</option>`).join("")}</select></label>
      <label>${W().Clients.slice(0, -1)} (facultatif)<select class="field" name="client_id" id="tCli"><option value="">— Aucun (tâche générale) —</option>${S.clients.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join("")}</select></label>
      <label>Équipement (facultatif)<select class="field" name="equipement_id" id="tEq"><option value="">—</option></select></label>
      <label class="full">Consignes<textarea class="field" name="description" rows="2" placeholder="Détails, matériel à prévoir, contact sur place…"></textarea></label>
      <div class="full"><button class="btn btn-hot" type="submit">Assigner et prévenir</button></div></form></div>
    <div class="panel"><h3>Charge de l'équipe</h3><table class="tbl"><tbody><tr><th>Membre</th><th>À faire</th><th>En retard</th><th>En cours</th><th>Non lues</th><th>Terminées (mois)</th></tr>
      ${charge.map(x => `<tr><td>${esc(x.g.nom || "Membre")}</td><td><b>${x.af}</b></td><td style="color:${x.ret ? "var(--bad)" : "inherit"}">${x.ret}</td><td>${x.enc}</td><td style="color:${x.nl ? "var(--heat)" : "inherit"}">${x.nl}</td><td>${x.fin}</td></tr>`).join("")}</tbody></table>
      <p class="m" style="margin-top:8px">« Non lues » : tâches que le technicien n'a pas encore ouvertes.</p></div></div>
  <div class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><h3>Répartir les OT en attente (${ouverts.length})</h3>
    <label class="m" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="nonAss"> seulement les non assignés</label></div>
    ${ouverts.length ? `<div style="overflow-x:auto"><table class="tbl" id="tRep"><tbody><tr><th>N°</th><th>Tâche</th><th>${W().Clients.slice(0, -1)} / équipement</th><th>Priorité</th><th>Échéance</th><th>Assigné à</th></tr>
      ${ouverts.map(o => `<tr data-id="${o.id}" data-ass="${o.assigne_a ? 1 : 0}"><td class="mono"><a href="#ot-${o.id}">${otNum(o)}</a></td><td>${esc(o.titre)}<br><span class="m">${OT_TYPES[o.type]}${o.vu_le ? " · 👁 vu" : ""}</span></td><td>${esc(client(o.client_id).nom || "Général")}${eqById(o.equipement_id) ? "<br><span class='m'>" + esc(eqById(o.equipement_id).emplacement) + "</span>" : ""}</td><td><span class="pill ${PRIO[o.priorite].c}">${PRIO[o.priorite].l}</span></td>
        <td><input class="field" type="date" data-d value="${o.date_prevue || ""}" style="padding:6px 8px"></td><td><select class="field" data-a style="padding:6px 8px">${optsG(o.assigne_a)}</select></td></tr>`).join("")}</tbody></table></div>
      <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap"><button class="btn btn-hot" id="saveRep">Enregistrer les affectations et prévenir</button><span class="m" id="nbChg"></span></div>` : `<p class="m">Aucun OT en attente. ✅</p>`}</div>`;
  const tCli = document.getElementById("tCli"), tEq = document.getElementById("tEq");
  tCli.onchange = () => { tEq.innerHTML = `<option value="">—</option>` + S.eqs.filter(e => e.client_id === tCli.value).map(e => `<option value="${e.id}">${esc(e.emplacement)}${e.zone ? " · " + esc(e.zone) : ""}</option>`).join(""); };
  document.getElementById("fTache").onsubmit = async ev => {
    ev.preventDefault(); const b = ev.target.querySelector("button"); b.disabled = true;
    const o = Object.fromEntries(new FormData(ev.target));
    for (const k of ["client_id", "equipement_id"]) if (!o[k]) o[k] = null;
    Object.assign(o, { statut: "planifie", assigne_le: new Date().toISOString(), intervenant: nomMembre(o.assigne_a) || "", intervenant_tel: telMembre(o.assigne_a) });
    const { data, error } = await sb.from("ordres_travail").insert(o).select().single();
    if (error) { toast(error.message); b.disabled = false; return; }
    await loadAll(); renderAffectation(); toast(`${otNum(data)} assigné à ${nomMembre(o.assigne_a)}`);
    if (o.assigne_a !== S.user.id) notifierAffectation([data.id]);
  };
  const tab = document.getElementById("tRep");
  if (tab) {
    const lignes = () => [...tab.querySelectorAll("tr[data-id]")];
    const chg = () => lignes().filter(tr => { const o = S.ots.find(x => x.id === tr.dataset.id); return (tr.querySelector("[data-a]").value || null) !== (o.assigne_a || null) || (tr.querySelector("[data-d]").value || null) !== (o.date_prevue || null); });
    tab.oninput = tab.onchange = () => { const n = chg().length; document.getElementById("nbChg").textContent = n ? `${n} modification(s) à enregistrer` : ""; };
    document.getElementById("nonAss").onchange = ev => lignes().forEach(tr => tr.hidden = ev.target.checked && tr.dataset.ass === "1");
    document.getElementById("saveRep").onclick = async ev => {
      const l = chg(); if (!l.length) return toast("Aucune modification");
      ev.target.disabled = true; const aPrevenir = [];
      for (const tr of l) {
        const o = S.ots.find(x => x.id === tr.dataset.id), a = tr.querySelector("[data-a]").value || null, d = tr.querySelector("[data-d]").value || null;
        const patch = { assigne_a: a, date_prevue: d, statut: a || d ? "planifie" : "demande" };
        if (a !== (o.assigne_a || null)) { Object.assign(patch, { assigne_le: a ? new Date().toISOString() : null, vu_le: null, intervenant: a ? nomMembre(a) : "", intervenant_tel: a ? telMembre(a) : "" }); if (a && a !== S.user.id) aPrevenir.push(o.id); }
        else if (a && d !== (o.date_prevue || null) && a !== S.user.id) aPrevenir.push(o.id);
        const { error } = await sb.from("ordres_travail").update(patch).eq("id", o.id);
        if (error) { toast(error.message); ev.target.disabled = false; return; }
      }
      await loadAll(); renderAffectation(); toast(`${l.length} OT mis à jour`);
      if (aPrevenir.length) notifierAffectation(aPrevenir);
    };
  }
}

// =====================================================================
// ÉQUIPE ET RÔLES
// =====================================================================
function optsAssign(sel) {
  const opts = [`<option value="">— Non assigné / prestataire externe —</option>`];
  if (isAdmin() && !S.moi) opts.push(`<option value="${S.user.id}" ${sel === S.user.id ? "selected" : ""}>Moi (${esc(S.tech.nom || "responsable")})</option>`);
  for (const m of S.membres || []) opts.push(`<option value="${m.user_id}" ${sel === m.user_id ? "selected" : ""}>${esc(m.nom || "Membre")} · ${m.role === "admin" ? "responsable" : "technicien"}</option>`);
  return opts.join("");
}
function majMenuRole() {
  const menu = document.getElementById("menu"); if (!menu) return;
  const set = (v, txt, show = true) => { const a = menu.querySelector(`a[data-v="${v}"]`); if (a) { if (txt) a.textContent = txt; a.hidden = !show; } };
  set("tableau", isAdmin() ? "Tableau" : "Mon espace");
  set("ot", isAdmin() ? "Travaux" : "Mes OT");
  set("indicateurs", null, isAdmin());
  if (isAdmin() && !menu.querySelector('a[data-v="equipe"]')) menu.querySelector('a[data-v="aide"]').insertAdjacentHTML("beforebegin", `<a href="#equipe" data-v="equipe">Équipe</a>`);
}

function renderMonEspace() {
  const mes = (S.ots || []).filter(o => o.assigne_a === S.user.id);
  const aFaire = mes.filter(o => ["planifie", "en_cours"].includes(o.statut)).sort((a, b) => (b.statut === "en_cours") - (a.statut === "en_cours") || String(a.date_prevue || "9").localeCompare(String(b.date_prevue || "9")));
  const finis = mes.filter(o => o.statut === "termine" && Date.parse(o.date_fin) >= Date.UTC(new Date(TODAY).getUTCFullYear(), new Date(TODAY).getUTCMonth(), 1));
  const sigs = (S.sigs || []).filter(x => x.statut !== "resolu");
  $view.innerHTML = `<h1 style="font-size:30px;margin-bottom:4px">Bonjour ${esc(((S.me || {}).nom || "").split(" ")[0])}</h1>
  <p class="m" style="margin-bottom:16px">Équipe ${esc(S.tech.entreprise || S.tech.nom)} · votre espace technicien</p>
  <div class="kpis">
    <div class="kpi"><b>${aFaire.length}</b><span>tâches à réaliser${aFaire.filter(o => !o.vu_le).length ? ` · <b style="color:var(--bad)">${aFaire.filter(o => !o.vu_le).length} nouvelle(s)</b>` : ""}</span></div>
    <div class="kpi alert"><b>${aFaire.filter(otEnRetard).length}</b><span>en retard</span></div>
    <div class="kpi"><b>${aFaire.filter(o => o.statut === "en_cours").length}</b><span>en cours</span></div>
    <div class="kpi"><b>${finis.length}</b><span>terminés ce mois</span></div>
  </div>
  <div class="grid2"><div class="panel"><h3>Mes interventions à faire</h3>${aFaire.map(carteOT).join("") || `<p class="empty">Aucun OT assigné pour le moment. ✅</p>`}</div>
  <div>
    ${sigs.length ? `<div class="panel" style="border:2px solid var(--bad)"><h3>🚨 ${sigs.length} panne(s) signalée(s)</h3><p class="m">Prévenez le responsable si vous êtes sur place.</p>${sigs.slice(0, 5).map(x => { const e = eqById(x.equipement_id) || {}; return `<div style="padding:8px 0;border-top:1px solid var(--line)"><b>${esc(e.emplacement || "?")}</b> · ${esc(client(e.client_id).nom || "")}<div class="m">${esc(x.description)}</div></div>`; }).join("")}</div>` : ""}
    <div class="panel"><h3>Raccourcis</h3><div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-hot" id="besoin">+ Signaler un besoin / une panne</button>
      <a class="btn btn-ghost" href="#parc">Consulter le parc</a>
      <a class="btn btn-ghost" href="/depannage">Codes erreur et dépannage</a></div></div>
  </div></div>`;
  document.getElementById("besoin").onclick = () => openOTForm({});
}

function renderEquipe() {
  const m = S.membres || [], inv = S.invitations || [];
  const lien = location.origin + "/app#inscription";
  $view.innerHTML = `<h1 style="font-size:28px;margin-bottom:6px">Équipe</h1>
  <p class="m" style="margin-bottom:14px">Le <b>responsable</b> (directeur, responsable maintenance) voit et gère tout. Chaque <b>technicien</b> a son espace : ses OT assignés, ses comptes rendus, le parc et le dépannage. Il ne voit ni les coûts globaux, ni l'abonnement, et ne peut rien supprimer.</p>
  <div class="grid2"><div>
    <div class="panel"><h3>Membres (${m.length + 1})</h3>
      <div class="row" style="cursor:default;grid-template-columns:auto 1fr auto"><div class="ic">👑</div><div><div class="t">${esc(S.tech.nom || "Responsable")}</div><div class="m">Titulaire du compte · responsable</div></div><span></span></div>
      ${m.map(x => `<div class="row" style="cursor:default;grid-template-columns:auto 1fr auto"><div class="ic">${x.role === "admin" ? "🧭" : "🔧"}</div><div><div class="t">${esc(x.nom || "Membre")}</div><div class="m">${x.role === "admin" ? "Responsable" : "Technicien"} · ${esc(x.telephone || "")} · ${(S.ots || []).filter(o => o.assigne_a === x.user_id && ["planifie", "en_cours"].includes(o.statut)).length} OT en cours</div></div>
        ${x.user_id !== S.user.id ? `<span style="display:flex;gap:6px"><select class="field" data-role="${x.id}" style="width:auto;padding:5px 8px"><option value="technicien" ${x.role === "technicien" ? "selected" : ""}>Technicien</option><option value="admin" ${x.role === "admin" ? "selected" : ""}>Responsable</option></select><button class="btn btn-ghost btn-sm" data-tel="${x.id}" title="Numéro WhatsApp pour recevoir les tâches">📱 WhatsApp</button><button class="btn btn-ghost btn-sm" data-rmm="${x.id}" style="color:var(--bad)">Retirer</button></span>` : "<span></span>"}</div>`).join("")}
    </div>
    ${inv.length ? `<div class="panel"><h3>Invitations en attente</h3>${inv.map(x => `<div class="row" style="cursor:default;grid-template-columns:1fr auto"><div><div class="t">${esc(x.nom || x.email)}</div><div class="m">${esc(x.email)} · ${x.role === "admin" ? "responsable" : "technicien"}</div></div><span style="display:flex;gap:6px">${x.telephone ? `<a class="btn btn-teal btn-sm" target="_blank" rel="noopener" href="https://wa.me/${waNum(x.telephone)}?text=${encodeURIComponent(msgInvitation(x, lien))}">Relancer</a>` : ""}<button class="btn btn-ghost btn-sm" data-rmi="${x.id}">Annuler</button></span></div>`).join("")}</div>` : ""}
  </div>
  <div class="panel"><h3>Inviter un membre</h3>
    <form class="form" id="fInv" style="grid-template-columns:1fr">
      <label>Nom<input class="field" name="nom" required></label>
      <label>E-mail (celui qu'il utilisera pour se connecter)<input class="field" type="email" name="email" required></label>
      <label>WhatsApp<input class="field" name="telephone" placeholder="+229 01 …"></label>
      <label>Rôle<select class="field" name="role"><option value="technicien">Technicien</option><option value="admin">Responsable (accès complet)</option></select></label>
      <button class="btn btn-hot" type="submit">Créer l'invitation</button></form>
    <p class="m" style="margin-top:12px">Ensuite, la personne crée son compte sur <span class="mono">${esc(lien)}</span> avec cet e-mail : elle rejoint automatiquement votre équipe.</p>
  </div></div>`;
  document.getElementById("fInv").onsubmit = async ev => {
    ev.preventDefault(); const o = Object.fromEntries(new FormData(ev.target)); o.email = o.email.trim().toLowerCase();
    const { error } = await sb.from("invitations").insert(o);
    if (error) return toast(error.message.includes("duplicate") ? "Cette personne est déjà invitée" : error.message);
    await loadAll(); renderEquipe(); toast("Invitation créée");
    if (o.telephone) modal(`<div class="panel"><h3>Prévenir ${esc(o.nom)}</h3><div class="msgbox">${esc(msgInvitation(o, lien))}</div><a class="btn btn-teal btn-sm" target="_blank" rel="noopener" href="https://wa.me/${waNum(o.telephone)}?text=${encodeURIComponent(msgInvitation(o, lien))}">Envoyer sur WhatsApp</a> <button class="btn btn-ghost btn-sm" data-close>Fermer</button></div>`);
  };
  document.querySelectorAll("[data-rmi]").forEach(b => b.onclick = async () => { await sb.from("invitations").delete().eq("id", b.dataset.rmi); await loadAll(); renderEquipe(); });
  document.querySelectorAll("[data-rmm]").forEach(b => b.onclick = () => confirmBox("Retirer ce membre de l'équipe ? Il n'aura plus accès aux données.", async () => { const { error } = await sb.from("membres").delete().eq("id", b.dataset.rmm); if (error) return toast(error.message); await loadAll(); renderEquipe(); }));
  document.querySelectorAll("[data-tel]").forEach(b => b.onclick = () => {
    const x = S.membres.find(m => m.id === b.dataset.tel);
    modal(`<div class="panel"><h3>WhatsApp de ${esc(x.nom || "ce membre")}</h3><p class="m">Numéro sur lequel il reçoit ses tâches.</p><input class="field" id="telM" value="${esc(x.telephone || "")}" placeholder="+229 01 XX XX XX XX" style="margin:10px 0"><div style="display:flex;gap:8px"><button class="btn btn-hot" id="telOk">Enregistrer</button><button class="btn btn-ghost" data-close>Annuler</button></div></div>`);
    document.getElementById("telOk").onclick = async () => { const { error } = await sb.from("membres").update({ telephone: document.getElementById("telM").value.trim() }).eq("id", x.id); if (error) return toast(error.message); modal(""); await loadAll(); renderEquipe(); toast("Numéro enregistré"); };
  });
  document.querySelectorAll("[data-role]").forEach(sel => sel.onchange = async () => { const { error } = await sb.from("membres").update({ role: sel.value }).eq("id", sel.dataset.role); if (error) return toast(error.message); await loadAll(); renderEquipe(); toast("Rôle modifié"); });
}
function msgInvitation(x, lien) {
  return `Bonjour ${x.nom || ""},\n\n${S.tech.entreprise || S.tech.nom} vous invite sur FroidPass, notre outil de suivi de la maintenance${x.role === "admin" ? "" : " : vous y retrouverez vos interventions à réaliser"}.\n\nCréez votre compte avec l'e-mail ${x.email} ici : ${lien}\n\nVous rejoindrez automatiquement l'équipe.`;
}
