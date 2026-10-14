import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_AGENT_A, GOV_MANAGER, GOV_ORG, GOV_VIEWER, lastLine, seedGov, sql } from "./gov-helpers";

/** FINANCEIRO (migration 9002): AS RPCs DE ESCRITA.
 *  Mede: 'ver' e manager sem linha recusados (gf_forbidden); parcelado soma o total com datas
 *  no último dia do mês curto; pago não se edita nem se exclui; corrigir estorna e relança;
 *  semente idempotente; acesso só por admin e só para membro; conta de outra org recusada;
 *  recebimento de contrato segue o acesso (contratos_forbidden). */
const ORG_B = "c3c3c3c3-0000-4000-8000-000000000002";
const CONTA_A = "c3c3c3c3-2222-4000-8000-000000000001";
const CONTA_B = "c3c3c3c3-2222-4000-8000-000000000002";
const PLANO_IN = "c3c3c3c3-3333-4000-8000-000000000001";
const FORA = "c3c3c3c3-1111-4000-8000-000000000001";
const CONTRATO = "c3c3c3c3-5555-4000-8000-000000000001";
const FORMA = "c3c3c3c3-6666-4000-8000-000000000001";
const COB = "c3c3c3c3-4444-4000-8000-000000000001";
const COB2 = "c3c3c3c3-4444-4000-8000-000000000002";
const VENDA = "c3c3c3c3-7777-4000-8000-000000000001";
const REC = "c3c3c3c3-8888-4000-8000-000000000001";
const REC_PEND_DEPOIS = "c3c3c3c3-8888-4000-8000-000000000002";
const REC_PAGO_DEPOIS = "c3c3c3c3-8888-4000-8000-000000000003";
const REC_PEND_ANTES = "c3c3c3c3-8888-4000-8000-000000000004";

function como(user: string, chamada: string): { ok: boolean; saida: string } {
  try {
    const out = sql(`set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', false);
      select (${chamada})::text;`);
    return { ok: true, saida: lastLine(out) };
  } catch (erro) {
    return { ok: false, saida: (erro as { stderr?: string }).stderr ?? String(erro) };
  }
}
const valor = (q: string) => lastLine(sql(q));
const criar = (dir: string, conta: string, cents: number, data: string, pago: boolean, plano = "null") =>
  `public.fn_gf_lancamento_criar('${GOV_ORG}', '${dir}', '${conta}', ${plano === "null" ? "null" : `'${plano}'`}, ${cents}, '${data}', 'teste', ${pago}, ${pago ? `'${data}'` : "null"})`;

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_contratos_provisionar();
    select public.fn_gestao_financeira_provisionar();
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_B}', 'gf-rpc-b', 'GF RPC B', 'GF RPC B') on conflict (id) do nothing;
    insert into auth.users (id, email) values ('${FORA}', 'gf-fora@invariant.test') on conflict do nothing;
    insert into public.financial_accounts (id, organization_id, name) values ('${CONTA_A}', '${GOV_ORG}', 'Caixa A'), ('${CONTA_B}', '${ORG_B}', 'Caixa B');
    insert into public.account_plans (id, organization_id, name, direction) values ('${PLANO_IN}', '${GOV_ORG}', 'Receita RPC', 'in');
    insert into public.gf_acessos (organization_id, user_id, nivel) values ('${GOV_ORG}', '${GOV_VIEWER}', 'ver'), ('${GOV_ORG}', '${GOV_AGENT_A}', 'editar');
    insert into public.contratos (id, organization_id, titulo, inicio) values ('${CONTRATO}', '${GOV_ORG}', 'K', '2026-10-01');
    insert into public.contrato_formas (id, organization_id, contrato_id, tipo, valor_cents, primeiro_vencimento) values ('${FORMA}', '${GOV_ORG}', '${CONTRATO}', 'avulso', 500, '2026-10-10');
    insert into public.contrato_cobrancas (id, organization_id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents) values
      ('${COB}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'r1', 'Cobrança', '2026-10-10', 500),
      ('${COB2}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'r2', 'Cobrança 2', '2026-10-10', 500);
    -- Lançamento de comanda (origin 'sale'): é das Comandas, o Financeiro não mexe.
    insert into public.financial_entries (id, organization_id, account_id, direction, amount_cents, entry_date, origin)
      values ('${VENDA}', '${GOV_ORG}', '${CONTA_A}', 'in', 300, '2026-10-01', 'sale');
  `);
});

describe("quem pode escrever", () => {
  it("'ver' e manager sem linha recebem gf_forbidden e nada é lançado", () => {
    for (const u of [GOV_VIEWER, GOV_MANAGER]) {
      const r = como(u, criar("out", CONTA_A, 100, "2026-10-01", false));
      expect(r.ok).toBe(false);
      expect(r.saida).toContain("gf_forbidden");
    }
    expect(valor(`select count(*) from public.financial_entries where organization_id = '${GOV_ORG}' and origin = 'manual';`)).toBe("0");
  });

  it("'editar' cria — controle positivo; pago leva paid_at ao meio-dia de São Paulo", () => {
    const r = como(GOV_AGENT_A, criar("in", CONTA_A, 2500, "2026-10-05", true, PLANO_IN));
    expect(r.ok).toBe(true);
    expect(valor(`select status || '|' || to_char(paid_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') from public.financial_entries where id = '${r.saida}';`))
      .toBe("paid|2026-10-05 12:00");
  });

  it("conta de outra organização e categoria de direção oposta são recusadas", () => {
    const conta = como(GOV_AGENT_A, criar("out", CONTA_B, 100, "2026-10-01", false));
    expect(conta.saida).toContain("conta_invalida");
    const cat = como(GOV_AGENT_A, criar("out", CONTA_A, 100, "2026-10-01", false, PLANO_IN));
    expect(cat.saida).toContain("categoria_invalida");
  });
});

