import { dividirEmParcelas, somarMeses } from "@/lib/contratos/regras";

export function gerarParcelado(i: { total_cents: number; parcelas: number; primeiro: string }): Array<{ numero: number; entry_date: string; amount_cents: number }> {
  return dividirEmParcelas(i.total_cents, i.parcelas).map((amount_cents, k) => ({ numero: k + 1, entry_date: somarMeses(i.primeiro, k), amount_cents }));
}
