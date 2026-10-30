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
        'hp', i.hp, 'bp', i.bp, 'intensite', i.intensite, 't_soufflage', i.t_soufflage, 't_reprise', i.t_reprise, 'photos', i.photos) order by i.date)
      from public.interventions i join public.equipements e on e.id = i.equipement_id
      where e.client_id = c.id and i.date >= d and i.date < f), '[]'::json),
    'signalements', (select count(*) from public.signalements s join public.equipements e on e.id = s.equipement_id where e.client_id = c.id and s.created_at >= d and s.created_at < f)
  );
end $$;
revoke all on function public.get_rapport(text, text) from public;
grant execute on function public.get_rapport(text, text) to anon, authenticated;
