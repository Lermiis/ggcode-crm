/** Tabela/relação ausente = módulo não instalado (ADR-0002). Postgres: 42P01; PostgREST: PGRST205 (tabela), PGRST200 (relação). */
export function moduloAusente(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST200";
}
