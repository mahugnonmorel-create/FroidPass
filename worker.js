// Point d'entrée Cloudflare Workers : /api/* -> fonctions de paiement, le reste -> site statique
import { onRequest } from "./functions/api/[[route]].js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const route = url.pathname.slice(5).split("/").filter(Boolean);
      return onRequest({ request, env, params: { route } });
    }
    return env.ASSETS.fetch(request);
  }
};
