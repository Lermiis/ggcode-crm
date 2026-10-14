/** Cálculos puros do Financeiro (spec §4). Centavos; datas civis YYYY-MM-DD; meses YYYY-MM. */
import { competenciaMensal, somarMeses } from "@/lib/contratos/regras";

import type { CobrancaContrato, ContratoResumo, Grupo, Lancamento, Metrica, Recorrencia, VisaoGeral } from "./tipos";

const soma = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const nulo = (motivo: string): Metrica => ({ valor: null, motivo });
const ok = (valor: number): Metrica => ({ valor });
const mesDe = (d: string | null | undefined) => d?.slice(0, 7) ?? "";
const addMes = (mes: string, n: number) => somarMeses(`${mes}-01`, n).slice(0, 7);
const mesesDe = (de: string, ate: string) => {
  const [a1, m1] = de.split("-").map(Number) as [number, number];
  const [a2, m2] = ate.split("-").map(Number) as [number, number];
  return (a2 - a1) * 12 + (m2 - m1) + 1;
};
const noPeriodo = (d: string | null | undefined, de: string, ate: string) => !!d && mesDe(d) >= de && mesDe(d) <= ate;

/** Estorno e estornado se anulam: saem de todos os cálculos. */
function semEstornos(ls: Lancamento[]): Lancamento[] {
  const estornados = new Set(ls.map((l) => l.reverses_entry_id).filter((x): x is string => !!x));
  return ls.filter((l) => !l.reverses_entry_id && !estornados.has(l.id));
}

const pagoCaixa = (l: Lancamento, de: string, ate = de) => l.status === "paid" && noPeriodo(l.paid_date, de, ate);

export function visaoGeral(i: { mes: string; hoje: string; lancamentos: Lancamento[]; cobrancas: CobrancaContrato[]; saldoInicialContas: number }): VisaoGeral {
  const ls = semEstornos(i.lancamentos);
  const ins = ls.filter((l) => l.direction === "in");
  const outs = ls.filter((l) => l.direction === "out");
  const faturado =
    soma(ins.filter((l) => !l.cobranca_contrato && mesDe(l.entry_date) === i.mes), (l) => l.amount_cents) +
    soma(i.cobrancas.filter((c) => c.situacao !== "cancelada" && mesDe(c.vencimento) === i.mes), (c) => c.valor_cents);
  const recebido = soma(ins.filter((l) => pagoCaixa(l, i.mes)), (l) => l.amount_cents);
  const custos = soma(outs.filter((l) => mesDe(l.entry_date) === i.mes), (l) => l.amount_cents);
  const lucro = recebido - soma(outs.filter((l) => pagoCaixa(l, i.mes)), (l) => l.amount_cents);
  // pendente de cobrança de contrato é contado pela própria cobrança
  const pend = ins.filter((l) => l.status === "pending" && !l.cobranca_contrato);
  const cobs = i.cobrancas.filter((c) => c.situacao === "a_receber");
  const aReceber = soma(pend.filter((l) => l.entry_date >= i.hoje), (l) => l.amount_cents) + soma(cobs.filter((c) => c.vencimento >= i.hoje), (c) => c.valor_cents);
  const atrasado = soma(pend.filter((l) => l.entry_date < i.hoje), (l) => l.amount_cents) + soma(cobs.filter((c) => c.vencimento < i.hoje), (c) => c.valor_cents);
  const aPagar = soma(outs.filter((l) => l.status === "pending"), (l) => l.amount_cents);
  const saldo = i.saldoInicialContas + soma(ls.filter((l) => l.status === "paid"), (l) => (l.direction === "in" ? l.amount_cents : -l.amount_cents));
  return { faturado, recebido, custos, lucro, margem: recebido > 0 ? ok(r1((lucro / recebido) * 100)) : nulo("Sem receita no mês."), aReceber, atrasado, aPagar, saldo };
}

export function serie12Meses(i: { ateMes: string; lancamentos: Lancamento[] }): Array<{ mes: string; receita: number; custos: number; lucro: number }> {
  const ls = semEstornos(i.lancamentos);
  return Array.from({ length: 12 }, (_, k) => {
    const mes = addMes(i.ateMes, k - 11);
    const receita = soma(ls.filter((l) => l.direction === "in" && pagoCaixa(l, mes)), (l) => l.amount_cents);
    const custos = soma(ls.filter((l) => l.direction === "out" && pagoCaixa(l, mes)), (l) => l.amount_cents);
    return { mes, receita, custos, lucro: receita - custos };
  });
}

