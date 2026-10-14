/**
 * Montagem dos dados do Financeiro para os cálculos puros (servidor, sessão do usuário + RLS).
 *
 * Saldo: o PostgREST desta base NÃO tem agregados (config.toml sem aggregates; nenhum `.sum()` no
 * código), então carregamos TODOS os lançamentos da org paginando de 1000 em 1000 (max_rows = 1000)
 * e deixamos `visaoGeral`/`fluxoProjetado` somarem.
 * ponytail: teto de TETO_LINHAS (50 mil lançamentos); acima disso lança erro em vez de dar saldo
 * errado. Upgrade: RPC SQL de soma por conta quando alguma org chegar perto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloAusente } from "@/lib/contratos/modulo";
import { hojeNoFuso } from "@/lib/contratos/regras";

import type { CobrancaContrato, ContratoResumo, Grupo, Lancamento, Recorrencia } from "./tipos";

type Db = Pick<SupabaseClient, "from">;
const PAGINA = 1000;
const TETO_LINHAS = 50_000;

/** timestamptz -> data civil YYYY-MM-DD em America/Sao_Paulo. */
export const dataCivil = (ts: string | null | undefined): string | null => (ts ? hojeNoFuso(new Date(ts)) : null);

/** Categoria sem linha em gf_categorias: receita para entrada, outras despesas para saída. */
export const grupoPadrao = (direction: "in" | "out"): Grupo => (direction === "in" ? "receita" : "outras_despesas");

export interface LinhaLancamento {
  id: string; direction: "in" | "out"; amount_cents: number; entry_date: string; status: "pending" | "paid";
  paid_at: string | null; origin: string; reverses_entry_id: string | null; description: string | null;
  account_id: string; account_plan_id: string | null; recurring_entry_id: string | null;
}
export interface Detalhe {
  description: string | null; account_id: string; recorrente: boolean;
  categoria: { id: string; nome: string; grupo: Grupo } | null;
  conta: { id: string; nome: string };
  parcela: { numero: number; total: number } | null;
}
export interface Contexto {
  categorias: Map<string, { nome: string; grupo: Grupo; conta_cac: boolean }>;
  contratoDoLancamento: Map<string, string>; // financial_entry_id -> contrato_id
  contas: Map<string, string>;
  parcelas: Map<string, { numero: number; total: number }>;
}

/** Linha do banco -> Lancamento do cálculo (+ detalhes para a lista). Pura. */
export function mapearLancamento(l: LinhaLancamento, ctx: Contexto): { lancamento: Lancamento; detalhe: Detalhe } {
  const cat = l.account_plan_id ? ctx.categorias.get(l.account_plan_id) : undefined;
  const contrato = ctx.contratoDoLancamento.get(l.id) ?? null;
  return {
    lancamento: {
      id: l.id, direction: l.direction, amount_cents: Number(l.amount_cents), entry_date: l.entry_date, status: l.status,
      paid_date: dataCivil(l.paid_at), grupo: cat?.grupo ?? grupoPadrao(l.direction), conta_cac: cat?.conta_cac ?? false,
      origin: l.origin, reverses_entry_id: l.reverses_entry_id, cobranca_contrato: contrato !== null, cliente_id: contrato,
    },
    detalhe: {
      description: l.description, account_id: l.account_id, recorrente: l.recurring_entry_id !== null,
      categoria: l.account_plan_id && cat ? { id: l.account_plan_id, nome: cat.nome, grupo: cat.grupo } : null,
      conta: { id: l.account_id, nome: ctx.contas.get(l.account_id) ?? "—" },
      parcela: ctx.parcelas.get(l.id) ?? null,
    },
  };
}

