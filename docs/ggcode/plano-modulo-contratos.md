# Módulo Contratos e receitas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar no CRM da GG Code um módulo opcional "Contratos". Ele registra os contratos com os clientes (implantação, mensalidade, por evento e avulso), gera as cobranças, deixa marcar "Recebido" (lançando no caixa) e mostra a receber, recebido e atrasado. Tudo rodando a partir de um repositório e de imagens próprios da GG Code.

**Architecture:** O módulo segue a ADR-0002 do Deskcomm. Uma provisionadora `fn_contratos_provisionar()` cria 3 tabelas com RLS por operação quando o módulo é instalado. O recebimento é uma RPC atômica (`for update`) que cria o `financial_entries`. As regras de negócio (parcelas, competências, atraso, totais) são funções puras em `lib/contratos/`. Rotas REST finas em `app/api/v1/contratos/`, rotina diária no scheduler e tela em `app/app/contratos/`. O código vive no repositório privado `Lermiis/ggcode-crm`: a branch `main` é a nossa, o upstream entra por merge de tag, e o CI publica as imagens em `ghcr.io/lermiis/*`.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase/Postgres 15 (RLS, plpgsql), zod, @tanstack/react-query, shadcn/ui, vitest, GitHub Actions + GHCR.

**Spec:** `C:\Users\User\Desktop\GG Code\CRM\docs\specs\2026-10-14-modulo-contratos-design.md`

## Global Constraints

- Base: DeskcommCRM **v1.80.0** (clone em `C:\Users\User\Desktop\GG Code\CRM\DeskcommCRM`).
- Dinheiro sempre em centavos `bigint`. Exibição com `formatCents(valor, "BRL")` de `@/lib/money`.
- **Nenhuma coluna das tabelas novas pode casar com** `\m(name|nome|apelido|sobrenome|email|telefone|phone|celular|whatsapp|cpf|cnpj|rg|cep|endereco|address|nascimento|birthdate|documento)`. É a régua de LGPD em `tests/invariants/lgpd-modulo-nao-declarado.test.ts`. Por isso o nome do contrato é `titulo`.
- **Nenhuma FK para `contacts`.** O contrato liga ao negócio (`lead_id`, obrigatório), como o Honorários. Assim a cascata da LGPD não ganha passo e não precisa de `modulo_secoes_lgpd`. ⚠️ Isto difere da spec, que previa `contact_id`. O cliente é lido pelo negócio (`crm_leads.contact_id`).
- Migrations: arquivo `supabase/migrations/<timestamp>_<NNNN>_<slug>.sql` com linha `-- manifest: ...` no cabeçalho. **O MANIFEST.md não é tocado.** O mesmo SQL vai no apêndice do `supabase/baseline.sql`, rotulado `-- ---- <coisa> (migration NNNN) ----`. Para não colidir com a numeração do upstream, a GG Code usa a faixa **9001+**.
- Sem `BEGIN/COMMIT` na migration. Tudo idempotente (`if not exists`, `create or replace`).
- Funções `security definer`: `set search_path = public, pg_temp`, revogar EXECUTE de `public, anon` (e de `authenticated` na provisionadora) e conceder ao papel certo.
- Papéis: leitura = `viewer`; criar, receber, lançar evento, cancelar e encerrar = `manager`.
- Tela: pt-BR via `useT()`, sem parágrafos explicativos, componentes de `@/components/ui/*`, tokens do design system (`text-text-muted`, `border-border`, `text-danger`, …). Precisa funcionar no claro e no escuro (os tokens já cuidam disso).
- Fuso das datas civis: `America/Sao_Paulo`. "Hoje" vem de `hojeNoFuso()` (Task 1).
- Commits em inglês no padrão Conventional Commits, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Não há Docker local.** `pnpm test:db` (invariantes) roda **só no CI**. Localmente rodam `pnpm vitest run <arquivo>` (unitários), `pnpm typecheck` e `pnpm lint`.

## Review Focus

1. **Mensalidade com dia 29–31 em mês curto:** deve vencer no último dia do mês, sem pular o mês nem jogar para o mês seguinte. Teste em Task 1 (`competenciaMensal`).
2. **Implantação com valor que não divide exato** (R$ 1.000 em 3x): soma das parcelas = total, sobra de centavos na 1ª. Teste em Task 1 (`dividirEmParcelas`).
3. **Dois cliques em "Recebido"** (ou retry de rede): o caixa recebe um lançamento só. Teste em Task 2 (`contratos-receber-uma-vez`).
4. **Mensalidade criada depois do vencimento do mês corrente** (contrato fechado dia 20, vencimento dia 10): não pode nascer cobrança já atrasada do mês corrente. A primeira cobrança é a do mês seguinte. Teste em Task 1 (`cobrancasIniciais`).
5. **Contrato encerrado com `fim` no meio do mês:** a rotina não gera mensalidade com competência depois do `fim`. Teste em Task 1 (`mensalidadesDevidas`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `lib/contratos/regras.ts` | Funções puras: parcelas, competência mensal, cobranças iniciais, mensalidades devidas, situação exibida, totais |
| `lib/contratos/esquemas.ts` | Schemas zod das rotas (criar contrato, forma, lançar evento, receber) |
| `lib/contratos/tipos.ts` | Tipos compartilhados entre rotas e tela |
| `tests/unit/contratos-regras.test.ts` | Testes das funções puras |
| `supabase/migrations/2026101500xxxx_9001_ggcode_modulo_contratos.sql` | Provisionadora + RPC de recebimento |
| `supabase/baseline.sql` (alterado) | Apêndice com o mesmo SQL |
| `tests/invariants/contratos-rls-por-operacao.test.ts` | RLS por papel e cross-org |
| `tests/invariants/contratos-receber-uma-vez.test.ts` | Recebimento atômico |
| `tests/invariants/adr-0002-d8-varreduras-com-os-modulos-instalados.test.ts` (alterado) | 3 entradas em `PROVA_DE_MODULO` |
| `lib/modulos/catalogo.ts` (alterado) | Entrada `contratos` no catálogo |
| `lib/instalacao/modulos.ts` (alterado) | `contratos` em `MODULOS_OPCIONAIS` e `MODULOS_DE_TABELA` |
| `lib/navigation/catalogo.ts` (alterado) | Item de menu "Contratos" |
| `app/api/v1/contratos/_comum.ts` | `moduloNaoInstalado`, mensagem, helper de resposta |
| `app/api/v1/contratos/route.ts` | GET lista, POST cria contrato + formas + cobranças iniciais |
| `app/api/v1/contratos/[id]/route.ts` | GET ficha, PATCH encerrar/cancelar |
| `app/api/v1/contratos/[id]/eventos/route.ts` | POST lançar evento |
| `app/api/v1/contratos/cobrancas/route.ts` | GET lista com filtro + totais |
| `app/api/v1/contratos/cobrancas/[id]/receber/route.ts` | POST recebido (RPC) |
| `app/api/v1/contratos/cobrancas/[id]/cancelar/route.ts` | POST cancelar |
| `app/api/v1/contratos/clientes/route.ts` | GET negócios fechados para o seletor |
| `app/api/v1/cron/contratos-mensalidades/route.ts` | Rotina diária |
| `docker/scheduler/entrypoint.sh` (alterado) | Linha do cron |
| `app/app/contratos/page.tsx` | Página (auth, papel) |
| `app/app/contratos/_client.tsx` | Resumo + abas |
| `app/app/contratos/_cobrancas.tsx` | Lista de cobranças + dialog Recebido |
| `app/app/contratos/_contratos.tsx` | Lista de contratos + ficha |
| `app/app/contratos/_novo.tsx` | Dialog Novo contrato |
| `app/app/contratos/_evento.tsx` | Dialog Lançar evento |
| `hostgator-setup-kit/_common.sh` (alterado) | `IMG_NS="ghcr.io/lermiis"` |

---

### Task 0: Repositório e esteira de imagens da GG Code

**Files:**
- Modify: `hostgator-setup-kit/_common.sh:1855` (`IMG_NS`)
- Modify: `.github/workflows/*.yml` (só se a cota de minutos exigir, Step 6)

**Interfaces:**
- Produces: repo `https://github.com/Lermiis/ggcode-crm` (privado), remote `upstream` = melgarafael, branch `main` nossa, imagens `ghcr.io/lermiis/{deskcommcrm,deskcomm-worker,deskcomm-scheduler,deskcomm-voice-agent}:1.80.0-gg.0` públicas.

- [ ] **Step 1: Criar o repositório privado pela API, com a credencial já guardada no Git (conta Lermiis)**

```bash
T=$(printf "protocol=https\nhost=github.com\nusername=Lermiis\n\n" | git credential fill | sed -n 's/^password=//p')
curl -s -X POST -H "Authorization: Bearer $T" https://api.github.com/user/repos \
  -d '{"name":"ggcode-crm","private":true,"description":"CRM GG Code (fork do DeskcommCRM)"}' \
  | python -c "import sys,json;d=json.load(sys.stdin);print(d.get('full_name'),d.get('private'))"
```
Expected: `Lermiis/ggcode-crm True`

- [ ] **Step 2: Apontar o clone local e subir a v1.80.0 como `main`**

```bash
cd "C:/Users/User/Desktop/GG Code/CRM/DeskcommCRM"
git remote rename origin upstream
git remote add origin https://github.com/Lermiis/ggcode-crm.git
git checkout -B main v1.80.0
git push -u origin main
```
Expected: push ok. A credencial tem `workflow`, então os arquivos em `.github/workflows` sobem.

- [ ] **Step 3: Trocar o namespace das imagens no kit e criar a tag de teste da esteira**

Em `hostgator-setup-kit/_common.sh`, linha `IMG_NS="ghcr.io/melgarafael"`, trocar para:

```bash
IMG_NS="ghcr.io/lermiis"
```

```bash
git add hostgator-setup-kit/_common.sh
git commit -m "chore(kit): pull images from GG Code registry"
git push
git tag v1.80.0-gg.0 && git push origin v1.80.0-gg.0
```

- [ ] **Step 4: Acompanhar o workflow `Publicar imagem Docker (GHCR)` até terminar**

```bash
curl -s -H "Authorization: Bearer $T" "https://api.github.com/repos/Lermiis/ggcode-crm/actions/runs?per_page=5" \
  | python -c "import sys,json;[print(r['name'],r['head_branch'],r['status'],r['conclusion']) for r in json.load(sys.stdin)['workflow_runs']]"
```
Expected: o run do tag `v1.80.0-gg.0` termina `completed success`. Se falhar, ler o log do job (`/actions/runs/<id>/jobs`) e corrigir na causa antes de seguir.

- [ ] **Step 5: Tornar os 4 pacotes públicos**

```bash
for p in deskcommcrm deskcomm-worker deskcomm-scheduler deskcomm-voice-agent; do
  curl -s -o /dev/null -w "$p %{http_code}\n" -X PATCH -H "Authorization: Bearer $T" \
    "https://api.github.com/user/packages/container/$p" -d '{"visibility":"public"}'
done
```
Expected: `200` ou `204` para cada um. Se a API recusar (o token pode não ter `write:packages`), pedir ao Guilherme para fazer na tela: github.com/Lermiis?tab=packages › pacote › Package settings › Change visibility › Public.

- [ ] **Step 6: Medir o consumo de minutos**

```bash
curl -s -H "Authorization: Bearer $T" https://api.github.com/users/Lermiis/settings/billing/actions
```
Se o push da `main` e da tag disparou `ci.yml`, `e2e.yml` e `perf.yml` e a soma passar de ~300 min, desligar no nosso repo os workflows que não protegem nada nosso:
- `perf.yml`, `relogio.yml`, `acolhida.yml` e `vigia-de-colisao.yml`, via API `PUT /repos/Lermiis/ggcode-crm/actions/workflows/<arquivo>/disable`;
- em `publish-image.yml`, limitar a matriz de arquitetura a `amd64` (a VPS é x86_64).

Manter `ci.yml`, que roda os invariantes.

- [ ] **Step 7: Confirmar que a VPS enxerga a imagem nova (só leitura, sem trocar nada ainda)**

```bash
ssh -i ~/.ssh/ggcode_crm_ed25519 root@179.197.237.126 'docker manifest inspect ghcr.io/lermiis/deskcommcrm:1.80.0-gg.0 >/dev/null && echo ok'
```
Expected: `ok`

---

### Task 1: Regras puras do módulo

**Files:**
- Create: `lib/contratos/tipos.ts`
- Create: `lib/contratos/regras.ts`
- Test: `tests/unit/contratos-regras.test.ts`

**Interfaces:**
- Produces:
  - `type TipoForma = "implantacao" | "mensalidade" | "evento" | "avulso"`
  - `type SituacaoCobranca = "a_receber" | "recebida" | "cancelada"`
  - `type SituacaoExibida = "atrasada" | "a_receber" | "recebida" | "cancelada"`
  - `interface FormaEntrada { tipo: TipoForma; valor_cents: number; parcelas?: number; primeiro_vencimento?: string; dia_vencimento?: number; descricao?: string }`
  - `interface CobrancaNova { competencia: string; descricao: string; vencimento: string; valor_cents: number }`
  - `hojeNoFuso(agora?: Date): string` (YYYY-MM-DD em America/Sao_Paulo)
  - `dividirEmParcelas(total: number, n: number): number[]`
  - `somarMeses(data: string, meses: number): string` (mantém o dia, cai no último dia do mês se preciso)
  - `competenciaMensal(ano: number, mes: number, dia: number): { competencia: string; vencimento: string }`
  - `cobrancasIniciais(forma: FormaEntrada, hoje: string): CobrancaNova[]`
  - `mensalidadesDevidas(f: { dia_vencimento: number; valor_cents: number }, contrato: { inicio: string; fim: string | null }, hoje: string): CobrancaNova[]`
  - `situacaoExibida(c: { situacao: SituacaoCobranca; vencimento: string }, hoje: string): SituacaoExibida`
  - `totaisDoMes(cobs: Array<{ situacao: SituacaoCobranca; vencimento: string; valor_cents: number; recebida_em: string | null }>, hoje: string): { aReceber: number; recebido: number; atrasado: number; qtdAtrasadas: number }`

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/contratos-regras.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  cobrancasIniciais,
  competenciaMensal,
  dividirEmParcelas,
  hojeNoFuso,
  mensalidadesDevidas,
  situacaoExibida,
  somarMeses,
  totaisDoMes,
} from "@/lib/contratos/regras";

