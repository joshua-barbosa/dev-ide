# dev-ide

IDE própria, construída do zero com **Node.js + TypeScript** no servidor e
**React + Vite + Monaco** na interface. Roda no navegador **ou como aplicativo de
desktop** (Electron), com o mesmo servidor e o mesmo bundle nos dois modos.

Nasceu para substituir uma extensão comercial de cliente de banco, e cresceu para
o que falta em volta dela: editor com diagnósticos e renomeação, terminal,
arquivos remotos por SSH/SFTP/FTP, cadernos de SQL e um cofre de credenciais.

> **O nome é provisório.** `dev-ide` é descrição, não nome — trocar está na fila.

## Como rodar

```bash
npm install
npm start                  # compila tudo e sobe em http://localhost:4321
npm run dev                # Vite em modo desenvolvimento (exige o npm start noutro terminal)
npm test                   # a suíte de unidade
npx playwright test        # a suíte de ponta a ponta
```

Porta em `PORT`; pasta dos projetos em `DEV_IDE_PROJECTS` (padrão `./projects`).

⚠️ **`npm test` roda `clean` e apaga o `dist/`** — que é de onde o servidor serve
a interface. Depois de testar, rode `npm run build` antes de subir o servidor,
senão a página não carrega.

### Como aplicativo

```bash
npm run electron           # abre a janela a partir do código
npm run empacotar          # gera AppImage e tar.gz em empacotado/
npm run instalar-atalho    # põe o ícone no menu do sistema
npm run instalar           # empacota e instala o atalho, num comando
```

A versão desktop sobe **o mesmo servidor**, numa porta efêmera (fixar 4321 faria
brigar com um `npm start` esquecido), e carrega a mesma interface numa janela com
isolamento de contexto — a página não tem `require` nem `process`. O que ela
ganha é o que o navegador não dá: **diálogo nativo de pasta** e **chaveiro do
sistema** para o cofre.

**No Linux, o sandbox do Chromium** exige `chrome-sandbox` de root com modo 4755,
e no Ubuntu 23.10+ o AppArmor fecha o caminho alternativo. Sem isso use
`npm run electron:sem-sandbox`; com um `sudo` uma única vez, o normal funciona:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

**O AppImage precisa de FUSE.** Sem `libfuse2` ele não abre e diz isso; use o
`tar.gz`, que roda descompactando.

**Windows ainda não.** O empacotamento existe (`npm run empacotar:win`), mas há
quatro pontos do código que assumem Unix: o terminal cai em `/bin/bash`, a busca
de ferramentas não tenta `.exe`, o executor chama `python3` pelo nome nu, e o
`node-pty` precisa de ConPTY. É um lote pequeno, e ainda não foi feito.

## O que ela faz

- **Editor** — Monaco, com diagnósticos de TypeScript e JavaScript, renomear
  símbolo em todos os arquivos, `Ctrl+clique` para a definição, *peek*,
  autocompletar, trilha de navegação e Emmet.
- **Execução** — arquivo, seleção ou função, em JavaScript, TypeScript, Python,
  PHP, C e C#. A saída vira **problemas clicáveis** que levam ao arquivo e à
  linha.
- **Bancos** — MySQL, PostgreSQL e SQLite: árvore de objetos, grade de
  resultados com edição, DDL, diagrama ER (do schema inteiro ou de uma tabela e
  seus vizinhos), gerenciador com métricas, e SQL de usuário e permissão
  **gerado, nunca executado**.
- **Cadernos** (`.sqlbook`) — blocos de SQL e markdown, com resultados que você
  escolhe guardar.
- **Servidores remotos** — SSH com terminal, SFTP e FTP, salto por bastion,
  monitor de processos e download de pasta como zip.
- **Terminais** locais e remotos, divididos em painéis.
- **Arquivos** — árvore com `.gitignore`, busca com regex, preview de markdown
  (com Mermaid e KaTeX), imagem, PDF e CSV editável pela grade.
- **Não perder trabalho** — Timeline de versões locais, rascunho automático,
  aviso ao fechar e histórico de notificações.

