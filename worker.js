// Point d'entrée Cloudflare Workers
//   /api/automatisations?key=ADMIN_KEY[&test=1] -> lance les automatisations à la main (test=1 : simulation sans envoi)
//   /api/*  -> fonctions de paiement FedaPay
//   le reste -> site statique (dossier public)
//   chaque matin 7 h (Bénin) -> rapport + e-mails automatiques (voir automatisations.js)
import { onRequest } from "./functions/api/[[route]].js";
import { runAutomatisations } from "./automatisations.js";
import { signaler } from "./signalements.js";

const json = (d, s = 200) => new Response(JSON.stringify(d, null, 2), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/automatisations") {
      if (!env.ADMIN_KEY || url.searchParams.get("key") !== env.ADMIN_KEY) return json({ error: "Clé invalide" }, 403);
      try { return json(await runAutomatisations(env, { dryRun: url.searchParams.get("test") === "1" })); }
      catch (e) { return json({ error: e.message }, 500); }
    }
    if (url.pathname === "/api/signaler") return signaler(request, env).catch(e => json({ error: e.message }, 500));
    if (url.pathname.startsWith("/api/")) {
      const route = url.pathname.slice(5).split("/").filter(Boolean);
      return onRequest({ request, env, params: { route } });
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomatisations(env).catch(e => console.error("Automatisations :", e.message)));
  }
};
