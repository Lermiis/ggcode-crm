-- manifest: GG Code — módulo Financeiro (gestao_financeira, ADR-0002): categorias da DRE, fim de recorrência, parcelado e acesso por pessoa (fn_gf_pode), RPCs de escrita; Contratos passam a seguir o acesso do Financeiro
--
-- Faixa 9001+ é da GG Code (fork). Slug `gestao_financeira` porque `financeiro` é o das Comandas.
-- Permissão: admin da org pode tudo; fora isso só quem tem linha em gf_acessos (ver/editar);
-- sem linha, só admin. gf_acessos só admin lê e escreve. As tabelas do NÚCLEO (financial_*,
-- account_plans, recurring_entries) mantêm a RLS do Deskcomm (as Comandas dependem dela); a
-- escrita do Financeiro passa pelas RPCs abaixo, que exigem fn_gf_pode(p_org, 'editar').
-- LGPD (D8): nenhuma FK para contacts e nenhuma coluna de dado pessoal.

-- fn_gf_pode é chamada nas policies dos Contratos, que existem ANTES de o Financeiro ser
-- instalado: sem gf_acessos (to_regclass nulo) só admin passa. Consulta dinâmica para compilar
-- e planejar sem a tabela (D7). Membro revogado não passa nem com linha em gf_acessos.
create or replace function public.fn_gf_pode(p_org uuid, p_nivel text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_nivel text;
begin
  if p_org is null or auth.uid() is null then
    return false;
  end if;
  if public.fn_role_at_least(p_org, 'admin') then
    return true;
  end if;
  if coalesce(p_nivel, '') not in ('ver', 'editar') or to_regclass('public.gf_acessos') is null
     or public.fn_user_role_in_org(p_org) is null then
    return false;
  end if;
  execute 'select nivel from public.gf_acessos where organization_id = $1 and user_id = $2'
     into v_nivel using p_org, auth.uid();
  return coalesce(v_nivel = 'editar' or (p_nivel = 'ver' and v_nivel = 'ver'), false);
end;
$$;

revoke execute on function public.fn_gf_pode(uuid, text) from public, anon;
grant execute on function public.fn_gf_pode(uuid, text) to authenticated, service_role;

create or replace function public.fn_gestao_financeira_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.gf_categorias (
    account_plan_id uuid primary key references public.account_plans(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    grupo text not null check (grupo in ('receita', 'imposto', 'custo_variavel', 'pessoal',
                                         'assinaturas', 'marketing', 'estrutura', 'outras_despesas')),
    conta_cac boolean not null default false
  );
  create index if not exists gf_categorias_org_idx on public.gf_categorias (organization_id);

  create table if not exists public.gf_recorrencias (
    recurring_entry_id uuid primary key references public.recurring_entries(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    fim date
  );
  create index if not exists gf_recorrencias_org_idx on public.gf_recorrencias (organization_id);

  create table if not exists public.gf_parcelamentos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    descricao text not null check (char_length(descricao) between 1 and 200),
    total_cents bigint not null check (total_cents > 0),
    parcelas integer not null check (parcelas between 2 and 120),
    created_at timestamptz not null default now()
  );
  create index if not exists gf_parcelamentos_org_idx on public.gf_parcelamentos (organization_id);

  create table if not exists public.gf_parcelas (
    entry_id uuid primary key references public.financial_entries(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    parcelamento_id uuid not null references public.gf_parcelamentos(id) on delete cascade,
    numero integer not null check (numero >= 1),
    constraint gf_parcelas_numero_unico unique (parcelamento_id, numero)
  );
  create index if not exists gf_parcelas_org_idx on public.gf_parcelas (organization_id);

  create table if not exists public.gf_acessos (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    nivel text not null check (nivel in ('ver', 'editar')),
    concedido_por uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (organization_id, user_id)
  );

  -- RLS própria: leitura = fn_gf_pode 'ver'; escrita = 'editar' e vínculo da MESMA organização.
  alter table public.gf_categorias enable row level security;
  drop policy if exists gf_categorias_select on public.gf_categorias;
  create policy gf_categorias_select
    on public.gf_categorias
    for select
    using (public.fn_gf_pode(organization_id, 'ver') or public.fn_is_platform_admin());
  drop policy if exists gf_categorias_write on public.gf_categorias;
  create policy gf_categorias_write
    on public.gf_categorias
    for all
    using (public.fn_gf_pode(organization_id, 'editar') or public.fn_is_platform_admin_full())
    with check ((public.fn_gf_pode(organization_id, 'editar') or public.fn_is_platform_admin_full())
                and exists (select 1 from public.account_plans p where p.id = gf_categorias.account_plan_id
                             and p.organization_id = gf_categorias.organization_id));
  revoke all on public.gf_categorias from anon;

  alter table public.gf_recorrencias enable row level security;
  drop policy if exists gf_recorrencias_select on public.gf_recorrencias;
  create policy gf_recorrencias_select
    on public.gf_recorrencias
    for select
    using (public.fn_gf_pode(organization_id, 'ver') or public.fn_is_platform_admin());
  drop policy if exists gf_recorrencias_write on public.gf_recorrencias;
  create policy gf_recorrencias_write
    on public.gf_recorrencias
    for all
    using (public.fn_gf_pode(organization_id, 'editar') or public.fn_is_platform_admin_full())
    with check ((public.fn_gf_pode(organization_id, 'editar') or public.fn_is_platform_admin_full())
                and exists (select 1 from public.recurring_entries r where r.id = gf_recorrencias.recurring_entry_id
                             and r.organization_id = gf_recorrencias.organization_id));
  revoke all on public.gf_recorrencias from anon;

  alter table public.gf_parcelamentos enable row level security;
  drop policy if exists gf_parcelamentos_select on public.gf_parcelamentos;
  create policy gf_parcelamentos_select
    on public.gf_parcelamentos
    for select
    using (public.fn_gf_pode(organization_id, 'ver') or public.fn_is_platform_admin());
  drop policy if exists gf_parcelamentos_write on public.gf_parcelamentos;
  create policy gf_parcelamentos_write
    on public.gf_parcelamentos
    for all
    using (public.fn_gf_pode(organization_id, 'editar') or public.fn_is_platform_admin_full())
    with check (public.fn_gf_pode(organization_id, 'editar') or public.fn_is_platform_admin_full());
  revoke all on public.gf_parcelamentos from anon;

  alter table public.gf_parcelas enable row level security;
  drop policy if exists gf_parcelas_select on public.gf_parcelas;
  create policy gf_parcelas_select
    on public.gf_parcelas
    for select
    using (public.fn_gf_pode(organization_id, 'ver') or public.fn_is_platform_admin());
  drop policy if exists gf_parcelas_write on public.gf_parcelas;
  create policy gf_parcelas_write
    on public.gf_parcelas
    for all
    using (public.fn_gf_pode(organization_id, 'editar') or public.fn_is_platform_admin_full())
    with check ((public.fn_gf_pode(organization_id, 'editar') or public.fn_is_platform_admin_full())
                and exists (select 1 from public.financial_entries e where e.id = gf_parcelas.entry_id
                             and e.organization_id = gf_parcelas.organization_id)
                and exists (select 1 from public.gf_parcelamentos g where g.id = gf_parcelas.parcelamento_id
                             and g.organization_id = gf_parcelas.organization_id));
  revoke all on public.gf_parcelas from anon;

  -- Quem pode ver o Financeiro é decisão de admin: só admin lê e escreve.
  alter table public.gf_acessos enable row level security;
  drop policy if exists gf_acessos_select on public.gf_acessos;
  create policy gf_acessos_select
    on public.gf_acessos
    for select
    using (public.fn_role_at_least(organization_id, 'admin') or public.fn_is_platform_admin());
  drop policy if exists gf_acessos_write on public.gf_acessos;
  create policy gf_acessos_write
    on public.gf_acessos
    for all
    using (public.fn_role_at_least(organization_id, 'admin') or public.fn_is_platform_admin_full())
    with check (public.fn_role_at_least(organization_id, 'admin') or public.fn_is_platform_admin_full());
  revoke all on public.gf_acessos from anon;

  comment on table public.gf_categorias is 'GG Code — grupo da DRE e se conta para o CAC, por categoria (account_plans).';
  comment on table public.gf_recorrencias is 'GG Code — até quando a recorrência (recurring_entries) se repete.';
  comment on table public.gf_parcelamentos is 'GG Code — agrupa as parcelas de um lançamento parcelado.';
  comment on table public.gf_parcelas is 'GG Code — liga cada financial_entries ao parcelado e ao número da parcela.';
  comment on table public.gf_acessos is 'GG Code — quem, além dos admins, vê ou edita o Financeiro e os Contratos.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_gestao_financeira_provisionar() from public, anon, authenticated;
grant execute on function public.fn_gestao_financeira_provisionar() to service_role;

-- Conferência comum dos lançamentos. Invoker e fechada: só as RPCs definer abaixo a chamam.
create or replace function public.fn_gf_conferir_lancamento(
  p_org uuid, p_direction text, p_account_id uuid, p_account_plan_id uuid, p_amount_cents bigint, p_description text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_direction is null or p_direction not in ('in', 'out') then
    raise exception 'direcao_invalida' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'valor_invalido' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 200 then
    raise exception 'descricao_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.financial_accounts
                  where id = p_account_id and organization_id = p_org and is_active) then
    raise exception 'conta_invalida' using errcode = '22023';
  end if;
  if p_account_plan_id is not null and not exists (
       select 1 from public.account_plans
        where id = p_account_plan_id and organization_id = p_org and is_active and direction = p_direction) then
    raise exception 'categoria_invalida' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.fn_gf_conferir_lancamento(uuid, text, uuid, uuid, bigint, text) from public, anon, authenticated;

-- Data civil → instante: meio-dia em São Paulo (nunca vira o dia em fuso nenhum do Brasil).
create or replace function public.fn_gf_meio_dia(p_data date)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$ select (p_data::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' $$;

revoke execute on function public.fn_gf_meio_dia(date) from public, anon, authenticated;

-- D7: `record`, nunca %rowtype. Todas começam por auth.uid() + fn_gf_pode(p_org, 'editar').
create or replace function public.fn_gf_semear_categorias(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c record;
  v_plano record;
  v_criadas integer := 0;
  v_n integer;
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;

  -- Espelho de lib/gestao-financeira/categorias-padrao.ts (tests/unit/gf-categorias-sql.test.ts).
  for c in
    select * from (values
      ('Serviços', 'in', 'receita', false),
      ('Mensalidades', 'in', 'receita', false),
      ('Vendas', 'in', 'receita', false),
      ('Outras receitas', 'in', 'receita', false),
      ('Impostos sobre vendas', 'out', 'imposto', false),
      ('Custos variáveis', 'out', 'custo_variavel', false),
      ('Taxas de pagamento', 'out', 'custo_variavel', false),
      ('Salários', 'out', 'pessoal', false),
      ('Pró-labore', 'out', 'pessoal', false),
      ('Freelancers', 'out', 'pessoal', false),
      ('Assinaturas e ferramentas', 'out', 'assinaturas', false),
      ('Meta Ads', 'out', 'marketing', true),
      ('Google Ads', 'out', 'marketing', true),
      ('TikTok Ads', 'out', 'marketing', true),
      ('LinkedIn Ads', 'out', 'marketing', true),
      ('Outros anúncios', 'out', 'marketing', true),
      ('Comissões de venda', 'out', 'marketing', true),
      ('Aluguel', 'out', 'estrutura', false),
      ('Contas (luz, água, internet)', 'out', 'estrutura', false),
      ('Contabilidade', 'out', 'estrutura', false),
      ('Outras despesas', 'out', 'outras_despesas', false)
    ) as t(nome, direction, grupo, conta_cac)
  loop
    insert into public.account_plans (organization_id, name, direction)
    values (p_org, c.nome, c.direction)
    on conflict (organization_id, lower(name)) where is_active do nothing;

    select id, direction into v_plano from public.account_plans
     where organization_id = p_org and lower(name) = lower(c.nome) and is_active;
    -- Categoria do núcleo com o mesmo nome e direção oposta: não se reclassifica.
    continue when v_plano.direction is distinct from c.direction;

    insert into public.gf_categorias (account_plan_id, organization_id, grupo, conta_cac)
    values (v_plano.id, p_org, c.grupo, c.conta_cac)
    on conflict (account_plan_id) do nothing;
    get diagnostics v_n = row_count;
    v_criadas := v_criadas + v_n;
  end loop;
  return v_criadas;
end;
$$;

revoke execute on function public.fn_gf_semear_categorias(uuid) from public, anon;
grant execute on function public.fn_gf_semear_categorias(uuid) to authenticated;

create or replace function public.fn_gf_lancamento_criar(
  p_org uuid, p_direction text, p_account_id uuid, p_account_plan_id uuid, p_amount_cents bigint,
  p_entry_date date, p_description text, p_pago boolean, p_paid_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_pago boolean := coalesce(p_pago, false);
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  perform public.fn_gf_conferir_lancamento(p_org, p_direction, p_account_id, p_account_plan_id, p_amount_cents, p_description);
  if p_entry_date is null then
    raise exception 'data_invalida' using errcode = '22023';
  end if;

  insert into public.financial_entries
    (organization_id, account_id, account_plan_id, direction, amount_cents, description, entry_date,
     status, paid_at, origin, created_by_user_id)
  values (p_org, p_account_id, p_account_plan_id, p_direction, p_amount_cents, p_description, p_entry_date,
          case when v_pago then 'paid' else 'pending' end,
          case when v_pago then public.fn_gf_meio_dia(coalesce(p_paid_date, p_entry_date)) end,
          'manual', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.fn_gf_lancamento_criar(uuid, text, uuid, uuid, bigint, date, text, boolean, date) from public, anon;
grant execute on function public.fn_gf_lancamento_criar(uuid, text, uuid, uuid, bigint, date, text, boolean, date) to authenticated;

-- N pendentes; a sobra de centavos vai na 1ª; datas mês a mês contadas da primeira
-- (31/01 + 1 mês = 28/02 e + 2 meses = 31/03, como somarMeses de lib/contratos/regras.ts).
create or replace function public.fn_gf_parcelado_criar(
  p_org uuid, p_direction text, p_account_id uuid, p_account_plan_id uuid, p_total_cents bigint,
  p_parcelas integer, p_primeiro date, p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parcelamento uuid;
  v_entry uuid;
  v_base bigint;
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  k integer;
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  perform public.fn_gf_conferir_lancamento(p_org, p_direction, p_account_id, p_account_plan_id, p_total_cents, v_desc);
  if v_desc is null then
    raise exception 'descricao_invalida' using errcode = '22023';
  end if;
  if p_parcelas is null or p_parcelas not between 2 and 120 or p_total_cents < p_parcelas then
    raise exception 'parcelas_invalidas' using errcode = '22023';
  end if;
  if p_primeiro is null then
    raise exception 'data_invalida' using errcode = '22023';
  end if;

  v_base := p_total_cents / p_parcelas;
  insert into public.gf_parcelamentos (organization_id, descricao, total_cents, parcelas)
  values (p_org, v_desc, p_total_cents, p_parcelas)
  returning id into v_parcelamento;

  for k in 0 .. p_parcelas - 1 loop
    insert into public.financial_entries
      (organization_id, account_id, account_plan_id, direction, amount_cents, description, entry_date,
       status, origin, created_by_user_id)
    values (p_org, p_account_id, p_account_plan_id, p_direction,
            v_base + case when k = 0 then p_total_cents - v_base * p_parcelas else 0 end,
            format('%s (%s/%s)', v_desc, k + 1, p_parcelas),
            (p_primeiro + k * interval '1 month')::date,
            'pending', 'manual', auth.uid())
    returning id into v_entry;
    insert into public.gf_parcelas (entry_id, organization_id, parcelamento_id, numero)
    values (v_entry, p_org, v_parcelamento, k + 1);
  end loop;
  return v_parcelamento;
end;
$$;

revoke execute on function public.fn_gf_parcelado_criar(uuid, text, uuid, uuid, bigint, integer, date, text) from public, anon;
grant execute on function public.fn_gf_parcelado_criar(uuid, text, uuid, uuid, bigint, integer, date, text) to authenticated;

-- Só pendente. Pago muda por fn_gf_lancamento_corrigir (contra-lançamento).
create or replace function public.fn_gf_lancamento_editar(
  p_org uuid, p_entry uuid, p_amount_cents bigint, p_entry_date date, p_account_id uuid,
  p_account_plan_id uuid, p_description text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  select id, direction, status, origin, entry_date into v from public.financial_entries
   where id = p_entry and organization_id = p_org
   for update;
  if not found then
    raise exception 'lancamento_nao_encontrado' using errcode = 'P0002';
  end if;
  if v.origin = 'sale' then
    raise exception 'lancamento_de_comanda' using errcode = '42501';
  end if;
  if v.status <> 'pending' then
    raise exception 'lancamento_pago_imutavel' using errcode = '42501';
  end if;
  perform public.fn_gf_conferir_lancamento(p_org, v.direction, p_account_id, p_account_plan_id, p_amount_cents, p_description);
  if p_entry_date is null then
    raise exception 'data_invalida' using errcode = '22023';
  end if;
  -- Recorrência regenera (recurring_entry_id, entry_date) ausentes: mover a data duplicaria.
  if v.origin = 'recurring' and p_entry_date <> v.entry_date then
    raise exception 'lancamento_recorrente' using errcode = '42501';
  end if;

  update public.financial_entries
     set amount_cents = p_amount_cents, entry_date = p_entry_date, account_id = p_account_id,
         account_plan_id = p_account_plan_id, description = p_description, updated_at = now()
   where id = p_entry;
end;
$$;

revoke execute on function public.fn_gf_lancamento_editar(uuid, uuid, bigint, date, uuid, uuid, text) from public, anon;
grant execute on function public.fn_gf_lancamento_editar(uuid, uuid, bigint, date, uuid, uuid, text) to authenticated;

create or replace function public.fn_gf_lancamento_pagar(p_org uuid, p_entry uuid, p_paid_date date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  select id, status, origin into v from public.financial_entries
   where id = p_entry and organization_id = p_org
   for update;
  if not found then
    raise exception 'lancamento_nao_encontrado' using errcode = 'P0002';
  end if;
  -- Lançamento de comanda é das Comandas (fn_estornar_comanda), não do Financeiro.
  if v.origin = 'sale' then
    raise exception 'lancamento_de_comanda' using errcode = '42501';
  end if;
  if v.status <> 'pending' then
    raise exception 'lancamento_ja_pago' using errcode = '22023';
  end if;
  update public.financial_entries
     set status = 'paid',
         paid_at = public.fn_gf_meio_dia(coalesce(p_paid_date, (now() at time zone 'America/Sao_Paulo')::date)),
         updated_at = now()
   where id = p_entry;
end;
$$;

revoke execute on function public.fn_gf_lancamento_pagar(uuid, uuid, date) from public, anon;
grant execute on function public.fn_gf_lancamento_pagar(uuid, uuid, date) to authenticated;

-- Pago não se altera (trigger trg_financial_entries_imutavel): estorna e lança de novo.
-- O contra-lançamento leva a data e o paid_at do original, então qualquer período o anula;
-- o novo leva o paid_at do original, ou o meio-dia da data nova se a data mudou.
create or replace function public.fn_gf_lancamento_corrigir(
  p_org uuid, p_entry uuid, p_amount_cents bigint, p_entry_date date, p_account_id uuid,
  p_account_plan_id uuid, p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  v_novo uuid;
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  select * into v from public.financial_entries
   where id = p_entry and organization_id = p_org
   for update;
  if not found then
    raise exception 'lancamento_nao_encontrado' using errcode = 'P0002';
  end if;
  if v.status <> 'paid' then
    raise exception 'lancamento_nao_pago' using errcode = '22023';
  end if;
  -- Estorno não se corrige, nem o já estornado; comanda tem o próprio estorno.
  if v.origin in ('reversal', 'sale')
     or exists (select 1 from public.financial_entries where reverses_entry_id = p_entry) then
    raise exception 'lancamento_nao_corrigivel' using errcode = '22023';
  end if;
  perform public.fn_gf_conferir_lancamento(p_org, v.direction, p_account_id, p_account_plan_id, p_amount_cents, p_description);
  if p_entry_date is null then
    raise exception 'data_invalida' using errcode = '22023';
  end if;

  insert into public.financial_entries
    (organization_id, account_id, account_plan_id, direction, amount_cents, description, entry_date,
     status, paid_at, reverses_entry_id, origin, created_by_user_id)
  values (p_org, v.account_id, v.account_plan_id, case when v.direction = 'in' then 'out' else 'in' end,
          v.amount_cents, left('Estorno: ' || coalesce(v.description, ''), 200), v.entry_date,
          'paid', v.paid_at, v.id, 'reversal', auth.uid());

  insert into public.financial_entries
    (organization_id, account_id, account_plan_id, direction, amount_cents, description, entry_date,
     status, paid_at, origin, created_by_user_id)
  values (p_org, p_account_id, p_account_plan_id, v.direction, p_amount_cents, p_description, p_entry_date,
          'paid', case when p_entry_date = v.entry_date then v.paid_at else public.fn_gf_meio_dia(p_entry_date) end,
          'manual', auth.uid())
  returning id into v_novo;

  -- A parcela "3/6" passa a ser o lançamento novo (sem o módulo instalado, nada a mover).
  if to_regclass('public.gf_parcelas') is not null then
    execute 'update public.gf_parcelas set entry_id = $1 where entry_id = $2' using v_novo, p_entry;
  end if;
  -- Recebimento de cobrança de contrato: a cobrança passa a apontar para o lançamento novo
  -- (o original fica estornado). Sem o módulo Contratos, nada a mover.
  if to_regclass('public.contrato_cobrancas') is not null then
    execute 'update public.contrato_cobrancas set financial_entry_id = $1, updated_at = now()
              where financial_entry_id = $2 and organization_id = $3' using v_novo, p_entry, p_org;
  end if;
  return v_novo;
end;
$$;

revoke execute on function public.fn_gf_lancamento_corrigir(uuid, uuid, bigint, date, uuid, uuid, text) from public, anon;
grant execute on function public.fn_gf_lancamento_corrigir(uuid, uuid, bigint, date, uuid, uuid, text) to authenticated;

-- Só pendente. gf_parcelas cai junto (FK on delete cascade).
create or replace function public.fn_gf_lancamento_excluir(p_org uuid, p_entry uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  select id, status, origin into v from public.financial_entries
   where id = p_entry and organization_id = p_org
   for update;
  if not found then
    raise exception 'lancamento_nao_encontrado' using errcode = 'P0002';
  end if;
  -- Lançamento de comanda é das Comandas (fn_estornar_comanda), não do Financeiro.
  if v.origin = 'sale' then
    raise exception 'lancamento_de_comanda' using errcode = '42501';
  end if;
  if v.origin = 'recurring' then
    raise exception 'lancamento_recorrente' using errcode = '42501';
  end if;
  if v.status <> 'pending' then
    raise exception 'lancamento_pago_imutavel' using errcode = '42501';
  end if;
  delete from public.financial_entries where id = p_entry;
end;
$$;

revoke execute on function public.fn_gf_lancamento_excluir(uuid, uuid) from public, anon;
grant execute on function public.fn_gf_lancamento_excluir(uuid, uuid) to authenticated;

create or replace function public.fn_gf_recorrencia_salvar(
  p_org uuid, p_id uuid, p_direction text, p_account_id uuid, p_account_plan_id uuid,
  p_amount_cents bigint, p_day integer, p_description text, p_fim date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_nome text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  perform public.fn_gf_conferir_lancamento(p_org, p_direction, p_account_id, p_account_plan_id, p_amount_cents, v_nome);
  if v_nome is null then
    raise exception 'descricao_invalida' using errcode = '22023';
  end if;
  if p_day is null or p_day not between 1 and 31 then
    raise exception 'dia_invalido' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.recurring_entries
      (organization_id, name, account_id, account_plan_id, direction, amount_cents, day_of_month, created_by_user_id)
    values (p_org, v_nome, p_account_id, p_account_plan_id, p_direction, p_amount_cents, p_day, auth.uid())
    returning id into v_id;
  else
    update public.recurring_entries
       set name = v_nome, account_id = p_account_id, account_plan_id = p_account_plan_id,
           direction = p_direction, amount_cents = p_amount_cents, day_of_month = p_day, updated_at = now()
     where id = v_id and organization_id = p_org;
    if not found then
      raise exception 'recorrencia_nao_encontrada' using errcode = 'P0002';
    end if;
  end if;

  insert into public.gf_recorrencias (recurring_entry_id, organization_id, fim)
  values (v_id, p_org, p_fim)
  on conflict (recurring_entry_id) do update set fim = excluded.fim;
  return v_id;
end;
$$;

revoke execute on function public.fn_gf_recorrencia_salvar(uuid, uuid, text, uuid, uuid, bigint, integer, text, date) from public, anon;
grant execute on function public.fn_gf_recorrencia_salvar(uuid, uuid, text, uuid, uuid, bigint, integer, text, date) to authenticated;

create or replace function public.fn_gf_recorrencia_encerrar(p_org uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  update public.recurring_entries set is_active = false, updated_at = now()
   where id = p_id and organization_id = p_org;
  if not found then
    raise exception 'recorrencia_nao_encontrada' using errcode = 'P0002';
  end if;
  insert into public.gf_recorrencias (recurring_entry_id, organization_id, fim)
  values (p_id, p_org, v_hoje)
  on conflict (recurring_entry_id) do update set fim = least(coalesce(gf_recorrencias.fim, excluded.fim), excluded.fim);
end;
$$;

revoke execute on function public.fn_gf_recorrencia_encerrar(uuid, uuid) from public, anon;
grant execute on function public.fn_gf_recorrencia_encerrar(uuid, uuid) to authenticated;

-- O gerador do núcleo (cron recurring-entries) não conhece gf_recorrencias.fim. Esta roda antes
-- dele (cron gf-recorrencias, 05:45): molde cujo fim já passou é desativado, e o lançamento
-- recorrente PENDENTE gerado depois do fim é apagado. Pago nunca é tocado. Só service_role.
create or replace function public.fn_gf_encerrar_recorrencias_vencidas()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if to_regclass('public.gf_recorrencias') is null then
    return 0;
  end if;
  execute $q$
    with vencidas as (
      select recurring_entry_id, organization_id, fim from public.gf_recorrencias
       where fim is not null and fim < $1
    ),
    apagadas as (
      delete from public.financial_entries e using vencidas v
       where e.recurring_entry_id = v.recurring_entry_id and e.organization_id = v.organization_id
         and e.origin = 'recurring' and e.status = 'pending' and e.entry_date > v.fim
      returning 1
    ),
    desligadas as (
      update public.recurring_entries r set is_active = false, updated_at = now()
        from vencidas v
       where r.id = v.recurring_entry_id and r.organization_id = v.organization_id and r.is_active
      returning 1
    )
    select count(*)::integer from desligadas
  $q$ into v_n using (now() at time zone 'America/Sao_Paulo')::date;
  return v_n;
end;
$$;

revoke execute on function public.fn_gf_encerrar_recorrencias_vencidas() from public, anon, authenticated;
grant execute on function public.fn_gf_encerrar_recorrencias_vencidas() to service_role;

-- Receita é entrada; todo outro grupo é saída. A direção de uma categoria existente não muda
-- (os lançamentos já classificados por ela mudariam de lado na DRE).
create or replace function public.fn_gf_categoria_salvar(
  p_org uuid, p_id uuid, p_nome text, p_direction text, p_grupo text, p_conta_cac boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_nome text := btrim(coalesce(p_nome, ''));
begin
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  if char_length(v_nome) not between 1 and 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if p_direction is null or p_direction not in ('in', 'out') then
    raise exception 'direcao_invalida' using errcode = '22023';
  end if;
  if p_grupo is null
     or p_grupo not in ('receita', 'imposto', 'custo_variavel', 'pessoal', 'assinaturas', 'marketing', 'estrutura', 'outras_despesas')
     or (p_grupo = 'receita') <> (p_direction = 'in') then
    raise exception 'grupo_invalido' using errcode = '22023';
  end if;

  begin
    if v_id is null then
      insert into public.account_plans (organization_id, name, direction)
      values (p_org, v_nome, p_direction)
      returning id into v_id;
    else
      update public.account_plans set name = v_nome, updated_at = now()
       where id = v_id and organization_id = p_org and is_active and direction = p_direction;
      if not found then
        raise exception 'categoria_invalida' using errcode = '22023';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'categoria_duplicada' using errcode = '23505';
  end;

  insert into public.gf_categorias (account_plan_id, organization_id, grupo, conta_cac)
  values (v_id, p_org, p_grupo, coalesce(p_conta_cac, false))
  on conflict (account_plan_id) do update set grupo = excluded.grupo, conta_cac = excluded.conta_cac;
  return v_id;
end;
$$;

revoke execute on function public.fn_gf_categoria_salvar(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.fn_gf_categoria_salvar(uuid, uuid, text, text, text, boolean) to authenticated;

-- Só admin. 'nenhum' apaga a linha. Só membro ativo da org recebe acesso.
create or replace function public.fn_gf_acesso_definir(p_org uuid, p_user uuid, p_nivel text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'admin') then
    raise exception 'gf_forbidden' using errcode = '42501';
  end if;
  if p_nivel is null or p_nivel not in ('nenhum', 'ver', 'editar') then
    raise exception 'nivel_invalido' using errcode = '22023';
  end if;
  if p_nivel = 'nenhum' then
    delete from public.gf_acessos where organization_id = p_org and user_id = p_user;
    return;
  end if;
  if not exists (select 1 from public.user_organizations
                  where user_id = p_user and organization_id = p_org and revoked_at is null) then
    raise exception 'usuario_nao_membro' using errcode = '22023';
  end if;
  insert into public.gf_acessos (organization_id, user_id, nivel, concedido_por, updated_at)
  values (p_org, p_user, p_nivel, auth.uid(), now())
  on conflict (organization_id, user_id)
  do update set nivel = excluded.nivel, concedido_por = excluded.concedido_por, updated_at = now();
end;
$$;

revoke execute on function public.fn_gf_acesso_definir(uuid, uuid, text) from public, anon;
grant execute on function public.fn_gf_acesso_definir(uuid, uuid, text) to authenticated;

-- ── Contratos (9001) passam a seguir o acesso do Financeiro ──
-- Mesmo corpo da 9001; só a autorização muda: leitura = fn_gf_pode 'ver', escrita = 'editar'
-- (no lugar de membro / manager+), e a escrita do platform admin exige escopo full (0533).
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

  -- RLS por operação (molde 0480). Leitura = fn_gf_pode 'ver'; escrita = 'editar' (9002).
  -- Recebida é imutável e só nasce na RPC.
  alter table public.contratos enable row level security;
  drop policy if exists tenant_isolation_contratos_all on public.contratos;
  drop policy if exists contratos_select on public.contratos;
  create policy contratos_select
    on public.contratos
    for select
    using (public.fn_gf_pode(organization_id, 'ver') or public.fn_is_platform_admin());
  drop policy if exists contratos_insert on public.contratos;
  create policy contratos_insert
    on public.contratos
    for insert
    with check ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
                and (contratos.lead_id is null
                     or exists (select 1 from public.crm_leads l where l.id = contratos.lead_id
                                 and l.organization_id = contratos.organization_id)));
  drop policy if exists contratos_update on public.contratos;
  create policy contratos_update
    on public.contratos
    for update
    using (public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
    with check ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
                and (contratos.lead_id is null
                     or exists (select 1 from public.crm_leads l where l.id = contratos.lead_id
                                 and l.organization_id = contratos.organization_id)));
  drop policy if exists contratos_delete on public.contratos;
  create policy contratos_delete
    on public.contratos
    for delete
    using ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
           and not exists (select 1 from public.contrato_cobrancas c
                            where c.contrato_id = contratos.id and c.situacao = 'recebida'));
  revoke all on public.contratos from anon;

  alter table public.contrato_formas enable row level security;
  drop policy if exists tenant_isolation_contrato_formas_all on public.contrato_formas;
  drop policy if exists contrato_formas_select on public.contrato_formas;
  create policy contrato_formas_select
    on public.contrato_formas
    for select
    using (public.fn_gf_pode(organization_id, 'ver') or public.fn_is_platform_admin());
  drop policy if exists contrato_formas_insert on public.contrato_formas;
  create policy contrato_formas_insert
    on public.contrato_formas
    for insert
    with check ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_formas.organization_id));
  drop policy if exists contrato_formas_update on public.contrato_formas;
  create policy contrato_formas_update
    on public.contrato_formas
    for update
    using (public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
    with check ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_formas.organization_id));
  drop policy if exists contrato_formas_delete on public.contrato_formas;
  create policy contrato_formas_delete
    on public.contrato_formas
    for delete
    using ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
           and not exists (select 1 from public.contrato_cobrancas c
                            where c.forma_id = contrato_formas.id and c.situacao = 'recebida'));
  revoke all on public.contrato_formas from anon;

  alter table public.contrato_cobrancas enable row level security;
  drop policy if exists tenant_isolation_contrato_cobrancas_all on public.contrato_cobrancas;
  drop policy if exists contrato_cobrancas_select on public.contrato_cobrancas;
  create policy contrato_cobrancas_select
    on public.contrato_cobrancas
    for select
    using (public.fn_gf_pode(organization_id, 'ver') or public.fn_is_platform_admin());
  drop policy if exists contrato_cobrancas_insert on public.contrato_cobrancas;
  create policy contrato_cobrancas_insert
    on public.contrato_cobrancas
    for insert
    with check ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
                and situacao <> 'recebida' and financial_entry_id is null and recebida_em is null
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_cobrancas.organization_id)
                and exists (select 1 from public.contrato_formas f where f.id = forma_id
                             and f.organization_id = contrato_cobrancas.organization_id
                             and f.contrato_id = contrato_cobrancas.contrato_id));
  drop policy if exists contrato_cobrancas_update on public.contrato_cobrancas;
  create policy contrato_cobrancas_update
    on public.contrato_cobrancas
    for update
    using ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
           and situacao <> 'recebida')
    with check ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
                and situacao <> 'recebida' and financial_entry_id is null and recebida_em is null
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_cobrancas.organization_id)
                and exists (select 1 from public.contrato_formas f where f.id = forma_id
                             and f.organization_id = contrato_cobrancas.organization_id
                             and f.contrato_id = contrato_cobrancas.contrato_id));
  drop policy if exists contrato_cobrancas_delete on public.contrato_cobrancas;
  create policy contrato_cobrancas_delete
    on public.contrato_cobrancas
    for delete
    using ((public.fn_is_platform_admin_full() or public.fn_gf_pode(organization_id, 'editar'))
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

-- Igual à 9001, com fn_gf_pode(p_org, 'editar') no lugar de manager+. O código de recusa
-- continua `contratos_forbidden` (a rota de recebimento o mapeia para 403).
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
  if auth.uid() is null or not public.fn_gf_pode(p_org, 'editar') then
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
          'paid', public.fn_gf_meio_dia(v_data), 'manual', auth.uid())
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

-- Onde os Contratos já estão instalados, as policies novas valem já (a provisionadora é idempotente).
do $gf$
begin
  if to_regclass('public.contratos') is not null then
    perform public.fn_contratos_provisionar();
  end if;
end $gf$;
