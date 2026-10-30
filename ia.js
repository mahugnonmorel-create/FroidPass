// FroidPass — Analyse IA d'une photo de pièce (Cloudflare Workers AI, offert dans l'allocation gratuite quotidienne)
// L'analyse est une aide au diagnostic : elle est enregistrée « à valider » et n'apparaît dans le rapport client
// qu'après validation par le responsable / directeur.
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } });
const QUOTA_DECOUVERTE = 3, QUOTA_PAYANT = 20, QUOTA_GLOBAL = 100; // analyses par jour
const MODELES = ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-3.2-11b-vision-instruct"];
const TYPES = { split: "split mural / console", cassette: "cassette / gainable", groupe: "groupe extérieur", chambre: "chambre froide", vitrine: "armoire / vitrine réfrigérée", vrv: "VRV / DRV", cta: "centrale de traitement d'air", eau_glacee: "groupe d'eau glacée", clim_precision: "climatisation de précision", frigo_medical: "réfrigérateur médical / laboratoire", chambre_mortuaire: "chambre mortuaire", ventilation: "ventilation / extraction" };
const CAT = { defectueuse: "pièce défectueuse déposée", remplacee: "pièce neuve posée en remplacement", avant: "état avant intervention", apres: "état après intervention", autre: "photo d'intervention" };

async function pg(env, path, { token, method = "GET", body, prefer = "return=representation" } = {}) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + (token || env.SUPABASE_SERVICE_ROLE_KEY), "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Base " + r.status + (j?.message ? " : " + j.message : ""));
  return j;
}

export function construirePrompt(eq, ph, obs) {
  return `Tu es un technicien frigoriste et climaticien expert (maintenance CVC, normes NF / ISO, climat tropical côtier du Bénin).
Analyse la photo jointe. Contexte fourni par le technicien :
- Équipement : ${TYPES[eq.type] || eq.type || "non précisé"}${eq.marque ? ", marque " + eq.marque : ""}${eq.puissance ? ", puissance " + eq.puissance : ""}${eq.fluide ? ", fluide " + eq.fluide : ""}
- Environnement : ${eq.environnement === "cotier" ? "côtier (air salin, humidité élevée)" : "intérieur"}
- Photo : ${CAT[ph.categorie] || "photo"}${ph.legende ? ` — légende : « ${ph.legende} »` : ""}
- Observations de l'intervention : ${obs || "aucune"}

Réponds en français, de façon factuelle et concise, avec exactement ces rubriques :
Pièce identifiée :
Défauts visibles : (gonflement, oxydation/corrosion, traces de brûlure ou d'arc, fuite d'huile, encrassement, déformation… ; écris « aucun défaut visible » si rien n'est visible)
Cause racine probable :
Action corrective :
Action préventive :
Mesure de confirmation : (mesure réelle à faire pour confirmer : capacité en µF, isolement en MΩ, résistance des enroulements, intensité absorbée, pressions HP/BP, surchauffe/sous-refroidissement… avec la valeur attendue si elle est connue)
Sécurité : (consignation NF C 18-510, EPI, décharge des condensateurs, récupération du fluide)
Niveau de confiance : faible, moyen ou élevé, avec la raison

Règles : ne devine pas. Si la photo est floue, trop sombre ou ne montre pas assez la pièce, dis-le et indique quelle photo ou quelle mesure prendre. N'invente aucune référence, valeur de plaque ou code erreur que tu ne vois pas. Pas de solution de surface (réarmement, reset) sans cause.`;
}

async function appelerIA(env, prompt, dataUrl, bytes) {
  let derniere;
  for (const m of MODELES) {
    try {
      const entree = m.includes("llama-3.2")
        ? { messages: [{ role: "user", content: prompt }], image: [...bytes], max_tokens: 700, temperature: 0.2 }
        : { messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }], max_tokens: 700, temperature: 0.2 };
      let r;
      try { r = await env.AI.run(m, entree); }
      catch (e) { if (/agree/i.test(e.message)) { await env.AI.run(m, { prompt: "agree" }).catch(() => {}); r = await env.AI.run(m, entree); } else throw e; }
      const texte = String(r?.response ?? r?.result?.response ?? "").trim();
      if (texte.length > 40) return { texte: texte.slice(0, 4000), modele: m.split("/").pop() };
      derniere = new Error("Réponse vide");
    } catch (e) { derniere = e; }
  }
  throw new Error("Analyse IA indisponible pour le moment (" + (derniere?.message || "erreur") + ")");
}

