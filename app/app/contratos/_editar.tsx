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
import { hojeNoFuso } from "@/lib/contratos/regras";
import type { Cobranca, Contrato, Forma } from "@/lib/contratos/tipos";
import { formatCents } from "@/lib/money";

const ROTULO: Record<Forma["tipo"], string> = { implantacao: "Implantação", mensalidade: "Mensalidade", evento: "Por evento", avulso: "Avulso" };

function useSalvar(url: string, metodo: "patch" | "post", onFeito?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: Record<string, unknown>) => (metodo === "patch" ? apiClient.patch(url, corpo) : apiClient.post(url, corpo)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["contratos"] }); onFeito?.(); },
    onError: showApiError,
  });
}

function BlocoForma({ contratoId, forma, cobrancas }: { contratoId: string; forma: Forma; cobrancas: Cobranca[] }) {
  const t = useT();
  const base = `/api/v1/contratos/${contratoId}/formas/${forma.id}`;
  const [valor, setValor] = useState(centavosParaTexto(forma.valor_cents));
  const [dia, setDia] = useState(String(forma.dia_vencimento ?? ""));
  const [aplicar, setAplicar] = useState(false);
  const [parcelas, setParcelas] = useState("1");
  const [primeiro, setPrimeiro] = useState(hojeNoFuso());
  const salvar = useSalvar(base, "patch");
  const refazer = useSalvar(`${base}?acao=refazer`, "post");
  const centavos = reaisParaCentavos(valor);
  const diaNum = Number(dia);

  const recebido = cobrancas.filter((c) => c.forma_id === forma.id && c.situacao === "recebida").reduce((s, c) => s + c.valor_cents, 0);
  const falta = forma.valor_cents - recebido;
  const n = Number(parcelas);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="text-xs font-medium text-text-muted">{t(ROTULO[forma.tipo])}</div>
      {forma.tipo === "implantacao" ? (
        <>
          <div className="text-sm">{t("Já recebido")} {formatCents(recebido, "BRL")} · {t("Falta")} {formatCents(Math.max(falta, 0), "BRL")}</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">{t("Parcelas")}<Input inputMode="numeric" value={parcelas} onChange={(e) => setParcelas(e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-sm">{t("1º vencimento")}<Input type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} /></label>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={falta <= 0 || !Number.isInteger(n) || n < 1 || n > 60 || !primeiro || refazer.isPending}
              onClick={() => refazer.mutate({ parcelas: n, primeiro_vencimento: primeiro })}>{t("Refazer parcelamento")}</Button>
          </div>
        </>
      ) : forma.tipo === "mensalidade" || forma.tipo === "evento" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">{forma.tipo === "evento" ? t("Valor padrão (R$)") : t("Valor (R$)")}
              <Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
            {forma.tipo === "mensalidade" ? (
              <label className="flex flex-col gap-1 text-sm">{t("Dia do vencimento")}<Input inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
            ) : null}
          </div>
          {forma.tipo === "mensalidade" ? (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={aplicar} onChange={(e) => setAplicar(e.target.checked)} />{t("Aplicar às próximas cobranças")}</label>
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={centavos === null || (forma.tipo === "mensalidade" && !(diaNum >= 1 && diaNum <= 31)) || salvar.isPending}
              onClick={() => salvar.mutate({ valor_cents: centavos, ...(forma.tipo === "mensalidade" ? { dia_vencimento: diaNum, aplicar_futuras: aplicar } : {}) })}>{t("Salvar")}</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function EditarContrato({ contrato, formas, cobrancas, onFechar }: { contrato: Contrato; formas: Forma[]; cobrancas: Cobranca[]; onFechar: () => void }) {
  const t = useT();
  const [titulo, setTitulo] = useState(contrato.titulo);
  const [inicio, setInicio] = useState(contrato.inicio);
  const [fim, setFim] = useState(contrato.fim ?? "");
  const salvar = useSalvar(`/api/v1/contratos/${contrato.id}`, "patch", onFechar);
  const invalido = !titulo.trim() || !inicio || (!!fim && fim < inicio);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t("Editar contrato")}</DialogTitle></DialogHeader>
        <label className="flex flex-col gap-1 text-sm">{t("Título")}<Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">{t("Início")}<Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm">{t("Fim")}<Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></label>
        </div>
        {contrato.situacao === "ativo" ? formas.filter((f) => f.ativa && f.tipo !== "avulso").map((f) => (
          <BlocoForma key={f.id} contratoId={contrato.id} forma={f} cobrancas={cobrancas} />
        )) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Fechar")}</Button>
          <Button disabled={invalido || salvar.isPending} onClick={() => salvar.mutate({ acao: "editar", titulo, inicio, fim: fim || null })}>{t("Salvar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
