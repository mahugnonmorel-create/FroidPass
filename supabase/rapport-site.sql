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
