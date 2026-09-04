<div align="center">

# Braytech Code

**Uma IDE própria** — editor, bancos de dados, servidores remotos e terminal,
no navegador ou como aplicativo de desktop.

</div>

![A tela do Braytech Code, com a árvore de arquivos e o editor](docs/imagens/01-visao-geral.png)

Nasceu para substituir uma extensão comercial de cliente de banco, e cresceu
para o que faltava em volta dela. É feita para um uso só — o de quem a
escreveu — e por isso cada decisão dela tem um dono e um porquê.

---

## Começar

```bash
npm install
npm start          # http://localhost:4321
```

Como aplicativo de desktop:

```bash
npm run instalar   # empacota e põe o ícone no menu do sistema
```

Os dois modos rodam **o mesmo servidor** e **a mesma interface**. O desktop
acrescenta o que o navegador não tem: diálogo nativo de pasta e chaveiro do
sistema para as senhas.

> **Linux:** o AppImage precisa de FUSE — sem ele, use o `.tar.gz`. E rodar a
> versão desktop a partir do código com o isolamento do Chromium ligado exige um
> `sudo` uma única vez; sem ele, `npm run electron:sem-sandbox`.
>
> **Windows:** o instalador (`.exe`) e o `.zip` portátil saem de
> `npm run empacotar:win`. A instalação é **por usuário**, sem pedir
> administrador — o cofre fica amarrado ao seu login do Windows.
>
> Duas diferenças em relação ao Linux, e as duas são de propósito:
> **lembrar a senha do cofre só funciona no aplicativo**, não no navegador (o
> chaveiro do sistema não existe lá), e rodar arquivos `.sh` exige o `bash` do
> [Git para Windows](https://git-scm.com/download/win) no PATH.

---

## Dentro do VS Code e do Cursor

A mesma IDE também roda **como extensão**, dentro do editor que você já usa: a
árvore de conexões vira um ícone na barra lateral, e os resultados, formulários
e cadernos abrem como abas normais.

Não está no Marketplace — é uso próprio. Instala-se a partir do código:

```bash
npm run empacotar:extensao                 # gera extensao/braytech-code-0.1.0.vsix

code   --install-extension extensao/braytech-code-0.1.0.vsix --force   # VS Code
cursor --install-extension extensao/braytech-code-0.1.0.vsix --force   # Cursor
```

Depois, no editor: **Developer: Reload Window**. O ícone do Braytech aparece na
barra de atividades.

Quem prefere o mouse: no VS Code, **Extensions → `…` → Install from VSIX…** e
escolha o `.vsix` gerado.

> **Reinstalar depois de mexer no código:** o editor usa o `.vsix` instalado,
> não o que está no repositório. Toda alteração em `src/ui/extensao/` ou
> `extensao/src/` só chega até lá repetindo os dois comandos acima e recarregando
> a janela.

A extensão sobe o mesmo servidor da IDE em `127.0.0.1` e conversa com ele pelo
processo do editor — as senhas continuam no mesmo cofre, e nenhuma porta nova
fica exposta.

Comandos disponíveis na paleta (`Ctrl+Shift+P`):

| Comando | O que faz |
|---|---|
| `Braytech: Nova consulta` | abre um editor SQL amarrado à conexão selecionada |
| `Braytech: Executar consulta` | roda o que está no editor e abre a grade |
| `Braytech Code: Nova conexão` | abre o formulário de conexão |
| `Braytech: Destrancar o cofre` | pede a senha-mestra |
| `Braytech: Recarregar conexões` | relê o cofre e redesenha a árvore |

---

## O que ela faz

### Editar código

O editor é o Monaco, com diagnósticos, renomear símbolo em todos os arquivos,
`Ctrl+clique` para a definição, autocompletar e trilha de navegação.

Executa **JavaScript, TypeScript, Python, PHP, C, C# e shell** — o arquivo
inteiro, uma seleção ou uma função. E a saída vira **problemas clicáveis** que
levam ao arquivo e à linha:

![Busca com regex na árvore de arquivos](docs/imagens/02-busca.png)

A busca aceita expressão regular, respeita o `.gitignore` e substitui em todos
os arquivos de uma vez.

### Falar com bancos de dados

**MySQL, PostgreSQL, SQL Server e SQLite** — a árvore desce até a coluna, e o
resultado abre numa grade que **edita**: com chave primária, o `UPDATE` é montado
para você conferir antes.

E mais três que não são tabelas: **Redis** (chaves numa árvore por prefixo,
comandos numa grade), **MongoDB** (documentos achatados em colunas, com o JSON
cru ao lado) e **Pinecone** (índices, namespaces e busca por proximidade, com a
nota de cada acerto).

![A árvore de um banco, com tabelas e views](docs/imagens/03-conexoes.png)

Duplo clique numa tabela abre a consulta pronta; `Ctrl+Enter` executa:

![A grade de resultado, com as colunas tipadas](docs/imagens/04-grade.png)

Também há **diagrama ER** (do schema inteiro ou de uma tabela e seus vizinhos),
DDL, comparação de estrutura entre dois bancos, e SQL de usuário e permissão —
este último **gerado e copiado, nunca executado**.

> As senhas ficam num cofre cifrado. A IDE **nunca** devolve um segredo numa
> listagem: revelar é um pedido explícito, campo a campo.

### Escrever documentos e cadernos

Preview de markdown com **Mermaid** e **KaTeX**, além de imagem, PDF e CSV — este
editável pela própria grade:

![Preview de markdown com um diagrama Mermaid](docs/imagens/05-preview.png)

E cadernos `.sqlbook`: blocos de SQL e markdown, com os resultados que você
escolher guardar.

### Terminal e servidores remotos

Terminais locais e remotos, divididos em painéis. SSH com salto por bastion,
SFTP, FTP, monitor de processos e download de pasta como zip.

![O terminal no painel inferior](docs/imagens/06-terminal.png)

> No terminal, **`Ctrl+Shift+C` copia** e **`Ctrl+Shift+V` cola** — o `Ctrl+C`
> continua sendo o `SIGINT`, que é o que se espera de um terminal. O menu de
> botão direito faz as duas coisas, para não depender de decorar o atalho.

### Não perder trabalho

Timeline de versões locais de cada arquivo, rascunho automático do que não foi
salvo, aviso ao fechar e histórico de notificações.

---

## Atalhos que vale conhecer

| Atalho | O quê |
|---|---|
| `Ctrl+Shift+P` | Paleta de comandos |
| `Ctrl+P` | Ir para arquivo |
| `Ctrl+Shift+O` | Ir para símbolo |
| `Ctrl+Enter` | Executar o arquivo, o bloco ou a consulta |
| `F2` | Renomear símbolo em todos os arquivos |
| `Ctrl+J` / `Ctrl+B` | Esconder o painel de baixo / a lateral |
| `Ctrl+Shift+C` | Copiar, dentro do terminal |

---

## Para quem vai mexer no código

- [`docs/tecnico.md`](docs/tecnico.md) — arquitetura, API REST, drivers, o cofre
  e o modelo de segurança.
As decisões de projeto — uma pasta por entrega, com o **porquê** de cada uma,
inclusive das recusadas — ficam em `specs/`, que **não é versionada**: ela cita
nomes de servidores e bancos reais.

```
1914 testes de unidade  ·  568 de ponta a ponta
```

Além dos de sempre, a suíte tem comparação de imagem, verificação de
acessibilidade e orçamento de peso e de tempo — e os três **provam que
funcionam**: há um teste que planta um defeito e cobra que o verificador o
encontre.

> Os prints desta página são gerados por `npm run prints`, contra o projeto de
> teste. Quando a interface muda, eles são refeitos — é o que impede a
> documentação de envelhecer sem ninguém perceber.

---

## Aviso

A IDE **executa código arbitrário** por design e **guarda credenciais**. O
servidor escuta só em `127.0.0.1` e recusa requisições de origem não-local. Use
em máquina de desenvolvimento, e não coloque um proxy reverso na frente dela.
