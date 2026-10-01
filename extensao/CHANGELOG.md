# Mudanças

## 0.1.13

- **Notebook JS/TS: as variáveis de fora da célula.** O resultado de uma
  célula SQL (`→ patients`) aparecia em vermelho numa célula TypeScript, como
  se não existisse. Agora o editor conhece o resultado de cada SQL, com as
  colunas do último resultado (`p.` sugere os campos), e o que as outras
  células JS/TS declaram. `await` no topo da célula e `import` de pacote do
  projeto também deixaram de ser marcados como erro.

## 0.1.12

- **Notebook: botão Ajuda.** Um painel ao lado das células explica como o
  notebook roda (kernel vivo, ordem de execução, o `[3]`), de onde vem o
  kernel, como o resultado do SQL vira variável e como uma variável entra no
  SQL (`IN {{ids}}`, sem parênteses), com exemplos na linguagem do kernel e um
  botão de copiar em cada um.

## 0.1.11

- **Abrir a mesma tabela em dois databases** abria só a primeira: a segunda
  apenas trazia a aba que já estava aberta, porque a aba era identificada pelo
  nome da tabela. Agora ela é identificada pela conexão, pelo database e pelo
  caminho, e o título mostra o database (`clientes · loja`). O mesmo vale para
  chaves Redis de mesmo nome e servidores de mesmo rótulo.
- **Ctrl+V colava duas vezes** no SQL da aba de tabela e no filtro. Quando o
  editor também cola depois de cancelar a tecla, a nossa colagem percebe e só
  uma das duas vale.
- **Notebook: autocompletar de SQL.** As células SQL sugerem tabelas e colunas
  do banco da célula, como o caderno já fazia.
- **Notebook JavaScript/TypeScript: escolher o Node e a pasta dos pacotes.** O
  clique na barra do kernel pergunta, com o kernel parado ou rodando: de qual
  projeto do workspace vêm os `node_modules` (um frontend e um backend lado a
  lado, por exemplo) e qual Node usar (o do editor, os do nvm, o do PATH). A
  barra mostra o que está em uso. No Python e no PHP o clique também passou a
  perguntar, em vez de subir o kernel sozinho.
- **Notebook JavaScript: `ids.map(i => console.log(i))`** não despeja mais um
  `[undefined, undefined, …]` depois das linhas impressas. Qualquer outro
  valor continua aparecendo.
- **Notebook JavaScript/TypeScript: autocompletar de JS**, e o fim do erro
  `Invalid base URL` que aparecia no console a cada tecla. Os editores da
  extensão não conseguiam criar os workers do Monaco.
- Link de apoio (Buy Me a Coffee) no README.

## 0.1.10

- **Notebook (`.brnb`)**, no estilo do Jupyter: kernel Python, JavaScript,
  TypeScript ou PHP, com células de código, SQL e Markdown. O resultado de uma
  célula SQL vira variável no kernel; `{{nome}}` leva uma variável do kernel de
  volta ao SQL, sempre como parâmetro. O kernel usa o `.venv`, o `node_modules`
  ou o `vendor` do projeto; Laravel opcional. Rodar tudo, rodar daqui para
  baixo, Parar, Reiniciar, gráficos e imagens, saídas salvas, exportar `.ipynb`.
- **Escolher uma conexão SQLite** para um `.sql` ou `.sqlbook` dizia "esta
  conexão não expôs nenhum database". O seletor procurava os databases onde o
  MySQL e o Postgres os guardam, e o SQLite os traz em outro lugar.

## 0.1.9

- **Ctrl+C, Ctrl+V e Ctrl+X funcionam de verdade no caderno** (e nas outras
  telas). A correção da 0.1.5 não pegava no editor real: a moldura da webview
  cancela as teclas num ponto que o evento só alcança DEPOIS do nosso, e a
  nossa conferência olhava cedo demais. Agora ela olha depois.
- **Um bloco com várias queries roda cada uma e abre um Results para cada** —
  `SELECT …; SELECT …;` vira duas telas, nomeadas `1/2` e `2/2`. Rodar de novo
  repinta as mesmas telas. Ponto e vírgula dentro de texto e corpo de
  procedure não partem a query.
- Se uma das queries falha, as seguintes não rodam, e o erro aparece **no
  próprio caderno**, dizendo qual instrução foi e a mensagem do banco — em vez
  de mandar procurar uma aba Problems que a extensão não tem.
- No SQLite, um bloco com várias queries rodava só a primeira, sem aviso.

## 0.1.8

- **Data e hora aparecem exatamente como estão gravadas.** Um `DATETIME`
  gravado `2026-09-25 11:19:41.208` aparecia `2026-09-25T14:19:41.208Z` — três
  horas a mais, com um `Z` inventado. O driver lia a coluna (que não tem fuso)
  como hora local da máquina e a célula a convertia para UTC. Agora nada é
  convertido: a grade mostra o texto que o banco devolve.
- Vale para MySQL/MariaDB (`DATETIME`, `TIMESTAMP`, `DATE`), PostgreSQL
  (`timestamp`, `timestamptz`, `date`) e SQL Server (`datetime`, `datetime2`,
  `smalldatetime`, `date`, `time`). Colunas `DATE` apareciam como
  `2026-09-25T03:00:00.000Z`; o `datetime2` do SQL Server perdia os dígitos
  além do milissegundo.
