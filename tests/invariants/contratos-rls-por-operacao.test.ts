import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_MANAGER, GOV_ORG, GOV_VIEWER, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

/** A RLS DE CONTRATOS É POR OPERAÇÃO (migration 9001; acesso pela 9002): leitura = 'ver' em
 *  gf_acessos; escrita = 'editar' (aqui: viewer e agent com 'ver', manager com 'editar'; quem
 *  não tem linha é medido em gf-rls-e-acesso.test.ts);
 *  cobrança recebida é imutável pela sessão; sessão não marca recebida; contrato com
 *  cobrança recebida não se apaga; nada pendura em contrato de outra organização. */
const ORG_B = "c1c1c1c1-0000-4000-8000-000000000002";
const LEAD = "c1c1c1c1-5555-4000-8000-000000000001";
const CONTRATO = "c1c1c1c1-3333-4000-8000-000000000001";
const CONTRATO_COM_RECEBIDA = "c1c1c1c1-3333-4000-8000-000000000002";
const CONTRATO_OUTRA_ORG = "c1c1c1c1-3333-4000-8000-000000000003";
const FORMA = "c1c1c1c1-6666-4000-8000-000000000001";
const FORMA_REC = "c1c1c1c1-6666-4000-8000-000000000002";
const PENDENTE = "c1c1c1c1-4444-4000-8000-000000000001";
const RECEBIDA = "c1c1c1c1-4444-4000-8000-000000000002";
const PIPELINE_B = "c1c1c1c1-7777-4000-8000-000000000001";
const STAGE_B = "c1c1c1c1-7777-4000-8000-000000000002";
const LEAD_B = "c1c1c1c1-5555-4000-8000-000000000002";
const FORMA_OUTRA_ORG = "c1c1c1c1-6666-4000-8000-000000000003";

const existe = (t: string, id: string) => lastLine(sql(`select exists(select 1 from public.${t} where id = '${id}')::text;`)) === "true";

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_contratos_provisionar();
    select public.fn_gestao_financeira_provisionar();
    insert into public.gf_acessos (organization_id, user_id, nivel) values
      ('${GOV_ORG}', '${GOV_VIEWER}', 'ver'), ('${GOV_ORG}', '${GOV_AGENT_A}', 'ver'), ('${GOV_ORG}', '${GOV_MANAGER}', 'editar');
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_B}', 'contratos-rls-b', 'Contratos RLS B', 'C RLS B') on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, title, pipeline_id, stage_id)
      select '${LEAD}', '${GOV_ORG}', 'Lead RLS', p.id, s.id from public.crm_pipelines p join public.crm_stages s on s.pipeline_id = p.id
       where p.organization_id = '${GOV_ORG}' limit 1 on conflict (id) do nothing;
    insert into public.contratos (id, organization_id, lead_id, titulo, inicio) values
      ('${CONTRATO}', '${GOV_ORG}', '${LEAD}', 'A', '2026-10-01'),
      ('${CONTRATO_COM_RECEBIDA}', '${GOV_ORG}', '${LEAD}', 'B', '2026-10-01'),
      ('${CONTRATO_OUTRA_ORG}', '${ORG_B}', null, 'C', '2026-10-01') on conflict (id) do nothing;
    insert into public.contrato_formas (id, organization_id, contrato_id, tipo, valor_cents, primeiro_vencimento) values
      ('${FORMA}', '${GOV_ORG}', '${CONTRATO}', 'avulso', 100, '2026-10-10'), ('${FORMA_REC}', '${GOV_ORG}', '${CONTRATO_COM_RECEBIDA}', 'avulso', 100, '2026-10-10') on conflict (id) do nothing;
    insert into public.contrato_cobrancas (id, organization_id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents, situacao, recebida_em) values
      ('${PENDENTE}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'x1', 'P', '2026-10-10', 100, 'a_receber', null),
      ('${RECEBIDA}', '${GOV_ORG}', '${CONTRATO_COM_RECEBIDA}', '${FORMA_REC}', 'x2', 'R', '2026-10-10', 100, 'recebida', '2026-10-10') on conflict (id) do nothing;
    insert into public.contrato_formas (id, organization_id, contrato_id, tipo, valor_cents, primeiro_vencimento) values
      ('${FORMA_OUTRA_ORG}', '${ORG_B}', '${CONTRATO_OUTRA_ORG}', 'avulso', 100, '2026-10-10') on conflict (id) do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug) values ('${PIPELINE_B}', '${ORG_B}', 'RLS B', 'rls-b') on conflict (id) do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values ('${STAGE_B}', '${ORG_B}', '${PIPELINE_B}', 'Novo', 'novo', 1000) on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, title, pipeline_id, stage_id) values ('${LEAD_B}', '${ORG_B}', 'Lead B', '${PIPELINE_B}', '${STAGE_B}') on conflict (id) do nothing;
  `);
});

describe("viewer e agent com 'ver' só leem", () => {
  for (const [papel, u] of [["viewer", GOV_VIEWER], ["agent", GOV_AGENT_A]] as const) {
    it(`${papel} não cria, não edita, não apaga`, () => {
      expect(writeCountAs(u, `insert into public.contratos (organization_id, lead_id, titulo, inicio) values ('${GOV_ORG}', '${LEAD}', 'x', '2026-10-01')`)).toBe(0);
      expect(writeCountAs(u, `update public.contrato_cobrancas set valor_cents = 1 where id = '${PENDENTE}'`)).toBe(0);
      expect(writeCountAs(u, `delete from public.contratos where id = '${CONTRATO}'`)).toBe(0);
      expect(existe("contratos", CONTRATO)).toBe(true);
    });
    it(`${papel} lê — controle positivo`, () => {
      expect(Number(lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}"}', false);
        select count(*) from public.contrato_cobrancas where id in ('${PENDENTE}', '${RECEBIDA}');`)))).toBe(2);
    });
  }
});

