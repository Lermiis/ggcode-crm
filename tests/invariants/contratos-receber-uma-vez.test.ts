import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

import { GOV_MANAGER, GOV_ORG, GOV_VIEWER, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * CONTRATOS — UMA COBRANÇA ENTRA NO CAIXA UMA VEZ SÓ (migration 9001).
 * Mede: segundo recebimento recusado; dois simultâneos lançam UM; conta de outra org recusada;
 * cobrança cancelada não se recebe.
 */
const ORG_B = "c0c0c0c0-0000-4000-8000-000000000002";
const CONTA_A = "c0c0c0c0-2222-4000-8000-000000000001";
const CONTA_B = "c0c0c0c0-2222-4000-8000-000000000002";
const LEAD = "c0c0c0c0-5555-4000-8000-000000000001";
const CONTRATO = "c0c0c0c0-3333-4000-8000-000000000001";
const FORMA = "c0c0c0c0-6666-4000-8000-000000000001";
const COB_SEQ = "c0c0c0c0-4444-4000-8000-000000000001";
const COB_CORRIDA = "c0c0c0c0-4444-4000-8000-000000000002";
const COB_OUTRA_CONTA = "c0c0c0c0-4444-4000-8000-000000000003";
const COB_CANCELADA = "c0c0c0c0-4444-4000-8000-000000000004";
const COB_VIEWER = "c0c0c0c0-4444-4000-8000-000000000005";

const execFileP = promisify(execFile);
const container = process.env.TEST_DB_CONTAINER ?? "";
const COMO_GERENTE = `
  set role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}","role":"authenticated"}', false);
`;
const COMO_VIEWER = COMO_GERENTE.replace(GOV_MANAGER, GOV_VIEWER);
const receber = (cob: string, conta: string) =>
  `select public.fn_contratos_cobranca_receber('${GOV_ORG}'::uuid, '${cob}'::uuid, '${conta}'::uuid)::text;`;

async function sessao(script: string): Promise<{ ok: boolean; saida: string }> {
  try {
    const { stdout } = await execFileP("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-c", script], { encoding: "utf8" });
    return { ok: true, saida: stdout };
  } catch (erro) {
    const e = erro as { stderr?: string; message?: string };
    return { ok: false, saida: e.stderr ?? e.message ?? "" };
  }
}
const lancamentosDa = (cob: string) =>
  Number(lastLine(sql(`select count(*) from public.financial_entries fe join public.contrato_cobrancas c on c.financial_entry_id = fe.id where c.id = '${cob}';`)));

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_contratos_provisionar();
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_B}', 'contratos-b', 'Contratos B', 'Contratos B') on conflict (id) do nothing;
    insert into public.financial_accounts (id, organization_id, name, kind) values
      ('${CONTA_A}', '${GOV_ORG}', 'Caixa A', 'cash'), ('${CONTA_B}', '${ORG_B}', 'Caixa B', 'cash') on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, title, pipeline_id, stage_id)
      select '${LEAD}', '${GOV_ORG}', 'Lead contrato', p.id, s.id from public.crm_pipelines p join public.crm_stages s on s.pipeline_id = p.id
       where p.organization_id = '${GOV_ORG}' limit 1 on conflict (id) do nothing;
    insert into public.contratos (id, organization_id, lead_id, titulo, inicio) values ('${CONTRATO}', '${GOV_ORG}', '${LEAD}', 'Teste', '2026-10-01') on conflict (id) do nothing;
    insert into public.contrato_formas (id, organization_id, contrato_id, tipo, valor_cents, primeiro_vencimento) values ('${FORMA}', '${GOV_ORG}', '${CONTRATO}', 'avulso', 10000, '2026-10-10') on conflict (id) do nothing;
    insert into public.contrato_cobrancas (id, organization_id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents, situacao) values
      ('${COB_SEQ}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a1', 'Seq', '2026-10-10', 10000, 'a_receber'),
      ('${COB_CORRIDA}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a2', 'Corrida', '2026-10-10', 10000, 'a_receber'),
      ('${COB_OUTRA_CONTA}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a3', 'Outra conta', '2026-10-10', 10000, 'a_receber'),
      ('${COB_CANCELADA}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a4', 'Cancelada', '2026-10-10', 10000, 'cancelada'),
      ('${COB_VIEWER}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a5', 'Viewer', '2026-10-10', 10000, 'a_receber')
      on conflict (id) do nothing;
  `);
});

describe("recebimento de cobrança é atômico", () => {
  it("o segundo recebimento é recusado e não lança de novo", async () => {
    expect((await sessao(COMO_GERENTE + receber(COB_SEQ, CONTA_A))).ok).toBe(true);
    const segunda = await sessao(COMO_GERENTE + receber(COB_SEQ, CONTA_A));
    expect(segunda.ok).toBe(false);
    expect(segunda.saida).toContain("cobranca_nao_recebivel");
    expect(lancamentosDa(COB_SEQ)).toBe(1);
  });

  it("dois recebimentos simultâneos lançam uma vez só", async () => {
    const [a, b] = await Promise.all([sessao(COMO_GERENTE + receber(COB_CORRIDA, CONTA_A)), sessao(COMO_GERENTE + receber(COB_CORRIDA, CONTA_A))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(lancamentosDa(COB_CORRIDA)).toBe(1);
  });

  it("conta de outra organização é recusada", async () => {
    const r = await sessao(COMO_GERENTE + receber(COB_OUTRA_CONTA, CONTA_B));
    expect(r.ok).toBe(false);
    expect(r.saida).toContain("conta_invalida");
  });

  it("cobrança cancelada não se recebe", async () => {
    const r = await sessao(COMO_GERENTE + receber(COB_CANCELADA, CONTA_A));
    expect(r.ok).toBe(false);
    expect(r.saida).toContain("cobranca_nao_recebivel");
  });

  it("viewer não recebe: contratos_forbidden e nada é lançado", async () => {
    const r = await sessao(COMO_VIEWER + receber(COB_VIEWER, CONTA_A));
    expect(r.ok).toBe(false);
    expect(r.saida).toContain("contratos_forbidden");
    expect(lancamentosDa(COB_VIEWER)).toBe(0);
  });
});