/** Contrato não ativo: o `updated_at` vira a data civil de encerramento. */
export function mapearContrato(c: { id: string; inicio: string; fim: string | null; situacao: ContratoResumo["situacao"]; created_at: string; updated_at: string; contrato_formas?: Array<{ tipo: string; valor_cents: number; ativa: boolean }> | null }): ContratoResumo {
  return {
    id: c.id, inicio: c.inicio, fim: c.fim, situacao: c.situacao, criado_em: dataCivil(c.created_at) ?? c.inicio,
    encerrado_em: c.situacao === "ativo" ? null : dataCivil(c.updated_at),
    mensal_cents: (c.contrato_formas ?? []).filter((f) => f.tipo === "mensalidade" && f.ativa).reduce((s, f) => s + Number(f.valor_cents), 0),
  };
}

type Res<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>;

/** Pagina até esgotar; lança o erro do PostgREST (as rotas mapeiam). `opcional`: tabela ausente = vazio. */
async function paginar<T>(q: (de: number, ate: number) => Res<T>, opcional = false): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await q(de, de + PAGINA - 1);
    if (error) {
      if (opcional && moduloAusente(error)) return [];
      throw error;
    }
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGINA) return out;
    if (out.length >= TETO_LINHAS) throw Object.assign(new Error("Volume acima do suportado."), { code: "gf_volume" });
  }
}

const tudo = <T>(db: Db, tabela: string, cols: string, orgId: string, opcional = false, ordem = "id") =>
  paginar<T>((a, b) => db.from(tabela).select(cols).eq("organization_id", orgId).order(ordem).range(a, b) as unknown as Res<T>, opcional);

export async function carregarCategorias(db: Db, orgId: string): Promise<Contexto["categorias"]> {
  const planos = await tudo<{ id: string; name: string }>(db, "account_plans", "id, name", orgId);
  const gfs = await tudo<{ account_plan_id: string; grupo: Grupo; conta_cac: boolean }>(db, "gf_categorias", "account_plan_id, grupo, conta_cac", orgId, false, "account_plan_id");
  const porPlano = new Map(gfs.map((g) => [g.account_plan_id, g]));
  return new Map(planos.map((p) => [p.id, { nome: p.name, grupo: porPlano.get(p.id)?.grupo ?? "outras_despesas", conta_cac: porPlano.get(p.id)?.conta_cac ?? false }]));
}

export async function carregarContas(db: Db, orgId: string) {
  return tudo<{ id: string; name: string; opening_balance_cents: number; is_active: boolean }>(db, "financial_accounts", "id, name, opening_balance_cents, is_active", orgId);
}

export async function carregarCobrancas(db: Db, orgId: string): Promise<Array<CobrancaContrato & { financial_entry_id: string | null }>> {
  const rows = await tudo<{ contrato_id: string; vencimento: string; valor_cents: number; situacao: CobrancaContrato["situacao"]; recebida_em: string | null; financial_entry_id: string | null }>(
    db, "contrato_cobrancas", "contrato_id, vencimento, valor_cents, situacao, recebida_em, financial_entry_id", orgId, true);
  return rows.map((r) => ({ ...r, valor_cents: Number(r.valor_cents) }));
}

export async function carregarContratos(db: Db, orgId: string): Promise<ContratoResumo[]> {
  const rows = await tudo<Parameters<typeof mapearContrato>[0]>(db, "contratos", "id, inicio, fim, situacao, created_at, updated_at, contrato_formas(tipo, valor_cents, ativa)", orgId, true);
  return rows.map(mapearContrato);
}

export async function carregarRecorrencias(db: Db, orgId: string): Promise<Array<Recorrencia & { name: string; account_id: string; account_plan_id: string | null }>> {
  const cats = await carregarCategorias(db, orgId);
  const rec = await tudo<{ id: string; name: string; direction: "in" | "out"; amount_cents: number; day_of_month: number; is_active: boolean; account_id: string; account_plan_id: string | null }>(
    db, "recurring_entries", "id, name, direction, amount_cents, day_of_month, is_active, account_id, account_plan_id", orgId);
  const gf = await tudo<{ recurring_entry_id: string; fim: string | null }>(db, "gf_recorrencias", "recurring_entry_id, fim", orgId, false, "recurring_entry_id");
  const fim = new Map(gf.map((g) => [g.recurring_entry_id, g.fim]));
  return rec.map((r) => ({
    ...r, amount_cents: Number(r.amount_cents), fim: fim.get(r.id) ?? null,
    grupo: (r.account_plan_id && cats.get(r.account_plan_id)?.grupo) || grupoPadrao(r.direction),
  }));
}

