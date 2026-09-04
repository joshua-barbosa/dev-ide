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

## Rodar

```bash
npm run build          # na RAIZ do projeto: compila o motor
cd extensao && npm install && npm run build
```

Depois, no VS Code, abra a pasta `extensao/` e tecle **F5**. Abre uma janela de
testes com a extensão carregada.

Na janela nova:

1. ícone do banco na barra lateral → **Conexões**;
2. cofre trancado aparece como uma linha — clique para destrancar;
3. clique numa conexão para torná-la a ativa (ela aparece na barra de status);
4. abra um `.sql` e tecle **Ctrl+Enter**.

## O que ela ainda NÃO faz

Não é uma lacuna escondida — é o limite combinado de uma prova de conceito:

- cadastrar, editar e apagar conexão (hoje se faz na IDE própria);
- caderno `.sqlbook`, SFTP, terminal remoto, monitor, portas e processos;
- editar célula na grade, paginação, exportar;
- menu de contexto na árvore (ver DDL, truncar, abrir consulta do nó).

## Configuração

| chave | o que faz |
|---|---|
| `braytech.porta` | porta do motor (padrão `4321`). Havendo um Braytech Code de pé nela, usa o mesmo. |
| `braytech.motor` | caminho do `dist/server/index.js`. Vazio usa o que vem junto. |
