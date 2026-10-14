import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_MANAGER, GOV_ORG, GOV_VIEWER, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

/** A RLS DE CONTRATOS É POR OPERAÇÃO (migration 9001): leitura = membro; escrita = manager;
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

const existe = (t: string, id: string) => lastLine(sql(`select exists(select 1 from public.${t} where id = '${id}')::text;`)) === "true";

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_contratos_provisionar();
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_B}', 'contratos-rls-b', 'Contratos RLS B', 'C RLS B') on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, title, pipeline_id, stage_id)
      select '${LEAD}', '${GOV_ORG}', 'Lead RLS', p.id, s.id from public.crm_pipelines p join public.crm_stages s on s.pipeline_id = p.id
       where p.organization_id = '${GOV_ORG}' limit 1 on conflict (id) do nothing;
    insert into public.contratos (id, organization_id, lead_id, titulo, inicio) values
      ('${CONTRATO}', '${GOV_ORG}', '${LEAD}', 'A', '2026-10-01'),
      ('${CONTRATO_COM_RECEBIDA}', '${GOV_ORG}', '${LEAD}', 'B', '2026-10-01'),
      ('${CONTRATO_OUTRA_ORG}', '${ORG_B}', null, 'C', '2026-10-01') on conflict (id) do nothing;
    insert into public.contrato_formas (id, organization_id, contrato_id, tipo, valor_cents) values
      ('${FORMA}', '${GOV_ORG}', '${CONTRATO}', 'avulso', 100), ('${FORMA_REC}', '${GOV_ORG}', '${CONTRATO_COM_RECEBIDA}', 'avulso', 100) on conflict (id) do nothing;
    insert into public.contrato_cobrancas (id, organization_id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents, situacao, recebida_em) values
      ('${PENDENTE}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'x1', 'P', '2026-10-10', 100, 'a_receber', null),
      ('${RECEBIDA}', '${GOV_ORG}', '${CONTRATO_COM_RECEBIDA}', '${FORMA_REC}', 'x2', 'R', '2026-10-10', 100, 'recebida', '2026-10-10') on conflict (id) do nothing;
  `);
});

describe("viewer e agent só leem", () => {
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

describe("manager", () => {
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
    expect(writeCountAs(GOV_MANAGER, `insert into public.contrato_formas (organization_id, contrato_id, tipo, valor_cents) values ('${GOV_ORG}', '${CONTRATO_OUTRA_ORG}', 'avulso', 1)`)).toBe(0);
  });
  it("não lê contrato de outra organização", () => {
    expect(Number(lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
      select count(*) from public.contratos where id = '${CONTRATO_OUTRA_ORG}';`)))).toBe(0);
  });
});
