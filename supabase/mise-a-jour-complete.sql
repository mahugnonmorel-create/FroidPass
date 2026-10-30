-- FroidPass — MISE À JOUR COMPLÈTE (sites + GMAO + équipe). À exécuter dans Supabase > SQL Editor > Run.
-- Sans risque : peut être exécuté plusieurs fois.
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
-- =====================================================================
-- FroidPass — module GMAO : ordres de travail, stock de pièces, consommations
-- À exécuter UNE FOIS dans Supabase > SQL Editor > Run (après mise-a-jour-sites.sql)
-- =====================================================================

-- ---------- ORDRES DE TRAVAIL ----------
create table if not exists public.ordres_travail (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity,
  technicien_id    uuid not null default auth.uid() references public.techniciens(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  equipement_id    uuid references public.equipements(id) on delete set null,
  titre            text not null check (char_length(titre) between 2 and 200),
  description      text default '',
  type             text not null default 'curatif' check (type in ('preventif','curatif','amelioration','inspection')),
  priorite         text not null default 'normale' check (priorite in ('basse','normale','haute','urgente')),
  statut           text not null default 'demande' check (statut in ('demande','planifie','en_cours','termine','annule')),
  date_prevue      date,
  intervenant      text default '',
  intervenant_tel  text default '',
  date_debut       timestamptz,
  date_fin         timestamptz,
  duree_heures     numeric check (duree_heures is null or duree_heures >= 0),
  cout_main_oeuvre integer default 0 check (cout_main_oeuvre >= 0),
  compte_rendu     text default '',
  signalement_id   uuid references public.signalements(id) on delete set null,
  intervention_id  uuid references public.interventions(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_ot_tech on public.ordres_travail(technicien_id, statut);
create index if not exists idx_ot_eq on public.ordres_travail(equipement_id);

-- ---------- STOCK DE PIÈCES ET CONSOMMABLES ----------
create table if not exists public.pieces (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null default auth.uid() references public.techniciens(id) on delete cascade,
  reference      text default '',
  designation    text not null check (char_length(designation) between 2 and 200),
  unite          text not null default 'u' check (unite in ('u','kg','L','m','boîte')),
  stock          numeric not null default 0,
  stock_min      numeric not null default 0,
  prix_unitaire  integer not null default 0 check (prix_unitaire >= 0),
  emplacement    text default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.consommations (
  id             uuid primary key default gen_random_uuid(),
  technicien_id  uuid not null default auth.uid() references public.techniciens(id) on delete cascade,
  ordre_id       uuid not null references public.ordres_travail(id) on delete cascade,
  piece_id       uuid not null references public.pieces(id) on delete restrict,
  quantite       numeric not null check (quantite > 0),
  prix_unitaire  integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_conso_ordre on public.consommations(ordre_id);

-- Le stock se met à jour automatiquement à chaque consommation (et revient si on la supprime)
create or replace function public.maj_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.pieces set stock = stock - new.quantite where id = new.piece_id and technicien_id = new.technicien_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.pieces set stock = stock + old.quantite where id = old.piece_id and technicien_id = old.technicien_id;
    return old;
  end if;
  return null;
end $$;
drop trigger if exists trg_maj_stock on public.consommations;
create trigger trg_maj_stock after insert or delete on public.consommations
for each row execute function public.maj_stock();

-- ---------- SÉCURITÉ : chacun ne voit que ses données ----------
alter table public.ordres_travail enable row level security;
alter table public.pieces enable row level security;
alter table public.consommations enable row level security;

drop policy if exists own_ot on public.ordres_travail;
create policy own_ot on public.ordres_travail for all
  using (technicien_id = auth.uid())
  with check (technicien_id = auth.uid()
    and exists (select 1 from public.clients c where c.id = client_id and c.technicien_id = auth.uid())
    and (equipement_id is null or exists (select 1 from public.equipements e where e.id = equipement_id and e.technicien_id = auth.uid())));

drop policy if exists own_pieces on public.pieces;
create policy own_pieces on public.pieces for all
  using (technicien_id = auth.uid()) with check (technicien_id = auth.uid());

drop policy if exists own_conso on public.consommations;
create policy own_conso on public.consommations for all
  using (technicien_id = auth.uid())
  with check (technicien_id = auth.uid()
    and exists (select 1 from public.ordres_travail o where o.id = ordre_id and o.technicien_id = auth.uid())
    and exists (select 1 from public.pieces p where p.id = piece_id and p.technicien_id = auth.uid()));

grant select, insert, update, delete on public.ordres_travail, public.pieces, public.consommations to authenticated;
-- =====================================================================
-- FroidPass — ÉQUIPE ET RÔLES (entreprise : responsable + techniciens)
-- À exécuter UNE FOIS dans Supabase > SQL Editor > Run
-- (après mise-a-jour-sites.sql et mise-a-jour-gmao.sql)
--
-- Principe : l'« organisation » est le compte du responsable (techniciens.id).
-- Toutes les données existantes lui appartiennent déjà. Les membres invités
-- accèdent aux données de l'organisation selon leur rôle :
--   admin      : accès complet (directeur, responsable maintenance)
--   technicien : ses OT assignés, le parc, les interventions, le stock (lecture)
-- =====================================================================

create table if not exists public.membres (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.techniciens(id) on delete cascade,
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  role        text not null default 'technicien' check (role in ('admin','technicien')),
  nom         text default '',
  telephone   text default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default auth.uid() references public.techniciens(id) on delete cascade,
  email       text not null,
  role        text not null default 'technicien' check (role in ('admin','technicien')),
  nom         text default '',
  telephone   text default '',
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);

-- Organisation et rôle de l'utilisateur connecté (security definer : pas de récursion RLS)
create or replace function public.mon_org() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select org_id from public.membres where user_id = auth.uid() limit 1), auth.uid())
$$;
create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.membres where user_id = auth.uid())
      or exists (select 1 from public.membres where user_id = auth.uid() and role = 'admin')
$$;
grant execute on function public.mon_org(), public.est_admin() to authenticated;
alter table public.invitations alter column org_id set default public.mon_org();

-- Acceptation automatique de l'invitation à la connexion (e-mail identique)
create or replace function public.accepter_invitation() returns json
language plpgsql security definer set search_path = public as $$
declare inv public.invitations; mail text;
begin
  if exists (select 1 from public.membres where user_id = auth.uid()) then
    return json_build_object('statut', 'deja_membre');
  end if;
  select email into mail from auth.users where id = auth.uid();
  select * into inv from public.invitations where lower(email) = lower(mail) order by created_at desc limit 1;
  if inv.id is null or inv.org_id = auth.uid() then return json_build_object('statut', 'aucune'); end if;
  insert into public.membres (org_id, user_id, role, nom, telephone) values (inv.org_id, auth.uid(), inv.role, inv.nom, inv.telephone);
  delete from public.invitations where lower(email) = lower(mail);
  return json_build_object('statut', 'acceptee', 'role', inv.role);
end $$;
grant execute on function public.accepter_invitation() to authenticated;

-- Les nouvelles lignes appartiennent à l'organisation (et non à l'utilisateur)
alter table public.clients        alter column technicien_id set default public.mon_org();
alter table public.equipements    alter column technicien_id set default public.mon_org();
alter table public.interventions  alter column technicien_id set default public.mon_org();
alter table public.ordres_travail alter column technicien_id set default public.mon_org();
alter table public.pieces         alter column technicien_id set default public.mon_org();
alter table public.consommations  alter column technicien_id set default public.mon_org();

-- Assignation des OT à un membre
alter table public.ordres_travail add column if not exists assigne_a uuid references auth.users(id) on delete set null;
create index if not exists idx_ot_assigne on public.ordres_travail(assigne_a);
alter table public.ordres_travail add column if not exists cree_par uuid default auth.uid() references auth.users(id) on delete set null;

-- ---------- Politiques de sécurité (remplacent les précédentes) ----------
alter table public.membres enable row level security;
alter table public.invitations enable row level security;

drop policy if exists tech_select on public.techniciens;
create policy tech_select on public.techniciens for select using (id = auth.uid() or id = public.mon_org());
-- (mise à jour : uniquement sa propre ligne, politique tech_update inchangée)

drop policy if exists own_clients on public.clients;
drop policy if exists cli_select on public.clients;  create policy cli_select on public.clients for select using (technicien_id = public.mon_org());
drop policy if exists cli_write on public.clients;   create policy cli_write  on public.clients for insert with check (technicien_id = public.mon_org() and public.est_admin());
drop policy if exists cli_update on public.clients;  create policy cli_update on public.clients for update using (technicien_id = public.mon_org() and public.est_admin()) with check (technicien_id = public.mon_org());
drop policy if exists cli_delete on public.clients;  create policy cli_delete on public.clients for delete using (technicien_id = public.mon_org() and public.est_admin());

drop policy if exists own_eq on public.equipements;
drop policy if exists eq_select on public.equipements; create policy eq_select on public.equipements for select using (technicien_id = public.mon_org());
drop policy if exists eq_insert on public.equipements; create policy eq_insert on public.equipements for insert with check (technicien_id = public.mon_org() and exists (select 1 from public.clients c where c.id = client_id and c.technicien_id = public.mon_org()));
drop policy if exists eq_update on public.equipements; create policy eq_update on public.equipements for update using (technicien_id = public.mon_org()) with check (technicien_id = public.mon_org() and exists (select 1 from public.clients c where c.id = client_id and c.technicien_id = public.mon_org()));
drop policy if exists eq_delete on public.equipements; create policy eq_delete on public.equipements for delete using (technicien_id = public.mon_org() and public.est_admin());

drop policy if exists own_int on public.interventions;
drop policy if exists int_select on public.interventions; create policy int_select on public.interventions for select using (technicien_id = public.mon_org());
drop policy if exists int_insert on public.interventions; create policy int_insert on public.interventions for insert with check (technicien_id = public.mon_org() and exists (select 1 from public.equipements e where e.id = equipement_id and e.technicien_id = public.mon_org()));
drop policy if exists int_update on public.interventions; create policy int_update on public.interventions for update using (technicien_id = public.mon_org() and public.est_admin()) with check (technicien_id = public.mon_org());
drop policy if exists int_delete on public.interventions; create policy int_delete on public.interventions for delete using (technicien_id = public.mon_org() and public.est_admin());

drop policy if exists own_pay on public.paiements;
create policy own_pay on public.paiements for select using (technicien_id = auth.uid() or (technicien_id = public.mon_org() and public.est_admin()));

drop policy if exists own_sig_select on public.signalements; create policy own_sig_select on public.signalements for select using (technicien_id = public.mon_org());
drop policy if exists own_sig_update on public.signalements; create policy own_sig_update on public.signalements for update using (technicien_id = public.mon_org()) with check (technicien_id = public.mon_org());

drop policy if exists own_ot on public.ordres_travail;
drop policy if exists ot_select on public.ordres_travail; create policy ot_select on public.ordres_travail for select using (technicien_id = public.mon_org() and (public.est_admin() or assigne_a = auth.uid() or cree_par = auth.uid()));
drop policy if exists ot_insert on public.ordres_travail; create policy ot_insert on public.ordres_travail for insert with check (
  technicien_id = public.mon_org()
  and (public.est_admin() or (statut = 'demande' and assigne_a is null))
  and exists (select 1 from public.clients c where c.id = client_id and c.technicien_id = public.mon_org())
  and (equipement_id is null or exists (select 1 from public.equipements e where e.id = equipement_id and e.technicien_id = public.mon_org())));
drop policy if exists ot_update on public.ordres_travail; create policy ot_update on public.ordres_travail for update
  using (technicien_id = public.mon_org() and (public.est_admin() or assigne_a = auth.uid()))
  with check (technicien_id = public.mon_org() and (public.est_admin() or assigne_a = auth.uid()));
drop policy if exists ot_delete on public.ordres_travail; create policy ot_delete on public.ordres_travail for delete using (technicien_id = public.mon_org() and public.est_admin());

drop policy if exists own_pieces on public.pieces;
drop policy if exists pc_select on public.pieces; create policy pc_select on public.pieces for select using (technicien_id = public.mon_org());
drop policy if exists pc_write on public.pieces;  create policy pc_write on public.pieces for all using (technicien_id = public.mon_org() and public.est_admin()) with check (technicien_id = public.mon_org() and public.est_admin());

drop policy if exists own_conso on public.consommations;
drop policy if exists cs_select on public.consommations; create policy cs_select on public.consommations for select using (technicien_id = public.mon_org());
drop policy if exists cs_insert on public.consommations; create policy cs_insert on public.consommations for insert with check (
  technicien_id = public.mon_org()
  and exists (select 1 from public.ordres_travail o where o.id = ordre_id and o.technicien_id = public.mon_org() and (public.est_admin() or o.assigne_a = auth.uid()))
  and exists (select 1 from public.pieces p where p.id = piece_id and p.technicien_id = public.mon_org()));
drop policy if exists cs_delete on public.consommations; create policy cs_delete on public.consommations for delete using (technicien_id = public.mon_org() and public.est_admin());

drop policy if exists mb_select on public.membres; create policy mb_select on public.membres for select using (org_id = public.mon_org());
drop policy if exists mb_update on public.membres; create policy mb_update on public.membres for update using (org_id = public.mon_org() and public.est_admin()) with check (org_id = public.mon_org());
drop policy if exists mb_delete on public.membres; create policy mb_delete on public.membres for delete using (org_id = public.mon_org() and public.est_admin() and user_id <> auth.uid());

drop policy if exists inv_all on public.invitations;
create policy inv_all on public.invitations for all
  using (org_id = public.mon_org() and public.est_admin()) with check (org_id = public.mon_org() and public.est_admin());

grant select, insert, update, delete on public.membres, public.invitations to authenticated;
revoke insert on public.membres from authenticated;  -- les membres sont créés uniquement par accepter_invitation()
-- =====================================================================
-- FroidPass — Envoi des rapports au client (e-mail / WhatsApp)
-- Périodes : mensuel 'AAAA-MM', trimestriel 'AAAA-T1..T4', semestriel 'AAAA-S1/S2', annuel 'AAAA'
-- =====================================================================

-- Photos des interventions (la colonne est aussi créée par mise-a-jour-photos.sql)
alter table public.interventions add column if not exists photos jsonb not null default '[]'::jsonb;

-- E-mail du client et code secret du rapport (différent du QR affiché sur le site)
alter table public.clients add column if not exists email text not null default '';
alter table public.clients add column if not exists code_rapport text;
update public.clients set code_rapport = replace(gen_random_uuid()::text, '-', '') where code_rapport is null;
alter table public.clients alter column code_rapport set default replace(gen_random_uuid()::text, '-', '');
alter table public.clients alter column code_rapport set not null;
create unique index if not exists clients_code_rapport_key on public.clients(code_rapport);

-- Historique des envois (traçabilité)
create table if not exists public.rapports_envoyes (
  id            uuid primary key default gen_random_uuid(),
  technicien_id uuid not null default public.mon_org() references public.techniciens(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  mois          text not null check (mois ~ '^\d{4}-\d{2}$'),
  canal         text not null check (canal in ('email','whatsapp')),
  destinataire  text default '',
  envoye_par    uuid default auth.uid(),
  envoye_par_nom text default '',
  created_at    timestamptz not null default now()
);
alter table public.rapports_envoyes enable row level security;
drop policy if exists re_select on public.rapports_envoyes;
create policy re_select on public.rapports_envoyes for select using (technicien_id = public.mon_org() and public.est_admin());
drop policy if exists re_insert on public.rapports_envoyes;
create policy re_insert on public.rapports_envoyes for insert with check (technicien_id = public.mon_org() and public.est_admin()
  and exists (select 1 from public.clients c where c.id = client_id and c.technicien_id = public.mon_org()));
grant select, insert on public.rapports_envoyes to authenticated;
-- Accepte aussi les périodes trimestrielles, semestrielles et annuelles
alter table public.rapports_envoyes drop constraint if exists rapports_envoyes_mois_check;
alter table public.rapports_envoyes add constraint rapports_envoyes_mois_check check (mois ~ '^\d{4}(-(0[1-9]|1[0-2]|T[1-4]|S[12]))?$');

-- Rapport public d'une période (lecture seule, accessible avec le code secret du client)
-- p_mois : 'AAAA-MM' (mois), 'AAAA-Tn' (trimestre), 'AAAA-Sn' (semestre) ou 'AAAA' (année)
create or replace function public.get_rapport(p_code text, p_mois text)
returns json language plpgsql stable security definer set search_path = public as $$
declare c public.clients; d date; f date;
begin
  if p_mois ~ '^\d{4}-(0[1-9]|1[0-2])$' then
    d := to_date(p_mois || '-01', 'YYYY-MM-DD'); f := (d + interval '1 month')::date;
  elsif p_mois ~ '^\d{4}-T[1-4]$' then
    d := make_date(left(p_mois, 4)::int, (right(p_mois, 1)::int - 1) * 3 + 1, 1); f := (d + interval '3 months')::date;
  elsif p_mois ~ '^\d{4}-S[12]$' then
    d := make_date(left(p_mois, 4)::int, (right(p_mois, 1)::int - 1) * 6 + 1, 1); f := (d + interval '6 months')::date;
  elsif p_mois ~ '^\d{4}$' then
    d := make_date(p_mois::int, 1, 1); f := (d + interval '1 year')::date;
  else return null; end if;
  select * into c from public.clients where code_rapport = p_code;
  if c.id is null then return null; end if;
  return json_build_object(
    'mois', p_mois, 'debut', d, 'fin', (f - 1),
    'client', json_build_object('nom', c.nom, 'contact', c.contact),
    'prestataire', (select json_build_object('nom', t.nom, 'entreprise', t.entreprise, 'whatsapp', t.whatsapp, 'profil', t.profil) from public.techniciens t where t.id = c.technicien_id),
    'equipements', coalesce((select json_agg(json_build_object(
        'id', e.id, 'emplacement', e.emplacement, 'zone', e.zone, 'type', e.type, 'environnement', e.environnement,
        'criticite', e.criticite, 'frequence_jours', e.frequence_jours, 'marque', e.marque, 'puissance', e.puissance, 'date_pose', e.date_pose,
        'dernier_preventif', (select max(i.date) from public.interventions i where i.equipement_id = e.id and i.type = 'preventif' and i.date < f))
      order by e.zone, e.emplacement) from public.equipements e where e.client_id = c.id), '[]'::json),
    'interventions', coalesce((select json_agg(json_build_object(
        'date', i.date, 'type', i.type, 'equipement', e.emplacement, 'observations', i.observations,
        'hp', i.hp, 'bp', i.bp, 'intensite', i.intensite, 't_soufflage', i.t_soufflage, 't_reprise', i.t_reprise,
        -- photos : l'analyse IA n'est transmise au client que si le responsable l'a validée
        'photos', (select coalesce(jsonb_agg(case when coalesce((p->'analyse'->>'valide')::boolean, false) then p else p - 'analyse' end), '[]'::jsonb) from jsonb_array_elements(coalesce(i.photos, '[]'::jsonb)) p)) order by i.date)
      from public.interventions i join public.equipements e on e.id = i.equipement_id
      where e.client_id = c.id and i.date >= d and i.date < f), '[]'::json),
    'signalements', (select count(*) from public.signalements s join public.equipements e on e.id = s.equipement_id where e.client_id = c.id and s.created_at >= d and s.created_at < f)
  );
end $$;
revoke all on function public.get_rapport(text, text) from public;
grant execute on function public.get_rapport(text, text) to anon, authenticated;

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
