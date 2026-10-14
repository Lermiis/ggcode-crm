import { describe, expect, it } from "vitest";

import { exigirAcesso } from "@/lib/gestao-financeira/acesso";
import { carregarCategorias } from "@/lib/gestao-financeira/carregar";
import { respostaDeErro } from "@/app/api/v1/gestao-financeira/_comum";

const rpc = (res: { data?: unknown; error?: unknown }) => ({ rpc: async () => ({ data: res.data ?? null, error: res.error ?? null }) }) as never;

describe("exigirAcesso", () => {
  it("true/false vêm da RPC", async () => {
    expect(await exigirAcesso(rpc({ data: true }), "o", "ver")).toBe(true);
    expect(await exigirAcesso(rpc({ data: false }), "o", "ver")).toBe(false);
  });
  it("erro da RPC lança (não vira false)", async () => {
    await expect(exigirAcesso(rpc({ error: { code: "XX000", message: "boom" } }), "o", "ver")).rejects.toMatchObject({ code: "XX000" });
  });
});

describe("respostaDeErro para erros de acesso", () => {
  it.each(["42P01", "PGRST205", "PGRST202", "42883"])("%s -> 409 module_not_installed", async (code) => {
    const r = respostaDeErro({ code, message: "x" }, "rid");
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("module_not_installed");
  });
  it("erro desconhecido -> 500; gf_volume -> 500", () => {
    expect(respostaDeErro({ code: "XX000", message: "boom" }, "rid").status).toBe(500);
    expect(respostaDeErro({ code: "gf_volume" }, "rid").status).toBe(500);
  });
  it("gf_forbidden -> 403", () => {
    expect(respostaDeErro({ code: "42501", message: "gf_forbidden" }, "rid").status).toBe(403);
  });
});

describe("carregarCategorias", () => {
  it("plano sem linha em gf_categorias usa o grupo padrão da direção", async () => {
    const dados: Record<string, unknown[]> = {
      account_plans: [{ id: "p1", name: "Vendas", direction: "in" }, { id: "p2", name: "Luz", direction: "out" }],
      gf_categorias: [],
    };
    const db = { from: (t: string) => { const q: Record<string, unknown> = {}; for (const m of ["select", "eq", "order"]) q[m] = () => q; q.range = async () => ({ data: dados[t], error: null }); return q; } } as never;
    const m = await carregarCategorias(db, "o");
    expect(m.get("p1")?.grupo).toBe("receita");
    expect(m.get("p2")?.grupo).toBe("outras_despesas");
  });
});