describe("dividirEmParcelas", () => {
  it("divide exato", () => expect(dividirEmParcelas(100000, 2)).toEqual([50000, 50000]));
  it("sobra de centavos vai na primeira e a soma fecha", () => {
    const p = dividirEmParcelas(100000, 3);
    expect(p).toEqual([33334, 33333, 33333]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100000);
  });
  it("recusa n < 1", () => expect(() => dividirEmParcelas(100, 0)).toThrow());
});

describe("datas", () => {
  it("somarMeses cai no último dia em mês curto", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2026-10-15", 2)).toBe("2026-12-15");
    expect(somarMeses("2026-12-10", 1)).toBe("2027-01-10");
  });
  it("competenciaMensal com dia 31 em fevereiro vence no dia 28", () => {
    expect(competenciaMensal(2027, 2, 31)).toEqual({ competencia: "2027-02", vencimento: "2027-02-28" });
  });
  it("hojeNoFuso usa São Paulo, não UTC", () => {
    // 02:00 UTC de 15/10 ainda é 14/10 em São Paulo (UTC-3)
    expect(hojeNoFuso(new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14");
  });
});

describe("cobrancasIniciais", () => {
  const hoje = "2026-10-14";
  it("implantação 2x vence mês a mês a partir do primeiro vencimento", () => {
    expect(cobrancasIniciais({ tipo: "implantacao", valor_cents: 100000, parcelas: 2, primeiro_vencimento: "2026-10-20" }, hoje)).toEqual([
      { competencia: "parcela-1", descricao: "Implantação 1/2", vencimento: "2026-10-20", valor_cents: 50000 },
      { competencia: "parcela-2", descricao: "Implantação 2/2", vencimento: "2026-11-20", valor_cents: 50000 },
    ]);
  });
  it("implantação à vista tem descrição sem fração", () => {
    expect(cobrancasIniciais({ tipo: "implantacao", valor_cents: 100000, primeiro_vencimento: "2026-10-20" }, hoje)[0].descricao).toBe("Implantação");
  });
  it("avulso gera uma cobrança com a descrição dada", () => {
    expect(cobrancasIniciais({ tipo: "avulso", valor_cents: 30000, primeiro_vencimento: "2026-11-01", descricao: "Ajuste no site" }, hoje)).toEqual([
      { competencia: "avulso", descricao: "Ajuste no site", vencimento: "2026-11-01", valor_cents: 30000 },
    ]);
  });
  it("mensalidade com vencimento ainda por vir no mês gera a do mês corrente", () => {
    expect(cobrancasIniciais({ tipo: "mensalidade", valor_cents: 50000, dia_vencimento: 20 }, hoje)).toEqual([
      { competencia: "2026-10", descricao: "Mensalidade out/26", vencimento: "2026-10-20", valor_cents: 50000 },
    ]);
  });
  it("mensalidade com vencimento já passado no mês começa no mês seguinte (Review Focus 4)", () => {
    expect(cobrancasIniciais({ tipo: "mensalidade", valor_cents: 50000, dia_vencimento: 10 }, hoje)).toEqual([
      { competencia: "2026-11", descricao: "Mensalidade nov/26", vencimento: "2026-11-10", valor_cents: 50000 },
    ]);
  });
  it("evento não gera nada na criação", () => {
    expect(cobrancasIniciais({ tipo: "evento", valor_cents: 50000 }, hoje)).toEqual([]);
  });
});

describe("mensalidadesDevidas", () => {
  const f = { dia_vencimento: 10, valor_cents: 50000 };
  it("devolve o mês corrente e o seguinte", () => {
    expect(mensalidadesDevidas(f, { inicio: "2026-01-01", fim: null }, "2026-10-14").map((c) => c.competencia)).toEqual(["2026-10", "2026-11"]);
  });
  it("não gera competência depois do fim (Review Focus 5)", () => {
    expect(mensalidadesDevidas(f, { inicio: "2026-01-01", fim: "2026-10-31" }, "2026-10-14").map((c) => c.competencia)).toEqual(["2026-10"]);
  });
  it("não gera competência antes do início", () => {
    expect(mensalidadesDevidas(f, { inicio: "2026-11-05", fim: null }, "2026-10-14").map((c) => c.competencia)).toEqual(["2026-11"]);
  });
});

describe("situação e totais", () => {
  const hoje = "2026-10-14";
  it("a_receber vencida vira atrasada só na exibição", () => {
    expect(situacaoExibida({ situacao: "a_receber", vencimento: "2026-10-13" }, hoje)).toBe("atrasada");
    expect(situacaoExibida({ situacao: "a_receber", vencimento: "2026-10-14" }, hoje)).toBe("a_receber");
    expect(situacaoExibida({ situacao: "recebida", vencimento: "2026-01-01" }, hoje)).toBe("recebida");
  });
  it("totais do mês: a receber (vence no mês, não vencida), recebido (recebida no mês), atrasado (qualquer mês)", () => {
    const t = totaisDoMes([
      { situacao: "a_receber", vencimento: "2026-10-20", valor_cents: 50000, recebida_em: null },
      { situacao: "a_receber", vencimento: "2026-11-20", valor_cents: 50000, recebida_em: null },
      { situacao: "a_receber", vencimento: "2026-09-10", valor_cents: 30000, recebida_em: null },
      { situacao: "recebida", vencimento: "2026-10-05", valor_cents: 20000, recebida_em: "2026-10-06" },
      { situacao: "cancelada", vencimento: "2026-10-01", valor_cents: 99900, recebida_em: null },
    ], hoje);
    expect(t).toEqual({ aReceber: 50000, recebido: 20000, atrasado: 30000, qtdAtrasadas: 1 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/contratos-regras.test.ts`
Expected: FAIL com "Failed to resolve import @/lib/contratos/regras"

- [ ] **Step 3: Implementar**

`lib/contratos/tipos.ts`:

```ts
export type TipoForma = "implantacao" | "mensalidade" | "evento" | "avulso";
export type SituacaoCobranca = "a_receber" | "recebida" | "cancelada";
export type SituacaoExibida = "atrasada" | SituacaoCobranca;
export type SituacaoContrato = "ativo" | "encerrado" | "cancelado";

export interface FormaEntrada {
  tipo: TipoForma;
  valor_cents: number;
  parcelas?: number;
  primeiro_vencimento?: string;
  dia_vencimento?: number;
  descricao?: string;
}

export interface CobrancaNova {
  competencia: string;
  descricao: string;
  vencimento: string;
  valor_cents: number;
}

export interface Cobranca {
  id: string;
  contrato_id: string;
  forma_id: string;
  competencia: string;
  descricao: string;
  vencimento: string;
  valor_cents: number;
  situacao: SituacaoCobranca;
  recebida_em: string | null;
  contrato_titulo: string;
  cliente: string;
}

export interface Forma extends FormaEntrada {
  id: string;
  ativa: boolean;
}

export interface Contrato {
  id: string;
  lead_id: string;
  titulo: string;
  inicio: string;
  fim: string | null;
  situacao: SituacaoContrato;
  cliente: string;
  mensal_cents: number;
  proximo_vencimento: string | null;
}
```

`lib/contratos/regras.ts`:

```ts
/**
 * Regras do módulo Contratos — puras, sem banco, para serem testadas sem esperar o calendário.
 * Datas são CIVIS (YYYY-MM-DD) no fuso de São Paulo: o vencimento é um dia, não um instante.
 */
import type { CobrancaNova, FormaEntrada, SituacaoCobranca, SituacaoExibida } from "./tipos";

const FUSO = "America/Sao_Paulo";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function hojeNoFuso(agora: Date = new Date()): string {
  return agora.toLocaleDateString("en-CA", { timeZone: FUSO });
}

const pad = (n: number) => String(n).padStart(2, "0");
const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

export function dividirEmParcelas(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error("parcelas deve ser inteiro >= 1");
  const base = Math.floor(total / n);
  const sobra = total - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + sobra : base));
}

export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ano = alvo.getUTCFullYear();
  const mes = alvo.getUTCMonth() + 1;
  return `${ano}-${pad(mes)}-${pad(Math.min(d, ultimoDia(ano, mes)))}`;
}

export function competenciaMensal(ano: number, mes: number, dia: number): { competencia: string; vencimento: string } {
  return { competencia: `${ano}-${pad(mes)}`, vencimento: `${ano}-${pad(mes)}-${pad(Math.min(dia, ultimoDia(ano, mes)))}` };
}

function mensalidade(ano: number, mes: number, dia: number, valor: number): CobrancaNova {
  const { competencia, vencimento } = competenciaMensal(ano, mes, dia);
  return { competencia, descricao: `Mensalidade ${MESES[mes - 1]}/${String(ano).slice(2)}`, vencimento, valor_cents: valor };
}

const proximoMes = (ano: number, mes: number): [number, number] => (mes === 12 ? [ano + 1, 1] : [ano, mes + 1]);

export function cobrancasIniciais(forma: FormaEntrada, hoje: string): CobrancaNova[] {
  if (forma.tipo === "evento") return [];
  if (forma.tipo === "avulso") {
    return [{ competencia: "avulso", descricao: forma.descricao?.trim() || "Avulso", vencimento: forma.primeiro_vencimento!, valor_cents: forma.valor_cents }];
  }
  if (forma.tipo === "implantacao") {
    const n = forma.parcelas ?? 1;
    return dividirEmParcelas(forma.valor_cents, n).map((valor, i) => ({
      competencia: `parcela-${i + 1}`,
      descricao: n === 1 ? "Implantação" : `Implantação ${i + 1}/${n}`,
      vencimento: somarMeses(forma.primeiro_vencimento!, i),
      valor_cents: valor,
    }));
  }
  // mensalidade: a do mês corrente só se o vencimento ainda não passou
  const [a, m] = hoje.split("-").map(Number);
  const atual = mensalidade(a, m, forma.dia_vencimento!, forma.valor_cents);
  if (atual.vencimento >= hoje) return [atual];
  const [a2, m2] = proximoMes(a, m);
  return [mensalidade(a2, m2, forma.dia_vencimento!, forma.valor_cents)];
}

export function mensalidadesDevidas(
  f: { dia_vencimento: number; valor_cents: number },
  contrato: { inicio: string; fim: string | null },
  hoje: string,
): CobrancaNova[] {
  const [a, m] = hoje.split("-").map(Number);
  const [a2, m2] = proximoMes(a, m);
  return [mensalidade(a, m, f.dia_vencimento, f.valor_cents), mensalidade(a2, m2, f.dia_vencimento, f.valor_cents)].filter(
    (c) => c.competencia >= contrato.inicio.slice(0, 7) && (!contrato.fim || c.competencia <= contrato.fim.slice(0, 7)),
  );
}

export function situacaoExibida(c: { situacao: SituacaoCobranca; vencimento: string }, hoje: string): SituacaoExibida {
  return c.situacao === "a_receber" && c.vencimento < hoje ? "atrasada" : c.situacao;
}

export function totaisDoMes(
  cobs: Array<{ situacao: SituacaoCobranca; vencimento: string; valor_cents: number; recebida_em: string | null }>,
  hoje: string,
): { aReceber: number; recebido: number; atrasado: number; qtdAtrasadas: number } {
  const mes = hoje.slice(0, 7);
  const t = { aReceber: 0, recebido: 0, atrasado: 0, qtdAtrasadas: 0 };
  for (const c of cobs) {
    const s = situacaoExibida(c, hoje);
    if (s === "atrasada") { t.atrasado += c.valor_cents; t.qtdAtrasadas++; }
    else if (s === "a_receber" && c.vencimento.slice(0, 7) === mes) t.aReceber += c.valor_cents;
    else if (s === "recebida" && c.recebida_em?.slice(0, 7) === mes) t.recebido += c.valor_cents;
  }
  return t;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/unit/contratos-regras.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add lib/contratos tests/unit/contratos-regras.test.ts
git commit -m "feat(contratos): pure billing rules for contracts module"
```

---

### Task 2: Schema do módulo (provisionadora + recebimento atômico) e registro

**Files:**
- Create: `supabase/migrations/20261015000000_9001_ggcode_modulo_contratos.sql`
- Modify: `supabase/baseline.sql` (apêndice no fim)
- Modify: `lib/modulos/catalogo.ts`, `lib/instalacao/modulos.ts`
- Modify: `tests/invariants/adr-0002-d8-varreduras-com-os-modulos-instalados.test.ts` (`PROVA_DE_MODULO`)
- Create: `tests/invariants/contratos-rls-por-operacao.test.ts`
- Create: `tests/invariants/contratos-receber-uma-vez.test.ts`

**Interfaces:**
- Produces:
  - tabelas `contratos(id, organization_id, lead_id, titulo, inicio, fim, situacao, created_at, updated_at)`, `contrato_formas(id, organization_id, contrato_id, tipo, valor_cents, parcelas, primeiro_vencimento, dia_vencimento, descricao, ativa, created_at)`, `contrato_cobrancas(id, organization_id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents, situacao, recebida_em, financial_entry_id, created_at, updated_at)`
  - `public.fn_contratos_cobranca_receber(p_org uuid, p_cobranca uuid, p_account_id uuid, p_recebida_em date default null) returns jsonb` → `{id, contrato_id, valor_cents, situacao:'recebida', recebida_em, financial_entry_id}`. Erros: `cobranca_nao_encontrada` (P0002), `cobranca_nao_recebivel` (22023), `conta_invalida` (22023), `contratos_forbidden` (42501).
  - módulo `contratos` em `MODULOS_OPCIONAIS` e `MODULOS_DE_TABELA`.

- [ ] **Step 1: Escrever os testes de invariante que falham**

`tests/invariants/contratos-receber-uma-vez.test.ts` (molde de `honorarios-pagar-uma-vez.test.ts`. Ler aquele arquivo inteiro antes e copiar o helper `sessao`, o `beforeAll` com `seedGov` e as constantes de conta):

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

import { GOV_MANAGER, GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * CONTRATOS — UMA COBRANÇA ENTRA NO CAIXA UMA VEZ SÓ (migration 9001).
 * Mede: segundo recebimento recusado; dois simultâneos lançam UM; conta de outra org recusada;
 * cobrança cancelada não se recebe.
 */
const ORG_B = "c0c0c0c0-0000-4000-8000-000000000002";
const CONTA_A = "c0c0c0c0-2222-4000-8000-000000000001";
const CONTA_B = "c0c0c0c0-2222-4000-8000-000000000002";
const LEAD = "c0c0c0c0-5555-4000-8000-000000000001";
const CONTRATO = "c0c0c0c0-3333-4000-8000-000000000001";
const FORMA = "c0c0c0c0-6666-4000-8000-000000000001";
const COB_SEQ = "c0c0c0c0-4444-4000-8000-000000000001";
const COB_CORRIDA = "c0c0c0c0-4444-4000-8000-000000000002";
const COB_OUTRA_CONTA = "c0c0c0c0-4444-4000-8000-000000000003";
const COB_CANCELADA = "c0c0c0c0-4444-4000-8000-000000000004";

const execFileP = promisify(execFile);
const container = process.env.TEST_DB_CONTAINER ?? "";
const COMO_GERENTE = `
  set role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}","role":"authenticated"}', false);
`;
const receber = (cob: string, conta: string) =>
  `select public.fn_contratos_cobranca_receber('${GOV_ORG}'::uuid, '${cob}'::uuid, '${conta}'::uuid)::text;`;

async function sessao(script: string): Promise<{ ok: boolean; saida: string }> {
  try {
    const { stdout } = await execFileP("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-c", script], { encoding: "utf8" });
    return { ok: true, saida: stdout };
  } catch (erro) {
    const e = erro as { stderr?: string; message?: string };
    return { ok: false, saida: e.stderr ?? e.message ?? "" };
  }
}
const lancamentosDa = (cob: string) =>
  Number(lastLine(sql(`select count(*) from public.financial_entries fe join public.contrato_cobrancas c on c.financial_entry_id = fe.id where c.id = '${cob}';`)));

beforeAll(() => {
  seedGov();
  // ⚠️ Conferir em honorarios-pagar-uma-vez.test.ts as colunas obrigatórias de
  // financial_accounts e crm_leads no baseline v1.80.0 e espelhar aqui.
  sql(`
    select public.fn_contratos_provisionar();
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_B}', 'contratos-b', 'Contratos B', 'Contratos B') on conflict (id) do nothing;
    insert into public.financial_accounts (id, organization_id, name, kind) values
      ('${CONTA_A}', '${GOV_ORG}', 'Caixa A', 'cash'), ('${CONTA_B}', '${ORG_B}', 'Caixa B', 'cash') on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, title, pipeline_id, stage_id)
      select '${LEAD}', '${GOV_ORG}', 'Lead contrato', p.id, s.id from public.crm_pipelines p join public.crm_stages s on s.pipeline_id = p.id
       where p.organization_id = '${GOV_ORG}' limit 1 on conflict (id) do nothing;
    insert into public.contratos (id, organization_id, lead_id, titulo, inicio) values ('${CONTRATO}', '${GOV_ORG}', '${LEAD}', 'Teste', '2026-10-01') on conflict (id) do nothing;
    insert into public.contrato_formas (id, organization_id, contrato_id, tipo, valor_cents) values ('${FORMA}', '${GOV_ORG}', '${CONTRATO}', 'avulso', 10000) on conflict (id) do nothing;
    insert into public.contrato_cobrancas (id, organization_id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents, situacao) values
      ('${COB_SEQ}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a1', 'Seq', '2026-10-10', 10000, 'a_receber'),
      ('${COB_CORRIDA}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a2', 'Corrida', '2026-10-10', 10000, 'a_receber'),
      ('${COB_OUTRA_CONTA}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a3', 'Outra conta', '2026-10-10', 10000, 'a_receber'),
      ('${COB_CANCELADA}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'a4', 'Cancelada', '2026-10-10', 10000, 'cancelada')
      on conflict (id) do nothing;
  `);
});

describe("recebimento de cobrança é atômico", () => {
  it("o segundo recebimento é recusado e não lança de novo", async () => {
    expect((await sessao(COMO_GERENTE + receber(COB_SEQ, CONTA_A))).ok).toBe(true);
    const segunda = await sessao(COMO_GERENTE + receber(COB_SEQ, CONTA_A));
    expect(segunda.ok).toBe(false);
    expect(segunda.saida).toContain("cobranca_nao_recebivel");
    expect(lancamentosDa(COB_SEQ)).toBe(1);
  });

  it("dois recebimentos simultâneos lançam uma vez só", async () => {
    const [a, b] = await Promise.all([sessao(COMO_GERENTE + receber(COB_CORRIDA, CONTA_A)), sessao(COMO_GERENTE + receber(COB_CORRIDA, CONTA_A))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(lancamentosDa(COB_CORRIDA)).toBe(1);
  });

  it("conta de outra organização é recusada", async () => {
    const r = await sessao(COMO_GERENTE + receber(COB_OUTRA_CONTA, CONTA_B));
    expect(r.ok).toBe(false);
    expect(r.saida).toContain("conta_invalida");
  });

  it("cobrança cancelada não se recebe", async () => {
    const r = await sessao(COMO_GERENTE + receber(COB_CANCELADA, CONTA_A));
    expect(r.ok).toBe(false);
    expect(r.saida).toContain("cobranca_nao_recebivel");
  });
});
```

`tests/invariants/contratos-rls-por-operacao.test.ts` (molde de `honorarios-rls-por-operacao.test.ts`):

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_MANAGER, GOV_ORG, GOV_VIEWER, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

/** A RLS DE CONTRATOS É POR OPERAÇÃO (migration 9001): leitura = membro; escrita = manager;
 *  cobrança recebida é imutável pela sessão; sessão não marca recebida; contrato com
 *  cobrança recebida não se apaga; nada pendura em contrato de outra organização. */
const ORG_B = "c1c1c1c1-0000-4000-8000-000000000002";
const LEAD = "c1c1c1c1-5555-4000-8000-000000000001";
const CONTRATO = "c1c1c1c1-3333-4000-8000-000000000001";
const CONTRATO_COM_RECEBIDA = "c1c1c1c1-3333-4000-8000-000000000002";
const CONTRATO_OUTRA_ORG = "c1c1c1c1-3333-4000-8000-000000000003";
const FORMA = "c1c1c1c1-6666-4000-8000-000000000001";
const FORMA_REC = "c1c1c1c1-6666-4000-8000-000000000002";
const PENDENTE = "c1c1c1c1-4444-4000-8000-000000000001";
const RECEBIDA = "c1c1c1c1-4444-4000-8000-000000000002";

const existe = (t: string, id: string) => lastLine(sql(`select exists(select 1 from public.${t} where id = '${id}')::text;`)) === "true";

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_contratos_provisionar();
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_B}', 'contratos-rls-b', 'Contratos RLS B', 'C RLS B') on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, title, pipeline_id, stage_id)
      select '${LEAD}', '${GOV_ORG}', 'Lead RLS', p.id, s.id from public.crm_pipelines p join public.crm_stages s on s.pipeline_id = p.id
       where p.organization_id = '${GOV_ORG}' limit 1 on conflict (id) do nothing;
    insert into public.contratos (id, organization_id, lead_id, titulo, inicio) values
      ('${CONTRATO}', '${GOV_ORG}', '${LEAD}', 'A', '2026-10-01'),
      ('${CONTRATO_COM_RECEBIDA}', '${GOV_ORG}', '${LEAD}', 'B', '2026-10-01'),
      ('${CONTRATO_OUTRA_ORG}', '${ORG_B}', null, 'C', '2026-10-01') on conflict (id) do nothing;
    insert into public.contrato_formas (id, organization_id, contrato_id, tipo, valor_cents) values
      ('${FORMA}', '${GOV_ORG}', '${CONTRATO}', 'avulso', 100), ('${FORMA_REC}', '${GOV_ORG}', '${CONTRATO_COM_RECEBIDA}', 'avulso', 100) on conflict (id) do nothing;
    insert into public.contrato_cobrancas (id, organization_id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents, situacao, recebida_em) values
      ('${PENDENTE}', '${GOV_ORG}', '${CONTRATO}', '${FORMA}', 'x1', 'P', '2026-10-10', 100, 'a_receber', null),
      ('${RECEBIDA}', '${GOV_ORG}', '${CONTRATO_COM_RECEBIDA}', '${FORMA_REC}', 'x2', 'R', '2026-10-10', 100, 'recebida', '2026-10-10') on conflict (id) do nothing;
  `);
});

describe("viewer e agent só leem", () => {
  for (const [papel, u] of [["viewer", GOV_VIEWER], ["agent", GOV_AGENT_A]] as const) {
    it(`${papel} não cria, não edita, não apaga`, () => {
      expect(writeCountAs(u, `insert into public.contratos (organization_id, lead_id, titulo, inicio) values ('${GOV_ORG}', '${LEAD}', 'x', '2026-10-01')`)).toBe(0);
      expect(writeCountAs(u, `update public.contrato_cobrancas set valor_cents = 1 where id = '${PENDENTE}'`)).toBe(0);
      expect(writeCountAs(u, `delete from public.contratos where id = '${CONTRATO}'`)).toBe(0);
      expect(existe("contratos", CONTRATO)).toBe(true);
    });
    it(`${papel} lê — controle positivo`, () => {
      expect(Number(lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}"}', false);
        select count(*) from public.contrato_cobrancas where id in ('${PENDENTE}', '${RECEBIDA}');`)))).toBe(2);
    });
  }
});

