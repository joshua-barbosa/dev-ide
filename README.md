# dev-ide

IDE de desenvolvimento própria, construída com **Node.js + TypeScript** no servidor e **React + Vite** na interface — sem extensões nem plugins. Editor com realce próprio, painel de símbolos, execução de código e conexão a bancos de dados.

Pensada para futuramente ser integrada a uma engine de criação de ambientes 3D com three.js: a engine pode consumir a mesma API REST (arquivos, símbolos, execução) ou ser embutida como painel adicional.

## Como rodar

```bash
npm install
npm start          # compila tudo e sobe em http://localhost:4321
npm run dev        # servidor de desenvolvimento da interface (exige o npm start em outro terminal)
npm test           # roda a suíte
```

O `npm test` compila só o servidor, sem passar pelo build da interface — a suíte
não paga o custo do Vite. Se você rodar `npm test` e depois `node dist/server/index.js`
direto, a interface não estará compilada; use `npm start` ou `npm run build:ui`.

Porta configurável via `PORT`; pasta raiz dos projetos via `DEV_IDE_PROJECTS` (padrão: `./projects`).

## Funcionalidades

- **Projetos** — crie pastas de projeto com nome próprio (botão "＋ projeto"); os arquivos ficam em `projects/<nome>/`.
- **Abrir / salvar / criar arquivos** — pela árvore lateral, por caminho absoluto ("abrir") ou "novo" (Ctrl+S salva).
- **Tipo de arquivo** — seletor que troca o highlight (JavaScript, TypeScript, Python, PHP, C, C#, JSON, HTML, CSS, texto). Cada tipo tem paleta de cores própria para classes, funções, constantes, variáveis etc. (as cores por tipo ficam em `src/ui/theme.ts` e no tokenizador).
- **Execução**:
  - **▶ arquivo** — executa o arquivo inteiro (Ctrl+Enter). Se houver alterações não salvas, executa o conteúdo do editor.
  - **▶ seleção** — executa apenas o bloco de código selecionado.
  - **▶ função** — executa uma função específica do arquivo (detectada automaticamente), com argumentos passados como array JSON; o valor de retorno aparece como `[retorno] ...`.
  - Timeout de 15s (30s para compilação) e limite de saída de 512 KB.

  | Linguagem | Runtime | arquivo | seleção | função |
  |---|---|---|---|---|
  | JavaScript / TypeScript | Node (TS transpilado automaticamente) | ✅ | ✅ | ✅ |
  | PHP | `php` CLI | ✅ | ✅ (adiciona `<?php` se faltar) | ✅ |
  | C | `gcc` (compila e roda) | ✅ | ✅ (embrulha em `main()` com includes comuns) | ❌ |
  | C# | `dotnet` SDK 10+ (`dotnet run arquivo.cs`) | ✅ | ✅ (top-level statements) | ❌ |
  | Python | — (ainda não suportado) | ❌ | ❌ | ❌ |

  Se o runtime não estiver instalado, a saída mostra uma mensagem clara indicando o que instalar.
- **Painel de símbolos** — lista variáveis, constantes, objetos, classes, métodos, interfaces, enums e funções de todos os arquivos salvos do projeto (AST do TypeScript para `.ts/.js`; regex para `.py`, `.php`, `.c/.h` e `.cs`). Clicar em um símbolo abre o arquivo na linha correspondente.

## Arquitetura

```
src/server/       # Express + API REST, drivers de conexão, cofre, runner
src/shared/       # lógica pura testável em node: abas, ícones, contratos, tokenizador
src/ui/           # interface em React (Vite compila para dist/ui)
```

A pasta `specs/` é a fonte da verdade do desenvolvimento; veja `specs/structure.md`
para o mapa completo.

### API REST (para integração com a engine 3D)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/projects` | lista projetos |
| POST | `/api/projects` | cria projeto `{name}` |
| GET | `/api/projects/:name/files` | árvore de arquivos |
| POST | `/api/projects/:name/files` | cria arquivo `{name, content}` |
| GET | `/api/projects/:name/symbols` | símbolos dos arquivos salvos |
| GET | `/api/file?path=` | lê arquivo |
| POST | `/api/file` | salva arquivo `{path, content}` |
| POST | `/api/run` | executa `{mode: file\|block\|function, filePath?, code?, functionName?, args?, language?}` |

Todas as respostas usam o envelope `{success, data, error}`.

### API de conexões (banco, redis, arquivos remotos, ssh)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/connections/drivers` | tipos disponíveis e os campos de cada formulário |
| GET | `/api/connections` | estado do cofre + árvore de grupos + sessões abertas |
| POST | `/api/connections` | cria conexão `{type, label, group, readOnly, fields}` |
| PATCH | `/api/connections/:id` | atualiza (sem `fields`, preserva os segredos) |
| DELETE | `/api/connections/:id` | remove |
| POST | `/api/connections/groups/rename` | renomeia grupo `{from, to}` e os descendentes |
| POST | `/api/connections/vault` | cria o cofre `{password}` |
| POST | `/api/connections/vault/unlock` \| `/lock` | destranca / tranca (trancar fecha as sessões) |
| POST | `/api/connections/:id/connect` \| `/disconnect` | abre/fecha sessão; `connect` devolve as capacidades |
| GET | `/api/connections/:id/children?path=a&path=b` | filhos do nó (navegação lazy) |
| POST | `/api/connections/:id/execute` | executa `{statement, nodePath?, rowLimit?, timeoutMs?}` |
| POST | `/api/connections/:id/action` | roda uma ação do menu `{nodePath, actionId}` — ex.: ver DDL |

### Serviços suportados

| Tipo | Biblioteca | Somente-leitura imposto por |
|---|---|---|
| `mysql` (MySQL/MariaDB) | `mysql2` | `SET SESSION TRANSACTION READ ONLY` |
| `postgres` | `pg` + `pg-cursor` | `SET default_transaction_read_only = on` |
| `sqlite` | `node:sqlite` (nativo) | abrir o arquivo como `readOnly` |

O corte de linhas é incremental, não um `slice` depois de baixar tudo: MySQL aborta o stream e
PostgreSQL usa cursor. Uma `SELECT *` numa tabela de 100M linhas devolve as primeiras 500 com
`truncated: true` sem carregar o resto.

No PostgreSQL a árvore lista **todos os bancos do servidor**, mas como não existe consulta
cross-database, expandir um banco diferente abre uma conexão nova sob demanda — a sessão mantém um
cliente por banco e fecha todos juntos.

#### Campos de conexão

Além de host/porta/usuário/senha, cada driver SQL aceita:

| Campo | Efeito |
|---|---|
| `main_database` | vai para o topo da árvore; no MySQL também é o schema padrão, no PostgreSQL é o banco da conexão inicial |
| `show_databases` | lista branca (vírgula ou quebra de linha); vazio mostra todos |
| `exclude_databases` | regex de exclusão; **regex inválida é ignorada**, não derruba a navegação |
| `exclude_schemas` | idem, aplicado aos schemas (só PostgreSQL) |
| `hide_system_schemas` | padrão `true`: esconde `information_schema`/`performance_schema`/`mysql`/`sys` e `pg_catalog` |
| `default_row_limit` | limite usado quando a query não pede um explícito |
| `startup_sql` | roda ao abrir a sessão, **depois** do somente-leitura (para não conseguir desfazê-lo) |
| `ssl_mode` + `ssl_ca` | `DISABLED…VERIFY_IDENTITY` no MySQL, `disable…verify-full` no PostgreSQL |
| `socket_path` | conexão por socket Unix em vez de TCP (só MySQL) |

A ordem dos filtros é: esconder sistema → excluir por regex → aplicar lista branca.

Os testes de integração rodam contra servidor real e **pulam** se as variáveis não estiverem
definidas, para `npm test` nunca quebrar offline. Eles abrem a conexão sempre em somente-leitura:

```bash
DEV_IDE_TEST_MYSQL="mysql://user:senha@host:3306/banco" \
DEV_IDE_TEST_POSTGRES="postgres://user:senha@host:5432/banco" npm test
```

**Credenciais.** Ficam em `~/.dev-ide/vault.json` (600), com cada campo secreto cifrado em AES-256-GCM
sob uma chave derivada da senha mestra por scrypt. Campos não-secretos ficam em claro de propósito —
a árvore de grupos renderiza com o cofre trancado, e só conectar exige a senha. Segredo **nunca** sai
numa resposta da API. Caminho configurável via `DEV_IDE_VAULT`.

> ⚠️ A IDE executa código arbitrário localmente por design e guarda credenciais de conexão. Use apenas em máquina de desenvolvimento.
>
> O servidor escuta **somente em `127.0.0.1`** e recusa requisições cujo `Host`/`Origin` não seja local — isso barra DNS rebinding, em que um site externo aponta um domínio próprio para o seu loopback e passa a falar com a API pelo seu navegador. Não coloque um proxy reverso na frente dele.