describe("manager com 'editar'", () => {
  it("edita cobrança a receber — controle positivo", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.contrato_cobrancas set descricao = 'P2' where id = '${PENDENTE}'`)).toBe(1);
  });
  it("não marca recebida pela sessão (só a RPC lança o caixa)", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.contrato_cobrancas set situacao = 'recebida' where id = '${PENDENTE}'`)).toBe(0);
  });
  it("não reescreve nem apaga cobrança recebida, nem o contrato que a tem", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.contrato_cobrancas set situacao = 'a_receber' where id = '${RECEBIDA}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.contrato_cobrancas where id = '${RECEBIDA}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.contratos where id = '${CONTRATO_COM_RECEBIDA}'`)).toBe(0);
  });
  it("não pendura forma nem cobrança em contrato de outra organização", () => {
    expect(writeCountAs(GOV_MANAGER, `insert into public.contrato_formas (organization_id, contrato_id, tipo, valor_cents, primeiro_vencimento) values ('${GOV_ORG}', '${CONTRATO_OUTRA_ORG}', 'avulso', 1, '2026-10-10')`)).toBe(0);
  });
  it("cobrança só aponta forma do PRÓPRIO contrato e da própria organização", () => {
    const ins = (contrato: string, forma: string, comp: string) =>
      `insert into public.contrato_cobrancas (organization_id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents) values ('${GOV_ORG}', '${contrato}', '${forma}', '${comp}', 'T', '2026-10-10', 1)`;
    expect(writeCountAs(GOV_MANAGER, ins(CONTRATO, FORMA_OUTRA_ORG, "z1"))).toBe(0);
    expect(writeCountAs(GOV_MANAGER, ins(CONTRATO, FORMA_REC, "z2"))).toBe(0);
    expect(writeCountAs(GOV_MANAGER, ins(CONTRATO, FORMA, "z3"))).toBe(1); // controle positivo
    expect(writeCountAs(GOV_MANAGER, `update public.contrato_cobrancas set forma_id = '${FORMA_OUTRA_ORG}' where id = '${PENDENTE}'`)).toBe(0);
  });
  it("contrato não aponta para negócio de outra organização", () => {
    expect(writeCountAs(GOV_MANAGER, `insert into public.contratos (organization_id, lead_id, titulo, inicio) values ('${GOV_ORG}', '${LEAD_B}', 'x', '2026-10-01')`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `update public.contratos set lead_id = '${LEAD_B}' where id = '${CONTRATO}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `insert into public.contratos (organization_id, lead_id, titulo, inicio) values ('${GOV_ORG}', '${LEAD}', 'ok', '2026-10-01')`)).toBe(1); // controle positivo
  });
  it("não lê contrato de outra organização", () => {
    expect(Number(lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
      select count(*) from public.contratos where id = '${CONTRATO_OUTRA_ORG}';`)))).toBe(0);
  });
});
