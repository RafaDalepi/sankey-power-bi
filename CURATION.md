# Curadoria e Rastreamento de Alterações: Sankey Tramontina (`sankeytramontina`)

Este documento é a **fonte única da verdade de curadoria** para todas as modificações realizadas no projeto do visual customizado **Sankey Tramontina** (`sankeytramontina/`).

---

## 📌 Regra do Projeto (Curation Rule)

> **Toda e qualquer alteração realizada neste projeto (`sankeytramontina/`) — seja código-fonte (`src/`), capacidades (`capabilities.json`), configurações (`settings.ts`), testes (`tests/`), estilos (`style/visual.less`) ou dependências — DEVE ser registrada obrigatoriamente neste documento antes da finalização da tarefa.**

---

## 📋 Modelo de Entrada para Curadoria (Template)

```markdown
### [YYYY-MM-DD] - <Título Resumido da Alteração>

- **Tipo de Alteração**: `feature` | `fix` | `refactor` | `style` | `contract` | `settings` | `release`
- **Versão**: `<versão anterior>` -> `<nova versão>` (se empacotado para consumo)
- **Motivação / Contexto**: Explicação clara do motivo da alteração e do problema resolvido.
- **Impacto Observável no Power BI**: O que muda na interface do usuário, formato ou comportamento visual.
- **Arquivos Afetados**:
  - `capabilities.json`: Descrição das mudanças
  - `src/...`: Descrição das mudanças
- **Contratos e Configurações**:
  - Detalhes de propriedades ou slices adicionadas/modificadas.
- **Evidências de Validação**:
  - Status de testes (`npm test`), lint e build.
```

---

## 🕒 Histórico de Curadoria (Curation Log)

### [2026-09-21] - Remoção da Tabela de Detalhes Acoplada para Projeto Standalone

- **Tipo de Alteração**: `refactor` / `cleanup`
- **Versão**: `1.1.0.0`
- **Motivação / Contexto**:
  - Separação de responsabilidades: a tabela de detalhes antes acoplada ao visual Sankey foi removida para dar lugar a um visual dedicado e independente (`tabletramontina`).
- **Impacto Observável no Power BI**:
  - O Sankey foca exclusivamente na renderização do diagrama de fluxo, alinhamento de colunas, ordenação customizada e cross-filtering nativo, com carregamento mais leve.
- **Arquivos Afetados**:
  - `src/detailTable.ts`: Removido.
  - `tests/detailTable.test.ts`: Removido.
  - `src/visual.ts`: Removidas referências e DOM da tabela de detalhes.
  - `src/settings.ts` & `capabilities.json`: Removidos cards de configuração de tabela de detalhes.
  - `style/visual.less`: Removidos estilos de tabela de detalhes.
- **Evidências de Validação**:
  - `npm test` em `sankeytramontina/`: 53 testes passando (0 falhas).

---

### [2026-09-18] - Introdução de LinkConfig e NodeLabels Customizáveis

- **Tipo de Alteração**: `feature` / `settings`
- **Versão**: `1.0.0.0` -> `1.0.1.0`
- **Motivação / Contexto**:
  - Suporte a estilização de fitas de conexão (`linkConfig`) com opacidade customizada, modos de cor e curvatura clamped.
  - Customização rica de rótulos dos nós (`nodeLabels`), suportando tipografia, posicionamento, modos de conteúdo e precisão compacta de números.
- **Arquivos Afetados**:
  - `capabilities.json`, `src/settings.ts`, `src/model.ts`, `src/visual.ts`, `tests/model.test.ts`.
- **Evidências de Validação**:
  - Testes automatizados cobrindo cálculo de links e rótulos de nós aprovados.