export function fluxoProjetado(i: {
  hoje: string; mesesFuturos: number; saldoAtual: number; lancamentos: Lancamento[]; recorrencias: Recorrencia[]; contratos: ContratoResumo[]; cobrancas: CobrancaContrato[];
}): Array<{ mes: string; entradas: number; saidas: number; saldo: number; projetado: boolean }> {
  const ls = semEstornos(i.lancamentos);
  const atual = mesDe(i.hoje);
  let saldo = i.saldoAtual;
  const out: Array<{ mes: string; entradas: number; saidas: number; saldo: number; projetado: boolean }> = [];
  for (let k = 0; k <= i.mesesFuturos; k++) {
    const mes = addMes(atual, k);
    const pend = ls.filter((l) => l.status === "pending" && !l.cobranca_contrato);
    let entradas = 0;
    let saidas = 0;
    if (k === 0) {
      // realizado do mês (já está no saldo atual) + pendentes do mês e atrasados (ponytail: atrasados caem no mês corrente)
      const real = ls.filter((l) => pagoCaixa(l, mes));
      entradas = soma(real.filter((l) => l.direction === "in"), (l) => l.amount_cents);
      saidas = soma(real.filter((l) => l.direction === "out"), (l) => l.amount_cents);
      const p = pend.filter((l) => mesDe(l.entry_date) <= mes);
      const pe = soma(p.filter((l) => l.direction === "in"), (l) => l.amount_cents) + soma(i.cobrancas.filter((c) => c.situacao === "a_receber" && mesDe(c.vencimento) <= mes), (c) => c.valor_cents);
      const ps = soma(p.filter((l) => l.direction === "out"), (l) => l.amount_cents);
      entradas += pe;
      saidas += ps;
      saldo += pe - ps;
    } else {
      const doMes = ls.filter((l) => mesDe(l.entry_date) === mes);
      const p = pend.filter((l) => mesDe(l.entry_date) === mes);
      const [ano, m] = mes.split("-").map(Number) as [number, number];
      const rec = i.recorrencias.filter(
        (r) =>
          r.is_active &&
          (!r.fim || r.fim >= competenciaMensal(ano, m, r.day_of_month).vencimento) &&
          !doMes.some((l) => l.origin === "recurring" && l.direction === r.direction && l.amount_cents === r.amount_cents),
      );
      const cobsMes = i.cobrancas.filter((c) => c.situacao !== "cancelada" && mesDe(c.vencimento) === mes);
      const mensal = i.contratos.filter(
        (c) => c.situacao === "ativo" && mesDe(c.inicio) <= mes && (!c.fim || mesDe(c.fim) >= mes) && !cobsMes.some((b) => b.contrato_id === c.id),
      );
      entradas =
        soma(p.filter((l) => l.direction === "in"), (l) => l.amount_cents) +
        soma(rec.filter((r) => r.direction === "in"), (r) => r.amount_cents) +
        soma(mensal, (c) => c.mensal_cents) +
        soma(cobsMes.filter((c) => c.situacao === "a_receber"), (c) => c.valor_cents);
      saidas = soma(p.filter((l) => l.direction === "out"), (l) => l.amount_cents) + soma(rec.filter((r) => r.direction === "out"), (r) => r.amount_cents);
      saldo += entradas - saidas;
    }
    out.push({ mes, entradas, saidas, saldo, projetado: k > 0 });
  }
  return out;
}

const DESPESAS: Array<[string, string, Grupo]> = [
  ["pessoal", "Pessoal", "pessoal"],
  ["assinaturas", "Assinaturas e ferramentas", "assinaturas"],
  ["marketing", "Marketing", "marketing"],
  ["estrutura", "Estrutura", "estrutura"],
  ["outras_despesas", "Outras despesas", "outras_despesas"],
];

const totalGrupo = (ls: Lancamento[], grupo: Grupo) =>
  soma(ls.filter((l) => l.grupo === grupo && l.direction === (grupo === "receita" ? "in" : "out")), (l) => l.amount_cents);

export function dre(i: { mes: string; lancamentos: Lancamento[] }): Array<{ chave: string; rotulo: string; valor: number; pct: number | null; destaque?: boolean }> {
  const ls = semEstornos(i.lancamentos).filter((l) => mesDe(l.entry_date) === i.mes);
  const bruta = totalGrupo(ls, "receita");
  const liquida = bruta - totalGrupo(ls, "imposto");
  const margem = liquida - totalGrupo(ls, "custo_variavel");
  const despesas = DESPESAS.map(([chave, rotulo, g]) => ({ chave, rotulo, valor: totalGrupo(ls, g) }));
  const resultado = margem - soma(despesas, (d) => d.valor);
  const pct = (v: number) => (bruta === 0 ? null : r1((v / bruta) * 100));
  const lin = (chave: string, rotulo: string, valor: number, destaque?: boolean) => ({ chave, rotulo, valor, pct: pct(valor), ...(destaque ? { destaque } : {}) });
  return [
    lin("receita_bruta", "Receita bruta", bruta),
    lin("impostos", "Impostos", totalGrupo(ls, "imposto")),
    lin("receita_liquida", "Receita líquida", liquida, true),
    lin("custos_variaveis", "Custos variáveis", totalGrupo(ls, "custo_variavel")),
    lin("margem_contribuicao", "Margem de contribuição", margem, true),
    ...despesas.map((d) => lin(d.chave, d.rotulo, d.valor)),
    lin("resultado", "Resultado", resultado, true),
  ];
}

type ChaveMetrica = "mrr" | "ticketMedio" | "churn" | "clientesNovos" | "cac" | "ltv" | "ltvCac" | "payback" | "roiEmpresa" | "roiMarketing" | "pontoEquilibrio";

