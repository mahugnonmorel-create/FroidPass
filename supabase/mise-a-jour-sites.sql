-- =====================================================================
-- FroidPass — Rapport de site + QR « site » + zones
-- À exécuter UNE FOIS dans Supabase > SQL Editor > Run
-- =====================================================================

-- Zone dans le site (Bâtiment A, Restaurant, Chambres 1-20…)
alter table public.equipements add column if not exists zone text not null default '';

-- Code public du site (QR à l'accueil / local technique)
alter table public.clients add column if not exists code_public text;
update public.clients set code_public = substr(replace(gen_random_uuid()::text,'-',''),1,12) where code_public is null;
alter table public.clients alter column code_public set default substr(replace(gen_random_uuid()::text,'-',''),1,12);
alter table public.clients alter column code_public set not null;
create unique index if not exists clients_code_public_key on public.clients(code_public);

-- Vue publique du site : tous les équipements du client, sans données personnelles du client
create or replace function public.get_site(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'client', c.nom,
    'technicien', json_build_object('nom', t.nom, 'entreprise', t.entreprise, 'whatsapp', t.whatsapp),
    'equipements', coalesce((
      select json_agg(json_build_object(
          'emplacement', e.emplacement, 'zone', e.zone, 'type', e.type, 'environnement', e.environnement,
          'marque', e.marque, 'puissance', e.puissance, 'fluide', e.fluide, 'date_pose', e.date_pose,
          'code_public', e.code_public,
          'dernier_preventif', (select max(i.date) from public.interventions i where i.equipement_id = e.id and i.type = 'preventif'),
          'nb_interventions', (select count(*) from public.interventions i where i.equipement_id = e.id))
        order by e.zone, e.emplacement)
      from public.equipements e where e.client_id = c.id), '[]'::json)
  )
  from public.clients c
  join public.techniciens t on t.id = c.technicien_id
  where c.code_public = p_code
$$;
revoke all on function public.get_site(text) from public;
grant execute on function public.get_site(text) to anon, authenticated;

-- Profil du compte : prestataire (technicien) ou entreprise (gère ses propres sites)
alter table public.techniciens add column if not exists profil text not null default 'technicien';
do $$ begin
  alter table public.techniciens add constraint techniciens_profil_check check (profil in ('technicien','entreprise'));
exception when duplicate_object then null; end $$;
grant update (nom, entreprise, whatsapp, ville, profil) on public.techniciens to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.techniciens (id, nom, whatsapp, ville, entreprise, profil)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'nom',''),
          coalesce(new.raw_user_meta_data->>'whatsapp',''),
          coalesce(new.raw_user_meta_data->>'ville',''),
          coalesce(new.raw_user_meta_data->>'entreprise',''),
          case when new.raw_user_meta_data->>'profil' = 'entreprise' then 'entreprise' else 'technicien' end)
  on conflict (id) do nothing;
  return new;
end $$;

-- =====================================================================
-- Grands sites / hôpitaux : nouveaux types, criticité, fréquence personnalisée, signalements de panne
-- =====================================================================
alter table public.equipements drop constraint if exists equipements_type_check;
alter table public.equipements add constraint equipements_type_check check (type in
  ('split','cassette','groupe','chambre','vitrine','cta','eau_glacee','vrv','frigo_medical','chambre_mortuaire','clim_precision','ventilation'));
alter table public.equipements add column if not exists criticite text not null default 'normale';
do $$ begin
  alter table public.equipements add constraint equipements_criticite_check check (criticite in ('normale','haute','critique'));
exception when duplicate_object then null; end $$;
alter table public.equipements add column if not exists frequence_jours integer check (frequence_jours is null or frequence_jours between 7 and 730);

create table if not exists public.signalements (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null references public.techniciens(id) on delete cascade,
  equipement_id  uuid not null references public.equipements(id) on delete cascade,
  description    text not null check (char_length(description) between 3 and 1000),
  nom            text default '',
  telephone      text default '',
  statut         text not null default 'nouveau' check (statut in ('nouveau','en_cours','resolu')),
  created_at     timestamptz not null default now(),
  resolu_at      timestamptz
);
create index if not exists idx_sig_tech on public.signalements(technicien_id, statut);
alter table public.signalements enable row level security;
drop policy if exists own_sig_select on public.signalements;
create policy own_sig_select on public.signalements for select using (technicien_id = auth.uid());
drop policy if exists own_sig_update on public.signalements;
create policy own_sig_update on public.signalements for update using (technicien_id = auth.uid()) with check (technicien_id = auth.uid());
revoke insert, delete on public.signalements from anon, authenticated;
-- Les signalements sont créés uniquement par le serveur (/api/signaler), avec limitation anti-abus.

-- Vues publiques mises à jour (fréquence personnalisée + criticité)
create or replace function public.get_carnet(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'equipement', json_build_object(
        'emplacement', e.emplacement, 'zone', e.zone, 'type', e.type, 'environnement', e.environnement,
        'marque', e.marque, 'puissance', e.puissance, 'fluide', e.fluide, 'date_pose', e.date_pose,
        'frequence_jours', e.frequence_jours, 'criticite', e.criticite),
    'client', c.nom,
    'technicien', json_build_object('nom', t.nom, 'entreprise', t.entreprise, 'whatsapp', t.whatsapp),
    'interventions', coalesce((
        select json_agg(json_build_object('date', i.date, 'type', i.type, 'observations', i.observations) order by i.date desc)
        from public.interventions i where i.equipement_id = e.id), '[]'::json)
  )
  from public.equipements e
  join public.clients c on c.id = e.client_id
  join public.techniciens t on t.id = e.technicien_id
  where e.code_public = p_code
$$;
revoke all on function public.get_carnet(text) from public;
grant execute on function public.get_carnet(text) to anon, authenticated;

create or replace function public.get_site(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'client', c.nom,
    'technicien', json_build_object('nom', t.nom, 'entreprise', t.entreprise, 'whatsapp', t.whatsapp, 'profil', t.profil),
    'equipements', coalesce((
      select json_agg(json_build_object(
          'emplacement', e.emplacement, 'zone', e.zone, 'type', e.type, 'environnement', e.environnement,
          'marque', e.marque, 'puissance', e.puissance, 'fluide', e.fluide, 'date_pose', e.date_pose,
          'code_public', e.code_public, 'frequence_jours', e.frequence_jours, 'criticite', e.criticite,
          'dernier_preventif', (select max(i.date) from public.interventions i where i.equipement_id = e.id and i.type = 'preventif'),
          'signalements_ouverts', (select count(*) from public.signalements s where s.equipement_id = e.id and s.statut <> 'resolu'))
        order by e.zone, e.emplacement)
      from public.equipements e where e.client_id = c.id), '[]'::json)
  )
  from public.clients c
  join public.techniciens t on t.id = c.technicien_id
  where c.code_public = p_code
$$;
revoke all on function public.get_site(text) from public;
grant execute on function public.get_site(text) to anon, authenticated;
