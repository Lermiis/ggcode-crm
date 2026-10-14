import { beforeAll, describe, expect, it } from "vitest";

import { countAs, GOV_ADMIN, GOV_AGENT_A, GOV_AGENT_B, GOV_MANAGER, GOV_ORG, GOV_VIEWER, seedGov, sql, writeCountAs } from "./gov-helpers";

/** FINANCEIRO (migration 9002): ACESSO POR PESSOA, NÃO POR PAPEL.
 *  Admin pode tudo; fora isso só quem tem linha em gf_acessos ('ver' lê, 'editar' escreve);
 *  sem linha (mesmo manager) não lê nem escreve; gf_acessos só admin lê e escreve; membro
 *  revogado não passa nem com linha; nada cruza organização. Contratos seguem a mesma regra. */
const ORG_B = "c2c2c2c2-0000-4000-8000-000000000002";
const MANAGER_EDITAR = "c2c2c2c2-1111-4000-8000-000000000001";
const ADMIN_B = "c2c2c2c2-1111-4000-8000-000000000002";
const CONTA_A = "c2c2c2c2-2222-4000-8000-000000000001";
const CONTA_B = "c2c2c2c2-2222-4000-8000-000000000002";
const PLANO_A = "c2c2c2c2-3333-4000-8000-000000000001";
const PLANO_A2 = "c2c2c2c2-3333-4000-8000-000000000002";
const PLANO_A3 = "c2c2c2c2-3333-4000-8000-000000000003";
const PLANO_B = "c2c2c2c2-3333-4000-8000-000000000004";
const REC_A = "c2c2c2c2-4444-4000-8000-000000000001";
const REC_B = "c2c2c2c2-4444-4000-8000-000000000002";
const PARC_A = "c2c2c2c2-5555-4000-8000-000000000001";
const PARC_B = "c2c2c2c2-5555-4000-8000-000000000002";
const ENTRY_A = "c2c2c2c2-6666-4000-8000-000000000001";
const ENTRY_B = "c2c2c2c2-6666-4000-8000-000000000002";
const CONTRATO = "c2c2c2c2-7777-4000-8000-000000000001";

