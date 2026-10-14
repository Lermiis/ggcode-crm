# Módulo Financeiro (gestão financeira) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a área **Financeiro** do sistema de gestão:
- Visão geral, Lançamentos, Fluxo de caixa, DRE, Métricas e Acesso;
- permissões por pessoa, que valem também para Contratos;
- edição de contrato com refazer parcelamento;
- testes e imagens rodando no Docker local.

**Architecture:**
- **Módulo ADR-0002** `gestao_financeira`, provisionadora `fn_gestao_financeira_provisionar()`. Tabelas `gf_categorias`, `gf_recorrencias`, `gf_parcelamentos`, `gf_parcelas` e `gf_acessos`.
- **Permissão:** `fn_gf_pode(org, nivel)`.
- **Escritas no caixa núcleo:** feitas por RPCs `security definer` (`fn_gf_*`) que checam `fn_gf_pode(org,'editar')`. A RLS do núcleo exige `manager`, e a permissão do Financeiro é por pessoa.
- **Leituras:** pela sessão, e as rotas checam `fn_gf_pode(org,'ver')`.
- **Cálculos:** funções puras em `lib/gestao-financeira/`.
- **Rotas e telas:** rotas finas em `app/api/v1/gestao-financeira/`, telas em `app/app/financeiro/`.

**Tech Stack:** Next.js 16, TypeScript, Supabase/Postgres 15 (RLS, plpgsql), zod, @tanstack/react-query, shadcn/ui, recharts, vitest, Docker Desktop (local).

**Spec:** `docs/ggcode/spec-modulo-financeiro.md` (aprovada em 14/10/2026). Módulo Contratos anterior: `docs/ggcode/spec-modulo-contratos.md`.

## Global Constraints

- Base: `main` do `Lermiis/ggcode-crm` (v1.80.0-gg.1 + spec). Trabalho na branch `ggcode/financeiro`.
- Slug do módulo: **`gestao_financeira`**, porque `financeiro` já é o módulo de Comandas do upstream. Prefixo das tabelas: `gf_`. Rótulo na tela: "Financeiro".
- Migrations: faixa GG Code **9002+**, arquivo `supabase/migrations/<timestamp>_9002_ggcode_gestao_financeira.sql`, com `-- manifest:` no cabeçalho. O mesmo SQL vai no apêndice do `baseline.sql`, **antes** do bloco "VARREDURA anon" (lição da 9001). O MANIFEST.md não é tocado. Sem BEGIN/COMMIT, tudo idempotente. O timestamp deve ser ≥ o da 9001 (`20261015000000`).
- Nenhuma coluna casa com `\m(name|nome|apelido|sobrenome|email|telefone|phone|celular|whatsapp|cpf|cnpj|rg|cep|endereco|address|nascimento|birthdate|documento)`. Nenhuma FK para `contacts`.
- `security definer` sempre com `set search_path = public, pg_temp`. Revogar EXECUTE de `public, anon` e conceder a `authenticated` (as RPCs) ou a `service_role` (a provisionadora). Registrar em `tests/invariants/hardening-definer-varredura.test.ts` (`AUTHENTICATED_PERMITIDO`) com razão e rota que chama.
- Tabelas de módulo: registrar em `PROVA_DE_MODULO` (`tests/invariants/adr-0002-d8-varreduras-com-os-modulos-instalados.test.ts`). O módulo entra em `lib/modulos/catalogo.ts`, `lib/instalacao/modulos.ts` (`MODULOS_OPCIONAIS` e `MODULOS_DE_TABELA`) e `lib/recursos-opcionais/catalogo.ts`.
- Dinheiro em centavos. Datas civis `America/Sao_Paulo` via `hojeNoFuso()` (`lib/contratos/regras.ts`). Parse de dinheiro via `reaisParaCentavos` (`lib/contratos/dinheiro.ts`).
- Permissão:
  - `admin` da org sempre pode tudo;
  - fora isso, só quem tem linha em `gf_acessos` (`ver` ou `editar`);
  - sem linha nenhuma, só admins;
  - `gf_acessos` só admin lê e escreve.
- Detecção de módulo ausente: `moduloAusente()` de `lib/contratos/modulo.ts`.
- Menu: "Financeiro" no hub Análise › Dinheiro, **sem** `sidebar: true` (o teste do upstream limita a 15 itens), com `modulo: "gestao_financeira"`.
- i18n: toda string de `t()` precisa de entrada `es` em `lib/i18n/dicionario.ts` (exigência dos testes). Não usar `t(variavel)`, só literais.
- Gráficos: recharts, no padrão de `components/ai/UsageChart.tsx`.
- Commits em Conventional Commits, terminando com linha em branco + `Co-Authored-By: Claude <Modelo> 5.5 <noreply@anthropic.com>` (o modelo real). `git user.email` já é o noreply do GitHub: não alterar.
- **Docker local:** o CLI fica em `/c/Users/User/AppData/Local/Programs/DockerDesktop/resources/bin`. Exportar no PATH em cada shell: `export PATH="/c/Users/User/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"`. pnpm via `npx pnpm@9.15.9`. Typecheck: `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.typecheck.json`.
- Teste de invariantes local: `npx pnpm@9.15.9 test:db` (Task 1 garante que roda). É **obrigatório verde** antes de cada push que mexe em SQL.

## Review Focus

