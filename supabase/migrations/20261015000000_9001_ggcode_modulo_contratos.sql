-- manifest: GG Code — módulo Contratos (ADR-0002): provisionadora de contratos/formas/cobranças com RLS por operação e recebimento atômico que lança no caixa
--
-- Faixa 9001+ é da GG Code (fork): não colide com a numeração do upstream.
-- LGPD (D8): nenhuma FK para contacts e nenhuma coluna de dado pessoal — o contrato liga ao
-- NEGÓCIO (lead_id), como honorários; anonimizar o contato não exige passo novo.

create or replace function public.fn_contratos_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.contratos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    lead_id uuid references public.crm_leads(id) on delete set null,
    titulo text not null check (char_length(titulo) between 1 and 120),
    inicio date not null,
    fim date,
    situacao text not null default 'ativo' check (situacao in ('ativo', 'encerrado', 'cancelado')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint contratos_fim_depois_do_inicio check (fim is null or fim >= inicio)
  );
  create index if not exists contratos_org_idx on public.contratos (organization_id, situacao);

  create table if not exists public.contrato_formas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contrato_id uuid not null references public.contratos(id) on delete cascade,
    tipo text not null check (tipo in ('implantacao', 'mensalidade', 'evento', 'avulso')),
    valor_cents bigint not null check (valor_cents > 0),
    parcelas integer not null default 1 check (parcelas between 1 and 60),
    primeiro_vencimento date,
    dia_vencimento integer check (dia_vencimento between 1 and 31),
    descricao text check (descricao is null or char_length(descricao) <= 120),
    ativa boolean not null default true,
    created_at timestamptz not null default now(),
    constraint contrato_formas_campos_do_tipo check (
      (tipo = 'mensalidade' and dia_vencimento is not null)
      or (tipo in ('implantacao', 'avulso') and primeiro_vencimento is not null)
      or tipo = 'evento'
    )
  );
  create index if not exists contrato_formas_contrato_idx on public.contrato_formas (organization_id, contrato_id);

  create table if not exists public.contrato_cobrancas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contrato_id uuid not null references public.contratos(id) on delete cascade,
    forma_id uuid not null references public.contrato_formas(id) on delete cascade,
    competencia text not null,
    descricao text not null check (char_length(descricao) between 1 and 160),
    vencimento date not null,
    valor_cents bigint not null check (valor_cents > 0),
    situacao text not null default 'a_receber' check (situacao in ('a_receber', 'recebida', 'cancelada')),
    recebida_em date,
    financial_entry_id uuid references public.financial_entries(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint contrato_cobrancas_competencia_unica unique (forma_id, competencia)
  );
  create index if not exists contrato_cobrancas_venc_idx on public.contrato_cobrancas (organization_id, vencimento);
  create index if not exists contrato_cobrancas_contrato_idx on public.contrato_cobrancas (organization_id, contrato_id);

  -- RLS por operação (molde 0480). Escrita = manager+. Recebida é imutável e só nasce na RPC.
  alter table public.contratos enable row level security;
  drop policy if exists tenant_isolation_contratos_all on public.contratos;
  drop policy if exists contratos_select on public.contratos;
  create policy contratos_select
    on public.contratos
    for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists contratos_insert on public.contratos;
  create policy contratos_insert
    on public.contratos
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  drop policy if exists contratos_update on public.contratos;
  create policy contratos_update
    on public.contratos
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  drop policy if exists contratos_delete on public.contratos;
  create policy contratos_delete
    on public.contratos
    for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and not exists (select 1 from public.contrato_cobrancas c
                            where c.contrato_id = contratos.id and c.situacao = 'recebida'));
  revoke all on public.contratos from anon;

  alter table public.contrato_formas enable row level security;
  drop policy if exists tenant_isolation_contrato_formas_all on public.contrato_formas;
  drop policy if exists contrato_formas_select on public.contrato_formas;
  create policy contrato_formas_select
    on public.contrato_formas
    for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists contrato_formas_insert on public.contrato_formas;
  create policy contrato_formas_insert
    on public.contrato_formas
    for insert
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_formas.organization_id));
  drop policy if exists contrato_formas_update on public.contrato_formas;
  create policy contrato_formas_update
    on public.contrato_formas
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_formas.organization_id));
  drop policy if exists contrato_formas_delete on public.contrato_formas;
  create policy contrato_formas_delete
    on public.contrato_formas
    for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and not exists (select 1 from public.contrato_cobrancas c
                            where c.forma_id = contrato_formas.id and c.situacao = 'recebida'));
  revoke all on public.contrato_formas from anon;

  alter table public.contrato_cobrancas enable row level security;
  drop policy if exists tenant_isolation_contrato_cobrancas_all on public.contrato_cobrancas;
  drop policy if exists contrato_cobrancas_select on public.contrato_cobrancas;
  create policy contrato_cobrancas_select
    on public.contrato_cobrancas
    for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists contrato_cobrancas_insert on public.contrato_cobrancas;
  create policy contrato_cobrancas_insert
    on public.contrato_cobrancas
    for insert
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and situacao <> 'recebida' and financial_entry_id is null and recebida_em is null
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_cobrancas.organization_id));
  drop policy if exists contrato_cobrancas_update on public.contrato_cobrancas;
  create policy contrato_cobrancas_update
    on public.contrato_cobrancas
    for update
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and situacao <> 'recebida')
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and situacao <> 'recebida' and financial_entry_id is null and recebida_em is null
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_cobrancas.organization_id));
  drop policy if exists contrato_cobrancas_delete on public.contrato_cobrancas;
  create policy contrato_cobrancas_delete
    on public.contrato_cobrancas
    for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and situacao <> 'recebida');
  revoke all on public.contrato_cobrancas from anon;

  comment on table public.contratos is 'GG Code — contrato com o cliente (liga ao negócio). Dinheiro real é o caixa núcleo.';
  comment on table public.contrato_formas is 'GG Code — formas de cobrança do contrato: implantação, mensalidade, evento, avulso.';
  comment on table public.contrato_cobrancas is 'GG Code — cada valor a receber. Receber cria financial_entries por fn_contratos_cobranca_receber.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_contratos_provisionar() from public, anon, authenticated;
