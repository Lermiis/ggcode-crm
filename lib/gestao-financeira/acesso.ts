import type { SupabaseClient } from "@supabase/supabase-js";

/** fn_gf_pode: admin sempre; senão gf_acessos. Erro de RPC = sem acesso (fail closed). */
export async function exigirAcesso(supabase: Pick<SupabaseClient, "rpc">, orgId: string, nivel: "ver" | "editar"): Promise<boolean> {
  const { data, error } = await supabase.rpc("fn_gf_pode", { p_org: orgId, p_nivel: nivel });
  return !error && data === true;
}