## Testes

```
1771 testes de unidade  ·  564 de ponta a ponta
```

Além dos de sempre, a suíte tem uma **rede de proteção** para a classe de defeito
que asserção de DOM não pega: comparação de imagem por região, verificação de
acessibilidade e orçamento de peso e de tempo. Os três **provam que funcionam** —
há um teste que planta um botão sem nome e cobra que o verificador o encontre.

## Arquitetura

```
src/server/       # Express + API REST, drivers de conexão, cofre, runner
src/shared/       # lógica PURA, testável sem navegador: contratos, ícones, abas, formatação
src/ui/           # interface em React (Vite compila para dist/ui)
src/electron/     # a casca de desktop: janela, ponte e chaveiro
specs/            # a fonte da verdade: uma pasta por entrega, com as decisões numeradas
e2e/              # Playwright
```

**A regra que governa o código:** o que dá para testar sem navegador mora em
`shared/`. É por isso que a conta de renomear, o colapso de SQL, a política do
chaveiro e o orçamento de desempenho ficam lá, e não junto da tela — são as
partes que erram, e erram calado.

A pasta `specs/` é a fonte da verdade do desenvolvimento; veja `specs/structure.md`
para o mapa completo.

### API REST

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
| POST | `/api/connections/vault` | cria o cofre `{password, remember?}` |
| POST | `/api/connections/vault/unlock` \| `/lock` | destranca `{password, remember?}` / tranca (trancar fecha as sessões e apaga a lembrança) |
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

**Lembrar o destrancamento.** Marcar "lembrar neste computador" ao destrancar guarda a *chave*
derivada — nunca a senha — em `~/.dev-ide/session.json` (600), cifrada e com prazo.

No **aplicativo de desktop**, quem cifra essa chave é o **chaveiro do sistema**
(`safeStorage`), e não a amarra de máquina descrita abaixo — a diferença é real:
a amarra deriva a cifra de `machine-id` + uid, então quem lê o disco lê a chave,
enquanto o chaveiro exige a sessão do usuário destrancada. O chaveiro é um
**atalho, nunca a única porta**: se ele não existir, o sistema recusar, ou a
chave não abrir mais o cofre, a senha mestra continua valendo — e a chave velha é
esquecida, para não repetir o mesmo tropeço em toda inicialização.

No navegador nada disso existe, e vale o parágrafo seguinte. Enquanto vale,
a IDE sobe já destrancada. Prazo em `DEV_IDE_VAULT_REMEMBER_DAYS` (padrão **15 dias**, contados a
partir do destrancamento e sem renovação por uso); caminho em `DEV_IDE_SESSION`.

Seja claro sobre o que isso protege e o que não protege:

- **Protege** contra `vault.json` que vaza sozinho — num backup, num `rsync`, numa pasta
  sincronizada. O cofre continua inútil sem a lembrança.
- **Protege** contra a pasta `~/.dev-ide/` inteira copiada para outra máquina: a lembrança é presa
  ao `machine-id` + uid, então lá a senha volta a ser exigida.
- **Protege** contra esticar o prazo à mão: a data de validade é autenticada pelo GCM, então editá-la
  no arquivo faz a decifra falhar em vez de passar.
- **Não protege** contra quem já está logado na sua conta durante o prazo — essa pessoa
  simplesmente abre a IDE. Se isso importa, não marque a caixa, ou use "Trancar", que apaga a
  lembrança na hora.

Reinstalar o sistema ou clonar a VM muda o `machine-id` e invalida a lembrança; a senha volta a ser
pedida, que é o comportamento correto.

> ⚠️ A IDE executa código arbitrário localmente por design e guarda credenciais de conexão. Use apenas em máquina de desenvolvimento.
>
> O servidor escuta **somente em `127.0.0.1`** e recusa requisições cujo `Host`/`Origin` não seja local — isso barra DNS rebinding, em que um site externo aponta um domínio próprio para o seu loopback e passa a falar com a API pelo seu navegador. Não coloque um proxy reverso na frente dele.