- **Editar uma data pela grade voltou a funcionar** no MySQL e no PostgreSQL —
  com a hora deslocada, a gravação não achava a linha.
- Limite conhecido: no `datetimeoffset` do SQL Server o driver descarta o fuso
  gravado; a grade mostra o instante com `+00:00` escrito.

## 0.1.7

- **O cofre não pede mais senha.** Ele abre sozinho, e a extensão deixa de pedir
  a senha-mestra toda vez que o editor é fechado e aberto. As senhas das
  conexões continuam cifradas: a chave fica amarrada a esta máquina, então uma
  cópia da pasta levada para outro computador não abre.
- **Cofre novo nasce sem senha**, sem perguntar nada ao salvar a primeira
  conexão.
- Quem já tem um cofre com senha usa **"Braytech: Remover a senha-mestra"** (na
  barra da árvore ou na paleta) — pede a senha atual uma última vez e pronto.
- O caminho de volta existe: **"Braytech: Pôr uma senha-mestra no cofre"**.
- Correção: o cadeado da árvore nunca mandava o "lembrar neste computador" ao
  motor, e por isso a IDE lembrava e a extensão não.

## 0.1.6

- **A lupa mostra o valor inteiro.** Um JSON de 12 mil caracteres aparecia com
  2.048 e um `…`, quebrado no meio — em toda tela de resultado de banco SQL. O
  corte era feito no driver, antes de o valor sair do banco, e por isso nem a
  lupa podia contorná-lo. Agora o corte é do DESENHO da célula (que mostra uma
  linha só), e o que atravessa é o valor inteiro, dentro de um orçamento por
  página.
- **Novo ajuste "Valores grandes"**, no painel de aparência (o `👁`): quanto
  texto uma página inteira pode trazer — 2, 8 (padrão), 32 ou 128 MB. O que
  passar disso chega como amostra, e aí a lupa diz *"mostrando 2.049 de 11.608
  caracteres"* em vez de mostrar o pedaço calada.
- A grade ficou mais rápida de desenhar: 63 ms → 27 ms por página de 500 linhas,
  porque a célula não pinta mais 2.048 caracteres para exibir uma linha.

## 0.1.5

- **Ctrl+C, Ctrl+X e Ctrl+V voltam a funcionar dentro das telas da extensão** —
  no caderno `.sqlbook`, na grade de resultado e nos formulários. A moldura de
  webview do editor cancela essas três teclas quando roda no Electron (vale para
  VS Code e Cursor) esperando que o próprio editor faça o serviço, mas o comando
  dele age no campo do editor, não dentro da tela da extensão: a tecla morria no
  caminho e só o botão direito copiava. Agora as telas atendem o gesto por conta
  própria, com o multi-cursor e o "copiar a linha inteira sem seleção" do editor
  de blocos preservados.

## 0.1.4

- **O terminal SSH não fecha mais sozinho depois de 10 minutos.** A conexão
  era considerada ociosa porque o que passa pelo terminal — o que você digita e
  o que o script imprime — não contava como uso. Um script em loop morria junto.
  Agora, enquanto houver um terminal aberto, a conexão fica aberta; ela só fecha
  quando você fecha o terminal ou desconecta.
- **O mesmo para o encaminhamento de portas:** um túnel aberto segura a conexão
  até ser fechado.

## 0.1.3

Correção para quem usa **só a extensão**, sem a IDE Braytech Code na máquina.

- **O cofre agora é criado pela extensão.** Numa máquina nova não havia como
  criá-lo: o cadeado só destrancava, e o motor respondia "Cofre não encontrado".
  O cadeado, a paleta e o aviso "Nenhum cofre ainda" passam a criar o cofre,
  pedindo a senha-mestra duas vezes.
- **Salvar uma conexão sem cofre não trava mais calado.** O formulário pedia
  para destrancar um cofre que não existia, com um diálogo que não aparecia —
  nada era gravado e nenhum erro era mostrado. Agora o diálogo aparece, cria o
  cofre se preciso, e a conexão é gravada.
- O formulário confere o cofre no motor na hora de salvar, e não no estado de
  quando a aba abriu.
- Uma variável `DEV_IDE_HOME` definida e vazia não faz mais o cofre ir para uma
  pasta relativa.

## 0.1.2

- Três imagens na página: a grade, o diagrama ER e a estrutura de uma tabela.
  São capturas da webview da PRÓPRIA extensão, com a paleta escura do editor e
  um banco de exemplo inventado.

## 0.1.1

- A página da extensão reescrita para quem chega de fora: o que ela conecta, o
  que cada gesto faz, e os limites conhecidos antes de instalar.
- Correção do texto: o teto da grade é de 500 linhas, ajustável por conexão —
  não 200.

## 0.1.0

Primeira versão pública.

- Bancos: MySQL, PostgreSQL, SQL Server, SQLite, MongoDB, Redis e Pinecone —
  árvore de conexões, grade de resultados, DDL, diagrama ER e caderno de SQL.
- Serviços remotos: SSH com terminal, monitor, encaminhamento de portas e
  arquivos (SFTP/FTP), com arrastar-e-soltar para subir arquivo e pasta.
- Nenhuma ação de escrita roda por clique: o menu GERA o SQL e o abre para você
  conferir antes de executar.
- O motor viaja dentro do pacote — um só, para Linux, Windows e Mac. Não precisa
  instalar nada além da extensão.
