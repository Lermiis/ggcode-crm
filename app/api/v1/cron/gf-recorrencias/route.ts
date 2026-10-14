/**
 * Fim das recorrências do Financeiro (GG Code, migration 9002). Diária, ANTES de recurring-entries.
 * O gerador do núcleo não conhece `gf_recorrencias.fim`: `fn_gf_encerrar_recorrencias_vencidas`
 * desativa o molde cujo fim passou e apaga o lançamento recorrente PENDENTE depois do fim.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { moduloAusente } from "@/lib/contratos/modulo";
import { ok, fail } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  const { data, error } = await createAdminClient().rpc("fn_gf_encerrar_recorrencias_vencidas");
  if (error) {
    if (moduloAusente(error)) return ok({ encerradas: 0, modulo: "nao_instalado" }, { requestId });
    logger.error("gf-recorrencias: falhou", { requestId, error: error.message });
    return fail("internal_error", error.message, 500, { requestId });
  }
  return ok({ encerradas: data ?? 0 }, { requestId });
}

export const GET = handle;
export const POST = handle;