describe("parcelado", () => {
  it("100000 em 3 a partir de 31/01: 3 pendentes que somam 100000, sobra na 1ª, último dia do mês curto", () => {
    const r = como(GOV_AGENT_A, `public.fn_gf_parcelado_criar('${GOV_ORG}', 'out', '${CONTA_A}', null, 100000, 3, '2026-01-31', 'Notebook')`);
    expect(r.ok).toBe(true);
    const linhas = sql(`select p.numero || '|' || e.amount_cents || '|' || e.entry_date || '|' || e.status
      from public.gf_parcelas p join public.financial_entries e on e.id = p.entry_id
      where p.parcelamento_id = '${r.saida}' order by p.numero;`).split("\n");
    expect(linhas).toEqual(["1|33334|2026-01-31|pending", "2|33333|2026-02-28|pending", "3|33333|2026-03-31|pending"]);
    expect(valor(`select total_cents || '|' || parcelas from public.gf_parcelamentos where id = '${r.saida}';`)).toBe("100000|3");
  });

  it("excluir uma parcela pendente apaga o lançamento e a gf_parcelas", () => {
    const entry = valor(`select entry_id from public.gf_parcelas where numero = 3 limit 1;`);
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_excluir('${GOV_ORG}', '${entry}')`).ok).toBe(true);
    expect(valor(`select (select count(*) from public.financial_entries where id = '${entry}') + (select count(*) from public.gf_parcelas where entry_id = '${entry}');`)).toBe("0");
  });
});

describe("pago é imutável: edita e exclui só pendente; corrige por contra-lançamento", () => {
  let pago = "";
  beforeAll(() => {
    pago = como(GOV_AGENT_A, criar("in", CONTA_A, 10000, "2026-10-01", true)).saida;
  });

  it("editar e excluir um pago são recusados", () => {
    const e = como(GOV_AGENT_A, `public.fn_gf_lancamento_editar('${GOV_ORG}', '${pago}', 1, '2026-10-01', '${CONTA_A}', null, 'x')`);
    expect(e.saida).toContain("lancamento_pago_imutavel");
    const x = como(GOV_AGENT_A, `public.fn_gf_lancamento_excluir('${GOV_ORG}', '${pago}')`);
    expect(x.saida).toContain("lancamento_pago_imutavel");
    expect(valor(`select amount_cents from public.financial_entries where id = '${pago}';`)).toBe("10000");
  });

  it("editar pendente funciona; pagar vira pago e o segundo pagar é recusado", () => {
    const pend = como(GOV_AGENT_A, criar("out", CONTA_A, 700, "2026-10-02", false)).saida;
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_editar('${GOV_ORG}', '${pend}', 800, '2026-10-03', '${CONTA_A}', null, 'y')`).ok).toBe(true);
    expect(valor(`select amount_cents || '|' || entry_date from public.financial_entries where id = '${pend}';`)).toBe("800|2026-10-03");
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_pagar('${GOV_ORG}', '${pend}', '2026-10-04')`).ok).toBe(true);
    expect(valor(`select status || '|' || (paid_at at time zone 'America/Sao_Paulo')::date from public.financial_entries where id = '${pend}';`)).toBe("paid|2026-10-04");
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_pagar('${GOV_ORG}', '${pend}', null)`).saida).toContain("lancamento_ja_pago");
  });

  it("corrigir um pago cria o contra-lançamento e o novo; a soma líquida é o valor novo", () => {
    const r = como(GOV_AGENT_A, `public.fn_gf_lancamento_corrigir('${GOV_ORG}', '${pago}', 12000, '2026-10-01', '${CONTA_A}', null, 'corrigido')`);
    expect(r.ok).toBe(true);
    expect(valor(`select direction || '|' || amount_cents || '|' || status || '|' || origin from public.financial_entries where reverses_entry_id = '${pago}';`))
      .toBe("out|10000|paid|reversal");
    expect(valor(`select status || '|' || amount_cents from public.financial_entries where id = '${r.saida}';`)).toBe("paid|12000");
    expect(valor(`select sum(case direction when 'in' then amount_cents else -amount_cents end) from public.financial_entries
      where id in ('${pago}', '${r.saida}') or reverses_entry_id = '${pago}';`)).toBe("12000");
    // O já estornado não se corrige de novo (estornaria duas vezes).
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_corrigir('${GOV_ORG}', '${pago}', 1, '2026-10-01', '${CONTA_A}', null, 'x')`).saida).toContain("lancamento_nao_corrigivel");
  });

  it("'ver' não corrige nem paga", () => {
    expect(como(GOV_VIEWER, `public.fn_gf_lancamento_corrigir('${GOV_ORG}', '${pago}', 1, '2026-10-01', '${CONTA_A}', null, 'x')`).saida).toContain("gf_forbidden");
  });
});

describe("categorias, recorrências e acesso", () => {
  it("semear duas vezes dá a mesma contagem (idempotente)", () => {
    const primeira = como(GOV_ADMIN, `public.fn_gf_semear_categorias('${GOV_ORG}')`);
    expect(primeira.saida).toBe("21");
    const n = valor(`select count(*) from public.gf_categorias where organization_id = '${GOV_ORG}';`);
    expect(como(GOV_ADMIN, `public.fn_gf_semear_categorias('${GOV_ORG}')`).saida).toBe("0");
    expect(valor(`select count(*) from public.gf_categorias where organization_id = '${GOV_ORG}';`)).toBe(n);
    expect(valor(`select count(*) from public.account_plans where organization_id = '${GOV_ORG}' and is_active;`)).toBe("22");
  });

  it("recorrência: salva molde + fim e encerra", () => {
    const r = como(GOV_AGENT_A, `public.fn_gf_recorrencia_salvar('${GOV_ORG}', null, 'out', '${CONTA_A}', null, 9900, 31, 'Aluguel', '2027-12-31')`);
    expect(r.ok).toBe(true);
    expect(valor(`select r.day_of_month || '|' || g.fim from public.recurring_entries r join public.gf_recorrencias g on g.recurring_entry_id = r.id where r.id = '${r.saida}';`)).toBe("31|2027-12-31");
    expect(como(GOV_AGENT_A, `public.fn_gf_recorrencia_encerrar('${GOV_ORG}', '${r.saida}')`).ok).toBe(true);
    expect(valor(`select is_active::text from public.recurring_entries where id = '${r.saida}';`)).toBe("false");
  });

  it("categoria: salva com grupo; receita só como entrada", () => {
    const ok = como(GOV_AGENT_A, `public.fn_gf_categoria_salvar('${GOV_ORG}', null, 'Hospedagem', 'out', 'assinaturas', false)`);
    expect(valor(`select grupo from public.gf_categorias where account_plan_id = '${ok.saida}';`)).toBe("assinaturas");
    expect(como(GOV_AGENT_A, `public.fn_gf_categoria_salvar('${GOV_ORG}', null, 'Errada', 'out', 'receita', false)`).saida).toContain("grupo_invalido");
  });

  it("acesso: manager é recusado; admin grava, 'nenhum' apaga; não-membro recusado", () => {
    expect(como(GOV_MANAGER, `public.fn_gf_acesso_definir('${GOV_ORG}', '${GOV_MANAGER}', 'editar')`).saida).toContain("gf_forbidden");
    expect(como(GOV_AGENT_A, `public.fn_gf_acesso_definir('${GOV_ORG}', '${GOV_MANAGER}', 'editar')`).saida).toContain("gf_forbidden");
    const linha = () => valor(`select coalesce((select nivel from public.gf_acessos where organization_id = '${GOV_ORG}' and user_id = '${GOV_MANAGER}'), 'nenhum');`);
    expect(como(GOV_ADMIN, `public.fn_gf_acesso_definir('${GOV_ORG}', '${GOV_MANAGER}', 'ver')`).ok).toBe(true);
    expect(linha()).toBe("ver");
    expect(como(GOV_ADMIN, `public.fn_gf_acesso_definir('${GOV_ORG}', '${GOV_MANAGER}', 'nenhum')`).ok).toBe(true);
    expect(linha()).toBe("nenhum");
    expect(como(GOV_ADMIN, `public.fn_gf_acesso_definir('${GOV_ORG}', '${FORA}', 'editar')`).saida).toContain("usuario_nao_membro");
  });
});

describe("recebimento de contrato segue o acesso do Financeiro", () => {
  it("'ver' recebe contratos_forbidden e nada é lançado; 'editar' recebe — controle positivo", () => {
    const receber = `public.fn_contratos_cobranca_receber('${GOV_ORG}', '${COB}', '${CONTA_A}', '2026-10-10')`;
    const r = como(GOV_VIEWER, receber);
    expect(r.ok).toBe(false);
    expect(r.saida).toContain("contratos_forbidden");
    expect(valor(`select situacao from public.contrato_cobrancas where id = '${COB}';`)).toBe("a_receber");
    expect(como(GOV_AGENT_A, receber).ok).toBe(true);
    expect(valor(`select situacao from public.contrato_cobrancas where id = '${COB}';`)).toBe("recebida");
  });
});

describe("corrigir o recebimento de uma cobrança de contrato", () => {
  it("a cobrança passa a apontar para o lançamento novo e o original fica estornado", () => {
    const rec = como(GOV_AGENT_A, `public.fn_contratos_cobranca_receber('${GOV_ORG}', '${COB2}', '${CONTA_A}', '2026-10-10')`);
    expect(rec.ok).toBe(true);
    const original = valor(`select financial_entry_id from public.contrato_cobrancas where id = '${COB2}';`);
    const r = como(GOV_AGENT_A, `public.fn_gf_lancamento_corrigir('${GOV_ORG}', '${original}', 550, '2026-10-10', '${CONTA_A}', null, 'Cobrança 2')`);
    expect(r.ok).toBe(true);
    expect(valor(`select financial_entry_id from public.contrato_cobrancas where id = '${COB2}';`)).toBe(r.saida);
    expect(valor(`select count(*) from public.financial_entries where reverses_entry_id = '${original}' and origin = 'reversal';`)).toBe("1");
  });
});

describe("lançamento de comanda é das Comandas", () => {
  it("editar, pagar e excluir recusam lancamento_de_comanda e nada muda", () => {
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_editar('${GOV_ORG}', '${VENDA}', 1, '2026-10-01', '${CONTA_A}', null, 'x')`).saida).toContain("lancamento_de_comanda");
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_pagar('${GOV_ORG}', '${VENDA}', null)`).saida).toContain("lancamento_de_comanda");
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_excluir('${GOV_ORG}', '${VENDA}')`).saida).toContain("lancamento_de_comanda");
    expect(valor(`select amount_cents || '|' || status from public.financial_entries where id = '${VENDA}';`)).toBe("300|pending");
  });
});

