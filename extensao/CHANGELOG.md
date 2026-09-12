# Mudanças

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
