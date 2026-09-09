# Braytech Code

Bancos de dados e servidores remotos dentro do VS Code e do Cursor. Sete bancos
e dois tipos de acesso remoto na mesma árvore, com grade de resultados, DDL,
diagrama ER, terminal SSH e SFTP — sem sair do editor e sem instalar mais nada.

![A grade de uma tabela, com filtro, paginação e a contagem real de linhas](https://raw.githubusercontent.com/joshua-barbosa/dev-ide/main/docs/imagens/extensao/01-grade.png)

## Instalar

Procure por **Braytech Code** no painel de extensões e clique em Install.
Recarregue a janela e o ícone de banco aparece na barra lateral.

Não precisa de Docker, de servidor à parte, nem de `npm install`. O motor vem
dentro do pacote — um só, para Linux, Windows e Mac.

## O que ela conecta

| | |
|---|---|
| **Databases** | MySQL · PostgreSQL · SQL Server · SQLite · MongoDB · Redis · Pinecone |
| **Services** | SSH (terminal, monitor, portas, SFTP) · FTP/FTPS |

Quem separa as duas visões é o próprio driver, não uma lista fixa.

## Bancos

| gesto | o que acontece |
|---|---|
| clicar numa conexão | conecta, vira a conexão ativa e expande |
| clicar numa tabela ou view | abre a grade com as primeiras 500 linhas e o total real (o teto é ajustável por conexão) |
| botão direito | as ações daquele objeto: DDL, contagem exata, `SELECT`, templates de INSERT/UPDATE/DELETE, esvaziar, apagar |
| **Diagrama ER** | de um schema inteiro ou de uma tabela só, com as chaves estrangeiras |
| pasta **Query** | os `.sql` e `.sqlbook` daquele banco, que abrem no editor |
| **Ctrl+Enter** num `.sql` | executa a seleção — ou o arquivo inteiro, se não houver seleção |

![Diagrama ER de um schema, com as chaves estrangeiras ligando as tabelas](https://raw.githubusercontent.com/joshua-barbosa/dev-ide/main/docs/imagens/extensao/02-diagrama.png)

Cada motor mostra o que é dele: procedures, functions, triggers, events e
foreign tables no MySQL e no Postgres; sequences, materialized views e types no
Postgres; chaves, TTL e RedisJSON no Redis; coleções e documentos no MongoDB;
índices e namespaces no Pinecone.

A sub-aba **Estrutura** traz colunas, tipos, chaves, índices, gatilhos e o DDL:

![A estrutura de uma tabela: colunas, tipos, chaves e o DDL](https://raw.githubusercontent.com/joshua-barbosa/dev-ide/main/docs/imagens/extensao/03-estrutura.png)

### Nada destrutivo roda por clique

Esta é a regra da extensão inteira, e não tem exceção: uma ação de escrita
**gera o SQL e abre num editor**. Quem executa é você, depois de ler. Um
`TRUNCATE` ou um `DROP` no menu não apaga nada — escreve o comando.

As ações de usuário e permissão (`GRANT`, `REVOKE`, criar, apagar) vão para a
área de transferência, para você colar onde for executar.

## Servidores remotos

Uma conexão SSH abre com quatro capacidades, e cada uma aparece só se o
servidor a oferece:

| | |
|---|---|
| **Terminal** | shell interativo, no canal da própria conexão |
| **Monitor** | CPU, memória, disco e uptime |
| **Portas** | encaminhamento de porta local ↔ remota |
| **Arquivos** | SFTP na árvore: abrir, editar e salvar direto no servidor |

Arraste arquivos e pastas do seu computador para uma pasta da árvore e eles
sobem, mantendo a estrutura. Baixar pasta sai em `.zip`. Também dá para criar,
renomear, apagar, ver permissões e executar um arquivo no servidor.

O terminal de uma conexão SSH não depende de nada nativo, então funciona igual
nos três sistemas.

## Credenciais

Ficam num cofre cifrado com AES-256-GCM, destrancado uma vez por sessão
(**Braytech: Destrancar o cofre**). A senha não aparece na listagem de conexões
nem no arquivo em claro, e vai do cofre direto para o driver.

Uma conexão pode ser marcada como **somente-leitura**, e aí o próprio servidor
de banco recusa escrita — não é filtro de texto no SQL. A árvore marca essas
conexões e esconde as ações que alterariam algo.

## Configuração

| chave | o que faz |
|---|---|
| `braytech.porta` | porta do motor (padrão `4321`). Havendo um Braytech Code de pé nela, usa o mesmo. |
| `braytech.motor` | caminho para outro motor. Vazio usa o que vem junto. |

## Limites conhecidos

Estão aqui porque é melhor você saber antes de instalar:

- **arrastar arquivo do sistema para dentro da tela cheia de SFTP não
  funciona.** É limite do editor: webview não recebe soltura do sistema
  ([microsoft/vscode#111092]). Arrastar para a **árvore** da barra lateral
  funciona, e é por onde se sobe arquivo e pasta;
- o terminal **local** do motor precisa do `node-pty`, que não viaja no pacote.
  Dentro do editor isso não faz falta: terminal local é o do próprio editor
  (Ctrl+`), e o da conexão é um canal SSH.

[microsoft/vscode#111092]: https://github.com/microsoft/vscode/issues/111092

## Desenvolver

O motor é o mesmo servidor da IDE Braytech Code, e a extensão o sobe dentro do
host de extensão — ou se liga ao que já estiver de pé, para as duas janelas não
brigarem pelo cofre.

```bash
npm run build                 # na raiz: compila o motor
npm run empacotar:extensao    # compila a extensão e gera o .vsix com o motor
code   --install-extension extensao/braytech-code-0.1.0.vsix --force
cursor --install-extension extensao/braytech-code-0.1.0.vsix --force
```

Ele procura o motor nesta ordem, e a primeira que responder ganha: um Braytech
Code já de pé na porta → a configuração `braytech.motor` → o `dist/server` de
alguma pasta aberta no editor → ao lado da extensão → o motor que veio no
pacote. O pacote é o último de propósito: com o repositório aberto, você quer o
motor que acabou de compilar.

Código em <https://github.com/joshua-barbosa/dev-ide>.

## Licença

Apache-2.0.
