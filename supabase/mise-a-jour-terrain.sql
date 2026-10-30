-- =====================================================================
-- FroidPass — Terrain : listes de contrôle et signature du client sur les interventions
-- =====================================================================
-- controles : [{ "point": "Filtres", "etat": "ok|anomalie|na" }]
alter table public.interventions add column if not exists controles jsonb not null default '[]'::jsonb;
-- signature : { "path": "<org>/signatures/<uuid>.png", "nom": "M. Dossou", "date": "..." }
alter table public.interventions add column if not exists signature jsonb;
-- signature aussi sur l'ordre de travail (OT sans équipement)
alter table public.ordres_travail add column if not exists signature jsonb;
