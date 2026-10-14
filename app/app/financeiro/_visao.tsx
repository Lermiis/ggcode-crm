"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useT } from "@/hooks/i18n/useT";
import type { VisaoGeral } from "@/lib/gestao-financeira/tipos";

import { Carga, SeletorMes, brl, mesCurto, mesDeHoje, tooltipStyle, useGf } from "./_comum";

type Dados = VisaoGeral & { serie: Array<{ mes: string; receita: number; custos: number; lucro: number }> };

function Cartao({ rotulo, valor, cor, destaque }: { rotulo: string; valor: string; cor?: "danger" | "success"; destaque?: boolean }) {
  return (
    <div className={`rounded-lg border border-border p-4 ${destaque ? "bg-surface" : ""}`}>
      <div className="text-xs font-medium text-text-muted">{rotulo}</div>
      <div className={`mt-1 font-semibold tabular-nums ${destaque ? "text-3xl" : "text-2xl"} ${cor === "danger" ? "text-danger" : cor === "success" ? "text-success" : ""}`}>{valor}</div>
    </div>
  );
}

export function AbaVisao() {
  const t = useT();
  const [mes, setMes] = useState(mesDeHoje());
  const q = useGf<Dados>(["visao", mes], `/api/v1/gestao-financeira/visao?mes=${mes}`);
  return (
    <div className="flex flex-col gap-4">
      <SeletorMes mes={mes} onChange={setMes} />
      <Carga q={q}>
        {(d) => (
          <>
            <Cartao destaque rotulo={t("Saldo em conta")} valor={brl(d.saldo)} cor={d.saldo < 0 ? "danger" : undefined} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Cartao rotulo={t("Faturado")} valor={brl(d.faturado)} />
              <Cartao rotulo={t("Recebido")} valor={brl(d.recebido)} />
              <Cartao rotulo={t("Custos")} valor={brl(d.custos)} />
              <Cartao rotulo={t("Lucro")} valor={brl(d.lucro)} cor={d.lucro < 0 ? "danger" : "success"} />
              <Cartao rotulo={t("Margem")} valor={d.margem.valor === null ? "—" : `${d.margem.valor.toLocaleString("pt-BR")}%`} />
              <Cartao rotulo={t("A receber")} valor={brl(d.aReceber)} />
              <Cartao rotulo={t("Atrasado")} valor={brl(d.atrasado)} cor={d.atrasado > 0 ? "danger" : undefined} />
              <Cartao rotulo={t("A pagar")} valor={brl(d.aPagar)} />
            </div>
            <div className="rounded-lg border border-border p-4">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={d.serie} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="mes" tickFormatter={mesCurto} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v: number) => `${Math.round(v / 100000)}k`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(l) => mesCurto(String(l))} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="receita" name={t("Receita")} fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="custos" name={t("Custos")} fill="var(--color-danger)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="lucro" name={t("Lucro")} fill="var(--color-success)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Carga>
    </div>
  );
}