/** Todos os lançamentos da org (ver nota de saldo no topo) já no formato do cálculo. */
export async function carregarLancamentos(db: Db, orgId: string): Promise<{ lancamentos: Lancamento[]; detalhes: Map<string, Detalhe> }> {
  const [categorias, contasRows, cobrancas, parcRows, parcelamentos, linhas] = await Promise.all([
    carregarCategorias(db, orgId),
    carregarContas(db, orgId),
    carregarCobrancas(db, orgId),
    tudo<{ entry_id: string; numero: number; parcelamento_id: string }>(db, "gf_parcelas", "entry_id, numero, parcelamento_id", orgId, false, "entry_id"),
    tudo<{ id: string; parcelas: number }>(db, "gf_parcelamentos", "id, parcelas", orgId),
    tudo<LinhaLancamento>(db, "financial_entries",
      "id, direction, amount_cents, entry_date, status, paid_at, origin, reverses_entry_id, description, account_id, account_plan_id, recurring_entry_id", orgId),
  ]);
  const total = new Map(parcelamentos.map((p) => [p.id, p.parcelas]));
  const ctx: Contexto = {
    categorias,
    contas: new Map(contasRows.map((c) => [c.id, c.name])),
    contratoDoLancamento: new Map(cobrancas.filter((c) => c.financial_entry_id).map((c) => [c.financial_entry_id as string, c.contrato_id])),
    parcelas: new Map(parcRows.map((p) => [p.entry_id, { numero: p.numero, total: total.get(p.parcelamento_id) ?? p.numero }])),
  };
  const lancamentos: Lancamento[] = [];
  const detalhes = new Map<string, Detalhe>();
  for (const l of linhas) {
    const m = mapearLancamento(l, ctx);
    lancamentos.push(m.lancamento);
    detalhes.set(l.id, m.detalhe);
  }
  return { lancamentos, detalhes };
}

/** Saldo por conta = saldo inicial + pagos (entrada soma, saída subtrai); estorno já é lançamento oposto. */
export function saldosPorConta(contas: Array<{ id: string; opening_balance_cents: number }>, lancamentos: Lancamento[], detalhes: Map<string, Detalhe>): Map<string, number> {
  const m = new Map(contas.map((c) => [c.id, Number(c.opening_balance_cents)]));
  for (const l of lancamentos) {
    const conta = detalhes.get(l.id)?.account_id;
    if (l.status === "paid" && conta && m.has(conta)) m.set(conta, (m.get(conta) ?? 0) + (l.direction === "in" ? l.amount_cents : -l.amount_cents));
  }
  return m;
}

export const saldoInicialTotal = (contas: Array<{ opening_balance_cents: number }>) => contas.reduce((s, c) => s + Number(c.opening_balance_cents), 0);

const proximoMes = (m: string) => {
  const [a, n] = m.split("-").map(Number) as [number, number];
  return n === 12 ? `${a + 1}-01` : `${a}-${String(n + 1).padStart(2, "0")}`;
};

/** Negócios ganhos no período (usado só quando a org não tem contratos). Meses YYYY-MM; borda em UTC-3. */
export async function contarGanhos(db: Db, orgId: string, de: string, ate: string): Promise<number> {
  const { count, error } = await db.from("crm_leads").select("id", { count: "exact", head: true })
    .eq("organization_id", orgId).eq("status", "won").gte("closed_at", `${de}-01T03:00:00Z`).lt("closed_at", `${proximoMes(ate)}-01T03:00:00Z`);
  if (error) throw error;
  return count ?? 0;
}
