"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { centavosParaTexto, reaisParaCentavos } from "@/lib/contratos/dinheiro";

import { Carga, brl, dataBR, selectCls, useGf } from "./_comum";
import type { Categoria } from "./_dre";
import type { Conta } from "./_lancamento-form";

// GET /recorrencias: Recorrencia + { name (descrição), account_id, account_plan_id }
type Rec = {
  id: string; direction: "in" | "out"; amount_cents: number; day_of_month: number; is_active: boolean; fim: string | null;
  name: string; account_id: string; account_plan_id: string | null;
};
const BASE = "/api/v1/gestao-financeira/recorrencias";

export function Recorrencias({ podeEditar, categorias, contas, onFechar }: { podeEditar: boolean; categorias: Categoria[]; contas: Conta[]; onFechar: () => void }) {
  const t = useT();
  const q = useGf<Rec[]>(["recorrencias"], BASE);
  const [edit, setEdit] = useState<Rec | null>(null);
  const [encerrar, setEncerrar] = useState<Rec | null>(null);
  const nomeCat = (id: string | null) => categorias.find((c) => c.id === id)?.nome ?? "—";
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Recorrências")}</DialogTitle></DialogHeader>
        {edit ? <FormRec rec={edit} categorias={categorias} contas={contas} onFechar={() => setEdit(null)} />
          : encerrar ? <ConfirmaEncerrar rec={encerrar} onFechar={() => setEncerrar(null)} />
          : (
            <>
              <Carga q={q}>
                {(lista) => lista.length === 0 ? <p className="text-sm text-text-muted">{t("Nada aqui.")}</p> : (
                  <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {lista.map((r) => (
                      <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${r.is_active ? "" : "text-text-muted"}`}>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="truncate text-xs text-text-muted">
                            {nomeCat(r.account_plan_id)} · {t("dia")} {r.day_of_month}{r.fim ? ` · ${t("até")} ${dataBR(r.fim)}` : ""}{r.is_active ? "" : ` · ${t("Encerrada")}`}
                          </div>
                        </div>
                        <span className={`tabular-nums font-semibold ${r.direction === "out" ? "text-error" : ""}`}>{r.direction === "out" ? "−" : ""}{brl(r.amount_cents)}</span>
                        {podeEditar && r.is_active ? (
                          <span className="flex gap-1">
                            <Button size="sm" variant="ghost" aria-label={`${t("Editar daqui pra frente")} ${r.name}`} onClick={() => setEdit(r)}>{t("Editar daqui pra frente")}</Button>
                            <Button size="sm" variant="ghost" aria-label={`${t("Encerrar")} ${r.name}`} onClick={() => setEncerrar(r)}>{t("Encerrar")}</Button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Carga>
              <DialogFooter><Button variant="outline" onClick={onFechar}>{t("Fechar")}</Button></DialogFooter>
            </>
          )}
      </DialogContent>
    </Dialog>
  );
}

function FormRec({ rec, categorias, contas, onFechar }: { rec: Rec; categorias: Categoria[]; contas: Conta[]; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [valor, setValor] = useState(centavosParaTexto(rec.amount_cents));
  const [dia, setDia] = useState(String(rec.day_of_month));
  const [descricao, setDescricao] = useState(rec.name);
  const [categoria, setCategoria] = useState(rec.account_plan_id ?? "");
  const [conta, setConta] = useState(rec.account_id);
  const [fim, setFim] = useState(rec.fim ?? "");
  const centavos = reaisParaCentavos(valor);
  const d = Number(dia);
  const valido = centavos !== null && Number.isInteger(d) && d >= 1 && d <= 31 && !!descricao.trim() && !!conta && (!fim || fim >= hoje);
  const salvar = useMutation({
    mutationFn: () => apiClient.post(BASE, {
      id: rec.id, direction: rec.direction, amount_cents: centavos, day_of_month: d, account_id: conta,
      account_plan_id: categoria || null, description: descricao.trim(), fim: fim || null,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["financeiro"] }); onFechar(); },
    onError: showApiError,
  });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">{t("Valor (R$)")}<Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm">{t("Dia do vencimento")}<Input inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
      </div>
      <label className="flex flex-col gap-1 text-sm">{t("Descrição")}<Input value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">{t("Categoria")}
          <select className={selectCls} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">—</option>
            {categorias.filter((c) => c.direction === rec.direction).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">{t("Conta")}
          <select className={selectCls} value={conta} onChange={(e) => setConta(e.target.value)}>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">{t("até")}<Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
      <DialogFooter>
        <Button variant="outline" onClick={onFechar}>{t("Voltar")}</Button>
        <Button disabled={!valido || salvar.isPending} onClick={() => salvar.mutate()}>{t("Salvar")}</Button>
      </DialogFooter>
    </>
  );
}

function ConfirmaEncerrar({ rec, onFechar }: { rec: Rec; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const encerrar = useMutation({
    mutationFn: () => apiClient.post(`${BASE}/${rec.id}/encerrar`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["financeiro"] }); onFechar(); },
    onError: showApiError,
  });
  return (
    <>
      <p className="text-sm">{t("Encerrar recorrência?")} <b>{rec.name}</b> · {brl(rec.amount_cents)}</p>
      <DialogFooter>
        <Button variant="outline" onClick={onFechar}>{t("Voltar")}</Button>
        <Button variant="destructive" disabled={encerrar.isPending} onClick={() => encerrar.mutate()}>{t("Encerrar")}</Button>
      </DialogFooter>
    </>
  );
}
