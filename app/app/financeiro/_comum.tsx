"use client";
import type { ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { formatCents } from "@/lib/money";

export const brl = (c: number) => formatCents(c, "BRL");
export const dataBR = (d: string) => d.split("-").reverse().join("/");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const mesCurto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
export const somaMes = (m: string, n: number) => {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
export const mesDeHoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);

export type ApiLista<T> = { data: T };
/** `bruto`: devolve o corpo inteiro ({data, meta}) em vez de só `data`. */
export function useGf<T>(chave: unknown[], url: string, bruto = false): UseQueryResult<T> {
  return useQuery({ queryKey: ["financeiro", ...chave], queryFn: async () => { const r = await apiClient.get<ApiLista<T>>(url); return (bruto ? r : r.data) as T; }, retry: false });
}

/** Carregando / erro com "Tentar de novo" / módulo não instalado; senão entrega os dados. */
export function Carga<T>({ q, children }: { q: UseQueryResult<T>; children: (d: T) => ReactNode }) {
  const t = useT();
  if (q.error instanceof ApiError && q.error.code === "module_not_installed") {
    return <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">{q.error.message}</p>;
  }
  if (q.isError) {
    return (
      <div className="flex items-center gap-3 text-sm text-error">
        {t("Não foi possível carregar.")}
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>{t("Tentar de novo")}</Button>
      </div>
    );
  }
  if (q.data === undefined) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  return <>{children(q.data)}</>;
}

export function SeletorMes({ mes, onChange }: { mes: string; onChange: (m: string) => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="outline" aria-label={t("Mês anterior")} onClick={() => onChange(somaMes(mes, -1))}>‹</Button>
      <span className="w-20 text-center text-sm font-medium tabular-nums">{mesCurto(mes)}</span>
      <Button size="sm" variant="outline" aria-label={t("Próximo mês")} onClick={() => onChange(somaMes(mes, 1))}>›</Button>
    </div>
  );
}

export const selectCls = "rounded-md border border-border bg-bg px-2 py-2 text-sm text-text";
export const tooltipStyle = { borderRadius: 8, fontSize: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" };
