"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import type { Metrica } from "@/lib/gestao-financeira/tipos";

import { Carga, brl, useGf } from "./_comum";

type Dados = Record<string, Metrica>;
type Def = [chave: string, nome: string, tipo: "brl" | "pct" | "meses" | "num" | "x", texto: string];

export function AbaMetricas() {
  const t = useT();
  const [periodo, setPeriodo] = useState(3);
  const q = useGf<Dados>(["metricas", periodo], `/api/v1/gestao-financeira/metricas?periodo=${periodo}`);
  const DEFS: Def[] = [
    ["mrr", t("Receita mensal recorrente"), "brl", t("Soma das mensalidades dos contratos ativos.")],
    ["ticketMedio", t("Ticket médio"), "brl", t("Quanto cada cliente pagou no período.")],
    ["churn", t("Cancelamento"), "pct", t("Clientes perdidos por mês. Abaixo de 5% é saudável.")],
    ["clientesNovos", t("Clientes novos"), "num", t("Contratos fechados no período.")],
    ["cac", t("CAC"), "brl", t("Custo para conquistar um cliente.")],
    ["ltv", t("LTV"), "brl", t("Quanto um cliente deixa durante o contrato.")],
    ["ltvCac", t("LTV / CAC"), "x", t("Acima de 3 é saudável.")],
    ["payback", t("Retorno do CAC"), "meses", t("Meses para recuperar o que gastou. Abaixo de 12 é bom.")],
    ["roiEmpresa", t("Retorno da empresa"), "pct", t("Lucro sobre os custos do período.")],
    ["roiMarketing", t("Retorno do marketing"), "pct", t("Quanto o marketing devolveu sobre o que custou.")],
    ["pontoEquilibrio", t("Ponto de equilíbrio"), "brl", t("Faturamento mensal para pagar todas as despesas.")],
  ];
  const fmt = (v: number, tipo: Def[2]) =>
    tipo === "brl" ? brl(v) : tipo === "pct" ? `${v.toLocaleString("pt-BR")}%` : tipo === "x" ? `${v.toLocaleString("pt-BR")}x` : tipo === "meses" ? `${v.toLocaleString("pt-BR")} ${t("meses")}` : String(v);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {[1, 3, 6, 12].map((n) => (
          <Button key={n} size="sm" variant={periodo === n ? "default" : "outline"} onClick={() => setPeriodo(n)}>{n} {n === 1 ? t("mês") : t("meses")}</Button>
        ))}
      </div>
      <Carga q={q}>
        {(d) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DEFS.map(([chave, nome, tipo, texto]) => {
              const m = d[chave];
              return (
                <div key={chave} className="rounded-lg border border-border p-4">
                  <div className="text-xs font-medium text-text-muted">{nome}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{m?.valor == null ? "—" : fmt(m.valor, tipo)}</div>
                  <div className="mt-1 text-xs text-text-muted">{m?.valor == null && m?.motivo ? m.motivo : texto}</div>
                </div>
              );
            })}
          </div>
        )}
      </Carga>
    </div>
  );
}
