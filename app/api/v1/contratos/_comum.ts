import { moduloAusente } from "@/lib/contratos/modulo";
import { fail } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";

export const MENSAGEM_MODULO =
  "O módulo Contratos não está instalado. Peça ao administrador para instalar em Configurações da instalação › Módulos.";

/** moduloAusente: tabela inexistente = módulo não instalado (ADR-0002). */
export function respostaDeErro(error: { code?: string; message?: string }, requestId: string): Response {
  if (moduloAusente(error)) return fail("module_not_installed", MENSAGEM_MODULO, 409, { requestId });
  if (error.code === "23503") return fail("validation_failed", "Referência inválida para esta organização.", 422, { requestId });
  if (error.code === "23505") return fail("conflict", "Esta cobrança já existe.", 409, { requestId });
  if (error.code === "22008" || error.code === "22007") return fail("validation_failed", "Data inválida.", 422, { requestId });
  logger.error("contratos.erro_inesperado", { requestId, code: error.code, message: error.message });
  return fail("internal_error", "Erro ao processar a solicitação.", 500, { requestId });
}

/** Linha de cobrança com o nome do contrato e do cliente, no formato `Cobranca`. */
export const SELECT_COBRANCA =
  "id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents, situacao, recebida_em, " +
  "contratos!inner(titulo, crm_leads(title))";

type LinhaCobranca = Record<string, unknown> & { contratos: { titulo: string; crm_leads: { title: string } | null } };
export function achatarCobranca(l: LinhaCobranca) {
  const { contratos, ...resto } = l;
  return { ...resto, contrato_titulo: contratos.titulo, cliente: contratos.crm_leads?.title ?? "—" };
}
