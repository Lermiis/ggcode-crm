export type Grupo = "receita" | "imposto" | "custo_variavel" | "pessoal" | "assinaturas" | "marketing" | "estrutura" | "outras_despesas";

export interface Lancamento {
  id: string; direction: "in" | "out"; amount_cents: number; entry_date: string; // YYYY-MM-DD
  status: "pending" | "paid"; paid_date: string | null; // data CIVIL YYYY-MM-DD em America/Sao_Paulo (o chamador converte o timestamptz paid_at)
  grupo: Grupo; conta_cac: boolean; origin: string; reverses_entry_id: string | null;
  cobranca_contrato: boolean; // true se é o lançamento do recebimento de uma cobrança de contrato
  cliente_id: string | null; // lead_id/contrato quando conhecido; se for recebimento de contrato, DEVE ser o id do CONTRATO (usado em roiMarketing)
}

export interface CobrancaContrato { vencimento: string; valor_cents: number; situacao: "a_receber" | "recebida" | "cancelada"; recebida_em: string | null; contrato_id: string }

export interface ContratoResumo { id: string; inicio: string; fim: string | null; situacao: "ativo" | "encerrado" | "cancelado"; criado_em: string; encerrado_em: string | null /* criado_em/encerrado_em: datas CIVIS YYYY-MM-DD em America/Sao_Paulo (o chamador converte o timestamptz) */; mensal_cents: number }

export interface Recorrencia { id: string; direction: "in" | "out"; amount_cents: number; day_of_month: number; is_active: boolean; fim: string | null; grupo: Grupo }

export interface Metrica { valor: number | null; motivo?: string } // null = "—"

export interface VisaoGeral { faturado: number; recebido: number; custos: number; lucro: number; margem: Metrica; aReceber: number; atrasado: number; aPagar: number; saldo: number }
