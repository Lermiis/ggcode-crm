import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moduloAusente } from "@/lib/contratos/modulo";
import { exigirAcesso } from "@/lib/gestao-financeira/acesso";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const MENSAGEM_MODULO_GF =
  "O módulo Financeiro não está instalado. Peça ao administrador para instalar em Configurações da instalação › Módulos.";

/** Mensagem das exceções das RPCs (fn_gf_*) -> [code, texto, status]. */
const RECUSAS: Record<string, [string, string, number]> = {
  gf_forbidden: ["forbidden", "Sem acesso ao Financeiro.", 403],
  lancamento_pago_imutavel: ["conflict", "Lançamento pago não muda. Use Corrigir.", 409],
  lancamento_recorrente: ["conflict", "Lançamento de recorrência: encerre a recorrência ou marque como pago.", 409],
  lancamento_de_comanda: ["conflict", "Lançamento de comanda é gerido pelas Comandas.", 409],
  lancamento_ja_pago: ["conflict", "Este lançamento já está pago.", 409],
  lancamento_nao_pago: ["conflict", "Só lançamento pago pode ser corrigido.", 409],
  lancamento_nao_corrigivel: ["conflict", "Este lançamento não pode ser corrigido.", 409],
  lancamento_nao_encontrado: ["not_found", "Lançamento não encontrado.", 404],
  recorrencia_nao_encontrada: ["not_found", "Recorrência não encontrada.", 404],
  conta_invalida: ["validation_failed", "Escolha uma conta ativa desta empresa.", 422],
  categoria_invalida: ["validation_failed", "Categoria inválida para este lançamento.", 422],
  categoria_duplicada: ["conflict", "Já existe uma categoria com este nome.", 409],
  usuario_nao_membro: ["validation_failed", "A pessoa não é membro desta empresa.", 422],
  data_invalida: ["validation_failed", "Data inválida.", 422],
};

export function respostaDeErro(error: { code?: string; message?: string }, requestId: string): Response {
  if (moduloAusente(error) || error.code === "PGRST202" || error.code === "42883") return fail("module_not_installed", MENSAGEM_MODULO_GF, 409, { requestId });
  const chave = Object.keys(RECUSAS).find((k) => error.message?.includes(k));
  if (chave) {
    const [code, msg, st] = RECUSAS[chave]!;
    return fail(code, msg, st, { requestId });
  }
  if (error.code === "22007" || error.code === "22008") return fail("validation_failed", "Data inválida.", 422, { requestId });
  if (error.code === "22023") return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  if (error.code === "23503") return fail("validation_failed", "Referência inválida para esta organização.", 422, { requestId });
  if (error.code === "23505") return fail("conflict", "Registro duplicado.", 409, { requestId });
  if (error.code === "gf_volume") return fail("internal_error", "Volume de lançamentos acima do suportado nesta versão.", 500, { requestId });
  logger.error("gestao_financeira.erro_inesperado", { requestId, code: error.code, message: error.message });
  return fail("internal_error", "Erro ao processar a solicitação.", 500, { requestId });
}

type Entrada =
  | { ok: true; supabase: SupabaseClient; orgId: string; userId: string }
  | { ok: false; response: Response };

/** Sessão `viewer` + fn_gf_pode(ver|editar). Escrita também passa pelo teto do suporte. */
export async function entrar(nivel: "ver" | "editar", resource: string, requestId: string): Promise<Entrada> {
  if (nivel === "editar") {
    const negado = await requireSupportWrite();
    if (negado) return { ok: false, response: negado };
  }
  const authz = await requireRole("viewer", { requestId, resource });
  if (!authz.ok) return { ok: false, response: authz.response };
  const supabase = (await createClient()) as unknown as SupabaseClient;
  let pode: boolean;
  try {
    pode = await exigirAcesso(supabase, authz.org.orgId, nivel);
  } catch (e) {
    return { ok: false, response: respostaDeErro(e as { code?: string; message?: string }, requestId) };
  }
  if (!pode) return { ok: false, response: fail("forbidden", "Sem acesso ao Financeiro.", 403, { requestId }) };
  return { ok: true, supabase, orgId: authz.org.orgId, userId: authz.user.id };
}

/** Executa o corpo da rota convertendo erros do loader/PostgREST em resposta. */
export async function protegido(requestId: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return respostaDeErro(e as { code?: string; message?: string }, requestId);
  }
}

export const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
