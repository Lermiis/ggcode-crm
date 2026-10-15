"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useT } from "@/hooks/i18n/useT";

import { Carga, brl, mesCurto, tooltipStyle, useGf } from "./_comum";

type Linha = { mes: string; entradas: number; saidas: number; saldo: number; projetado: boolean };

export function AbaFluxo() {
  const t = useT();
  const q = useGf<Linha[]>(["fluxo"], "/api/v1/gestao-financeira/fluxo?meses=6");
  return (
    <Carga q={q}>
      {(linhas) => (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="text-xs text-text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-medium">{t("Mês")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Entradas")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Saídas")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("Saldo")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {linhas.map((l) => (
                  <tr key={l.mes} className={l.projetado ? "italic text-text-muted" : ""}>
                    <td className="px-4 py-2">{mesCurto(l.mes)}{l.projetado ? <span className="ml-2 rounded-md bg-surface px-1.5 py-0.5 text-xs not-italic">{t("previsto")}</span> : null}</td>
                    <td className="px-4 py-2 text-right">{brl(l.entradas)}</td>
                    <td className="px-4 py-2 text-right">{brl(l.saidas)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${l.saldo < 0 ? "text-error" : ""}`}>{brl(l.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border border-border p-4">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={linhas} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="mes" tickFormatter={mesCurto} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => `${Math.round(v / 100000)}k`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                <Tooltip formatter={(v) => [brl(Number(v)), t("Saldo")]} labelFormatter={(l) => mesCurto(String(l))} contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="saldo" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Carga>
  );
}
