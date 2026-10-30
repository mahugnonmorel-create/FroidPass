-- =====================================================================
-- FroidPass — Photos des pièces (défectueuses / remplacées) dans les interventions
-- =====================================================================
-- Chaque intervention garde une liste de photos : [{ "path": "...", "categorie": "defectueuse|remplacee|avant|apres|autre", "legende": "..." }]
alter table public.interventions add column if not exists photos jsonb not null default '[]'::jsonb;

-- Espace de stockage des photos (Supabase Storage). Fichiers en lecture publique par lien
-- (noms aléatoires non devinables), pour que le client voie les photos dans son rapport sans compte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Dépôt : tout membre de l'organisation, uniquement dans le dossier de son organisation
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = public.mon_org()::text);
-- Lecture via l'API (aperçus dans l'application) : membres de l'organisation
drop policy if exists photos_select on storage.objects;
create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.mon_org()::text);
-- Suppression : responsable / directeur uniquement
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.mon_org()::text and public.est_admin());

-- Analyses IA des photos (comptage des quotas journaliers ; accès serveur uniquement)
create table if not exists public.analyses_ia (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null references public.techniciens(id) on delete cascade,
  intervention_id uuid references public.interventions(id) on delete set null,
  demande_par    uuid,
  created_at     timestamptz not null default now()
);
alter table public.analyses_ia enable row level security;
create index if not exists analyses_ia_org_date on public.analyses_ia(technicien_id, created_at);