describe("manager", () => {
  it("edita cobrança a receber — controle positivo", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.contrato_cobrancas set descricao = 'P2' where id = '${PENDENTE}'`)).toBe(1);
  });
  it("não marca recebida pela sessão (só a RPC lança o caixa)", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.contrato_cobrancas set situacao = 'recebida' where id = '${PENDENTE}'`)).toBe(0);
  });
  it("não reescreve nem apaga cobrança recebida, nem o contrato que a tem", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.contrato_cobrancas set situacao = 'a_receber' where id = '${RECEBIDA}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.contrato_cobrancas where id = '${RECEBIDA}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.contratos where id = '${CONTRATO_COM_RECEBIDA}'`)).toBe(0);
  });
  it("não pendura forma nem cobrança em contrato de outra organização", () => {
    expect(writeCountAs(GOV_MANAGER, `insert into public.contrato_formas (organization_id, contrato_id, tipo, valor_cents) values ('${GOV_ORG}', '${CONTRATO_OUTRA_ORG}', 'avulso', 1)`)).toBe(0);
  });
  it("não lê contrato de outra organização", () => {
    expect(Number(lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
      select count(*) from public.contratos where id = '${CONTRATO_OUTRA_ORG}';`)))).toBe(0);
  });
});
```

Em `tests/invariants/adr-0002-d8-varreduras-com-os-modulos-instalados.test.ts`, dentro de `PROVA_DE_MODULO`, logo depois de `honorarios_parcelas: {...},`:

```ts
  // GG Code — módulo Contratos (migration 9001).
  contratos: {
    arquivo: "tests/invariants/contratos-rls-por-operacao.test.ts",
    razao:
      "JWT real: viewer e agent não criam, não editam e não apagam; manager edita a receber " +
      "(controle positivo); contrato com cobrança recebida não se apaga; leitura cross-org zero.",
  },
  contrato_formas: {
    arquivo: "tests/invariants/contratos-rls-por-operacao.test.ts",
    razao:
      "Mesmo arquivo: escrita só manager+ e forma não pendura em contrato de OUTRA organização " +
      "(insert cross-org recusado pela policy, contagem zero).",
  },
  contrato_cobrancas: {
    arquivo: "tests/invariants/contratos-rls-por-operacao.test.ts",
    razao:
      "Mesmo arquivo: sessão não marca recebida (só a RPC que lança o caixa), recebida é " +
      "imutável e não se apaga; viewer/agent não escrevem; leitura por papel com controle positivo.",
  },
