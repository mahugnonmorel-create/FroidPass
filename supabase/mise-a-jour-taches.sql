-- =====================================================================
-- FroidPass — Affectation des tâches aux techniciens
-- =====================================================================
-- Nouveau type « tâche » (travail hors équipement : inventaire, achat, rangement, devis…)
alter table public.ordres_travail drop constraint if exists ordres_travail_type_check;
alter table public.ordres_travail add constraint ordres_travail_type_check check (type in ('preventif','curatif','amelioration','inspection','tache'));
-- Une tâche peut concerner toute l'organisation (pas de site précis)
alter table public.ordres_travail alter column client_id drop not null;
-- Suivi de l'affectation : date d'affectation et accusé de lecture du technicien
alter table public.ordres_travail add column if not exists assigne_le timestamptz;
alter table public.ordres_travail add column if not exists vu_le timestamptz;

drop policy if exists ot_insert on public.ordres_travail; create policy ot_insert on public.ordres_travail for insert with check (
  technicien_id = public.mon_org()
  and (public.est_admin() or (statut = 'demande' and assigne_a is null))
  and (client_id is null or exists (select 1 from public.clients c where c.id = client_id and c.technicien_id = public.mon_org()))
  and (equipement_id is null or exists (select 1 from public.equipements e where e.id = equipement_id and e.technicien_id = public.mon_org())));
