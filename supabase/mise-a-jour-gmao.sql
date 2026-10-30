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