const TABELAS_GF = [
  ["gf_categorias", GOV_ORG],
  ["gf_recorrencias", GOV_ORG],
  ["gf_parcelamentos", GOV_ORG],
  ["gf_parcelas", GOV_ORG],
] as const;
const conta = (u: string, t: string, org: string) => countAs(u, `select count(*) from public.${t} where organization_id = '${org}';`);

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_contratos_provisionar();
    select public.fn_gestao_financeira_provisionar();
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_B}', 'gf-rls-b', 'GF RLS B', 'GF B') on conflict (id) do nothing;
    insert into auth.users (id, email) values ('${MANAGER_EDITAR}', 'gf-manager-editar@invariant.test'), ('${ADMIN_B}', 'gf-admin-b@invariant.test') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER_EDITAR}', '${GOV_ORG}', 'manager', now()), ('${ADMIN_B}', '${ORG_B}', 'admin', now()),
      ('${GOV_AGENT_A}', '${ORG_B}', 'agent', now()) on conflict do nothing;
    insert into public.financial_accounts (id, organization_id, name) values ('${CONTA_A}', '${GOV_ORG}', 'Caixa A'), ('${CONTA_B}', '${ORG_B}', 'Caixa B');
    insert into public.account_plans (id, organization_id, name, direction) values
      ('${PLANO_A}', '${GOV_ORG}', 'Serviços A', 'in'), ('${PLANO_A2}', '${GOV_ORG}', 'Aluguel A', 'out'),
      ('${PLANO_A3}', '${GOV_ORG}', 'Ads A', 'out'), ('${PLANO_B}', '${ORG_B}', 'Serviços B', 'in');
    insert into public.gf_categorias (account_plan_id, organization_id, grupo) values
      ('${PLANO_A}', '${GOV_ORG}', 'receita'), ('${PLANO_B}', '${ORG_B}', 'receita');
    insert into public.recurring_entries (id, organization_id, name, account_id, direction, amount_cents, day_of_month) values
      ('${REC_A}', '${GOV_ORG}', 'Aluguel', '${CONTA_A}', 'out', 100, 5), ('${REC_B}', '${ORG_B}', 'Aluguel B', '${CONTA_B}', 'out', 100, 5);
    insert into public.gf_recorrencias (recurring_entry_id, organization_id, fim) values ('${REC_A}', '${GOV_ORG}', null), ('${REC_B}', '${ORG_B}', null);
    insert into public.gf_parcelamentos (id, organization_id, descricao, total_cents, parcelas) values
      ('${PARC_A}', '${GOV_ORG}', 'Notebook', 200, 2), ('${PARC_B}', '${ORG_B}', 'Notebook B', 200, 2);
    insert into public.financial_entries (id, organization_id, account_id, direction, amount_cents, entry_date) values
      ('${ENTRY_A}', '${GOV_ORG}', '${CONTA_A}', 'out', 100, '2026-10-10'), ('${ENTRY_B}', '${ORG_B}', '${CONTA_B}', 'out', 100, '2026-10-10');
    insert into public.gf_parcelas (entry_id, organization_id, parcelamento_id, numero) values
      ('${ENTRY_A}', '${GOV_ORG}', '${PARC_A}', 1), ('${ENTRY_B}', '${ORG_B}', '${PARC_B}', 1);
    insert into public.gf_acessos (organization_id, user_id, nivel) values
      ('${GOV_ORG}', '${GOV_VIEWER}', 'ver'), ('${GOV_ORG}', '${GOV_AGENT_A}', 'editar'),
      ('${GOV_ORG}', '${MANAGER_EDITAR}', 'editar'), ('${GOV_ORG}', '${GOV_AGENT_B}', 'editar'),
      ('${ORG_B}', '${ADMIN_B}', 'editar');
    -- GOV_AGENT_B tem linha 'editar' mas deixou a organização: a linha não vale mais nada.
    update public.user_organizations set revoked_at = now() where user_id = '${GOV_AGENT_B}' and organization_id = '${GOV_ORG}';
    insert into public.contratos (id, organization_id, titulo, inicio) values ('${CONTRATO}', '${GOV_ORG}', 'C', '2026-10-01');
  `);
});

describe("tabelas gf_* — leitura", () => {
  for (const [t, org] of TABELAS_GF) {
    it(`${t}: admin, 'ver' e 'editar' leem; manager SEM linha e membro revogado leem zero`, () => {
      expect(conta(GOV_ADMIN, t, org)).toBe(1);
      expect(conta(GOV_VIEWER, t, org)).toBe(1);
      expect(conta(GOV_AGENT_A, t, org)).toBe(1);
      expect(conta(GOV_MANAGER, t, org)).toBe(0);
      expect(conta(GOV_AGENT_B, t, org)).toBe(0);
    });
    it(`${t}: 'editar' na org A (e membro da B sem linha) lê zero da org B`, () => {
      expect(conta(GOV_AGENT_A, t, ORG_B)).toBe(0);
      expect(conta(ADMIN_B, t, ORG_B)).toBe(1); // controle positivo: a linha da B existe
    });
  }
});

describe("tabelas gf_* — escrita", () => {
  const novaCategoria = (plano: string, org = GOV_ORG) =>
    `insert into public.gf_categorias (account_plan_id, organization_id, grupo) values ('${plano}', '${org}', 'estrutura')`;

  it("viewer com 'ver' não escreve", () => {
    expect(writeCountAs(GOV_VIEWER, novaCategoria(PLANO_A2))).toBe(0);
    expect(writeCountAs(GOV_VIEWER, `update public.gf_categorias set conta_cac = true where account_plan_id = '${PLANO_A}'`)).toBe(0);
    expect(writeCountAs(GOV_VIEWER, `update public.gf_recorrencias set fim = '2027-01-01' where recurring_entry_id = '${REC_A}'`)).toBe(0);
    expect(writeCountAs(GOV_VIEWER, `delete from public.gf_parcelas where entry_id = '${ENTRY_A}'`)).toBe(0);
    expect(writeCountAs(GOV_VIEWER, `update public.gf_parcelamentos set descricao = 'x' where id = '${PARC_A}'`)).toBe(0);
  });

  it("manager sem linha não escreve (manager não é admin)", () => {
    expect(writeCountAs(GOV_MANAGER, novaCategoria(PLANO_A2))).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `update public.gf_categorias set conta_cac = true where account_plan_id = '${PLANO_A}'`)).toBe(0);
  });

  it("membro revogado com linha 'editar' não escreve", () => {
    expect(writeCountAs(GOV_AGENT_B, novaCategoria(PLANO_A2))).toBe(0);
  });

  it("agent com 'editar' escreve — controle positivo", () => {
    expect(writeCountAs(GOV_AGENT_A, novaCategoria(PLANO_A2))).toBe(1);
    expect(writeCountAs(GOV_AGENT_A, `update public.gf_recorrencias set fim = '2027-01-01' where recurring_entry_id = '${REC_A}'`)).toBe(1);
  });

  it("admin escreve", () => {
    expect(writeCountAs(GOV_ADMIN, novaCategoria(PLANO_A3))).toBe(1);
    expect(writeCountAs(GOV_ADMIN, `update public.gf_categorias set conta_cac = true where account_plan_id = '${PLANO_A3}'`)).toBe(1);
  });

  it("'editar' na A não escreve na B nem pendura categoria da B na A", () => {
    expect(writeCountAs(GOV_AGENT_A, `update public.gf_categorias set conta_cac = true where account_plan_id = '${PLANO_B}'`)).toBe(0);
    expect(writeCountAs(GOV_AGENT_A, novaCategoria(PLANO_B, ORG_B))).toBe(0);
    expect(writeCountAs(GOV_AGENT_A, novaCategoria(PLANO_B, GOV_ORG))).toBe(0);
  });
});

describe("gf_acessos — só admin", () => {
  const acessos = (u: string, org = GOV_ORG) => conta(u, "gf_acessos", org);

  it("admin lê e escreve", () => {
    expect(acessos(GOV_ADMIN)).toBe(4);
    expect(writeCountAs(GOV_ADMIN, `update public.gf_acessos set nivel = 'ver' where organization_id = '${GOV_ORG}' and user_id = '${GOV_VIEWER}'`)).toBe(1);
  });

  it("manager com 'editar' não lê nem escreve (nem a própria linha)", () => {
    expect(acessos(MANAGER_EDITAR)).toBe(0);
    expect(writeCountAs(MANAGER_EDITAR, `update public.gf_acessos set nivel = 'editar' where organization_id = '${GOV_ORG}' and user_id = '${GOV_VIEWER}'`)).toBe(0);
    expect(writeCountAs(MANAGER_EDITAR, `insert into public.gf_acessos (organization_id, user_id, nivel) values ('${GOV_ORG}', '${GOV_MANAGER}', 'editar')`)).toBe(0);
  });

  it("viewer com 'ver' e agent com 'editar' não se promovem", () => {
    expect(acessos(GOV_AGENT_A)).toBe(0);
    expect(writeCountAs(GOV_VIEWER, `update public.gf_acessos set nivel = 'editar' where user_id = '${GOV_VIEWER}'`)).toBe(0);
  });

  it("admin da A não lê a B", () => {
    expect(acessos(GOV_ADMIN, ORG_B)).toBe(0);
    expect(acessos(ADMIN_B, ORG_B)).toBe(1); // controle positivo
  });
});

describe("Contratos seguem o acesso do Financeiro", () => {
  const contratos = (u: string) => conta(u, "contratos", GOV_ORG);
  const novoContrato = `insert into public.contratos (organization_id, titulo, inicio) values ('${GOV_ORG}', 'novo', '2026-10-01')`;

  it("manager SEM linha não lê nem escreve contratos", () => {
    expect(contratos(GOV_MANAGER)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, novoContrato)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `update public.contratos set titulo = 'x' where id = '${CONTRATO}'`)).toBe(0);
  });

  it("com 'ver' lê e não escreve", () => {
    expect(contratos(GOV_VIEWER)).toBe(1);
    expect(writeCountAs(GOV_VIEWER, novoContrato)).toBe(0);
    expect(writeCountAs(GOV_VIEWER, `delete from public.contratos where id = '${CONTRATO}'`)).toBe(0);
  });

  it("membro revogado com 'editar' não lê", () => {
    expect(contratos(GOV_AGENT_B)).toBe(0);
  });

  it("com 'editar' (mesmo agent) escreve — controle positivo; admin lê", () => {
    expect(writeCountAs(GOV_AGENT_A, novoContrato)).toBe(1);
    expect(writeCountAs(GOV_AGENT_A, `update public.contratos set titulo = 'C2' where id = '${CONTRATO}'`)).toBe(1);
    expect(contratos(GOV_ADMIN)).toBe(2);
  });
});
