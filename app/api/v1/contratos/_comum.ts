import { fail } from "@/lib/api/wrappers";

export const MENSAGEM_MODULO =
  "O módulo Contratos não está instalado. Peça ao administrador para instalar em Configurações da instalação › Módulos.";

/** 42P01 = tabela inexistente = módulo não instalado (ADR-0002). */
export function respostaDeErro(error: { code?: string; message?: string }, requestId: string): Response {
  if (error.code === "42P01") return fail("module_not_installed", MENSAGEM_MODULO, 409, { requestId });
  if (error.code === "23503") return fail("validation_failed", "Referência inválida para esta organização.", 422, { requestId });
  if (error.code === "23505") return fail("conflict", "Esta cobrança já existe.", 409, { requestId });
  return fail("internal_error", error.message ?? "erro", 500, { requestId });
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
