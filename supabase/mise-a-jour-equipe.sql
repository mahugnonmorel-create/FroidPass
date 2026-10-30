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
