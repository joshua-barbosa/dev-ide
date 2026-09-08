# Ícones próprios

Um `.svg` aqui **substitui** o ícone daquele nome, na IDE e na árvore da
extensão. O nome do arquivo é o nome lógico do ícone:

```
icones/table.svg        → substitui o ícone de tabela
icones/procedure.svg    → substitui o de procedure
icones/mysql.svg        → substitui a marca do MySQL
```

Os nomes válidos são os de `src/shared/icons.ts` (`NODE_ICONS` e `TAB_ICONS`) e
os das marcas (`mysql`, `postgresql`, `redis`, `mongodb`, `sqlite`, `mariadb`,
`microsoftsqlserver`). Um arquivo com nome que não existe **faz o build falhar**,
em vez de ser ignorado em silêncio.

## Tema claro e escuro

O mesmo arquivo serve aos dois. Quando o desenho precisar mudar com o tema,
ponha um segundo arquivo com sufixo `-dark`:

```
icones/table.svg         → tema claro (e o padrão)
icones/table-dark.svg    → tema escuro
```

**A árvore do editor NÃO recolore SVG.** Um traço preto some no tema escuro —
por isso ou o desenho é colorido (como as marcas), ou vêm os dois arquivos.

## Depois de mexer

```bash
npm run build:icons        # a IDE
npm run empacotar:extensao # a extensão
```

## Vindo de outro tema de ícones

Dá para pegar o `.svg` de um tema que você já usa (Material Icon Theme, por
exemplo). Só lembre que o desenho é de outra pessoa: se este repositório for
publicado, a licença de origem vai junto — o Material Icon Theme é MIT, e pede
o aviso de copyright preservado.
