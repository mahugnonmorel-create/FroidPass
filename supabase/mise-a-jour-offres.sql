-- =====================================================================
-- FroidPass — Limites par offre (membres d'équipe) et envoi automatique des rapports
-- =====================================================================
-- Nombre de membres (en plus du titulaire du compte) : Découverte 1 · Solo 1 · Pro 3 · Équipe 15
create or replace function public.limite_membres(o text) returns int language sql immutable as $$
  select case o when 'equipe' then 15 when 'pro' then 3 else 1 end
$$;
create or replace function public.verifier_quota_membres()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.techniciens; o text; n int; lim int;
begin
  select * into t from public.techniciens where id = new.org_id;
  o := public.offre_active(t); lim := public.limite_membres(o);
  select (select count(*) from public.membres where org_id = new.org_id)
       + (select count(*) from public.invitations where org_id = new.org_id and (tg_table_name <> 'invitations' or email <> new.email))
       - case when tg_table_name = 'membres' then 1 else 0 end   -- l'invitation acceptée devient le membre
    into n;
  if n >= lim then
    raise exception 'QUOTA: votre offre % permet % membre(s) d''équipe en plus du titulaire. Passez à l''offre supérieure.', o, lim;
  end if;
  return new;
end $$;
drop trigger if exists trg_quota_invitations on public.invitations;
create trigger trg_quota_invitations before insert on public.invitations for each row execute function public.verifier_quota_membres();

-- Envoi automatique des rapports par e-mail (le 1er du mois) : null = désactivé
alter table public.clients add column if not exists rapport_auto text;
alter table public.clients drop constraint if exists clients_rapport_auto_check;
alter table public.clients add constraint clients_rapport_auto_check check (rapport_auto is null or rapport_auto in ('mensuel','trimestriel','semestriel','annuel'));
