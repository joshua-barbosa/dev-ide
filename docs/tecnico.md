# Braytech Code — por dentro

Este documento é para quem vai **mexer no código**. Se você quer usar a IDE, o
[README](../README.md) é o lugar.

## Arquitetura

```
src/server/       # Express + API REST, drivers de conexão, cofre, runner
src/shared/       # lógica PURA, testável sem navegador: contratos, ícones, abas, formatação
src/ui/           # interface em React (Vite compila para dist/ui)
src/electron/     # a casca de desktop: janela, ponte e chaveiro
specs/            # as decisões, uma pasta por entrega — NÃO versionada (cita nomes reais)
e2e/              # Playwright
```

**A regra que governa o código:** o que dá para testar sem navegador mora em
`shared/`. É por isso que a conta de renomear, o colapso de SQL, a política do
chaveiro e o orçamento de desempenho ficam lá, e não junto da tela — são as
partes que erram, e erram calado.

A pasta `specs/` é a fonte da verdade do desenvolvimento — e fica **fora do
repositório**, porque cita nomes de servidores e bancos reais. Quem tem o clone
não a recebe; veja `specs/structure.md` na máquina onde ela existe.

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

#### Consulta que não volta

`execute` tem prazo: **60 s** por padrão, ou o `timeoutMs` do pedido mais 5 s de
folga — a folga existe para o erro do driver chegar antes do nosso, já que ele
diz o que o banco respondeu.

Estourado o prazo, a sessão **sai do pool**. É o que faz a consulta seguinte
reconectar em vez de bater no mesmo socket meio-aberto. Os sockets de MySQL,
PostgreSQL e Redis têm keepalive (primeiro sinal em 20 s) e o do MongoDB tem
`socketTimeoutMS` de 45 s: sem isso, uma VPN que cai deixa a espera correr por
horas antes de o sistema desistir.

O botão `Parar` só aparece onde o driver declara `cancelaQuery`. MySQL,
PostgreSQL e SQL Server cancelam de verdade; Redis e MongoDB derrubam o socket,
o que para de esperar mas não garante que o servidor interrompa o comando.

### O que a árvore mostra

Cada driver declara quais categorias são **opcionais**, e o cadastro ganha um
interruptor por categoria na seção `Árvore` — a escolha é por conexão, e todas
nascem ligadas. A lógica é pura, em `shared/sql/categorias-visiveis.ts`; a tela
não sabe o que é um gatilho.

| Driver | Opcionais |
|---|---|
| PostgreSQL | Materialized Views, Foreign Tables, Sequences, Types, Triggers |
| MySQL / MariaDB | Events, Triggers |
| SQLite | Indexes, Triggers |
| SQL Server | Triggers, Sequences, Types |

No Redis o equivalente são três campos: `Mostrar todos os bancos` (faz nascer o
nível `db0`, `db1`…), `Bancos visíveis` (lista branca) e `Usar RedisJSON e
RediSearch`.

### Windows

O que muda entre plataformas mora em `shared/plataforma.ts`, e **nada ali lê o
sistema**: tudo recebe a plataforma como argumento. É o que torna as decisões
testáveis numa máquina que não é Windows — que é o caso desta.

| O quê | Unix | Windows |
|---|---|---|
| Shell do terminal | `$SHELL`, senão `/bin/bash` | `%ComSpec%`, senão `cmd.exe` |
| Rodar `.sh` | `bash` | `bash` do Git para Windows; sem ele, avisa o que instalar |
| Caminho absoluto | começa com `/` | `C:\…` ou `\\servidor\pasta` |
| Achar executável no PATH | nome + bit de execução | nome + sufixos do `PATHEXT` (`bash.exe`) |
| Lembrar a senha do cofre | arquivo `600` + `/etc/machine-id` | **só o chaveiro do sistema** (DPAPI) |

A última linha é a única que muda o que a ferramenta FAZ, e é uma decisão de
segurança: no Windows o modo `600` é ignorado e `/etc/machine-id` não existe —
as duas pernas do backend de arquivo caem ao mesmo tempo, e o que sobraria seria
a chave do cofre legível por quem lesse o disco. Por isso lá a lembrança exige o
`safeStorage`, que só existe no aplicativo. No navegador, a senha é digitada a
cada vez, e a tela diz por quê.

O `node-pty` publica binários prontos para `win32-x64` e `win32-arm64` — o
terminal não precisa de compilação na máquina do usuário. O pacote Windows
exclui `node-pty/build`, que traz o binário Linux desta máquina.

**Nada disto foi verificado em Windows de verdade.** O que existe são testes de
unidade sobre as decisões puras.

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