1. **Recebimento de contrato contado duas vezes no Faturado.** A cobrança do contrato (vencimento em M) e o `financial_entries` do recebimento (`entry_date` em M) são o mesmo dinheiro. Teste em Task 2 (`visaoGeral`).
2. **Usuário com acesso `ver` tentando escrever** pela rota ou pela RPC: tem de receber 403 ou exceção `gf_forbidden`. E **agente sem linha em `gf_acessos`** tem de ser recusado em Contratos depois da 9002. Testes em Task 3 (invariantes).
3. **Refazer parcelamento de implantação com parcela já recebida:** a soma das novas parcelas = total − recebido, sem colidir `competencia` com as recebidas. Teste em Task 5 (`refazerParcelamento`).
4. **Métrica sem base** (CAC sem cliente novo, LTV sem churn nem contrato, ROI sem custo) tem de dar `null` com motivo, nunca `0`, `Infinity` ou `NaN`. Testes em Task 2.
5. **Projeção do fluxo** sem contar duas vezes a recorrência que já gerou o lançamento pendente do mês, nem a mensalidade que já virou cobrança. Teste em Task 2 (`fluxoProjetado`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `docs/ggcode/ESTEIRA.md` | como testar, montar e publicar com Docker local |
| `scripts/ggcode/publicar.sh` | monta as imagens e publica na VPS (Task 7) |
| `lib/gestao-financeira/tipos.ts` | tipos compartilhados |
| `lib/gestao-financeira/calculos.ts` | visão geral, fluxo, DRE e métricas (puro) |
| `lib/gestao-financeira/parcelas.ts` | gerar parcelado e datas mensais (puro) |
| `lib/gestao-financeira/categorias-padrao.ts` | lista das categorias padrão |
| `lib/gestao-financeira/esquemas.ts` | zod das rotas |
| `lib/gestao-financeira/acesso.ts` | helper de rota: `exigirAcesso(nivel)` |
| `lib/contratos/edicao.ts` | `refazerParcelamento` (puro) |
| `supabase/migrations/…_9002_ggcode_gestao_financeira.sql` + apêndice | provisionadora, `fn_gf_pode`, RPCs, policies dos Contratos |
| `tests/unit/gf-*.test.ts`, `tests/unit/contratos-edicao.test.ts` | unitários |
| `tests/invariants/gf-*.test.ts` | RLS, RPCs e permissão nos Contratos |
| `app/api/v1/gestao-financeira/**` | rotas |
| `app/api/v1/contratos/[id]/route.ts` (alterado), `app/api/v1/contratos/[id]/formas/[formaId]/route.ts` (novo) | edição de contrato |
| `app/app/financeiro/**` | telas |
| `app/app/contratos/_editar.tsx` (novo) e `_contratos.tsx` (alterado) | editar contrato |
| `lib/navigation/catalogo.ts`, `lib/i18n/dicionario.ts`, catálogos de módulo (alterados) | registro |

---

### Task 1: Esteira local com Docker

**Files:**
- Create: `docs/ggcode/ESTEIRA.md`
- Modify (somente se necessário para rodar no Windows/Git Bash): nenhum arquivo do upstream sem registrar o motivo no relatório

**Interfaces:**
- Produces: comando confiável `npx pnpm@9.15.9 test:db` rodando localmente e verde em `main`. Documentação de como rodá-lo.

- [ ] **Step 1: Rodar o test:db na main atual**

```bash
export PATH="/c/Users/User/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"
cd "C:/Users/User/Desktop/GG Code/CRM/DeskcommCRM"
git checkout main && git checkout -b ggcode/financeiro
npx pnpm@9.15.9 test:db 2>&1 | tee /tmp/testdb.log | tail -40
```
Expected: termina com "test:db verde" (como no CI) e os invariantes passam. Se falhar por ambiente Windows (caminhos, `bash`, CRLF, `docker exec -i`), ler `scripts/test-db.sh` e corrigir o mínimo via variáveis de ambiente que o script já aceita (`TEST_DB_IMAGE`, porta etc.). Só se não houver opção, fazer um patch pequeno, explicado no relatório. **Não desligar** nenhum teste.

- [ ] **Step 2: Documentar**

`docs/ggcode/ESTEIRA.md`:

```markdown
# Esteira GG Code (Docker local)

- PATH do Docker no Git Bash: `export PATH="/c/Users/User/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"`
- Unitários de um arquivo: `npx pnpm@9.15.9 vitest run <arquivo>`
- Invariantes do banco (obrigatório antes de push com SQL): `npx pnpm@9.15.9 test:db`
- Typecheck: `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit -p tsconfig.typecheck.json`
- Publicar na VPS: `bash scripts/ggcode/publicar.sh <vX.Y.Z-gg.N>` (ver Task 7 do plano do Financeiro)
- Atualizar do upstream: `git fetch upstream --tags && git merge <tag-upstream>` na `main`, resolver, `test:db` verde, nova tag `-gg.N`, publicar.
```

(Completar com o que o Step 1 descobriu: tempo de execução e variáveis usadas.)

- [ ] **Step 3: Commit**

```bash
git add docs/ggcode/ESTEIRA.md
git commit -m "docs(ggcode): local docker pipeline"
```

---

### Task 2: Cálculos puros do Financeiro

**Files:**
- Create: `lib/gestao-financeira/tipos.ts`, `lib/gestao-financeira/calculos.ts`, `lib/gestao-financeira/parcelas.ts`, `lib/gestao-financeira/categorias-padrao.ts`
- Test: `tests/unit/gf-calculos.test.ts`, `tests/unit/gf-parcelas.test.ts`

**Interfaces:**
- Consumes: `hojeNoFuso`, `somarMeses`, `dividirEmParcelas`, `competenciaMensal` de `lib/contratos/regras.ts`.
- Produces:

```ts
// tipos.ts
export type Grupo = "receita" | "imposto" | "custo_variavel" | "pessoal" | "assinaturas" | "marketing" | "estrutura" | "outras_despesas";
export interface Lancamento {
  id: string; direction: "in" | "out"; amount_cents: number; entry_date: string; // YYYY-MM-DD
  status: "pending" | "paid"; paid_date: string | null; // YYYY-MM-DD (paid_at no fuso)
  grupo: Grupo; conta_cac: boolean; origin: string; reverses_entry_id: string | null;
  cobranca_contrato: boolean; // true se é o lançamento do recebimento de uma cobrança de contrato
  cliente_id: string | null;  // lead_id/contrato quando conhecido
}
export interface CobrancaContrato { vencimento: string; valor_cents: number; situacao: "a_receber" | "recebida" | "cancelada"; recebida_em: string | null; contrato_id: string; }
export interface ContratoResumo { id: string; inicio: string; fim: string | null; situacao: "ativo" | "encerrado" | "cancelado"; criado_em: string; encerrado_em: string | null; mensal_cents: number; }
export interface Recorrencia { id: string; direction: "in" | "out"; amount_cents: number; day_of_month: number; is_active: boolean; fim: string | null; grupo: Grupo; }
export interface Metrica { valor: number | null; motivo?: string } // null = "—"
export interface VisaoGeral { faturado: number; recebido: number; custos: number; lucro: number; margem: Metrica; aReceber: number; atrasado: number; aPagar: number; saldo: number; }
```

```ts
// calculos.ts (todas puras)
export function visaoGeral(i: { mes: string /* YYYY-MM */; hoje: string; lancamentos: Lancamento[]; cobrancas: CobrancaContrato[]; saldoInicialContas: number }): VisaoGeral;
export function serie12Meses(i: { ateMes: string; lancamentos: Lancamento[] }): Array<{ mes: string; receita: number; custos: number; lucro: number }>;
export function fluxoProjetado(i: { hoje: string; mesesFuturos: number; saldoAtual: number; lancamentos: Lancamento[]; recorrencias: Recorrencia[]; contratos: ContratoResumo[]; cobrancas: CobrancaContrato[] }): Array<{ mes: string; entradas: number; saidas: number; saldo: number; projetado: boolean }>;
export function dre(i: { mes: string; lancamentos: Lancamento[] }): Array<{ chave: string; rotulo: string; valor: number; pct: number | null; destaque?: boolean }>;
export function metricas(i: { de: string; ate: string /* YYYY-MM inclusivos */; lancamentos: Lancamento[]; contratos: ContratoResumo[]; ganhosSemContrato: number }): Record<"mrr"|"ticketMedio"|"churn"|"clientesNovos"|"cac"|"ltv"|"ltvCac"|"payback"|"roiEmpresa"|"roiMarketing"|"pontoEquilibrio", Metrica>;
// parcelas.ts
export function gerarParcelado(i: { total_cents: number; parcelas: number; primeiro: string }): Array<{ numero: number; entry_date: string; amount_cents: number }>;
// categorias-padrao.ts
export const CATEGORIAS_PADRAO: ReadonlyArray<{ nome: string; direction: "in" | "out"; grupo: Grupo; conta_cac: boolean }>;
```

- [ ] **Step 1: Escrever os testes que falham**

`tests/unit/gf-calculos.test.ts`: um `describe` por função. Os casos são obrigatórios: escrever cada `it` com os valores abaixo.

```ts
import { describe, expect, it } from "vitest";

import { dre, fluxoProjetado, metricas, serie12Meses, visaoGeral } from "@/lib/gestao-financeira/calculos";
import type { Lancamento } from "@/lib/gestao-financeira/tipos";

const L = (p: Partial<Lancamento>): Lancamento => ({
  id: Math.random().toString(36).slice(2), direction: "in", amount_cents: 0, entry_date: "2026-10-10",
  status: "pending", paid_date: null, grupo: "receita", conta_cac: false, origin: "manual",
  reverses_entry_id: null, cobranca_contrato: false, cliente_id: null, ...p,
});

describe("visaoGeral", () => {
  it("faturado não conta duas vezes o recebimento de cobrança de contrato (Review Focus 1)", () => {
    const v = visaoGeral({
      mes: "2026-10", hoje: "2026-10-14", saldoInicialContas: 0,
      cobrancas: [{ vencimento: "2026-10-10", valor_cents: 50000, situacao: "recebida", recebida_em: "2026-10-10", contrato_id: "k1" }],
      lancamentos: [L({ amount_cents: 50000, status: "paid", paid_date: "2026-10-10", cobranca_contrato: true })],
    });
    expect(v.faturado).toBe(50000);
    expect(v.recebido).toBe(50000);
  });
  it("lucro de caixa = recebido − saídas pagas; margem null sem recebido", () => {
    const v = visaoGeral({ mes: "2026-10", hoje: "2026-10-14", saldoInicialContas: 100000, cobrancas: [], lancamentos: [
      L({ direction: "out", grupo: "assinaturas", amount_cents: 9900, status: "paid", paid_date: "2026-10-05" }),
    ] });
    expect(v.lucro).toBe(-9900);
    expect(v.margem).toEqual({ valor: null, motivo: "Sem receita no mês." });
    expect(v.saldo).toBe(90100);
  });
  it("a receber / atrasado / a pagar", () => {
    const v = visaoGeral({ mes: "2026-10", hoje: "2026-10-14", saldoInicialContas: 0, lancamentos: [
      L({ amount_cents: 1000, entry_date: "2026-10-01" }), L({ amount_cents: 2000, entry_date: "2026-10-20" }),
      L({ direction: "out", grupo: "estrutura", amount_cents: 500, entry_date: "2026-10-25" }),
    ], cobrancas: [{ vencimento: "2026-10-05", valor_cents: 3000, situacao: "a_receber", recebida_em: null, contrato_id: "k" }] });
    expect(v.atrasado).toBe(4000);
    expect(v.aReceber).toBe(2000);
    expect(v.aPagar).toBe(500);
  });
});

describe("dre", () => {
  it("margem de contribuição e resultado com %", () => {
    const linhas = dre({ mes: "2026-10", lancamentos: [
      L({ amount_cents: 100000, grupo: "receita" }), L({ direction: "out", amount_cents: 6000, grupo: "imposto" }),
      L({ direction: "out", amount_cents: 4000, grupo: "custo_variavel" }), L({ direction: "out", amount_cents: 30000, grupo: "pessoal" }),
      L({ direction: "out", amount_cents: 10000, grupo: "marketing" }),
    ] });
    const v = Object.fromEntries(linhas.map((l) => [l.chave, l]));
    expect(v.receita_bruta.valor).toBe(100000);
    expect(v.receita_liquida.valor).toBe(94000);
    expect(v.margem_contribuicao.valor).toBe(90000);
    expect(v.margem_contribuicao.pct).toBe(90);
    expect(v.resultado.valor).toBe(50000);
  });
  it("estorno (reverses_entry_id) anula o lançamento estornado", () => {
    const a = L({ id: "a", direction: "out", amount_cents: 5000, grupo: "estrutura" });
    const r = L({ direction: "in", amount_cents: 5000, grupo: "estrutura", origin: "reversal", reverses_entry_id: "a" });
    const v = Object.fromEntries(dre({ mes: "2026-10", lancamentos: [a, r] }).map((l) => [l.chave, l]));
    expect(v.resultado.valor).toBe(0);
  });
});

describe("fluxoProjetado (Review Focus 5)", () => {
  it("recorrência que já gerou o pendente do mês não conta duas vezes; mensalidade que já virou cobrança também não", () => {
    const f = fluxoProjetado({
      hoje: "2026-10-14", mesesFuturos: 2, saldoAtual: 0,
      lancamentos: [L({ direction: "out", grupo: "assinaturas", amount_cents: 9900, entry_date: "2026-11-05", origin: "recurring" })],
      recorrencias: [{ id: "r", direction: "out", amount_cents: 9900, day_of_month: 5, is_active: true, fim: null, grupo: "assinaturas" }],
      contratos: [{ id: "k", inicio: "2026-01-01", fim: null, situacao: "ativo", criado_em: "2026-01-01", encerrado_em: null, mensal_cents: 50000 }],
      cobrancas: [{ vencimento: "2026-11-10", valor_cents: 50000, situacao: "a_receber", recebida_em: null, contrato_id: "k" }],
    });
    const nov = f.find((m) => m.mes === "2026-11")!;
    expect(nov.saidas).toBe(9900);
    expect(nov.entradas).toBe(50000);
    const dez = f.find((m) => m.mes === "2026-12")!;
    expect(dez.saidas).toBe(9900);
    expect(dez.entradas).toBe(50000);
    expect(dez.saldo).toBe(80200);
  });
  it("recorrência com fim não projeta depois do fim", () => {
    const f = fluxoProjetado({ hoje: "2026-10-14", mesesFuturos: 2, saldoAtual: 0, lancamentos: [], contratos: [], cobrancas: [],
      recorrencias: [{ id: "r", direction: "out", amount_cents: 100, day_of_month: 5, is_active: true, fim: "2026-11-30", grupo: "assinaturas" }] });
    expect(f.find((m) => m.mes === "2026-12")!.saidas).toBe(0);
  });
});

describe("metricas (Review Focus 4)", () => {
  it("sem base → null com motivo, nunca 0/Infinity/NaN", () => {
    const m = metricas({ de: "2026-10", ate: "2026-10", lancamentos: [], contratos: [], ganhosSemContrato: 0 });
    for (const k of ["cac", "ltv", "ltvCac", "payback", "roiEmpresa", "roiMarketing", "churn", "ticketMedio"] as const) {
      expect(m[k].valor).toBeNull();
      expect(m[k].motivo).toBeTruthy();
    }
    expect(m.mrr.valor).toBe(0);
    expect(m.clientesNovos.valor).toBe(0);
  });
  it("CAC = marketing (conta_cac) ÷ clientes novos; LTV/CAC e payback", () => {
    const m = metricas({ de: "2026-10", ate: "2026-10", ganhosSemContrato: 0,
      contratos: [
        { id: "a", inicio: "2026-10-01", fim: null, situacao: "ativo", criado_em: "2026-10-02", encerrado_em: null, mensal_cents: 50000 },
        { id: "b", inicio: "2026-01-01", fim: null, situacao: "ativo", criado_em: "2026-01-01", encerrado_em: null, mensal_cents: 50000 },
        { id: "c", inicio: "2026-01-01", fim: "2026-10-05", situacao: "encerrado", criado_em: "2026-01-01", encerrado_em: "2026-10-05", mensal_cents: 50000 },
      ],
      lancamentos: [
        L({ direction: "out", grupo: "marketing", conta_cac: true, amount_cents: 60000, status: "paid", paid_date: "2026-10-03" }),
        L({ amount_cents: 100000, status: "paid", paid_date: "2026-10-10", cliente_id: "a" }),
      ],
    });
    expect(m.clientesNovos.valor).toBe(1);
    expect(m.cac.valor).toBe(60000);
    expect(m.mrr.valor).toBe(100000);
    expect(m.churn.valor).toBe(50); // 1 encerrado ÷ 2 ativos no início (b, c) = 50%
  });
});
```

`tests/unit/gf-parcelas.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { gerarParcelado } from "@/lib/gestao-financeira/parcelas";

describe("gerarParcelado", () => {
  it("6x de 1000,00 a partir de 31/01 cai no último dia em fev", () => {
    const p = gerarParcelado({ total_cents: 100000, parcelas: 6, primeiro: "2027-01-31" });
    expect(p).toHaveLength(6);
    expect(p[1]).toEqual({ numero: 2, entry_date: "2027-02-28", amount_cents: 16666 });
    expect(p[0]!.amount_cents).toBe(16670);
    expect(p.reduce((s, x) => s + x.amount_cents, 0)).toBe(100000);
  });
});
```

Run: `npx pnpm@9.15.9 vitest run tests/unit/gf-calculos.test.ts tests/unit/gf-parcelas.test.ts`. Expected: FAIL (módulos inexistentes).

- [ ] **Step 2: Implementar `tipos.ts`, `parcelas.ts`, `categorias-padrao.ts` e `calculos.ts`**

Regras exatas (spec §4). Detalhes que os testes fixam:

- **Mês de um lançamento:**
  - competência = `entry_date.slice(0,7)`;
  - caixa = `paid_date?.slice(0,7)`.
- **Estornos:** um lançamento com `reverses_entry_id` e o lançamento estornado **se anulam**. Remover os dois de todos os cálculos.
- **`visaoGeral`:**
  - `faturado` = entradas com competência M (exceto `cobranca_contrato`) + cobranças de contrato com vencimento em M e situação ≠ cancelada;
  - `recebido` = entradas `paid` com caixa M (inclui `cobranca_contrato`);
  - `custos` = saídas com competência M;
  - `lucro` = recebido − saídas `paid` com caixa M;
  - `margem` = lucro ÷ recebido × 100, arredondado a 1 casa. Se não houver recebido, `{valor:null, motivo:"Sem receita no mês."}`;
  - `aReceber` = entradas pendentes com `entry_date ≥ hoje` + cobranças `a_receber` com vencimento ≥ hoje (sem considerar o mês). `atrasado` = as que vencem antes de hoje;
  - `aPagar` = saídas pendentes;
  - `saldo` = saldoInicialContas + entradas pagas − saídas pagas (todas as datas).
- **`serie12Meses`:** 12 meses terminando em `ateMes`, com receita = recebido do mês, custos = saídas pagas do mês, lucro = diferença.
- **`dre`** (competência M):
  - linhas, nesta ordem, com `chave`: `receita_bruta`, `impostos`, `receita_liquida`*, `custos_variaveis`, `margem_contribuicao`*, `pessoal`, `assinaturas`, `marketing`, `estrutura`, `outras_despesas`, `resultado`*;
  - `*` = `destaque: true`;
  - `pct` = valor ÷ receita bruta × 100 (1 casa), ou `null` se a receita for 0;
  - as despesas entram como **valor positivo** na linha, e as fórmulas subtraem.
- **`fluxoProjetado`:**
  - meses de `hoje` até +`mesesFuturos`;
  - mês corrente = realizado + pendentes do mês;
  - meses futuros: pendentes com `entry_date` no mês + recorrências ativas (`fim` nulo ou ≥ data do mês) **que não têm lançamento `origin:'recurring'` com o mesmo valor e direção naquele mês** + mensalidade de contratos ativos (até `fim`) **sem cobrança de contrato naquele mês** + cobranças `a_receber` do mês;
  - `saldo` acumulado a partir de `saldoAtual`, somando entradas − saídas dos meses futuros e do restante do mês corrente.
- **`metricas`** (período `de`..`ate`, meses inclusivos):
  - `clientesNovos` = contratos com `criado_em` no período, ou `ganhosSemContrato` se não houver contrato nenhum;
  - `mrr` = Σ `mensal_cents` dos contratos com situação ativo;
  - `ticketMedio` = recebido no período ÷ nº de `cliente_id` distintos com recebimento. Sem clientes → null, "Nenhum recebimento identificado por cliente.";
  - `churn` (%) = encerrados no período ÷ ativos no início do período (`criado_em` < início e não encerrados antes). Divide por nº de meses se o período > 1. Sem ativos no início → null;
  - `cac` = Σ saídas `conta_cac` no período ÷ clientesNovos. Sem gasto → null, "Lance os gastos de marketing (categorias de marketing)."; sem clientes novos → null, "Nenhum cliente novo no período.";
  - `ltv` = (mrr ÷ nº de contratos ativos) × permanência (meses = 100 ÷ churn%). Sem churn: duração média dos contratos com `fim`; sem nada → null;
  - `ltvCac` = ltv ÷ cac (2 casas);
  - `payback` = cac ÷ (mrr ÷ ativos), em meses (1 casa);
  - `roiEmpresa` = (receita − custos) ÷ custos × 100, na competência do período;
  - `roiMarketing` = (recebido dos clientes novos − gasto marketing) ÷ gasto marketing × 100;
  - `pontoEquilibrio` = despesas fixas (pessoal + assinaturas + marketing + estrutura + outras) ÷ (margem de contribuição ÷ receita), em centavos. Sem margem → null.
- `CATEGORIAS_PADRAO`: exatamente as da spec §3, com `conta_cac=true` nas 6 de marketing.

- [ ] **Step 3: Testes verdes, lint, typecheck e commit**

Run: `npx pnpm@9.15.9 vitest run tests/unit/gf-calculos.test.ts tests/unit/gf-parcelas.test.ts && npx eslint lib/gestao-financeira tests/unit/gf-*.test.ts`. Expected: PASS.

```bash
git add lib/gestao-financeira tests/unit/gf-calculos.test.ts tests/unit/gf-parcelas.test.ts
git commit -m "feat(financeiro): pure finance calculations (overview, cash flow, P&L, metrics)"
```

---

### Task 3: Banco: módulo `gestao_financeira`, permissões e RPCs

**Files:**
- Create: `supabase/migrations/20261015000100_9002_ggcode_gestao_financeira.sql`
- Modify: `supabase/baseline.sql` (apêndice antes de "VARREDURA anon"), `lib/modulos/catalogo.ts`, `lib/instalacao/modulos.ts`, `lib/recursos-opcionais/catalogo.ts`, `tests/invariants/adr-0002-d8-varreduras-com-os-modulos-instalados.test.ts`, `tests/invariants/hardening-definer-varredura.test.ts`
- Create: `tests/invariants/gf-rls-e-acesso.test.ts`, `tests/invariants/gf-rpcs.test.ts`
- Modify: `tests/invariants/contratos-rls-por-operacao.test.ts` (nova regra de acesso)

**Interfaces:**
- Produces:
  - Tabelas `gf_categorias(account_plan_id pk, organization_id, grupo, conta_cac)`, `gf_recorrencias(recurring_entry_id pk, organization_id, fim)`, `gf_parcelamentos(id, organization_id, descricao, total_cents, parcelas, created_at)`, `gf_parcelas(entry_id pk, organization_id, parcelamento_id, numero)` e `gf_acessos(organization_id, user_id, nivel, concedido_por, updated_at, pk(org,user))`.
  - `fn_gf_pode(p_org uuid, p_nivel text) returns boolean`: stable, security definer. Admin → true; `ver` aceita nível ver/editar; `editar` só editar. **Não depende das tabelas existirem**: se `to_regclass('public.gf_acessos')` for nulo, só admin.
  - RPCs (todas `security definer`, checam `auth.uid()` e `fn_gf_pode(p_org,'editar')`, levantam `gf_forbidden` 42501). Usam `record`/`jsonb`, nunca `%rowtype` (D7).
    - `fn_gf_semear_categorias(p_org uuid) returns int`: idempotente; cria `account_plans` + `gf_categorias` de `CATEGORIAS_PADRAO`, que a migration replica em SQL.
    - `fn_gf_lancamento_criar(p_org, p_direction, p_account_id, p_account_plan_id, p_amount_cents, p_entry_date, p_description, p_pago boolean, p_paid_date date) returns uuid`.
    - `fn_gf_parcelado_criar(p_org, p_direction, p_account_id, p_account_plan_id, p_total_cents, p_parcelas int, p_primeiro date, p_description) returns uuid` (parcelamento_id): cria N pendentes + `gf_parcelamentos` + `gf_parcelas`. Sobra de centavos na 1ª. Datas mês a mês, com o último dia em mês curto.
    - `fn_gf_lancamento_editar(p_org, p_entry uuid, p_amount_cents, p_entry_date, p_account_id, p_account_plan_id, p_description) returns void`: só `pending`. Pago → `lancamento_pago_imutavel`.
    - `fn_gf_lancamento_pagar(p_org, p_entry, p_paid_date date) returns void`: pending → paid (`paid_at` = p_paid_date ao meio-dia em São Paulo).
    - `fn_gf_lancamento_corrigir(p_org, p_entry, p_amount_cents, p_entry_date, p_account_id, p_account_plan_id, p_description) returns uuid`: para pago, cria o contra-lançamento (`origin='reversal'`, `reverses_entry_id`, direção oposta, mesmo valor, `paid`) + o novo lançamento `paid`. Devolve o id novo.
    - `fn_gf_lancamento_excluir(p_org, p_entry) returns void`: só `pending`. Também apaga `gf_parcelas`.
    - `fn_gf_recorrencia_salvar(p_org, p_id uuid null, p_direction, p_account_id, p_account_plan_id, p_amount_cents, p_day int, p_description, p_fim date null) returns uuid`: cria ou edita o molde `recurring_entries` + `gf_recorrencias`.
    - `fn_gf_recorrencia_encerrar(p_org, p_id) returns void`.
    - `fn_gf_categoria_salvar(p_org, p_id uuid null, p_nome text, p_direction, p_grupo, p_conta_cac) returns uuid`.
    - `fn_gf_acesso_definir(p_org, p_user uuid, p_nivel text /* 'nenhum'|'ver'|'editar' */) returns void`: só admin (`fn_role_at_least(p_org,'admin')`). `nenhum` apaga a linha. Recusa definir acesso de quem não é membro ativo da org. Audita em `api_audit_log` pela rota, não aqui.
  - **Contratos:** as policies de `contratos`, `contrato_formas` e `contrato_cobrancas` são recriadas com `fn_gf_pode(organization_id,'ver')` no SELECT e `fn_gf_pode(organization_id,'editar')` em INSERT/UPDATE/DELETE, **mantendo** as demais condições da 9001 (mesma org do contrato/forma/lead, recebida imutável, sem delete com recebida). `fn_contratos_cobranca_receber` passa a checar `fn_gf_pode(p_org,'editar')` no lugar de `fn_role_at_least(p_org,'manager')`. A 9002 **altera a 9001 via `create or replace` e drop/create policy**. A provisionadora dos Contratos também precisa sair com as policies novas, senão uma reinstalação restaura as velhas: atualizar o corpo de `fn_contratos_provisionar()` na 9002, com o mesmo texto e as policies novas.

- [ ] **Step 1: Testes de invariante (vermelhos)**

`tests/invariants/gf-rls-e-acesso.test.ts`, no molde de `contratos-rls-por-operacao.test.ts`, com `seedGov` e `writeCountAs`. Casos:
- **admin (GOV_ADMIN, conferir o nome em gov-helpers):** lê e escreve `gf_categorias`;
- **manager sem linha em gf_acessos:** lê 0 linhas de `gf_categorias` e não escreve (Review Focus 2: manager não é admin);
- **viewer com `ver`:** lê e não escreve;
- **agent com `editar`:** escreve;
- **`gf_acessos`:** só admin lê e escreve (manager com `editar` não lê nem escreve);
- **cross-org:** usuário com `editar` na org A não lê a org B;
- **Contratos:** manager **sem** linha não lê `contratos` (nova regra); com `ver` lê e não escreve; com `editar` escreve (controle positivo).

`tests/invariants/gf-rpcs.test.ts`, no molde de `contratos-receber-uma-vez.test.ts`:
- `fn_gf_lancamento_criar` com usuário `ver` → `gf_forbidden`;
- com `editar` → cria;
- `fn_gf_parcelado_criar` 100000 em 3 → 3 pendentes que somam 100000, com `gf_parcelas` 1..3;
- `fn_gf_lancamento_editar` num pago → `lancamento_pago_imutavel`;
- `fn_gf_lancamento_corrigir` num pago → contra-lançamento + novo, e a soma líquida reflete o valor novo;
- `fn_gf_lancamento_excluir` num pago → recusa;
- `fn_gf_semear_categorias` duas vezes → mesma contagem (idempotente);
- `fn_gf_acesso_definir` por manager → recusa; por admin → grava e `nenhum` apaga;
- conta (`p_account_id`) de outra org → recusa;
- `fn_contratos_cobranca_receber` com usuário `ver` → `gf_forbidden` ou `contratos_forbidden`. Escolher **um** código e documentar: recomendado manter `contratos_forbidden`, por compatibilidade com a rota.

Atualizar `contratos-rls-por-operacao.test.ts`: os casos que davam escrita ao manager agora precisam conceder `editar` (insert em `gf_acessos` como postgres, após provisionar `gestao_financeira`) ou usar admin. **Não enfraquecer** as asserções.

- [ ] **Step 2: Migration 9002 + apêndice do baseline**

Escrever o SQL conforme as Interfaces, no molde da 9001 (`supabase/migrations/20261015000000_9001_ggcode_modulo_contratos.sql`; ler inteira antes). Pontos de atenção:
- `fn_gf_pode` precisa compilar sem as tabelas, via `to_regclass`, e usar `execute` dinâmico ou `exists` sob `if to_regclass(...) is not null`. Ela é chamada nas policies dos Contratos, que existem antes de instalar o Financeiro.
- **Contas e categorias passadas às RPCs:** conferir que são da `p_org` e estão ativas, como em `fn_contratos_cobranca_receber`.
- **Datas de parcela:** em SQL, `(p_primeiro + (k * interval '1 month'))::date` já cai no último dia do mês em mês curto no Postgres. Conferir com teste.
- **`paid_at` a partir de data civil:** `(p_paid_date::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'`.
- **Trigger `trg_financial_entries_imutavel`:** continua valendo. Nunca alterar um pago.
- **Grants:** `revoke execute ... from public, anon; grant ... to authenticated` em cada RPC. A provisionadora fica só para `service_role`.
- **Registros:** catálogo (`slug: "gestao_financeira"`, nome "Financeiro (gestão)", descrição curta), `MODULOS_OPCIONAIS`/`MODULOS_DE_TABELA`, `recursos-opcionais/catalogo.ts` (o `Record` exaustivo), `PROVA_DE_MODULO` (5 tabelas, apontando para `gf-rls-e-acesso.test.ts`, razão ≥ 40 caracteres) e `AUTHENTICATED_PERMITIDO` (cada RPC, com razão e rota em `app/api/v1/gestao-financeira/...`).

- [ ] **Step 3: Rodar local**

Run: `npx pnpm@9.15.9 checar:colisao-de-migration && npx pnpm@9.15.9 vitest run tests/unit/manifest-x-migrations.test.ts tests/unit/adr-0002-funcao-provisionadora.test.ts && npx pnpm@9.15.9 test:db`
Expected: tudo verde, incluindo os invariantes novos e os antigos (lgpd, d8, definer, rls-isolation, contratos-*).

- [ ] **Step 4: Commit**

```bash
git add supabase lib/modulos lib/instalacao lib/recursos-opcionais tests/invariants
git commit -m "feat(financeiro): finance module schema, per-person access and write RPCs; contracts follow finance access"
```

---

### Task 4: API do Financeiro

**Files:**
- Create: `lib/gestao-financeira/esquemas.ts`, `lib/gestao-financeira/acesso.ts`
- Create rotas em `app/api/v1/gestao-financeira/`:
  - `visao/route.ts` (GET `?mes=YYYY-MM`)
  - `lancamentos/route.ts` (GET filtros; POST criar ou parcelado)
  - `lancamentos/[id]/route.ts` (PATCH editar; DELETE excluir)
  - `lancamentos/[id]/pagar/route.ts` (POST)
  - `lancamentos/[id]/corrigir/route.ts` (POST)
  - `recorrencias/route.ts` (GET; POST salvar)
  - `recorrencias/[id]/encerrar/route.ts` (POST)
  - `categorias/route.ts` (GET; POST salvar; o primeiro GET chama `fn_gf_semear_categorias` se não houver nenhuma `gf_categorias` da org)
  - `fluxo/route.ts` (GET `?meses=6`)
  - `dre/route.ts` (GET `?mes=`)
  - `metricas/route.ts` (GET `?periodo=1|3|6|12`)
  - `acessos/route.ts` (GET lista de membros com nível, só admin; POST `{user_id, nivel}`, só admin)
  - `contas/route.ts` (GET contas ativas + saldo)
- Modify: `lib/audit/actions.ts` (ações `financeiro.*`)
- Test: `tests/unit/gf-esquemas.test.ts`

**Interfaces:**
- Consumes: Task 2 (cálculos e tipos), Task 3 (RPCs, `fn_gf_pode`).
- Produces (JSON `{data}`):
  - visão: `VisaoGeral & { serie: ReturnType<typeof serie12Meses> }`;
  - lançamentos: `Array<{ id, direction, amount_cents, entry_date, status, paid_date, description, categoria: {id,nome,grupo}|null, conta: {id,nome}, parcela: {numero,total}|null, recorrente: boolean, cobranca_contrato: boolean }>`;
  - fluxo: o retorno de `fluxoProjetado`;
  - dre: o de `dre`;
  - métricas: o de `metricas` + `{ periodo: {de, ate} }`;
  - acessos: `Array<{ user_id, nome, papel, nivel: 'admin'|'nenhum'|'ver'|'editar' }>`.
- `acesso.ts`: `export async function exigirAcesso(supabase, orgId: string, nivel: "ver" | "editar"): Promise<boolean>` (chama `rpc("fn_gf_pode")`). As rotas usam `requireRole("viewer")` e depois `exigirAcesso`. Sem acesso → `fail("forbidden","Sem acesso ao Financeiro.",403)`.

- [ ] **Step 1: zod (TDD)**

`tests/unit/gf-esquemas.test.ts` cobre:
- `lancamentoSchema`: direction, valor > 0, data, conta uuid, categoria uuid opcional, `pago` e `paid_date`;
- `parceladoSchema`: parcelas 2–60;
- `recorrenciaSchema`: dia 1–31, `fim` ≥ hoje opcional;
- `acessoSchema`: `nivel` em `nenhum|ver|editar`;
- casos inválidos de cada um.

Red → green como nos schemas de Contratos.

- [ ] **Step 2: Montagem dos dados para os cálculos**

Ler da sessão:
- `financial_entries` da org: período necessário; para o saldo, todas as pagas via agregação. Usar `select sum` com `.select("direction, amount_cents.sum()")` se a versão do PostgREST permitir; senão, buscar paginado com `limit` alto e somar no servidor. Documentar.
- join com `account_plans` + `gf_categorias` (grupo e `conta_cac`; sem linha → padrão por direction);
- `contrato_cobrancas` (`financial_entry_id` → marca `cobranca_contrato` e `cliente_id` = `contrato_id`);
- `contratos` com as formas de mensalidade (`mensal_cents`), `created_at` → `criado_em`, `updated_at` quando situação ≠ ativo → `encerrado_em`;
- `recurring_entries` + `gf_recorrencias`;
- `financial_accounts` (saldo inicial: conferir o nome da coluna no baseline);
- `paid_date` = `paid_at` convertido para data civil em São Paulo.

Isso fica num módulo só, `lib/gestao-financeira/carregar.ts` (servidor), com funções `carregarLancamentos(supabase, orgId, deData, ateData)` etc., reaproveitado pelas rotas.

- [ ] **Step 3: Rotas**

Mesmo padrão das rotas de Contratos (`app/api/v1/contratos/**`):
- `requireSupportWrite` nas escritas;
- `moduloAusente` → 409 `module_not_installed` com `MENSAGEM_MODULO_GF`;
- erros de RPC mapeados: `gf_forbidden` → 403, `lancamento_pago_imutavel` → 409 "Lançamento pago não muda. Use Corrigir.", `conta_invalida` → 422, 22007/22008 → 422;
- auditoria `financeiro.lancamento_criado`, `financeiro.lancamento_corrigido`, `financeiro.acesso_alterado` (metadata: `user_id` alvo e nível; sem PII).

- [ ] **Step 4: Verificar e commit**

Run: `npx pnpm@9.15.9 vitest run tests/unit/gf-*.test.ts && <typecheck> && npx eslint app/api/v1/gestao-financeira lib/gestao-financeira`. Rodar também os testes unitários que inventariam rotas e auditoria: os mesmos que a Task 3 de Contratos rodou (`grep -rl "audit/actions" tests/unit`).

```bash
git add lib/gestao-financeira app/api/v1/gestao-financeira lib/audit tests/unit/gf-esquemas.test.ts
git commit -m "feat(financeiro): finance API (overview, entries, recurrences, cash flow, P&L, metrics, access)"
```

---

### Task 5: Editar contrato e refazer parcelamento

**Files:**
- Create: `lib/contratos/edicao.ts`, `tests/unit/contratos-edicao.test.ts`
- Modify: `lib/contratos/esquemas.ts` (schemas de edição), `app/api/v1/contratos/[id]/route.ts` (PATCH aceita também `acao: "editar"`)
- Create: `app/api/v1/contratos/[id]/formas/[formaId]/route.ts` (PATCH valor/dia/descrição; POST `refazer-parcelamento` via `?acao=refazer`)
- Create: `app/app/contratos/_editar.tsx`; Modify: `app/app/contratos/_contratos.tsx` (botão Editar na Ficha)

**Interfaces:**
- Produces:

```ts
// lib/contratos/edicao.ts
export function refazerParcelamento(i: {
  total_cents: number;
  recebidas: Array<{ competencia: string; valor_cents: number }>; // parcela-k recebidas
  novasParcelas: number; primeiroVencimento: string;
}): Array<{ competencia: string; descricao: string; vencimento: string; valor_cents: number }>;
```

Regra (Review Focus 3):
- saldo = total − Σ recebidas;
- divide em `novasParcelas` com `dividirEmParcelas`;
- numeração continua depois do maior k recebido (`parcela-{k+1}…`);
- descrição "Implantação k/N", com N = recebidas + novas;
- vencimentos mês a mês com `somarMeses`;
- saldo ≤ 0 → lança erro "Nada a parcelar.".

- [ ] **Step 1: Teste (red)**

```ts
import { describe, expect, it } from "vitest";

import { refazerParcelamento } from "@/lib/contratos/edicao";

describe("refazerParcelamento", () => {
  it("1000 em 2x com 1 recebida → restante 500 em 3x continua a numeração", () => {
    const r = refazerParcelamento({ total_cents: 100000, recebidas: [{ competencia: "parcela-1", valor_cents: 50000 }], novasParcelas: 3, primeiroVencimento: "2026-11-10" });
    expect(r.map((c) => c.competencia)).toEqual(["parcela-2", "parcela-3", "parcela-4"]);
    expect(r.map((c) => c.valor_cents)).toEqual([16668, 16666, 16666]);
    expect(r[0]!.descricao).toBe("Implantação 2/4");
    expect(r.map((c) => c.vencimento)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
  });
  it("nada a parcelar", () => {
    expect(() => refazerParcelamento({ total_cents: 1000, recebidas: [{ competencia: "parcela-1", valor_cents: 1000 }], novasParcelas: 2, primeiroVencimento: "2026-11-10" })).toThrow("Nada a parcelar.");
  });
});
```

- [ ] **Step 2: Implementar a regra e as rotas**

- **PATCH `acao:"editar"`:** aceita `titulo`, `inicio` e `fim` (zod: fim ≥ inicio). Se `inicio` for depois do vencimento de alguma cobrança `recebida`, recusar com 422 "Já há recebimento antes dessa data.".
- **PATCH forma:**
  - mensalidade: `valor_cents` e `dia_vencimento`. Atualiza a forma. Com `aplicar_futuras: true`, também atualiza `valor_cents` e `vencimento` das cobranças `a_receber` com vencimento ≥ hoje, recalculando o vencimento pelo novo dia com `competenciaMensal`.
  - evento: `valor_cents` (padrão).
  - avulso: só se a cobrança estiver `a_receber`; atualiza valor, vencimento e descrição.
- **Refazer parcelamento** (só implantação): body `{ parcelas: 1..60, primeiro_vencimento }`. Apaga as cobranças `a_receber` da forma, insere as de `refazerParcelamento` e atualiza `contrato_formas.parcelas` = recebidas + novas. Ordem segura: calcular, inserir as novas com competências que não colidem, só então apagar as antigas `a_receber`. Em erro no meio, as antigas continuam e o erro volta.
- **Permissões:** todas as escritas checam `editar` via RLS (9002) e `exigirAcesso(...,'editar')` na rota.

- [ ] **Step 3: Tela**

`_editar.tsx`: Dialog "Editar contrato" com:
- título, início e fim;
- por forma, um bloco curto: mensalidade (valor, dia, "aplicar às próximas cobranças"), implantação ("Refazer parcelamento": parcelas e 1º vencimento, mostrando "Já recebido R$ X · Falta R$ Y") e evento (valor padrão).

Usar `reaisParaCentavos` e `@/components/ui/input`, com labels. O botão "Editar" fica na Ficha, só para quem pode editar: a página passa `podeEditar` vindo de `fn_gf_pode`. Ajustar `app/app/contratos/page.tsx` para calcular via RPC em vez de `ROLE_RANK`.

- [ ] **Step 4: Verificar e commit**

Run: testes unitários de contratos (`contratos-*`), typecheck, eslint, i18n e `test:db` (a RLS de Contratos mudou na Task 3; garantir que os fluxos continuam).

```bash
git commit -am "feat(contratos): edit contract, change forms and redo installments"
```

---

### Task 6: Telas do Financeiro

**Files:**
- Create: `app/app/financeiro/page.tsx` (auth + `fn_gf_pode('ver')`; sem acesso → mensagem curta "Você não tem acesso ao Financeiro. Peça a um administrador."), `_client.tsx` (abas), `_visao.tsx`, `_lancamentos.tsx`, `_lancamento-form.tsx`, `_fluxo.tsx`, `_dre.tsx`, `_metricas.tsx`, `_acesso.tsx`
- Modify: `lib/navigation/catalogo.ts` (item `/app/financeiro`, label "Financeiro", grupo `analise`, seção "Dinheiro", sem sidebar, `modulo: "gestao_financeira"`), `lib/i18n/dicionario.ts`

**Interfaces:**
- Consumes: as rotas da Task 4.

Requisitos por aba (texto curto, números primeiro):
- [ ] **Visão geral:**
  - seletor de mês (‹ out/2026 ›);
  - 8 cartões: Faturado, Recebido, Custos, Lucro (verde ou vermelho), Margem, A receber, Atrasado (vermelho), A pagar, mais Saldo em conta em destaque;
  - gráfico de barras recharts dos 12 meses com 3 séries (Receita, Custos, Lucro), legenda e tooltip em R$;
  - cores das séries pelos tokens do tema; conferir em `components/ai/UsageChart.tsx` como o projeto define cores para claro e escuro.
- [ ] **Lançamentos:**
  - botões "+ Entrada" e "+ Saída";
  - filtros: mês, tipo, categoria, situação;
  - lista com data, descrição, categoria, conta, valor (saída em vermelho com "−"), situação, selo "3/6" e selo "mensal";
  - ações por linha: Pagar/Receber (pendente), Editar (pendente), Corrigir (pago), Excluir (pendente, com confirmação);
  - formulário (`_lancamento-form.tsx`): valor, data, categoria (lista filtrada por direção), conta, descrição;
  - forma: "Uma vez", "Parcelado em [N]x" ou "Todo mês até [data opcional]";
  - "Já pago?" com data.
- [ ] **Fluxo de caixa:** tabela mês a mês (Entradas, Saídas, Saldo), com os meses projetados em itálico e o selo "previsto", mais um gráfico de linha do saldo.
- [ ] **DRE:**
  - seletor de mês;
  - tabela com as linhas da DRE; as de destaque em negrito; colunas Valor e % da receita;
  - link "Categorias" que abre um Dialog para criar ou editar categoria (nome, entrada/saída, grupo da DRE, "conta para o CAC").
- [ ] **Métricas:**
  - seletor de período (1, 3, 6, 12 meses);
  - cartões com nome, valor (R$, %, meses ou número) e uma linha de explicação + referência (strings literais por métrica, ex.: "Custo para conquistar um cliente.", "Acima de 3 é saudável.");
  - `null` → "—" + o motivo.
- [ ] **Acesso** (só admin):
  - lista de membros com papel e um seletor por pessoa: "Sem acesso / Só vê / Vê e edita";
  - admins aparecem fixos com "Administrador · acesso total";
  - salvar ao mudar, com toast curto.
- [ ] Em todas as abas: estados de carregando, erro com "Tentar de novo" e módulo não instalado (mensagem da rota). Para quem só vê, os botões de escrita não aparecem.
- [ ] Rodar typecheck, eslint e os testes de i18n e navegação (os mesmos da Task 5 de Contratos). Commit:

```bash
git commit -am "feat(financeiro): finance screens (overview, entries, cash flow, P&L, metrics, access)"
```

---

### Task 7: Publicar com Docker local e voltar a privado

**Files:**
- Create: `scripts/ggcode/publicar.sh`
- Modify: `docs/ggcode/ESTEIRA.md`

- [ ] **Step 1: Escolher o caminho de imagem (medir, não supor)**

Ler `hostgator-setup-kit/update.sh` (preflight, `DESKCOMM_BUILD_LOCAL`, `gravar_imagens`, `pull_policy`) e decidir, nesta ordem:
- **(a)** Montar aqui com `docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build app worker scheduler` (plataforma `linux/amd64`, tags `ghcr.io/lermiis/<img>:<versão>`), transferir com `docker save | gzip | ssh ... "gunzip | docker load"` e rodar o `update.sh` de um jeito que **não** baixe nem reconstrua. Verificar se `DESKCOMM_BUILD_LOCAL=1` com as imagens já carregadas pula o build, ou se há variável de `pull_policy=never`.
- **(b)** Se (a) não for suportado sem editar o kit, enviar as imagens ao GHCR a partir daqui (`docker login ghcr.io` com um token de pacote que o Guilherme gera: classic PAT só com `write:packages`). Nesse caso, os pacotes voltam a privado e a VPS faz `docker login ghcr.io` com um token só `read:packages` guardado em `/root/.docker/config.json`.
- **(c)** Último recurso: `DESKCOMM_BUILD_LOCAL=1` na VPS, à noite.

Registrar a escolha e o motivo em `ESTEIRA.md`.

- [ ] **Step 2: `scripts/ggcode/publicar.sh <tag>`**

Script com `set -euo pipefail` que:
1. confere árvore limpa e tag na `main`;
2. roda `pnpm test:db`;
3. monta as imagens;
4. publica pelo caminho escolhido;
5. na VPS: `git fetch --tags origin && git checkout <tag> && bash hostgator-setup-kit/update.sh --to <tag> --force` (com `nohup` + log);
6. aguarda e imprime as linhas ✓/⚠;
7. confere `https://crm.ggc0de.com/api/v1/health` com a versão certa;
8. comenta de novo a linha do cron do agente se o `update.sh` a reativou.

- [ ] **Step 3: Release v1.80.0-gg.2**

1. Merge ff da `ggcode/financeiro` na `main`.
2. Criar a tag `v1.80.0-gg.2` + release no GitHub.
3. **Perguntar ao Guilherme antes** de rodar o `publicar.sh`: é deploy em produção, e a autorização tem de ser explícita e específica.
4. Depois do deploy:
   - instalar "Financeiro (gestão)" em `/admin/modulos` (Guilherme);
   - abrir o Financeiro: as categorias são semeadas;
   - lançar uma assinatura recorrente, um parcelado 3x e um custo de Meta Ads;
   - conferir Visão geral, DRE e Métricas;
   - em Acesso, dar "Só vê" a um usuário de teste e conferir que ele não consegue lançar;
   - editar o contrato da Juliana e refazer o parcelamento.

- [ ] **Step 4: Voltar a privado (depois do deploy ok)**

Com o caminho (a) ou (b) funcionando:
- `PATCH /repos/Lermiis/ggcode-crm {"private": true}`;
- pacotes privados (Guilherme, pela tela);
- testar uma publicação de ponta a ponta depois disso.

Atualizar `ESTEIRA.md` e o diário do vault.

---

## Self-review

- **Cobertura da spec:**
  - §1 abas, métricas e anúncios manuais (T2, T4, T6);
  - §2 caixa núcleo (T3 RPCs, T4 leitura);
  - §3 tabelas, `fn_gf_pode`, Contratos sob a nova regra e categorias padrão (T3);
  - §4 regras (T2);
  - §5 edição: lançamentos (T3 RPCs, T4, T6) e contrato (T5);
  - §6 telas (T6);
  - §8 esteira (T1, T7);
  - §9 testes (T2–T5).
- **Desvios:**
  - a permissão de Contratos agora é a do Financeiro: manager deixa de ter acesso automático. Na GG Code, só admins.
  - a decisão de esteira (a/b/c) é tomada na T7 com base no `update.sh` real.
- **Riscos:**
  - `fn_gf_pode` usada em policies antes do módulo existir: precisa ser resiliente (`to_regclass`).
  - Agregação de saldo com muitos lançamentos: limite e paginação documentados na T4.
  - A troca da regra dos Contratos quebra testes antigos, que a T3 atualiza sem enfraquecer.
