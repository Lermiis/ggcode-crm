export type TipoForma = "implantacao" | "mensalidade" | "evento" | "avulso";
export type SituacaoCobranca = "a_receber" | "recebida" | "cancelada";
export type SituacaoExibida = "atrasada" | SituacaoCobranca;
export type SituacaoContrato = "ativo" | "encerrado" | "cancelado";

export interface FormaEntrada {
  tipo: TipoForma;
  valor_cents: number;
  parcelas?: number;
  primeiro_vencimento?: string;
  dia_vencimento?: number;
  descricao?: string;
}

export interface CobrancaNova {
  competencia: string;
  descricao: string;
  vencimento: string;
  valor_cents: number;
}

export interface Cobranca {
  id: string;
  contrato_id: string;
  forma_id: string;
  competencia: string;
  descricao: string;
  vencimento: string;
  valor_cents: number;
  situacao: SituacaoCobranca;
  recebida_em: string | null;
  contrato_titulo: string;
  cliente: string;
}

export interface Forma extends FormaEntrada {
  id: string;
  ativa: boolean;
}

export interface Contrato {
  id: string;
  lead_id: string;
  titulo: string;
  inicio: string;
  fim: string | null;
  situacao: SituacaoContrato;
  cliente: string;
  mensal_cents: number;
  proximo_vencimento: string | null;
}