export async function analyserPhoto(request, env) {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  if (!env.AI) return json({ error: "L'IA n'est pas activée sur le serveur (liaison Workers AI manquante)" }, 503);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Service indisponible (configuration serveur)" }, 503);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Connexion requise" }, 401);
  const user = await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token } }).then(r => r.ok ? r.json() : null);
  if (!user?.id) return json({ error: "Session expirée, reconnectez-vous" }, 401);

  const b = await request.json().catch(() => ({}));
  const id = String(b.intervention_id || ""), k = Number(b.index);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(k) || k < 0 || k > 20) return json({ error: "Requête invalide" }, 400);

  // Lecture avec le jeton de l'utilisateur : la RLS garantit que l'intervention appartient à son organisation
  const it = (await pg(env, `interventions?id=eq.${id}&select=id,technicien_id,observations,photos,equipements(type,marque,puissance,fluide,environnement)`, { token }))[0];
  if (!it) return json({ error: "Intervention introuvable" }, 404);
  const ph = (it.photos || [])[k];
  if (!ph?.path || !ph.path.startsWith(it.technicien_id + "/")) return json({ error: "Photo introuvable" }, 404);

  // Quotas (l'allocation IA gratuite est partagée entre tous les comptes)
  const org = (await pg(env, `techniciens?id=eq.${it.technicien_id}&select=offre,fin_abonnement`))[0] || {};
  const payant = org.offre && org.offre !== "decouverte" && org.fin_abonnement && Date.parse(org.fin_abonnement) >= Date.now() - 864e5;
  const depuis = encodeURIComponent(new Date(Date.now() - 864e5).toISOString());
  const nbOrg = (await pg(env, `analyses_ia?technicien_id=eq.${it.technicien_id}&created_at=gte.${depuis}&select=id`)).length;
  const quota = payant ? QUOTA_PAYANT : QUOTA_DECOUVERTE;
  if (nbOrg >= quota) return json({ error: `Limite atteinte : ${quota} analyses IA par 24 h${payant ? "" : " avec l'offre Découverte (20 avec un abonnement)"}` }, 429);
  const nbTotal = (await pg(env, `analyses_ia?created_at=gte.${depuis}&select=id`)).length;
  if (nbTotal >= QUOTA_GLOBAL) return json({ error: "Le service d'analyse IA est très sollicité aujourd'hui, réessayez demain." }, 429);

  // Photo (compressée par l'application, ~100-250 Ko)
  const img = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public/photos/${ph.path.split("/").map(encodeURIComponent).join("/")}`);
  if (!img.ok) return json({ error: "Photo inaccessible" }, 404);
  const bytes = new Uint8Array(await img.arrayBuffer());
  if (bytes.length > 3_500_000) return json({ error: "Photo trop lourde pour l'analyse" }, 413);
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const dataUrl = `data:${img.headers.get("content-type") || "image/jpeg"};base64,${btoa(bin)}`;

  await pg(env, "analyses_ia", { method: "POST", body: { technicien_id: it.technicien_id, intervention_id: it.id, demande_par: user.id }, prefer: "return=minimal" });
  const res = await appelerIA(env, construirePrompt(it.equipements || {}, ph, it.observations), dataUrl, bytes);

  // Enregistrement dans la photo (relecture juste avant pour ne pas écraser une modification parallèle)
  const frais = (await pg(env, `interventions?id=eq.${id}&select=photos`))[0];
  const photos = Array.isArray(frais?.photos) ? frais.photos : [];
  if (!photos[k] || photos[k].path !== ph.path) return json({ error: "La photo a changé entre-temps, relancez l'analyse" }, 409);
  photos[k] = { ...photos[k], analyse: { texte: res.texte, modele: res.modele, date: new Date().toISOString(), valide: false } };
  await pg(env, `interventions?id=eq.${id}`, { method: "PATCH", body: { photos }, prefer: "return=minimal" });
  return json({ ok: true, analyse: photos[k].analyse, restant: quota - nbOrg - 1 });
}
