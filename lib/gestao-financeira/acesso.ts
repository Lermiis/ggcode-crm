import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * fn_gf_pode: admin sempre; senão gf_acessos. `false` = sem acesso.
 * Erro da RPC NÃO é "sem acesso": lança o erro para a rota mapear (409 módulo ausente ou 500).
 */
export async function exigirAcesso(supabase: Pick<SupabaseClient, "rpc">, orgId: string, nivel: "ver" | "editar"): Promise<boolean> {
  const { data, error } = await supabase.rpc("fn_gf_pode", { p_org: orgId, p_nivel: nivel });
  if (error) throw error;
  return data === true;
}
