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

/** fn_gf_pode roda nas policies dos Contratos ANTES de o Financeiro existir: sem gf_acessos, só admin. */
describe("fn_gf_pode sem a tabela gf_acessos", () => {
  const ini = sqlTexto.indexOf("create or replace function public.fn_gf_pode(");
  const fn = sqlTexto.slice(ini, sqlTexto.indexOf("$$;", ini));
  it("admin passa antes de qualquer consulta; sem gf_acessos devolve false; a consulta é dinâmica", () => {
    expect(ini).toBeGreaterThan(-1);
    const admin = fn.indexOf("if public.fn_role_at_least(p_org, 'admin') then\n    return true;");
    const guarda = fn.search(/to_regclass\('public\.gf_acessos'\) is null[\s\S]*?then\s+return false;/);
    expect(admin).toBeGreaterThan(-1);
    expect(guarda).toBeGreaterThan(admin);
    expect(fn.indexOf("execute 'select nivel from public.gf_acessos")).toBeGreaterThan(guarda);
    expect(fn).not.toMatch(/^\s*select[^']*from public\.gf_acessos/m); // nenhuma consulta estática
  });
});
