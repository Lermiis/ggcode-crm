/**
 * Regras do módulo Contratos — puras, sem banco, para serem testadas sem esperar o calendário.
 * Datas são CIVIS (YYYY-MM-DD) no fuso de São Paulo: o vencimento é um dia, não um instante.
 */
import type { CobrancaNova, FormaEntrada, SituacaoCobranca, SituacaoExibida } from "./tipos";

const FUSO = "America/Sao_Paulo";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function hojeNoFuso(agora: Date = new Date()): string {
  return agora.toLocaleDateString("en-CA", { timeZone: FUSO });
}

const pad = (n: number) => String(n).padStart(2, "0");
const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const ymd = (data: string): [number, number, number] => data.split("-").map(Number) as [number, number, number];

export function dividirEmParcelas(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error("parcelas deve ser inteiro >= 1");
  const base = Math.floor(total / n);
  const sobra = total - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + sobra : base));
}

export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = ymd(data);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ano = alvo.getUTCFullYear();
  const mes = alvo.getUTCMonth() + 1;
  return `${ano}-${pad(mes)}-${pad(Math.min(d, ultimoDia(ano, mes)))}`;
}

export function competenciaMensal(ano: number, mes: number, dia: number): { competencia: string; vencimento: string } {
  return { competencia: `${ano}-${pad(mes)}`, vencimento: `${ano}-${pad(mes)}-${pad(Math.min(dia, ultimoDia(ano, mes)))}` };
}

function mensalidade(ano: number, mes: number, dia: number, valor: number): CobrancaNova {
  const { competencia, vencimento } = competenciaMensal(ano, mes, dia);
  return { competencia, descricao: `Mensalidade ${MESES[mes - 1]}/${String(ano).slice(2)}`, vencimento, valor_cents: valor };
}

const proximoMes = (ano: number, mes: number): [number, number] => (mes === 12 ? [ano + 1, 1] : [ano, mes + 1]);

export function cobrancasIniciais(forma: FormaEntrada, hoje: string): CobrancaNova[] {
  if (forma.tipo === "evento") return [];
  if (forma.tipo === "avulso") {
    return [{ competencia: "avulso", descricao: forma.descricao?.trim() || "Avulso", vencimento: forma.primeiro_vencimento!, valor_cents: forma.valor_cents }];
  }
  if (forma.tipo === "implantacao") {
    const n = forma.parcelas ?? 1;
    return dividirEmParcelas(forma.valor_cents, n).map((valor, i) => ({
      competencia: `parcela-${i + 1}`,
      descricao: n === 1 ? "Implantação" : `Implantação ${i + 1}/${n}`,
      vencimento: somarMeses(forma.primeiro_vencimento!, i),
      valor_cents: valor,
    }));
  }
  // mensalidade: a do mês corrente só se o vencimento ainda não passou
  const [a, m] = ymd(hoje);
  const atual = mensalidade(a, m, forma.dia_vencimento!, forma.valor_cents);
  if (atual.vencimento >= hoje) return [atual];
  const [a2, m2] = proximoMes(a, m);
  return [mensalidade(a2, m2, forma.dia_vencimento!, forma.valor_cents)];
}

export function mensalidadesDevidas(
  f: { dia_vencimento: number; valor_cents: number },
  contrato: { inicio: string; fim: string | null },
  hoje: string,
): CobrancaNova[] {
  const [a, m] = ymd(hoje);
  const [a2, m2] = proximoMes(a, m);
  const desde = contrato.inicio > hoje ? contrato.inicio : hoje;
  return [mensalidade(a, m, f.dia_vencimento, f.valor_cents), mensalidade(a2, m2, f.dia_vencimento, f.valor_cents)].filter(
    (c) => c.vencimento >= desde && (!contrato.fim || c.vencimento <= contrato.fim),
  );
}

export function situacaoExibida(c: { situacao: SituacaoCobranca; vencimento: string }, hoje: string): SituacaoExibida {
  return c.situacao === "a_receber" && c.vencimento < hoje ? "atrasada" : c.situacao;
}

export function totaisDoMes(
  cobs: Array<{ situacao: SituacaoCobranca; vencimento: string; valor_cents: number; recebida_em: string | null }>,
  hoje: string,
): { aReceber: number; recebido: number; atrasado: number; qtdAtrasadas: number } {
  const mes = hoje.slice(0, 7);
  const t = { aReceber: 0, recebido: 0, atrasado: 0, qtdAtrasadas: 0 };
  for (const c of cobs) {
    const s = situacaoExibida(c, hoje);
    if (s === "atrasada") { t.atrasado += c.valor_cents; t.qtdAtrasadas++; }
    else if (s === "a_receber" && c.vencimento.slice(0, 7) === mes) t.aReceber += c.valor_cents;
    else if (s === "recebida" && c.recebida_em?.slice(0, 7) === mes) t.recebido += c.valor_cents;
  }
  return t;
}