```

- [ ] **Step 2: Escrever a migration**

`supabase/migrations/20261015000000_9001_ggcode_modulo_contratos.sql`. Copiar a estrutura de `20260928150200_0480_honorarios_modulo_oficial.sql`: função `$f$`, `fn_proteger_modulo_provisionado()` no fim, revokes.

```sql
-- manifest: GG Code — módulo Contratos (ADR-0002): provisionadora de contratos/formas/cobranças com RLS por operação e recebimento atômico que lança no caixa
--
-- Faixa 9001+ é da GG Code (fork): não colide com a numeração do upstream.
-- LGPD (D8): nenhuma FK para contacts e nenhuma coluna de dado pessoal — o contrato liga ao
-- NEGÓCIO (lead_id), como honorários; anonimizar o contato não exige passo novo.

create or replace function public.fn_contratos_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.contratos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    lead_id uuid references public.crm_leads(id) on delete set null,
    titulo text not null check (char_length(titulo) between 1 and 120),
    inicio date not null,
    fim date,
    situacao text not null default 'ativo' check (situacao in ('ativo', 'encerrado', 'cancelado')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint contratos_fim_depois_do_inicio check (fim is null or fim >= inicio)
  );
  create index if not exists contratos_org_idx on public.contratos (organization_id, situacao);

  create table if not exists public.contrato_formas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contrato_id uuid not null references public.contratos(id) on delete cascade,
    tipo text not null check (tipo in ('implantacao', 'mensalidade', 'evento', 'avulso')),
    valor_cents bigint not null check (valor_cents > 0),
    parcelas integer not null default 1 check (parcelas between 1 and 60),
    primeiro_vencimento date,
    dia_vencimento integer check (dia_vencimento between 1 and 31),
    descricao text check (descricao is null or char_length(descricao) <= 120),
    ativa boolean not null default true,
    created_at timestamptz not null default now(),
    constraint contrato_formas_campos_do_tipo check (
      (tipo = 'mensalidade' and dia_vencimento is not null)
      or (tipo in ('implantacao', 'avulso') and primeiro_vencimento is not null)
      or tipo = 'evento'
    )
  );
  create index if not exists contrato_formas_contrato_idx on public.contrato_formas (organization_id, contrato_id);

  create table if not exists public.contrato_cobrancas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contrato_id uuid not null references public.contratos(id) on delete cascade,
    forma_id uuid not null references public.contrato_formas(id) on delete cascade,
    competencia text not null,
    descricao text not null check (char_length(descricao) between 1 and 160),
    vencimento date not null,
    valor_cents bigint not null check (valor_cents > 0),
    situacao text not null default 'a_receber' check (situacao in ('a_receber', 'recebida', 'cancelada')),
    recebida_em date,
    financial_entry_id uuid references public.financial_entries(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint contrato_cobrancas_competencia_unica unique (forma_id, competencia)
  );
  create index if not exists contrato_cobrancas_venc_idx on public.contrato_cobrancas (organization_id, vencimento);
  create index if not exists contrato_cobrancas_contrato_idx on public.contrato_cobrancas (organization_id, contrato_id);

  -- RLS por operação (molde 0480). Escrita = manager+. Recebida é imutável e só nasce na RPC.
  alter table public.contratos enable row level security;
  drop policy if exists tenant_isolation_contratos_all on public.contratos;
  drop policy if exists contratos_select on public.contratos;
  create policy contratos_select on public.contratos for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists contratos_insert on public.contratos;
  create policy contratos_insert on public.contratos for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  drop policy if exists contratos_update on public.contratos;
  create policy contratos_update on public.contratos for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  drop policy if exists contratos_delete on public.contratos;
  create policy contratos_delete on public.contratos for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and not exists (select 1 from public.contrato_cobrancas c
                            where c.contrato_id = contratos.id and c.situacao = 'recebida'));
  revoke all on public.contratos from anon;

  alter table public.contrato_formas enable row level security;
  drop policy if exists tenant_isolation_contrato_formas_all on public.contrato_formas;
  drop policy if exists contrato_formas_select on public.contrato_formas;
  create policy contrato_formas_select on public.contrato_formas for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists contrato_formas_insert on public.contrato_formas;
  create policy contrato_formas_insert on public.contrato_formas for insert
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_formas.organization_id));
  drop policy if exists contrato_formas_update on public.contrato_formas;
  create policy contrato_formas_update on public.contrato_formas for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_formas.organization_id));
  drop policy if exists contrato_formas_delete on public.contrato_formas;
  create policy contrato_formas_delete on public.contrato_formas for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and not exists (select 1 from public.contrato_cobrancas c
                            where c.forma_id = contrato_formas.id and c.situacao = 'recebida'));
  revoke all on public.contrato_formas from anon;

  alter table public.contrato_cobrancas enable row level security;
  drop policy if exists tenant_isolation_contrato_cobrancas_all on public.contrato_cobrancas;
  drop policy if exists contrato_cobrancas_select on public.contrato_cobrancas;
  create policy contrato_cobrancas_select on public.contrato_cobrancas for select
    using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());
  drop policy if exists contrato_cobrancas_insert on public.contrato_cobrancas;
  create policy contrato_cobrancas_insert on public.contrato_cobrancas for insert
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and situacao <> 'recebida' and financial_entry_id is null and recebida_em is null
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_cobrancas.organization_id));
  drop policy if exists contrato_cobrancas_update on public.contrato_cobrancas;
  create policy contrato_cobrancas_update on public.contrato_cobrancas for update
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and situacao <> 'recebida')
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and situacao <> 'recebida' and financial_entry_id is null and recebida_em is null
                and exists (select 1 from public.contratos k where k.id = contrato_id
                             and k.organization_id = contrato_cobrancas.organization_id));
  drop policy if exists contrato_cobrancas_delete on public.contrato_cobrancas;
  create policy contrato_cobrancas_delete on public.contrato_cobrancas for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and situacao <> 'recebida');
  revoke all on public.contrato_cobrancas from anon;

  comment on table public.contratos is 'GG Code — contrato com o cliente (liga ao negócio). Dinheiro real é o caixa núcleo.';
  comment on table public.contrato_formas is 'GG Code — formas de cobrança do contrato: implantação, mensalidade, evento, avulso.';
  comment on table public.contrato_cobrancas is 'GG Code — cada valor a receber. Receber cria financial_entries por fn_contratos_cobranca_receber.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_contratos_provisionar() from public, anon, authenticated;
grant execute on function public.fn_contratos_provisionar() to service_role;

