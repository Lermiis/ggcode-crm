"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { GRUPOS } from "@/lib/gestao-financeira/esquemas";
import type { Grupo } from "@/lib/gestao-financeira/tipos";

import { Carga, SeletorMes, brl, mesDeHoje, selectCls, useGf } from "./_comum";

type Linha = { chave: string; rotulo: string; valor: number; pct: number | null; destaque?: boolean };
export type Categoria = { id: string; nome: string; direction: "in" | "out"; grupo: Grupo; conta_cac: boolean };

export function AbaDre({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const [mes, setMes] = useState(mesDeHoje());
  const [cats, setCats] = useState(false);
  const q = useGf<Linha[]>(["dre", mes], `/api/v1/gestao-financeira/dre?mes=${mes}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <SeletorMes mes={mes} onChange={setMes} />
        <Button size="sm" variant="ghost" onClick={() => setCats(true)}>{t("Categorias")}</Button>
      </div>
      <Carga q={q}>
        {(linhas) => (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="text-xs text-text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-left font-medium" />
                  <th className="px-4 py-2 text-right font-medium">{t("Valor")}</th>
                  <th className="px-4 py-2 text-right font-medium">{t("% da receita")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {linhas.map((l) => (
                  <tr key={l.chave} className={l.destaque ? "bg-surface font-semibold" : ""}>
                    <td className="px-4 py-2">{l.rotulo}</td>
                    <td className={`px-4 py-2 text-right ${l.valor < 0 ? "text-error" : ""}`}>{brl(l.valor)}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{l.pct === null ? "—" : `${l.pct.toLocaleString("pt-BR")}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Carga>
      {cats ? <DialogCategorias podeEditar={podeEditar} onFechar={() => setCats(false)} /> : null}
    </div>
  );
}

function DialogCategorias({ podeEditar, onFechar }: { podeEditar: boolean; onFechar: () => void }) {
  const t = useT();
  const q = useGf<Categoria[]>(["categorias"], "/api/v1/gestao-financeira/categorias");
  const [edit, setEdit] = useState<Partial<Categoria> | null>(null);
  const GR: Record<Grupo, string> = {
    receita: t("Receita"), imposto: t("Impostos"), custo_variavel: t("Custo variável"), pessoal: t("Pessoal"),
    assinaturas: t("Assinaturas"), marketing: t("Marketing"), estrutura: t("Estrutura"), outras_despesas: t("Outras despesas"),
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Categorias")}</DialogTitle></DialogHeader>
        {edit ? <FormCategoria inicial={edit} GR={GR} onFechar={() => setEdit(null)} /> : (
          <>
            <Carga q={q}>
              {(lista) => (
                <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {lista.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                      <span className="text-xs text-text-muted">{GR[c.grupo]}</span>
                      {podeEditar ? <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>{t("Editar")}</Button> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Carga>
            <DialogFooter>
              <Button variant="outline" onClick={onFechar}>{t("Fechar")}</Button>
              {podeEditar ? <Button onClick={() => setEdit({ direction: "out", grupo: "outras_despesas", conta_cac: false })}>{t("Nova categoria")}</Button> : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormCategoria({ inicial, GR, onFechar }: { inicial: Partial<Categoria>; GR: Record<Grupo, string>; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [nome, setNome] = useState(inicial.nome ?? "");
  const [direction, setDirection] = useState<"in" | "out">(inicial.direction ?? "out");
  const [grupo, setGrupo] = useState<Grupo>(inicial.grupo ?? "outras_despesas");
  const [cac, setCac] = useState(inicial.conta_cac ?? false);
  const trocarDirecao = (d: "in" | "out") => { setDirection(d); setGrupo(d === "in" ? "receita" : "outras_despesas"); };
  const salvar = useMutation({
    mutationFn: () => apiClient.post("/api/v1/gestao-financeira/categorias", { id: inicial.id ?? null, nome, direction, grupo, conta_cac: cac }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["financeiro"] }); onFechar(); },
    onError: showApiError,
  });
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">{t("Nome")}<Input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">{t("Tipo")}
          <select className={selectCls} value={direction} disabled={!!inicial.id} onChange={(e) => trocarDirecao(e.target.value as "in" | "out")}>
            <option value="in">{t("Entrada")}</option><option value="out">{t("Saída")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">{t("Grupo da DRE")}
          <select className={selectCls} value={grupo} onChange={(e) => setGrupo(e.target.value as Grupo)}>
            {GRUPOS.filter((g) => (g === "receita") === (direction === "in")).map((g) => <option key={g} value={g}>{GR[g]}</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cac} onChange={(e) => setCac(e.target.checked)} />{t("Conta para o CAC")}
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={onFechar}>{t("Voltar")}</Button>
        <Button disabled={!nome.trim() || salvar.isPending} onClick={() => salvar.mutate()}>{t("Salvar")}</Button>
      </DialogFooter>
    </>
  );
}