describe("fim da recorrência (fn_gf_encerrar_recorrencias_vencidas, cron gf-recorrencias)", () => {
  const HOJE = "(now() at time zone 'America/Sao_Paulo')::date";
  beforeAll(() => {
    sql(`
      insert into public.recurring_entries (id, organization_id, name, account_id, direction, amount_cents, day_of_month)
        values ('${REC}', '${GOV_ORG}', 'Assinatura', '${CONTA_A}', 'out', 100, 1);
      insert into public.gf_recorrencias (recurring_entry_id, organization_id, fim) values ('${REC}', '${GOV_ORG}', ${HOJE} - 1);
      insert into public.financial_entries (id, organization_id, account_id, direction, amount_cents, entry_date, status, paid_at, origin, recurring_entry_id) values
        ('${REC_PEND_DEPOIS}', '${GOV_ORG}', '${CONTA_A}', 'out', 100, ${HOJE}, 'pending', null, 'recurring', '${REC}'),
        ('${REC_PAGO_DEPOIS}', '${GOV_ORG}', '${CONTA_A}', 'out', 100, ${HOJE} + 1, 'paid', now(), 'recurring', '${REC}'),
        ('${REC_PEND_ANTES}', '${GOV_ORG}', '${CONTA_A}', 'out', 100, ${HOJE} - 5, 'pending', null, 'recurring', '${REC}');
    `);
  });

  it("authenticated não executa (só service_role)", () => {
    expect(como(GOV_ADMIN, `public.fn_gf_encerrar_recorrencias_vencidas()`).saida).toContain("permission denied");
  });

  it("molde com fim ontem é desligado; pendente depois do fim apagado; pago e pendente até o fim intactos", () => {
    expect(valor(`set role service_role; select public.fn_gf_encerrar_recorrencias_vencidas();`)).toBe("1");
    expect(valor(`select is_active::text from public.recurring_entries where id = '${REC}';`)).toBe("false");
    const restantes = sql(`select id from public.financial_entries where recurring_entry_id = '${REC}' order by id;`).split("\n");
    expect(restantes).toEqual([REC_PAGO_DEPOIS, REC_PEND_ANTES]);
    expect(valor(`set role service_role; select public.fn_gf_encerrar_recorrencias_vencidas();`)).toBe("0"); // idempotente
  });
});

