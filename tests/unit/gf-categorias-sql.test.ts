import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CATEGORIAS_PADRAO } from "@/lib/gestao-financeira/categorias-padrao";

/** A semente SQL (fn_gf_semear_categorias, migration 9002) é a MESMA lista do TS — nem a mais, nem a menos. */
const dir = path.join(process.cwd(), "supabase", "migrations");
const arquivo = fs.readdirSync(dir).find((f) => f.includes("_9002_"));
const sqlTexto = fs.readFileSync(path.join(dir, arquivo!), "utf8");
const corpo = sqlTexto.slice(sqlTexto.indexOf("function public.fn_gf_semear_categorias("), sqlTexto.indexOf("as t(nome, direction, grupo, conta_cac)"));
const linhas = [...corpo.matchAll(/\('([^']+)', '(in|out)', '([a-z_]+)', (true|false)\)/g)].map((m) => ({
  nome: m[1], direction: m[2], grupo: m[3], conta_cac: m[4] === "true",
}));

describe("categorias padrão: SQL = TS", () => {
  it("a semente SQL tem exatamente as categorias de CATEGORIAS_PADRAO, na mesma ordem", () => {
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas).toEqual(CATEGORIAS_PADRAO.map(({ nome, direction, grupo, conta_cac }) => ({ nome, direction, grupo, conta_cac })));
  });
});