export function metricas(i: { de: string; ate: string; lancamentos: Lancamento[]; contratos: ContratoResumo[]; ganhosSemContrato: number }): Record<ChaveMetrica, Metrica> {
  const { de, ate, contratos } = i;
  const nMeses = mesesDe(de, ate);
  const inicio = `${de}-01`;
  const ls = semEstornos(i.lancamentos);
  const ativos = contratos.filter((c) => c.situacao === "ativo");
  const mrr = soma(ativos, (c) => c.mensal_cents);
  const novos = contratos.filter((c) => noPeriodo(c.criado_em, de, ate));
  const nNovos = contratos.length === 0 ? i.ganhosSemContrato : novos.length;

  const recebidos = ls.filter((l) => l.direction === "in" && pagoCaixa(l, de, ate));
  const identificados = recebidos.filter((l) => l.cliente_id);
  const clientes = new Set(recebidos.map((l) => l.cliente_id).filter((x): x is string => !!x));
  const ticketMedio = clientes.size === 0 ? nulo("Nenhum recebimento identificado por cliente.") : ok(Math.round(soma(identificados, (l) => l.amount_cents) / clientes.size));

  const noInicio = contratos.filter((c) => c.criado_em.slice(0, 10) < inicio && !(c.encerrado_em && c.encerrado_em.slice(0, 10) < inicio));
  const encerrados = contratos.filter((c) => c.situacao !== "ativo" && noPeriodo(c.encerrado_em, de, ate));
  const churn = noInicio.length === 0 ? nulo("Sem contratos ativos no início do período.") : ok(r1(((encerrados.length / noInicio.length) * 100) / nMeses));

  const gasto = soma(ls.filter((l) => l.direction === "out" && l.conta_cac && noPeriodo(l.entry_date, de, ate)), (l) => l.amount_cents);
  const cac = gasto === 0 ? nulo("Lance os gastos de marketing (categorias de marketing).") : nNovos === 0 ? nulo("Nenhum cliente novo no período.") : ok(Math.round(gasto / nNovos));

  const arpa = ativos.length === 0 ? null : mrr / ativos.length;
  const duracoes = contratos
    .filter((c) => c.fim)
    .map((c) => mesesDe(mesDe(c.inicio), mesDe(c.fim)) - 1);
  let ltv: Metrica;
  if (arpa === null) ltv = nulo("Sem contratos ativos.");
  else if (churn.valor && churn.valor > 0) ltv = ok(Math.round(arpa * (100 / churn.valor)));
  else if (duracoes.length > 0 && soma(duracoes, (d) => d) > 0) ltv = ok(Math.round(arpa * (soma(duracoes, (d) => d) / duracoes.length)));
  else ltv = nulo("Sem churn nem contratos encerrados para estimar a permanência.");

  const ltvCac = ltv.valor === null ? nulo(ltv.motivo ?? "Sem LTV.") : cac.valor === null || cac.valor <= 0 ? nulo(cac.motivo ?? "CAC indisponível.") : ok(r2(ltv.valor / cac.valor));
  const payback = cac.valor === null || cac.valor <= 0 ? nulo(cac.motivo ?? "CAC indisponível.") : !arpa ? nulo("Sem receita média por cliente.") : ok(r1(cac.valor / arpa));

  const doPeriodo = ls.filter((l) => noPeriodo(l.entry_date, de, ate));
  const receita = totalGrupo(doPeriodo, "receita");
  const custos = soma(doPeriodo.filter((l) => l.direction === "out"), (l) => l.amount_cents);
  const roiEmpresa = custos === 0 ? nulo("Sem custos no período.") : ok(r1(((receita - custos) / custos) * 100));

  const idsNovos = new Set(novos.map((c) => c.id));
  const roiMarketing =
    gasto === 0 ? nulo("Lance os gastos de marketing (categorias de marketing).")
    : idsNovos.size === 0 ? nulo("Nenhum cliente novo identificado.")
    : ok(r1(((soma(recebidos.filter((l) => l.cliente_id && idsNovos.has(l.cliente_id)), (l) => l.amount_cents) - gasto) / gasto) * 100));

  // ponytail: despesas fixas mensalizadas pela média do período; sem rateio de sazonalidade
  const fixas = soma(doPeriodo.filter((l) => l.direction === "out" && (["pessoal", "assinaturas", "marketing", "estrutura", "outras_despesas"] as Grupo[]).includes(l.grupo)), (l) => l.amount_cents) / nMeses;
  const margemPct = receita === 0 ? 0 : (receita - totalGrupo(doPeriodo, "imposto") - totalGrupo(doPeriodo, "custo_variavel")) / receita;
  const pontoEquilibrio = margemPct <= 0 ? nulo("Sem margem de contribuição no período.") : ok(Math.round(fixas / margemPct));

  return { mrr: ok(mrr), ticketMedio, churn, clientesNovos: ok(nNovos), cac, ltv, ltvCac, payback, roiEmpresa, roiMarketing, pontoEquilibrio };
}