grant execute on function public.fn_contratos_provisionar() to service_role;

-- D7: `record`, nunca %rowtype — compila antes de o módulo ser instalado.
create or replace function public.fn_contratos_cobranca_receber(
  p_org uuid,
  p_cobranca uuid,
  p_account_id uuid,
  p_recebida_em date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cob record;
  v_entry uuid;
  v_data date := coalesce(p_recebida_em, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'manager') then
    raise exception 'contratos_forbidden' using errcode = '42501';
  end if;

  select * into v_cob from public.contrato_cobrancas
   where id = p_cobranca and organization_id = p_org
   for update;
  if not found then
    raise exception 'cobranca_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_cob.situacao <> 'a_receber' then
    raise exception 'cobranca_nao_recebivel' using errcode = '22023';
  end if;
  if not exists (select 1 from public.financial_accounts
                  where id = p_account_id and organization_id = p_org and is_active) then
    raise exception 'conta_invalida' using errcode = '22023';
  end if;

  insert into public.financial_entries
    (organization_id, account_id, direction, amount_cents, description, entry_date,
     status, paid_at, origin, created_by_user_id)
  values (p_org, p_account_id, 'in', v_cob.valor_cents, v_cob.descricao, v_data,
          'paid', now(), 'manual', auth.uid())
  returning id into v_entry;

  update public.contrato_cobrancas
     set situacao = 'recebida', recebida_em = v_data, financial_entry_id = v_entry, updated_at = now()
   where id = p_cobranca;

  return jsonb_build_object('id', v_cob.id, 'contrato_id', v_cob.contrato_id, 'valor_cents', v_cob.valor_cents,
    'situacao', 'recebida', 'recebida_em', v_data, 'financial_entry_id', v_entry);
end;
$$;

revoke execute on function public.fn_contratos_cobranca_receber(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.fn_contratos_cobranca_receber(uuid, uuid, uuid, date) to authenticated;
