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

// worker.js
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const route = url.pathname.slice(5).split("/").filter(Boolean);
      return onRequest({ request, env, params: { route } });
    }
    return env.ASSETS.fetch(request);
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

// .wrangler/tmp/bundle-S8yaNz/middleware-insertion-facade.js
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

// .wrangler/tmp/bundle-S8yaNz/middleware-loader.entry.ts
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
