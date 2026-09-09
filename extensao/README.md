# Braytech Code — extensão para VS Code e Cursor

**Prova de conceito.** Ela responde a uma pergunta só: *quanto do projeto
sobrevive à troca de casca?*

## A resposta, medida

| | |
|---|---|
| Motor (drivers, cofre, pool, rotas) | **não mudou uma linha** |
| Árvore de conexões | árvore **nativa** do editor, sem webview |
| Grade de resultados | webview — o único desenho reescrito |
| Dependências nativas a resolver | **nenhuma** (o `node-pty` não é usado aqui) |

O motor é o mesmo `dist/server/index.js` que a IDE própria roda. A extensão o
sobe dentro do host de extensão — que também é Node — ou se liga ao que já
estiver de pé, para as duas janelas não brigarem pelo cofre.

## Instalar

Pelo **Cursor**: `Extensions` na barra lateral, procure por *Braytech Code* e
clique em Install. Nada mais — o motor vem dentro do pacote.

Do repositório, para desenvolver:

```bash
npm run build                 # na RAIZ: compila o motor
npm run empacotar:extensao    # compila a extensão e gera o .vsix com o motor
code   --install-extension extensao/braytech-code-0.1.0.vsix --force
cursor --install-extension extensao/braytech-code-0.1.0.vsix --force
```

**Reinicie o editor** depois de instalar. A extensão aparece na barra lateral
com um ícone de banco de dados, e em `Extensões` como *Braytech Code*.

### Onde ela acha o motor

Nesta ordem, e a primeira que responder ganha:

1. um Braytech Code **já de pé** na porta (padrão `4321`);
2. a configuração `braytech.motor`;
3. o `dist/server/index.js` de **alguma pasta aberta** no editor — é o que faz
   ela funcionar sem configurar nada, com o projeto aberto;
4. ao lado da própria extensão, para quem a roda de dentro do projeto;
5. o **motor que vem dentro do pacote** — é o que faz ela funcionar na máquina
   de quem só a instalou pela loja. É o último de propósito: com o repositório
   aberto, ele quer o motor que você acabou de compilar.

Não achando nenhum, o erro diz a configuração que resolve.

## Rodar em desenvolvimento

Abra a pasta `extensao/` no VS Code e tecle **F5**: abre uma janela de testes
com a extensão carregada, sem precisar instalar.

## Usar

Na barra lateral, o ícone de banco abre **duas** visões, como na IDE própria:

- **Databases** — MySQL, PostgreSQL, SQL Server, SQLite, Redis, MongoDB, Pinecone
- **Services** — SSH e FTP

Quem separa é o `panel` que o **driver declara**, não uma lista escrita aqui.

| gesto | o que acontece |
|---|---|
| clicar numa conexão | vira a conexão ativa (aparece na barra de status) e expande |
| clicar numa **tabela** ou view | mostra as primeiras 200 linhas, com o total real |
| botão direito num nó | as ações que o **driver** declarou: DDL, contagem, `SELECT`, templates de INSERT/UPDATE/DELETE, esvaziar, apagar |
| pasta **Query** de um database | os `.sql` e `.sqlbook` daquele database, que abrem no editor |
| **Ctrl+Enter** num `.sql` | executa a seleção — ou o arquivo inteiro, se não houver seleção |

Ação destrutiva pede confirmação antes. Ação marcada como "copiar" vai para a
área de transferência em vez de abrir aba, que foi a decisão dele sobre o SQL de
usuário e permissão.

## O que ela ainda NÃO faz

Não é lacuna escondida — é o limite conhecido:

- **arrastar arquivo do sistema para dentro da tela de SFTP não funciona.** É
  limite do editor, não meu: webview não recebe soltura do sistema
  ([microsoft/vscode#111092]). Arrastar para a **árvore** da barra lateral
  funciona, e é por onde se sobe arquivo e pasta;
- o terminal **local** do motor precisa do `node-pty`, que não viaja no pacote.
  Dentro do editor isso não faz falta: terminal local é o do próprio editor
  (Ctrl+`), e o da conexão é um canal SSH, que não depende de nada nativo.

[microsoft/vscode#111092]: https://github.com/microsoft/vscode/issues/111092

## Configuração

| chave | o que faz |
|---|---|
| `braytech.porta` | porta do motor (padrão `4321`). Havendo um Braytech Code de pé nela, usa o mesmo. |
| `braytech.motor` | caminho do `dist/server/index.js`. Vazio usa o que vem junto. |
