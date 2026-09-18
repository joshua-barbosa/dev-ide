# Mudanças

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
