-- =====================================================================
-- FroidPass — Emplacement de l'équipement : 3 choix (près de la mer / dehors loin de la mer / à l'abri)
-- =====================================================================
alter table public.equipements drop constraint if exists equipements_environnement_check;
alter table public.equipements add constraint equipements_environnement_check check (environnement in ('cotier','exterieur','interieur'));
