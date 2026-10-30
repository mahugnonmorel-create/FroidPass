// FroidPass — Notifications sur le téléphone (Web Push standard, gratuit, sans service tiers)
// Les clés VAPID sont générées automatiquement au premier usage et gardées dans Supabase (table config_serveur, accès serveur uniquement).
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } });
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };

async function pg(env, path, { token, method = "GET", body, prefer = "return=representation" } = {}) {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method, headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + (token || env.SUPABASE_SERVICE_ROLE_KEY), "Content-Type": "application/json", Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Base " + r.status + (j?.message ? " : " + j.message : ""));
  return j;
}

// ---------- Clés VAPID ----------
let vapidCache = null;
export async function clesVapid(env) {
  if (vapidCache) return vapidCache;
  const row = (await pg(env, "config_serveur?cle=eq.vapid&select=valeur"))[0];
  if (row?.valeur?.publicKey) return (vapidCache = row.valeur);
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const valeur = { publicKey: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
  await pg(env, "config_serveur", { method: "POST", body: { cle: "vapid", valeur }, prefer: "resolution=ignore-duplicates,return=minimal" });
  const relu = (await pg(env, "config_serveur?cle=eq.vapid&select=valeur"))[0]; // en cas de création simultanée, la première gagne
  return (vapidCache = relu?.valeur || valeur);
}
async function jetonVapid(env, endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:" + (env.ADMIN_EMAIL || "contact@froidpass.app") })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(h + "." + p));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// ---------- Chiffrement du message (RFC 8291, aes128gcm) ----------
const hkdf = async (salt, ikm, info, bits) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bits));
export async function chiffrer(sub, texte) {
  const uaPub = deb64u(sub.keys.p256dh), auth = deb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const partage = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, partage, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 96);
  const clair = concat(enc.encode(texte), new Uint8Array([2]));
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]), clair));
  const rs = new Uint8Array([0, 0, 16, 0]); // taille d'enregistrement 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, chiffre);
}

// Envoie une notification à une liste d'utilisateurs (tous leurs appareils). Ne lève jamais d'erreur.
export async function envoyerPush(env, userIds, message) {
  try {
    const ids = [...new Set(userIds)].filter(x => /^[0-9a-f-]{36}$/i.test(x));
    if (!ids.length || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return 0;
    const abos = await pg(env, `push_abonnements?user_id=in.(${ids.join(",")})&select=id,endpoint,p256dh,auth`);
    if (!abos.length) return 0;
    const vapid = await clesVapid(env), texte = JSON.stringify(message).slice(0, 3000);
    let n = 0;
    await Promise.all(abos.map(async a => {
      try {
        const corps = await chiffrer({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, texte);
        const r = await fetch(a.endpoint, { method: "POST", headers: { Authorization: await jetonVapid(env, a.endpoint, vapid), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: message.urgent ? "high" : "normal" }, body: corps });
        if (r.status === 404 || r.status === 410) await pg(env, `push_abonnements?id=eq.${a.id}`, { method: "DELETE", prefer: "return=minimal" }); // abonnement expiré
        else if (r.ok) n++;
      } catch (e) { console.error("push", e.message); }
    }));
    return n;
  } catch (e) { console.error("push", e.message); return 0; }
}
// Responsables (titulaire + membres « admin ») d'une organisation
export async function responsablesOrg(env, orgId) {
  const m = await pg(env, `membres?org_id=eq.${orgId}&role=eq.admin&select=user_id`).catch(() => []);
  return [orgId, ...m.map(x => x.user_id)];
}

// ---------- API ----------
export async function routePush(request, env, chemin) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Notifications indisponibles (configuration serveur)" }, 503);
  if (chemin === "cle") return json({ publicKey: (await clesVapid(env)).publicKey });
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const user = token && await fetch(env.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + token } }).then(r => r.ok ? r.json() : null);
  if (!user?.id) return json({ error: "Connexion requise" }, 401);
  const b = await request.json().catch(() => ({}));
  if (chemin === "abonner") {
    const s = b.subscription || {};
    if (!/^https:\/\//.test(s.endpoint || "") || !s.keys?.p256dh || !s.keys?.auth) return json({ error: "Abonnement invalide" }, 400);
    const org = await pg(env, "rpc/mon_org", { token, method: "POST", body: {} }).catch(() => user.id);
    await pg(env, "push_abonnements?on_conflict=endpoint", { method: "POST", body: { user_id: user.id, org_id: org || user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, appareil: String(b.appareil || "").slice(0, 120) }, prefer: "resolution=merge-duplicates,return=minimal" });
    return json({ ok: true });
  }
  if (chemin === "desabonner") { if (b.endpoint) await pg(env, `push_abonnements?endpoint=eq.${encodeURIComponent(b.endpoint)}&user_id=eq.${user.id}`, { method: "DELETE", prefer: "return=minimal" }); return json({ ok: true }); }
  if (chemin === "test") { const n = await envoyerPush(env, [user.id], { titre: "FroidPass", corps: "✅ Les notifications fonctionnent sur cet appareil.", url: "/app#tableau" }); return json({ envoyes: n }); }
  return json({ error: "Route inconnue" }, 404);
}