describe("lançamento pendente de recorrência (o gerador recriaria o que faltasse)", () => {
  const MOLDE = "c3c3c3c3-8888-4000-8000-000000000010";
  const PEND = "c3c3c3c3-8888-4000-8000-000000000011";
  beforeAll(() => {
    sql(`
      insert into public.recurring_entries (id, organization_id, name, account_id, direction, amount_cents, day_of_month)
        values ('${MOLDE}', '${GOV_ORG}', 'Aluguel', '${CONTA_A}', 'out', 100, 5);
      insert into public.financial_entries (id, organization_id, account_id, direction, amount_cents, entry_date, status, origin, recurring_entry_id)
        values ('${PEND}', '${GOV_ORG}', '${CONTA_A}', 'out', 100, '2026-11-05', 'pending', 'recurring', '${MOLDE}');
    `);
  });

  it("excluir é recusado (lancamento_recorrente) e a linha fica", () => {
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_excluir('${GOV_ORG}', '${PEND}')`).saida).toContain("lancamento_recorrente");
    expect(valor(`select count(*) from public.financial_entries where id = '${PEND}';`)).toBe("1");
  });

  it("editar: mudar a data é recusado; valor/descrição/conta passam", () => {
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_editar('${GOV_ORG}', '${PEND}', 100, '2026-11-06', '${CONTA_A}', null, 'x')`).saida).toContain("lancamento_recorrente");
    expect(como(GOV_AGENT_A, `public.fn_gf_lancamento_editar('${GOV_ORG}', '${PEND}', 250, '2026-11-05', '${CONTA_A}', null, 'novo')`).ok).toBe(true);
    expect(valor(`select amount_cents || '|' || entry_date || '|' || description from public.financial_entries where id = '${PEND}';`)).toBe("250|2026-11-05|novo");
  });
});
