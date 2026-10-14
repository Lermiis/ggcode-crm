export type Grupo = "receita" | "imposto" | "custo_variavel" | "pessoal" | "assinaturas" | "marketing" | "estrutura" | "outras_despesas";

export interface Lancamento {
  id: string; direction: "in" | "out"; amount_cents: number; entry_date: string; // YYYY-MM-DD
  status: "pending" | "paid"; paid_date: string | null; // YYYY-MM-DD (paid_at no fuso)
  grupo: Grupo; conta_cac: boolean; origin: string; reverses_entry_id: string | null;
  cobranca_contrato: boolean; // true se é o lançamento do recebimento de uma cobrança de contrato
  cliente_id: string | null; // lead_id/contrato quando conhecido
}

export interface CobrancaContrato { vencimento: string; valor_cents: number; situacao: "a_receber" | "recebida" | "cancelada"; recebida_em: string | null; contrato_id: string }

export interface ContratoResumo { id: string; inicio: string; fim: string | null; situacao: "ativo" | "encerrado" | "cancelado"; criado_em: string; encerrado_em: string | null; mensal_cents: number }

export interface Recorrencia { id: string; direction: "in" | "out"; amount_cents: number; day_of_month: number; is_active: boolean; fim: string | null; grupo: Grupo }

export interface Metrica { valor: number | null; motivo?: string } // null = "—"

export interface VisaoGeral { faturado: number; recebido: number; custos: number; lucro: number; margem: Metrica; aReceber: number; atrasado: number; aPagar: number; saldo: number }
