/** Regras puras da edição de contrato (sem banco). */
import { competenciaMensal, dividirEmParcelas, somarMeses } from "./regras";
import type { CobrancaNova } from "./tipos";

/** Parcelas novas para o saldo (total − recebidas), continuando a numeração depois da maior recebida. */
export function refazerParcelamento(i: {
  total_cents: number;
  recebidas: Array<{ competencia: string; valor_cents: number }>;
  novasParcelas: number;
  primeiroVencimento: string;
  /** Competências já usadas pela forma (ex.: parcelas canceladas): a numeração passa por cima delas. */
  ocupadas?: string[];
}): CobrancaNova[] {
  const saldo = i.total_cents - i.recebidas.reduce((s, r) => s + r.valor_cents, 0);
  if (saldo <= 0) throw new Error("Nada a parcelar.");
  const maiorK = Math.max(0, ...[...i.recebidas.map((r) => r.competencia), ...(i.ocupadas ?? [])].map((c) => Number(c.replace("parcela-", "")) || 0));
  const total = i.recebidas.length + i.novasParcelas;
  return dividirEmParcelas(saldo, i.novasParcelas).map((valor, n) => ({
    competencia: `parcela-${maiorK + n + 1}`,
    descricao: `Implantação ${maiorK + n + 1}/${total}`,
    vencimento: somarMeses(i.primeiroVencimento, n),
    valor_cents: valor,
  }));
}

/** Mesmo mês do vencimento, outro dia (limitado ao último dia do mês). */
export function vencimentoPeloDia(vencimento: string, dia: number): string {
  const [a, m] = vencimento.split("-").map(Number) as [number, number];
  return competenciaMensal(a, m, dia).vencimento;
}
