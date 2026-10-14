"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

import { Carga, selectCls, useGf } from "./_comum";

type Membro = { user_id: string; nome: string; papel: string; nivel: "admin" | "nenhum" | "ver" | "editar" };

export function AbaAcesso() {
  const t = useT();
  const qc = useQueryClient();
  const q = useGf<Membro[]>(["acessos"], "/api/v1/gestao-financeira/acessos");
  const definir = useMutation({
    mutationFn: (v: { user_id: string; nivel: string }) => apiClient.post("/api/v1/gestao-financeira/acessos", v),
    onSuccess: () => { toast.success(t("Salvo.")); void qc.invalidateQueries({ queryKey: ["financeiro", "acessos"] }); },
    onError: showApiError,
  });
  return (
    <Carga q={q}>
      {(lista) => (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lista.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.nome}</div>
                <div className="text-xs text-text-muted">{m.papel}</div>
              </div>
              {m.nivel === "admin" ? (
                <span className="text-sm text-text-muted">{t("Administrador · acesso total")}</span>
              ) : (
                <select className={selectCls} aria-label={m.nome} value={m.nivel} disabled={definir.isPending}
                  onChange={(e) => definir.mutate({ user_id: m.user_id, nivel: e.target.value })}>
                  <option value="nenhum">{t("Sem acesso")}</option>
                  <option value="ver">{t("Só vê")}</option>
                  <option value="editar">{t("Vê e edita")}</option>
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
    </Carga>
  );
}