-- D7: `record`, nunca %rowtype — compila antes de o módulo ser instalado.
create or replace function public.fn_contratos_cobranca_receber(
  p_org uuid,
  p_cobranca uuid,
  p_account_id uuid,
  p_recebida_em date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cob record;
  v_entry uuid;
  v_data date := coalesce(p_recebida_em, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'manager') then
    raise exception 'contratos_forbidden' using errcode = '42501';
  end if;

  select * into v_cob from public.contrato_cobrancas
   where id = p_cobranca and organization_id = p_org
   for update;
  if not found then
    raise exception 'cobranca_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_cob.situacao <> 'a_receber' then
    raise exception 'cobranca_nao_recebivel' using errcode = '22023';
  end if;
  if not exists (select 1 from public.financial_accounts
                  where id = p_account_id and organization_id = p_org and is_active) then
    raise exception 'conta_invalida' using errcode = '22023';
  end if;

  insert into public.financial_entries
    (organization_id, account_id, direction, amount_cents, description, entry_date,
     status, paid_at, origin, created_by_user_id)
  values (p_org, p_account_id, 'in', v_cob.valor_cents, v_cob.descricao, v_data,
          'paid', now(), 'manual', auth.uid())
  returning id into v_entry;

  update public.contrato_cobrancas
     set situacao = 'recebida', recebida_em = v_data, financial_entry_id = v_entry, updated_at = now()
   where id = p_cobranca;

  return jsonb_build_object('id', v_cob.id, 'contrato_id', v_cob.contrato_id, 'valor_cents', v_cob.valor_cents,
    'situacao', 'recebida', 'recebida_em', v_data, 'financial_entry_id', v_entry);
end;
$$;

revoke execute on function public.fn_contratos_cobranca_receber(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.fn_contratos_cobranca_receber(uuid, uuid, uuid, date) to authenticated;
```

⚠️ **O UPDATE dentro da RPC passa pela policy?** Não. A função é `security definer` e o dono é `postgres`, então a RLS não se aplica ao dono (mesmo desenho de `fn_honorarios_parcela_pagar`). Conferir no baseline se `contrato_cobrancas` ficou com `force row level security` desligado: `fn_proteger_modulo_provisionado` não força, porque o Honorários faz o mesmo update.

- [ ] **Step 3: Acrescentar ao `supabase/baseline.sql`**

No **fim** do arquivo, colar exatamente o corpo da migration a partir de `create or replace function public.fn_contratos_provisionar()` até o último `grant`, precedido de:

```sql
-- ---- GG Code: módulo Contratos — provisionadora + recebimento (migration 9001) ----
```

- [ ] **Step 4: Registrar o módulo**

`lib/modulos/catalogo.ts`, no array `CATALOGO_DE_MODULOS`, depois da entrada `financeiro`:

```ts
  {
    // GG Code — migration 9001.
    slug: "contratos",
    nome: "Contratos e receitas",
    descricao:
      "Contratos com clientes (implantação, mensalidade, por evento, avulso), cobranças do mês " +
      "e botão Recebido que lança no caixa.",
  },
```

`lib/instalacao/modulos.ts`: acrescentar `"contratos",` em `MODULOS_OPCIONAIS`, depois de `"financeiro",`. Em `MODULOS_DE_TABELA`:

```ts
const MODULOS_DE_TABELA = ["honorarios", "financeiro", "contratos"] as const satisfies readonly ModuloOpcional[];
```

- [ ] **Step 5: Conferir números e tipos**

Run: `pnpm checar:colisao-de-migration && pnpm vitest run tests/unit/manifest-x-migrations.test.ts tests/unit/adr-0002-funcao-provisionadora.test.ts && pnpm typecheck`
Expected: PASS. Se o `checar` reclamar da faixa 9001 (número fora da sequência), ler a mensagem e ajustar a regra só se ela barrar faixa própria. Se barrar, usar o próximo número livre do upstream e anotar em `docs/specs` que esse número precisa mudar se colidir num merge futuro.

- [ ] **Step 6: Commit e CI**

```bash
git add supabase lib/modulos/catalogo.ts lib/instalacao/modulos.ts tests/invariants/contratos-*.test.ts tests/invariants/adr-0002-d8-varreduras-com-os-modulos-instalados.test.ts
git commit -m "feat(contratos): module schema with per-operation RLS and atomic receive"
git push
```

Acompanhar o run do `ci.yml` na API (comando do Task 0 Step 4).
Expected: jobs `invariants-majors` verdes, incluindo `contratos-rls-por-operacao`, `contratos-receber-uma-vez`, `adr-0002-d8-*`, `lgpd-modulo-nao-declarado` e `hardening-definer-varredura`. Se algum invariante pedir registro novo (ex.: lista de funções definer), ler a mensagem do teste, que diz onde registrar, e registrar com o motivo.

---

### Task 3: API REST do módulo

**Files:**
- Create: `lib/contratos/esquemas.ts`
- Create: `app/api/v1/contratos/_comum.ts`
- Create: `app/api/v1/contratos/route.ts`
- Create: `app/api/v1/contratos/[id]/route.ts`
- Create: `app/api/v1/contratos/[id]/eventos/route.ts`
- Create: `app/api/v1/contratos/cobrancas/route.ts`
- Create: `app/api/v1/contratos/cobrancas/[id]/receber/route.ts`
- Create: `app/api/v1/contratos/cobrancas/[id]/cancelar/route.ts`
- Create: `app/api/v1/contratos/clientes/route.ts`
- Test: `tests/unit/contratos-esquemas.test.ts`

**Interfaces:**
- Consumes: Task 1 (`cobrancasIniciais`, `hojeNoFuso`, `totaisDoMes`, tipos), Task 2 (tabelas, RPC).
- Produces (JSON `{ data }` via `ok()`):
  - `GET /api/v1/contratos` → `Contrato[]`
  - `POST /api/v1/contratos` body `CriarContrato` → `{ id }`
  - `GET /api/v1/contratos/:id` → `{ contrato: Contrato, formas: Forma[], cobrancas: Cobranca[] }`
  - `PATCH /api/v1/contratos/:id` body `{ acao: "encerrar" | "cancelar", cancelar_futuras?: boolean }` → `{ id, situacao }`
  - `POST /api/v1/contratos/:id/eventos` body `{ forma_id, data, titulo, valor_cents? }` → `Cobranca`
  - `GET /api/v1/contratos/cobrancas?filtro=atrasadas|mes|proximas|recebidas` → `{ cobrancas: Cobranca[], totais: {aReceber, recebido, atrasado, qtdAtrasadas} }`
  - `POST /api/v1/contratos/cobrancas/:id/receber` body `{ account_id, recebida_em? }` → resultado da RPC
  - `POST /api/v1/contratos/cobrancas/:id/cancelar` → `{ id, situacao: "cancelada" }`
  - `GET /api/v1/contratos/clientes` → `Array<{ id, title, contact_name }>` (negócios fechados)
  - Todas devolvem 409 `module_not_installed` com `MENSAGEM_MODULO` quando a tabela não existe (42P01).

- [ ] **Step 1: Teste dos schemas (falha)**

`tests/unit/contratos-esquemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { criarContratoSchema, lancarEventoSchema } from "@/lib/contratos/esquemas";

const lead = "6f1c2b9e-1111-4000-8000-000000000001";

describe("criarContratoSchema", () => {
  it("aceita implantação + mensalidade", () => {
    expect(criarContratoSchema.safeParse({
      lead_id: lead, titulo: "Site", inicio: "2026-10-14",
      formas: [{ tipo: "implantacao", valor_cents: 100000, parcelas: 2, primeiro_vencimento: "2026-10-20" }, { tipo: "mensalidade", valor_cents: 50000, dia_vencimento: 10 }],
    }).success).toBe(true);
  });
  it("recusa contrato sem forma", () => {
    expect(criarContratoSchema.safeParse({ lead_id: lead, titulo: "X", inicio: "2026-10-14", formas: [] }).success).toBe(false);
  });
  it("recusa mensalidade sem dia", () => {
    expect(criarContratoSchema.safeParse({ lead_id: lead, titulo: "X", inicio: "2026-10-14", formas: [{ tipo: "mensalidade", valor_cents: 1 }] }).success).toBe(false);
  });
  it("recusa implantação sem primeiro vencimento", () => {
    expect(criarContratoSchema.safeParse({ lead_id: lead, titulo: "X", inicio: "2026-10-14", formas: [{ tipo: "implantacao", valor_cents: 1 }] }).success).toBe(false);
  });
  it("recusa fim antes do início", () => {
    expect(criarContratoSchema.safeParse({ lead_id: lead, titulo: "X", inicio: "2026-10-14", fim: "2026-10-01", formas: [{ tipo: "evento", valor_cents: 1 }] }).success).toBe(false);
  });
});

describe("lancarEventoSchema", () => {
  it("valor é opcional (usa o padrão da forma)", () => {
    expect(lancarEventoSchema.safeParse({ forma_id: lead, data: "2026-12-05", titulo: "Espetáculo" }).success).toBe(true);
  });
});
```

Run: `pnpm vitest run tests/unit/contratos-esquemas.test.ts`. Expected: FAIL (módulo inexistente).

- [ ] **Step 2: Schemas**

`lib/contratos/esquemas.ts`:

```ts
import { z } from "zod";

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD");
const centavos = z.number().int().min(1).max(10_000_000_00);

export const formaSchema = z
  .object({
    tipo: z.enum(["implantacao", "mensalidade", "evento", "avulso"]),
    valor_cents: centavos,
    parcelas: z.number().int().min(1).max(60).optional(),
    primeiro_vencimento: data.optional(),
    dia_vencimento: z.number().int().min(1).max(31).optional(),
    descricao: z.string().trim().max(120).optional(),
  })
  .refine((f) => f.tipo !== "mensalidade" || f.dia_vencimento != null, { message: "Mensalidade precisa do dia de vencimento." })
  .refine((f) => !["implantacao", "avulso"].includes(f.tipo) || f.primeiro_vencimento != null, { message: "Informe o vencimento." });

export const criarContratoSchema = z
  .object({
    lead_id: z.string().uuid(),
    titulo: z.string().trim().min(1).max(120),
    inicio: data,
    fim: data.nullish(),
    formas: z.array(formaSchema).min(1, "Adicione ao menos uma forma de cobrança.").max(10),
  })
  .refine((c) => !c.fim || c.fim >= c.inicio, { message: "O fim não pode ser antes do início." });
export type CriarContrato = z.infer<typeof criarContratoSchema>;

export const lancarEventoSchema = z.object({
  forma_id: z.string().uuid(),
  data,
  titulo: z.string().trim().min(1).max(120),
  valor_cents: centavos.optional(),
});

export const receberSchema = z.object({ account_id: z.string().uuid(), recebida_em: data.optional() });
export const alterarContratoSchema = z.object({ acao: z.enum(["encerrar", "cancelar"]), cancelar_futuras: z.boolean().default(true) });
export const filtroSchema = z.enum(["atrasadas", "mes", "proximas", "recebidas"]).catch("mes");
```

Run: `pnpm vitest run tests/unit/contratos-esquemas.test.ts`. Expected: PASS.

- [ ] **Step 3: Helper comum**

`app/api/v1/contratos/_comum.ts`:

```ts
import { fail } from "@/lib/api/wrappers";

export const MENSAGEM_MODULO =
  "O módulo Contratos não está instalado. Peça ao administrador para instalar em Configurações da instalação › Módulos.";

/** 42P01 = tabela inexistente = módulo não instalado (ADR-0002). */
export function respostaDeErro(error: { code?: string; message?: string }, requestId: string): Response {
  if (error.code === "42P01") return fail("module_not_installed", MENSAGEM_MODULO, 409, { requestId });
  if (error.code === "23503") return fail("validation_failed", "Referência inválida para esta organização.", 422, { requestId });
  if (error.code === "23505") return fail("conflict", "Esta cobrança já existe.", 409, { requestId });
  return fail("internal_error", error.message ?? "erro", 500, { requestId });
}

/** Linha de cobrança com o nome do contrato e do cliente, no formato `Cobranca`. */
export const SELECT_COBRANCA =
  "id, contrato_id, forma_id, competencia, descricao, vencimento, valor_cents, situacao, recebida_em, " +
  "contratos!inner(titulo, crm_leads(title))";

type LinhaCobranca = Record<string, unknown> & { contratos: { titulo: string; crm_leads: { title: string } | null } };
export function achatarCobranca(l: LinhaCobranca) {
  const { contratos, ...resto } = l;
  return { ...resto, contrato_titulo: contratos.titulo, cliente: contratos.crm_leads?.title ?? "—" };
}
```

- [ ] **Step 4: `app/api/v1/contratos/route.ts`**

```ts
/**
 * CONTRATOS (GG Code, migration 9001) — lista e criação.
 * Criar = contrato + formas + cobranças iniciais (implantação, avulso, mensalidade do mês).
 * Não é transação única: se uma etapa falhar, o contrato recém-criado é apagado (sem cobrança
 * recebida, a policy de delete permite) para não deixar contrato pela metade.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { criarContratoSchema } from "@/lib/contratos/esquemas";
import { cobrancasIniciais, hojeNoFuso } from "@/lib/contratos/regras";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { respostaDeErro } from "./_comum";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const hoje = hojeNoFuso();

  const { data, error } = await supabase
    .from("contratos")
    .select("id, lead_id, titulo, inicio, fim, situacao, crm_leads(title), contrato_formas(tipo, valor_cents, ativa), contrato_cobrancas(vencimento, situacao)")
    .eq("organization_id", authz.org.orgId)
    .order("situacao")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return respostaDeErro(error, requestId);

  const lista = (data ?? []).map((c) => ({
    id: c.id, lead_id: c.lead_id, titulo: c.titulo, inicio: c.inicio, fim: c.fim, situacao: c.situacao,
    cliente: (c.crm_leads as { title?: string } | null)?.title ?? "—",
    mensal_cents: (c.contrato_formas as Array<{ tipo: string; valor_cents: number; ativa: boolean }>)
      .filter((f) => f.tipo === "mensalidade" && f.ativa).reduce((s, f) => s + f.valor_cents, 0),
    proximo_vencimento: (c.contrato_cobrancas as Array<{ vencimento: string; situacao: string }>)
      .filter((k) => k.situacao === "a_receber" && k.vencimento >= hoje).map((k) => k.vencimento).sort()[0] ?? null,
  }));
  return ok(lista, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;

  const lido = criarContratoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const orgId = authz.org.orgId;
  const corpo = lido.data;
  const supabase = await createClient();

  const { data: lead } = await supabase.from("crm_leads").select("id").eq("id", corpo.lead_id).eq("organization_id", orgId).maybeSingle();
  if (!lead) return fail("validation_failed", "Negócio inválido para esta organização.", 422, { requestId });

  const { data: contrato, error: e1 } = await supabase
    .from("contratos")
    .insert({ organization_id: orgId, lead_id: corpo.lead_id, titulo: corpo.titulo, inicio: corpo.inicio, fim: corpo.fim ?? null })
    .select("id")
    .single();
  if (e1) return respostaDeErro(e1, requestId);

  const desfazer = async () => { await supabase.from("contratos").delete().eq("id", contrato.id); };
  const hoje = corpo.inicio > hojeNoFuso() ? corpo.inicio : hojeNoFuso();

  for (const forma of corpo.formas) {
    const { data: f, error: e2 } = await supabase
      .from("contrato_formas")
      .insert({ organization_id: orgId, contrato_id: contrato.id, tipo: forma.tipo, valor_cents: forma.valor_cents,
        parcelas: forma.parcelas ?? 1, primeiro_vencimento: forma.primeiro_vencimento ?? null,
        dia_vencimento: forma.dia_vencimento ?? null, descricao: forma.descricao ?? null })
      .select("id")
      .single();
    if (e2) { await desfazer(); return respostaDeErro(e2, requestId); }
    const novas = cobrancasIniciais(forma, hoje).map((c) => ({ ...c, organization_id: orgId, contrato_id: contrato.id, forma_id: f.id }));
    if (novas.length) {
      const { error: e3 } = await supabase.from("contrato_cobrancas").insert(novas);
      if (e3) { await desfazer(); return respostaDeErro(e3, requestId); }
    }
  }

  await audit({ action: "contratos.contrato_criado", resourceType: "contrato", resourceId: contrato.id, requestId, metadata: { formas: corpo.formas.length } });
  return ok({ id: contrato.id }, { requestId, status: 201 });
}
```

⚠️ Conferir a assinatura de `ok()` em `lib/api/wrappers.ts`. Se ela não aceitar `status`, devolver `ok({ id }, { requestId })` (200), como as rotas de honorários.

- [ ] **Step 5: `app/api/v1/contratos/[id]/route.ts`**

```ts
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { alterarContratoSchema } from "@/lib/contratos/esquemas";
import { hojeNoFuso } from "@/lib/contratos/regras";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { achatarCobranca, respostaDeErro, SELECT_COBRANCA } from "../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const supabase = await createClient();
  const orgId = authz.org.orgId;

  const [c, f, k] = await Promise.all([
    supabase.from("contratos").select("id, lead_id, titulo, inicio, fim, situacao, crm_leads(title, contact_id)").eq("id", id).eq("organization_id", orgId).maybeSingle(),
    supabase.from("contrato_formas").select("id, tipo, valor_cents, parcelas, primeiro_vencimento, dia_vencimento, descricao, ativa").eq("contrato_id", id).eq("organization_id", orgId).order("created_at"),
    supabase.from("contrato_cobrancas").select(SELECT_COBRANCA).eq("contrato_id", id).eq("organization_id", orgId).order("vencimento"),
  ]);
  const erro = c.error ?? f.error ?? k.error;
  if (erro) return respostaDeErro(erro, requestId);
  if (!c.data) return fail("not_found", "Contrato não encontrado.", 404, { requestId });
  const lead = c.data.crm_leads as { title?: string; contact_id?: string } | null;
  return ok({
    contrato: { ...c.data, crm_leads: undefined, cliente: lead?.title ?? "—", contact_id: lead?.contact_id ?? null },
    formas: f.data ?? [],
    cobrancas: (k.data ?? []).map((l) => achatarCobranca(l as never)),
  }, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const lido = alterarContratoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", "Ação inválida.", 422, { requestId });
  const { id } = await ctx.params;
  const orgId = authz.org.orgId;
  const supabase = await createClient();
  const situacao = lido.data.acao === "encerrar" ? "encerrado" : "cancelado";
  const hoje = hojeNoFuso();

  const { data, error } = await supabase.from("contratos")
    .update({ situacao, fim: hoje, updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", orgId).eq("situacao", "ativo").select("id, situacao").maybeSingle();
  if (error) return respostaDeErro(error, requestId);
  if (!data) return fail("not_found", "Contrato ativo não encontrado.", 404, { requestId });

  await supabase.from("contrato_formas").update({ ativa: false }).eq("contrato_id", id).eq("organization_id", orgId);
  if (lido.data.cancelar_futuras) {
    await supabase.from("contrato_cobrancas").update({ situacao: "cancelada", updated_at: new Date().toISOString() })
      .eq("contrato_id", id).eq("organization_id", orgId).eq("situacao", "a_receber").gt("vencimento", hoje);
  }
  await audit({ action: `contratos.contrato_${situacao}`, resourceType: "contrato", resourceId: id, requestId });
  return ok(data, { requestId });
}
```

- [ ] **Step 6: `app/api/v1/contratos/[id]/eventos/route.ts`**

```ts
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { lancarEventoSchema } from "@/lib/contratos/esquemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { achatarCobranca, respostaDeErro, SELECT_COBRANCA } from "../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const lido = lancarEventoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  const { id: contratoId } = await ctx.params;
  const orgId = authz.org.orgId;
  const supabase = await createClient();

  const { data: forma, error: e1 } = await supabase.from("contrato_formas")
    .select("id, valor_cents, contratos!inner(situacao)").eq("id", lido.data.forma_id).eq("contrato_id", contratoId)
    .eq("organization_id", orgId).eq("tipo", "evento").maybeSingle();
  if (e1) return respostaDeErro(e1, requestId);
  if (!forma || (forma.contratos as { situacao: string }).situacao !== "ativo") {
    return fail("validation_failed", "Forma de cobrança por evento não encontrada em contrato ativo.", 422, { requestId });
  }

  const { data, error } = await supabase.from("contrato_cobrancas").insert({
    organization_id: orgId, contrato_id: contratoId, forma_id: forma.id, competencia: `evento-${randomUUID()}`,
    descricao: `Evento: ${lido.data.titulo}`, vencimento: lido.data.data, valor_cents: lido.data.valor_cents ?? forma.valor_cents,
  }).select(SELECT_COBRANCA).single();
  if (error) return respostaDeErro(error, requestId);

  await audit({ action: "contratos.evento_lancado", resourceType: "contrato", resourceId: contratoId, requestId });
  return ok(achatarCobranca(data as never), { requestId });
}
```

- [ ] **Step 7: `app/api/v1/contratos/cobrancas/route.ts`**

```ts
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { filtroSchema } from "@/lib/contratos/esquemas";
import { hojeNoFuso, somarMeses, totaisDoMes } from "@/lib/contratos/regras";
import { createClient } from "@/lib/supabase/server";

import { achatarCobranca, respostaDeErro, SELECT_COBRANCA } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const filtro = filtroSchema.parse(new URL(req.url).searchParams.get("filtro"));
  const hoje = hojeNoFuso();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const fimMes = somarMeses(inicioMes, 1);
  const supabase = await createClient();
  const orgId = authz.org.orgId;

  // Totais: tudo que pode cair nos três números (atrasadas de qualquer mês + o mês corrente).
  const base = supabase.from("contrato_cobrancas").select("situacao, vencimento, valor_cents, recebida_em").eq("organization_id", orgId);
  const { data: paraTotais, error: e1 } = await base.or(`and(situacao.eq.a_receber,vencimento.lt.${fimMes}),and(situacao.eq.recebida,recebida_em.gte.${inicioMes})`);
  if (e1) return respostaDeErro(e1, requestId);

  let q = supabase.from("contrato_cobrancas").select(SELECT_COBRANCA).eq("organization_id", orgId);
  if (filtro === "atrasadas") q = q.eq("situacao", "a_receber").lt("vencimento", hoje).order("vencimento");
  else if (filtro === "mes") q = q.eq("situacao", "a_receber").gte("vencimento", hoje).lt("vencimento", fimMes).order("vencimento");
  else if (filtro === "proximas") q = q.eq("situacao", "a_receber").gte("vencimento", fimMes).order("vencimento");
  else q = q.eq("situacao", "recebida").order("recebida_em", { ascending: false });
  const { data, error } = await q.limit(300);
  if (error) return respostaDeErro(error, requestId);

  return ok({
    cobrancas: (data ?? []).map((l) => achatarCobranca(l as never)),
    totais: totaisDoMes((paraTotais ?? []) as never, hoje),
  }, { requestId });
}
```

- [ ] **Step 8: receber, cancelar e clientes**

`app/api/v1/contratos/cobrancas/[id]/receber/route.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { receberSchema } from "@/lib/contratos/esquemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { MENSAGEM_MODULO } from "../../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const RECUSAS: Record<string, [string, string, number]> = {
  cobranca_nao_encontrada: ["not_found", "Cobrança não encontrada.", 404],
  cobranca_nao_recebivel: ["conflict", "Esta cobrança já foi recebida ou cancelada.", 409],
  conta_invalida: ["validation_failed", "Escolha uma conta ativa desta empresa.", 422],
  contratos_forbidden: ["forbidden", "Sem permissão para registrar recebimento.", 403],
};

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contrato_cobrancas" });
  if (!authz.ok) return authz.response;
  const lido = receberSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("validation_failed", "Escolha a conta.", 422, { requestId });
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("fn_contratos_cobranca_receber", {
    p_org: authz.org.orgId, p_cobranca: id, p_account_id: lido.data.account_id, p_recebida_em: lido.data.recebida_em ?? null,
  });
  if (error) {
    if (error.code === "42P01") return fail("module_not_installed", MENSAGEM_MODULO, 409, { requestId });
    const chave = Object.keys(RECUSAS).find((k) => error.message?.includes(k));
    if (chave) { const [code, msg, st] = RECUSAS[chave]; return fail(code, msg, st, { requestId }); }
    return fail("internal_error", "Erro ao registrar o recebimento.", 500, { requestId });
  }
  await audit({ action: "contratos.cobranca_recebida", resourceType: "contrato_cobranca", resourceId: id, requestId,
    metadata: { financial_entry_id: (data as { financial_entry_id: string }).financial_entry_id } });
  return ok(data, { requestId });
}
```

`app/api/v1/contratos/cobrancas/[id]/cancelar/route.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { respostaDeErro } from "../../../_comum";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "contrato_cobrancas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("contrato_cobrancas")
    .update({ situacao: "cancelada", updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", authz.org.orgId).eq("situacao", "a_receber").select("id, situacao").maybeSingle();
  if (error) return respostaDeErro(error, requestId);
  if (!data) return fail("conflict", "Só dá para cancelar cobrança a receber.", 409, { requestId });
  await audit({ action: "contratos.cobranca_cancelada", resourceType: "contrato_cobranca", resourceId: id, requestId });
  return ok(data, { requestId });
}
```

`app/api/v1/contratos/clientes/route.ts`:

```ts
/** Negócios fechados da organização, para o seletor do Novo contrato. Contato só para exibir. */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "contratos" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const { data, error } = await supabase.from("crm_leads").select("id, title, contacts(full_name)")
    .eq("organization_id", authz.org.orgId).eq("status", "won").order("closed_at", { ascending: false }).limit(300);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok((data ?? []).map((l) => ({ id: l.id, title: l.title, contact_name: (l.contacts as { full_name?: string } | null)?.full_name ?? null })), { requestId });
}
```

⚠️ Antes de rodar, conferir no baseline o nome real da coluna de nome em `contacts` e o de `closed_at` em `crm_leads`: `grep -n "CREATE TABLE public.contacts" -A30 supabase/baseline.sql`. Ajustar `full_name` e `closed_at` se forem outros.

- [ ] **Step 9: Tipagem e lint**

Run: `pnpm typecheck && pnpm lint app/api/v1/contratos lib/contratos && pnpm vitest run tests/unit/contratos-esquemas.test.ts tests/unit/contratos-regras.test.ts`
Expected: zero erros. Se os tipos gerados do Supabase (`types/supabase*.ts`) não conhecerem as tabelas novas, seguir o que as rotas de honorários fazem, que também são tabelas de módulo (cast ou client sem tipo). Não regenerar o arquivo inteiro.

- [ ] **Step 10: Commit**

```bash
git add lib/contratos app/api/v1/contratos tests/unit/contratos-esquemas.test.ts
git commit -m "feat(contratos): REST API for contracts, charges, events and receive"
```

---

### Task 4: Rotina diária das mensalidades

**Files:**
- Create: `app/api/v1/cron/contratos-mensalidades/route.ts`
- Modify: `docker/scheduler/entrypoint.sh` (linha nova no bloco do crontab, logo após `recurring-entries`)

**Interfaces:**
- Consumes: `mensalidadesDevidas`, `hojeNoFuso` (Task 1), tabelas (Task 2), `autorizaCron` e `createAdminClient` (núcleo).
- Produces: `GET|POST /api/v1/cron/contratos-mensalidades` → `{ geradas: number }`. 0 quando o módulo não está instalado.

- [ ] **Step 1: Ler o molde**

Ler `app/api/v1/cron/recurring-entries/route.ts` inteiro: como exporta GET/POST, o que faz com `autorizaCron` e o formato do `ok`. Ler também `tests/unit/cron-respeita-org-operante.test.ts`, que pode exigir filtro de "organização operante" em toda rota de cron. Se exigir, aplicar o mesmo filtro que `recurring-entries` usa.

- [ ] **Step 2: Implementar**

```ts
/**
 * Mensalidades dos contratos (GG Code, migration 9001). Diária.
 * Para cada forma `mensalidade` ativa de contrato ativo: garante a cobrança do mês corrente e
 * do seguinte. Idempotência é do índice único (forma_id, competencia): 23505 = já existia.
 * Nasce A RECEBER, nunca recebida — quem marca é uma pessoa.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { hojeNoFuso, mensalidadesDevidas } from "@/lib/contratos/regras";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("unauthorized", "unauthorized", 401, { requestId });
  const db = createAdminClient();
  const hoje = hojeNoFuso();

  const { data, error } = await db.from("contrato_formas")
    .select("id, organization_id, contrato_id, valor_cents, dia_vencimento, contratos!inner(inicio, fim, situacao)")
    .eq("tipo", "mensalidade").eq("ativa", true).eq("contratos.situacao", "ativo");
  if (error) {
    if (error.code === "42P01") return ok({ geradas: 0, modulo: "nao_instalado" }, { requestId });
    logger.error("contratos-mensalidades: leitura falhou", { requestId, error: error.message });
    return fail("internal_error", error.message, 500, { requestId });
  }

  let geradas = 0;
  for (const f of data ?? []) {
    const k = f.contratos as { inicio: string; fim: string | null };
    for (const c of mensalidadesDevidas({ dia_vencimento: f.dia_vencimento!, valor_cents: f.valor_cents }, k, hoje)) {
      const { error: e } = await db.from("contrato_cobrancas").insert({
        ...c, organization_id: f.organization_id, contrato_id: f.contrato_id, forma_id: f.id,
      });
      if (!e) geradas++;
      else if (e.code !== "23505") logger.warn("contratos-mensalidades: insert falhou", { requestId, forma: f.id, error: e.message });
    }
  }
  return ok({ geradas }, { requestId });
}

export const GET = handle;
export const POST = handle;
```

- [ ] **Step 3: Agendar no scheduler**

Em `docker/scheduler/entrypoint.sh`, logo depois da linha `50 5 * * *|60|api/v1/cron/recurring-entries`:

```
# GG Code — mensalidades dos contratos. Diária, depois das recorrências.
55 5 * * *|60|api/v1/cron/contratos-mensalidades
```

Run: `bash tests/shell/scheduler-entrypoint.test.sh`
Expected: PASS. Se o teste comparar a lista de rotas com as pastas de `app/api/v1/cron`, ele passa a enxergar a nova pasta; se exigir registro em outra lista, seguir a mensagem.

- [ ] **Step 4: Typecheck, testes e commit**

Run: `pnpm typecheck && pnpm vitest run tests/unit/cron-respeita-org-operante.test.ts tests/unit/contratos-regras.test.ts`
Expected: PASS

```bash
git add app/api/v1/cron/contratos-mensalidades docker/scheduler/entrypoint.sh
git commit -m "feat(contratos): daily job that creates monthly charges"
```

---

### Task 5: Telas

**Files:**
- Create: `app/app/contratos/page.tsx`, `_client.tsx`, `_cobrancas.tsx`, `_contratos.tsx`, `_novo.tsx`, `_evento.tsx`
- Modify: `lib/navigation/catalogo.ts` (item novo, logo após o item de `/app/honorarios`)

**Interfaces:**
- Consumes: rotas da Task 3, tipos de `lib/contratos/tipos.ts`, `situacaoExibida` e `hojeNoFuso` (Task 1), `GET /api/v1/financeiro/catalogo/contas` (núcleo; devolve `{ id, name }[]`; conferir os campos em `app/app/honorarios/_parcelas.tsx:57`).
- Produces: página `/app/contratos`.

- [ ] **Step 1: Ler os moldes de UI**

Ler inteiros:
- `app/app/honorarios/page.tsx`, `_client.tsx` e `_parcelas.tsx` (padrão de query, mutation, `showApiError`, dialog de conta);
- `components/ui/dialog.tsx`, `tabs.tsx`, `select.tsx` e `input.tsx`, para os nomes exportados.

Usar só componentes que existem em `components/ui`.

- [ ] **Step 2: Menu**

Em `lib/navigation/catalogo.ts`, depois do bloco de `/app/honorarios`:

```ts
  {
    // GG Code — módulo Contratos (migration 9001). Uso diário de quem administra: sobe ao sidebar.
    href: "/app/contratos",
    label: "Contratos",
    description: "Quem paga, quanto e quando. Cobranças do mês e recebimentos.",
    icon: "FileText",
    group: "analise",
    section: "Dinheiro",
    minRole: "viewer",
    sidebar: true,
    modulo: "contratos",
  },
```

Conferir se o ícone `FileText` existe no mapa de ícones do sidebar (`grep -rn "\"ChartBar\"" components/ | head`, para achar o mapa). Se não existir, usar um nome que exista.

Run: `pnpm vitest run tests/unit -t navega` (ou o teste de navegação que o grep `navigation/catalogo` em `tests/unit` achar). Expected: PASS. Se um teste limitar o número de itens no sidebar, trocar `sidebar: true` por omitir `sidebar` (fica no hub de Análise) e anotar.

- [ ] **Step 3: `page.tsx`**

```tsx
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { Contratos } from "./_client";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  return <Contratos podeGerenciar={ROLE_RANK[org.role] >= ROLE_RANK.manager} />;
}
```

- [ ] **Step 4: `_client.tsx` (números + abas)**

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { Cobranca } from "@/lib/contratos/tipos";
import { formatCents } from "@/lib/money";

import { ListaDeCobrancas } from "./_cobrancas";
import { ListaDeContratos } from "./_contratos";
import { NovoContrato } from "./_novo";

export type Filtro = "atrasadas" | "mes" | "proximas" | "recebidas";
type Resposta = { cobrancas: Cobranca[]; totais: { aReceber: number; recebido: number; atrasado: number; qtdAtrasadas: number } };

export function Contratos({ podeGerenciar }: { podeGerenciar: boolean }) {
  const t = useT();
  const [aba, setAba] = useState<"cobrancas" | "contratos">("cobrancas");
  const [filtro, setFiltro] = useState<Filtro>("mes");
  const [novo, setNovo] = useState(false);

  const cobrancas = useQuery({
    queryKey: ["contratos", "cobrancas", filtro],
    queryFn: async () => (await apiClient.get<{ data: Resposta }>(`/api/v1/contratos/cobrancas?filtro=${filtro}`)).data,
    retry: false,
  });

  if (cobrancas.error instanceof ApiError && cobrancas.error.code === "module_not_installed") {
    return <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">{cobrancas.error.message}</p>;
  }
  const tt = cobrancas.data?.totais;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("Contratos")}</h1>
        {podeGerenciar ? <Button onClick={() => setNovo(true)}>{t("Novo contrato")}</Button> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Numero rotulo={t("A receber no mês")} valor={tt?.aReceber} />
        <Numero rotulo={t("Recebido no mês")} valor={tt?.recebido} />
        <Numero rotulo={t("Atrasado")} valor={tt?.atrasado} extra={tt?.qtdAtrasadas ? `${tt.qtdAtrasadas}` : undefined} perigo={!!tt?.atrasado}
          onClick={() => { setAba("cobrancas"); setFiltro("atrasadas"); }} />
      </div>

      <div className="flex gap-1 border-b border-border" role="tablist">
        {(["cobrancas", "contratos"] as const).map((a) => (
          <button key={a} role="tab" aria-selected={aba === a} onClick={() => setAba(a)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${aba === a ? "border-primary text-text" : "border-transparent text-text-muted"}`}>
            {a === "cobrancas" ? t("Cobranças") : t("Contratos")}
          </button>
        ))}
      </div>

      {aba === "cobrancas" ? (
        <ListaDeCobrancas filtro={filtro} onFiltro={setFiltro} carregando={cobrancas.isLoading}
          cobrancas={cobrancas.data?.cobrancas ?? []} podeGerenciar={podeGerenciar} />
      ) : (
        <ListaDeContratos podeGerenciar={podeGerenciar} />
      )}

      {novo ? <NovoContrato onFechar={() => setNovo(false)} /> : null}
    </div>
  );
}

function Numero({ rotulo, valor, extra, perigo, onClick }: { rotulo: string; valor?: number; extra?: string; perigo?: boolean; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="rounded-lg border border-border p-4 text-left">
      <div className="text-xs font-medium text-text-muted">{rotulo}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${perigo ? "text-danger" : ""}`}>
        {valor == null ? "—" : formatCents(valor, "BRL")}
        {extra ? <span className="ml-2 text-sm font-normal">({extra})</span> : null}
      </div>
    </Tag>
  );
}
```

⚠️ Conferir os tokens de cor reais (`border-primary`, `text-text`, `text-danger`) em `app/globals.css` ou `tailwind.config`. Usar os que o resto das telas usa (ver `_client.tsx` do honorários).

- [ ] **Step 5: `_cobrancas.tsx` (lista + Recebido)**

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { hojeNoFuso, situacaoExibida } from "@/lib/contratos/regras";
import type { Cobranca } from "@/lib/contratos/tipos";
import { formatCents } from "@/lib/money";

import type { Filtro } from "./_client";

const FILTROS: Array<[Filtro, string]> = [["atrasadas", "Atrasadas"], ["mes", "Este mês"], ["proximas", "Próximas"], ["recebidas", "Recebidas"]];
const dataBR = (d: string) => d.split("-").reverse().join("/");

export function ListaDeCobrancas({ filtro, onFiltro, cobrancas, carregando, podeGerenciar }: {
  filtro: Filtro; onFiltro: (f: Filtro) => void; cobrancas: Cobranca[]; carregando: boolean; podeGerenciar: boolean;
}) {
  const t = useT();
  const [recebendo, setRecebendo] = useState<Cobranca | null>(null);
  const hoje = hojeNoFuso();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {FILTROS.map(([f, r]) => (
          <Button key={f} size="sm" variant={filtro === f ? "default" : "outline"} onClick={() => onFiltro(f)}>{t(r)}</Button>
        ))}
      </div>
      {carregando ? <p className="text-sm text-text-muted">{t("Carregando…")}</p> : cobrancas.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nada aqui.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {cobrancas.map((c) => {
            const s = situacaoExibida(c, hoje);
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.cliente}</div>
                  <div className="truncate text-xs text-text-muted">{c.descricao} · {c.contrato_titulo}</div>
                </div>
                <div className={`text-right text-xs ${s === "atrasada" ? "text-danger" : "text-text-muted"}`}>
                  {s === "recebida" && c.recebida_em ? `${t("Recebida")} ${dataBR(c.recebida_em)}` : `${s === "atrasada" ? t("Venceu") : t("Vence")} ${dataBR(c.vencimento)}`}
                </div>
                <div className="w-28 text-right text-sm font-semibold tabular-nums">{formatCents(c.valor_cents, "BRL")}</div>
                {podeGerenciar && c.situacao === "a_receber" ? (
                  <Button size="sm" onClick={() => setRecebendo(c)}>{t("Recebido")}</Button>
                ) : <span className="w-[84px]" />}
              </li>
            );
          })}
        </ul>
      )}
      {recebendo ? <DialogReceber cobranca={recebendo} onFechar={() => setRecebendo(null)} /> : null}
    </div>
  );
}

type Conta = { id: string; name: string };
const CHAVE_CONTA = "contratos:ultima-conta";

function DialogReceber({ cobranca, onFechar }: { cobranca: Cobranca; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const contas = useQuery({
    queryKey: ["financeiro", "contas"],
    queryFn: async () => (await apiClient.get<{ data: Conta[] }>("/api/v1/financeiro/catalogo/contas")).data,
  });
  const inicial = (() => { try { return localStorage.getItem(CHAVE_CONTA) ?? ""; } catch { return ""; } })();
  const [conta, setConta] = useState(inicial);
  const [data, setData] = useState(hojeNoFuso());
  const contaEscolhida = conta || contas.data?.[0]?.id || "";

  const receber = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/contratos/cobrancas/${cobranca.id}/receber`, { account_id: contaEscolhida, recebida_em: data }),
    onSuccess: () => {
      try { localStorage.setItem(CHAVE_CONTA, contaEscolhida); } catch { /* sem storage, segue */ }
      void qc.invalidateQueries({ queryKey: ["contratos"] });
      onFechar();
    },
    onError: showApiError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Registrar recebimento")}</DialogTitle></DialogHeader>
        <p className="text-sm">{cobranca.cliente} · {cobranca.descricao} · <b>{formatCents(cobranca.valor_cents, "BRL")}</b></p>
        <label className="flex flex-col gap-1 text-sm">{t("Entrou na conta")}
          <select className="rounded-md border border-border bg-transparent px-2 py-2" value={contaEscolhida} onChange={(e) => setConta(e.target.value)}>
            {(contas.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {contas.data && contas.data.length === 0 ? (
          <p className="text-sm text-danger">{t("Cadastre uma conta em Configurações › Financeiro.")}</p>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">{t("Data")}
          <input type="date" className="rounded-md border border-border bg-transparent px-2 py-2" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button disabled={!contaEscolhida || receber.isPending} onClick={() => receber.mutate()}>{t("Confirmar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: `_contratos.tsx` (lista + ficha)**

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { Cobranca, Contrato, Forma } from "@/lib/contratos/tipos";
import { formatCents } from "@/lib/money";

import { ListaDeCobrancas } from "./_cobrancas";
import { LancarEvento } from "./_evento";

const SIT: Record<string, string> = { ativo: "Ativo", encerrado: "Encerrado", cancelado: "Cancelado" };
const dataBR = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export function ListaDeContratos({ podeGerenciar }: { podeGerenciar: boolean }) {
  const t = useT();
  const [aberto, setAberto] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ["contratos", "lista"],
    queryFn: async () => (await apiClient.get<{ data: Contrato[] }>("/api/v1/contratos")).data,
  });
  if (lista.isLoading) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  if (!lista.data?.length) return <p className="text-sm text-text-muted">{t("Nenhum contrato ainda.")}</p>;
  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {lista.data.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-elevated" onClick={() => setAberto(c.id)}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.cliente}</div>
                <div className="truncate text-xs text-text-muted">{c.titulo} · {t(SIT[c.situacao])}</div>
              </div>
              <div className="text-right text-xs text-text-muted">{c.proximo_vencimento ? `${t("Próximo")} ${dataBR(c.proximo_vencimento)}` : ""}</div>
              <div className="w-32 text-right text-sm font-semibold tabular-nums">{c.mensal_cents ? `${formatCents(c.mensal_cents, "BRL")}/${t("mês")}` : "—"}</div>
            </button>
          </li>
        ))}
      </ul>
      {aberto ? <Ficha id={aberto} podeGerenciar={podeGerenciar} onFechar={() => setAberto(null)} /> : null}
    </>
  );
}

const ROTULO_FORMA: Record<string, string> = { implantacao: "Implantação", mensalidade: "Mensalidade", evento: "Por evento", avulso: "Avulso" };
function resumoForma(f: Forma, t: (s: string) => string): string {
  const v = formatCents(f.valor_cents, "BRL");
  if (f.tipo === "implantacao") return `${v}${(f.parcelas ?? 1) > 1 ? ` · ${f.parcelas}x` : ""}`;
  if (f.tipo === "mensalidade") return `${v} · ${t("dia")} ${f.dia_vencimento}`;
  if (f.tipo === "evento") return `${v} ${t("por evento")}`;
  return `${v} · ${f.descricao ?? ""}`;
}

function Ficha({ id, podeGerenciar, onFechar }: { id: string; podeGerenciar: boolean; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [evento, setEvento] = useState<Forma | null>(null);
  const ficha = useQuery({
    queryKey: ["contratos", "ficha", id],
    queryFn: async () => (await apiClient.get<{ data: { contrato: Contrato & { contact_id: string | null }; formas: Forma[]; cobrancas: Cobranca[] } }>(`/api/v1/contratos/${id}`)).data,
  });
  const encerrar = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/contratos/${id}`, { acao: "encerrar", cancelar_futuras: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["contratos"] }),
    onError: showApiError,
  });
  const d = ficha.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{d ? `${d.contrato.cliente} · ${d.contrato.titulo}` : t("Contrato")}</DialogTitle></DialogHeader>
        {d ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
              <span>{dataBR(d.contrato.inicio)} → {dataBR(d.contrato.fim)}</span>
              <span>{t(SIT[d.contrato.situacao])}</span>
              <a className="underline" href={`/app/leads/${d.contrato.lead_id}`}>{t("Abrir negócio")}</a>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {d.formas.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div><div className="text-xs text-text-muted">{t(ROTULO_FORMA[f.tipo])}</div><div className="text-sm font-medium">{resumoForma(f, t)}</div></div>
                  {podeGerenciar && f.tipo === "evento" && d.contrato.situacao === "ativo" ? (
                    <Button size="sm" variant="outline" onClick={() => setEvento(f)}>{t("Lançar evento")}</Button>
                  ) : null}
                </div>
              ))}
            </div>
            <ListaDeCobrancas filtro="mes" onFiltro={() => {}} carregando={false} cobrancas={d.cobrancas} podeGerenciar={podeGerenciar} semFiltros />
            {podeGerenciar && d.contrato.situacao === "ativo" ? (
              <div className="flex justify-end">
                <Button variant="outline" disabled={encerrar.isPending} onClick={() => encerrar.mutate()}>{t("Encerrar contrato")}</Button>
              </div>
            ) : null}
          </div>
        ) : <p className="text-sm text-text-muted">{t("Carregando…")}</p>}
        {evento ? <LancarEvento contratoId={id} forma={evento} onFechar={() => setEvento(null)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
```

Ajuste em `_cobrancas.tsx`: acrescentar a prop opcional `semFiltros?: boolean` e, quando verdadeira, não renderizar a fileira de botões de filtro. Isso permite reusar a lista dentro da ficha.

- [ ] **Step 7: `_evento.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { hojeNoFuso } from "@/lib/contratos/regras";
import type { Forma } from "@/lib/contratos/tipos";

export function LancarEvento({ contratoId, forma, onFechar }: { contratoId: string; forma: Forma; onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState(hojeNoFuso());
  const [valor, setValor] = useState((forma.valor_cents / 100).toFixed(2).replace(".", ","));
  const centavos = Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100);
  const lancar = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/contratos/${contratoId}/eventos`, { forma_id: forma.id, data, titulo, valor_cents: centavos }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["contratos"] }); onFechar(); },
    onError: showApiError,
  });
  const campo = "rounded-md border border-border bg-transparent px-2 py-2";
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Lançar evento")}</DialogTitle></DialogHeader>
        <label className="flex flex-col gap-1 text-sm">{t("Evento")}<input className={campo} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={t("Ex.: Espetáculo de fim de ano")} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">{t("Data")}<input type="date" className={campo} value={data} onChange={(e) => setData(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm">{t("Valor (R$)")}<input inputMode="decimal" className={campo} value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button disabled={!titulo.trim() || !(centavos > 0) || lancar.isPending} onClick={() => lancar.mutate()}>{t("Lançar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: `_novo.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { hojeNoFuso } from "@/lib/contratos/regras";
import type { TipoForma } from "@/lib/contratos/tipos";

type Cliente = { id: string; title: string; contact_name: string | null };
type FormaRascunho = { tipo: TipoForma; valor: string; parcelas: string; venc: string; dia: string; descricao: string };
const TIPOS: Array<[TipoForma, string]> = [["implantacao", "Implantação"], ["mensalidade", "Mensalidade"], ["evento", "Por evento"], ["avulso", "Avulso"]];
const vazia = (tipo: TipoForma): FormaRascunho => ({ tipo, valor: "", parcelas: "1", venc: hojeNoFuso(), dia: "10", descricao: "" });
const centavos = (v: string) => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);

export function NovoContrato({ onFechar }: { onFechar: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const clientes = useQuery({
    queryKey: ["contratos", "clientes"],
    queryFn: async () => (await apiClient.get<{ data: Cliente[] }>("/api/v1/contratos/clientes")).data,
  });
  const [lead, setLead] = useState("");
  const [titulo, setTitulo] = useState("");
  const [inicio, setInicio] = useState(hojeNoFuso());
  const [formas, setFormas] = useState<FormaRascunho[]>([vazia("implantacao")]);
  const mudar = (i: number, p: Partial<FormaRascunho>) => setFormas((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));

  const criar = useMutation({
    mutationFn: () => apiClient.post("/api/v1/contratos", {
      lead_id: lead, titulo, inicio,
      formas: formas.map((f) => ({
        tipo: f.tipo, valor_cents: centavos(f.valor),
        ...(f.tipo === "implantacao" ? { parcelas: Number(f.parcelas) || 1, primeiro_vencimento: f.venc } : {}),
        ...(f.tipo === "avulso" ? { primeiro_vencimento: f.venc, descricao: f.descricao } : {}),
        ...(f.tipo === "mensalidade" ? { dia_vencimento: Number(f.dia) } : {}),
      })),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["contratos"] }); onFechar(); },
    onError: showApiError,
  });

  const campo = "rounded-md border border-border bg-transparent px-2 py-2 text-sm";
  const valido = lead && titulo.trim() && formas.length > 0 && formas.every((f) => centavos(f.valor) > 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t("Novo contrato")}</DialogTitle></DialogHeader>
        <label className="flex flex-col gap-1 text-sm">{t("Cliente (negócio fechado)")}
          <select className={campo} value={lead} onChange={(e) => {
            setLead(e.target.value);
            const c = clientes.data?.find((x) => x.id === e.target.value);
            if (c && !titulo) setTitulo(c.title);
          }}>
            <option value="">{t("Escolha…")}</option>
            {(clientes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}{c.contact_name ? ` — ${c.contact_name}` : ""}</option>)}
          </select>
        </label>
        {clientes.data && clientes.data.length === 0 ? <p className="text-sm text-text-muted">{t("Nenhum negócio fechado. Marque o negócio como ganho no funil primeiro.")}</p> : null}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label className="flex flex-col gap-1 text-sm">{t("Nome do contrato")}<input className={campo} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm">{t("Início")}<input type="date" className={campo} value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        </div>

        <div className="flex flex-col gap-2">
          {formas.map((f, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 sm:grid-cols-4">
              <select className={campo} value={f.tipo} onChange={(e) => mudar(i, vazia(e.target.value as TipoForma))}>
                {TIPOS.map(([v, r]) => <option key={v} value={v}>{t(r)}</option>)}
              </select>
              <input className={campo} inputMode="decimal" placeholder={t("Valor R$")} value={f.valor} onChange={(e) => mudar(i, { valor: e.target.value })} />
              {f.tipo === "implantacao" ? (<>
                <input className={campo} inputMode="numeric" placeholder={t("Parcelas")} value={f.parcelas} onChange={(e) => mudar(i, { parcelas: e.target.value })} />
                <input type="date" className={campo} value={f.venc} onChange={(e) => mudar(i, { venc: e.target.value })} aria-label={t("1º vencimento")} />
              </>) : null}
              {f.tipo === "mensalidade" ? (
                <input className={campo} inputMode="numeric" placeholder={t("Dia do vencimento")} value={f.dia} onChange={(e) => mudar(i, { dia: e.target.value })} />
              ) : null}
              {f.tipo === "avulso" ? (<>
                <input type="date" className={campo} value={f.venc} onChange={(e) => mudar(i, { venc: e.target.value })} aria-label={t("Vencimento")} />
                <input className={campo} placeholder={t("Descrição")} value={f.descricao} onChange={(e) => mudar(i, { descricao: e.target.value })} />
              </>) : null}
              <Button variant="ghost" size="sm" className="col-span-full justify-self-end" onClick={() => setFormas((fs) => fs.filter((_, j) => j !== i))}>{t("Remover")}</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setFormas((fs) => [...fs, vazia("mensalidade")])}>{t("+ Forma de cobrança")}</Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>{t("Cancelar")}</Button>
          <Button disabled={!valido || criar.isPending} onClick={() => criar.mutate()}>{t("Salvar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 9: Tipagem, lint e i18n**

Run: `pnpm typecheck && pnpm lint app/app/contratos lib/navigation`
Expected: zero erros. Se houver teste de i18n que exige toda string de `t()` no dicionário (`grep -rln "dicionario" tests/unit | head`), rodar e registrar as strings novas onde ele mandar, só em pt-BR.

- [ ] **Step 10: Commit e push (CI completo)**

```bash
git add app/app/contratos lib/navigation/catalogo.ts
git commit -m "feat(contratos): contracts screen with charges, receive and events"
git push
```

Expected: `ci.yml` verde. Se o e2e ou algum teste de navegação reprovar por causa do item novo, ler a mensagem e ajustar. Não desligar o teste.

---

### Task 6: Publicar e trocar a VPS para as imagens da GG Code

**Files:**
- Nenhum arquivo do repositório. Operação na VPS.

- [ ] **Step 1: Tag de release**

```bash
git tag v1.80.0-gg.1 && git push origin v1.80.0-gg.1
```

Acompanhar `publish-image.yml` até `success` (comando do Task 0 Step 4).

- [ ] **Step 2: Desligar o "oferecer atualização do Deskcomm" na VPS antes de trocar**

O `hostgator-setup-kit/agent.sh` (cron `*/5`) oferece a maior tag `v*` do upstream. Com imagens nossas, aceitar essa oferta voltaria a VPS para o Deskcomm puro.

```bash
ssh -i ~/.ssh/ggcode_crm_ed25519 root@179.197.237.126 'cd /opt/ggcode-crm && grep -n "github.com\|api.github\|releases" hostgator-setup-kit/agent.sh | head'
```

Se o agente consulta o repositório do upstream, comentar a linha `# deskcomm:/opt/ggcode-crm:agent` no crontab da VPS:

```bash
crontab -l | sed 's|^\(\*/5 .*deskcomm:/opt/ggcode-crm:agent\)$|# \1|' | crontab -
```

Anotar no diário que **atualizações agora são feitas por nós (merge + tag)**.

- [ ] **Step 3: Atualizar a VPS para a nossa versão (à noite, com o Guilherme avisado)**

Primeiro, na VPS, apontar o kit para o nosso repositório:

```bash
cd /opt/ggcode-crm
git remote set-url origin https://github.com/Lermiis/ggcode-crm.git
```

O repositório é privado. Para o `git fetch` da VPS funcionar, criar uma **deploy key só de leitura**:
1. `ssh-keygen -t ed25519 -f /root/.ssh/ggcode_repo -N ""` na VPS.
2. Cadastrar a chave pública com `POST /repos/Lermiis/ggcode-crm/keys` (`read_only: true`).
3. Configurar o remote como `git@github.com:Lermiis/ggcode-crm.git` com `core.sshCommand="ssh -i /root/.ssh/ggcode_repo"`.

Então rodar:

```bash
bash hostgator-setup-kit/update.sh --to v1.80.0-gg.1
```

Expected: `✓ Atualização concluída — app no ar e saudável`. Conferir `grep -E "^(APP|WORKER|SCHEDULER)_IMAGE" .env`. Os três precisam apontar para `ghcr.io/lermiis/...:1.80.0-gg.1`.

**Rollback** (se falhar):
1. `git remote set-url origin https://github.com/melgarafael/DeskcommCRM.git`.
2. Restaurar `IMG_NS` no `_common.sh`.
3. `bash hostgator-setup-kit/update.sh --to v1.80.0 --force`.

- [ ] **Step 4: Instalar o módulo e conferir de ponta a ponta**

Como administrador da instalação, em `https://crm.ggc0de.com/admin/modulos`, instalar **Contratos e receitas**. Depois:
1. **Contratos** aparece no menu.
2. **Novo contrato:** Juliana Bercial (negócio fechado), "Sistema de ingressos PEC", Implantação R$ 1.000 (2x, 1º vencimento hoje) + Por evento R$ 500. Aparecem 2 cobranças de R$ 500.
3. Na ficha: **Lançar evento** "Teste", data de hoje. Aparece a cobrança "Evento: Teste" de R$ 500.
4. **Recebido** na 1ª parcela (conta Caixa). Ela sai de "Este mês", o total "Recebido no mês" vira R$ 500 e o lançamento aparece em **Faturamento**.
5. Cancelar a cobrança "Evento: Teste" (era só teste).
6. Rodar a rotina à mão: `docker compose exec -T scheduler sh -c 'curl -fsS -H "Authorization: Bearer $INTERNAL_SECRET" http://app:3000/api/v1/cron/contratos-mensalidades'`. Expected: `{"geradas":0}` (não há mensalidade).
7. Abrir no tema escuro e no celular: os números e a lista ficam legíveis.

- [ ] **Step 5: Registrar**

Atualizar `C:\Users\User\Desktop\Claudio 1.0\vault\Diario\<hoje>.md` e `Projetos/GG Code.md`:
- versão `v1.80.0-gg.1` no ar;
- módulo instalado;
- novo procedimento de atualização: merge da tag do upstream na `main` do `Lermiis/ggcode-crm`, tag `-gg.N`, `update.sh --to`;
- agente de atualização desligado.

---

## Self-review

- **Cobertura da spec:**
  - modelos (T1, T2, T3);
  - recebido no caixa (T2, T3, T5);
  - mensalidade automática (T4);
  - lançar evento (T3, T5);
  - encerrar e cancelar (T3, T5);
  - tela com 3 números e abas (T5);
  - permissões (T2, T3);
  - LGPD (Global Constraints + T2);
  - pré-requisito de repositório e imagens (T0, T6);
  - testes unitários e invariantes (T1–T4).
- **Desvios declarados da spec:**
  - (a) o contrato liga ao **negócio** (`lead_id`), não ao contato. Isso evita registro de LGPD; o cliente é o negócio fechado.
  - (b) o módulo liga por **instalação**, não por empresa. O mecanismo por empresa do Deskcomm (`capacidades`) exigiria mexer em mais arquivos do upstream. Com uma instalação só, todos veem o menu quando instalado, e cada empresa só vê os próprios contratos.
  - (c) o nome do contrato é `titulo`, por causa da régua de LGPD.
- **Riscos que só o CI revela** (não há Docker local): invariantes de catálogo de funções definer, numeração 9001 e e2e. Cada task manda ler a mensagem do teste e registrar no lugar que ele indica.
