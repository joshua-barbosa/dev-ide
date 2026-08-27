// A grade: o desenho das linhas e colunas (spec 062, generalizada na 070).
//
// Saiu do `TablePanel` quando ele passou do teto de 800 linhas do Artigo IV — e
// o corte é o natural: aqui está tudo que sabe o que é uma CÉLULA (largura,
// arrasto, lupa, edição), e lá ficou o que sabe o que é a ABA (o SQL, a barra
// de comando, a paginação).
//
// **É a ÚNICA grade da IDE.** A aba `Result` desenhava uma segunda, sem lupa e
// sem painel de aparência, e ele reclamou com razão: *"todo Resultado deveria
// ser igual ao que tem do 'abrir tabela'"*. Duas grades é o mesmo erro do CSV
// da spec 068 — eu escrevi que a lupa vinha "de graça" e não vinha, porque ela
// morava só aqui.
//
// O que separa os dois usos não é o componente: são CAPACIDADES declaradas por
// quem chama. Ordenar e filtrar por coluna exigem reescrever o SQL, e só a aba
// de tabela sabe fazê-lo; quem não passa a capacidade não ganha o controle — e
// não ganha um botão que não faz nada, que é pior que botão ausente.
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { larguraDoConteudo } from '../../shared/grade/larguras';
import { explicarFiltro } from '../../shared/grade/filtro';
import {
  alinhamentoDe, bordasDe, ehTipoNumerico, type Aparencia,
} from '../../shared/grade/aparencia';
import { useLarguras } from './useLarguras';
import { VisorDeCelula } from './VisorDeCelula';
import { idDaLinha, type Rascunho } from './useRascunho';
import type {
  CellResult, CellValue, OrdenacaoDeTabela, TableColumn,
} from '../../shared/contracts';

/**
 * Quanto um caractere ocupa na fonte da grade, para o ajuste automático.
 *
 * Medido, e não chutado: `0.6em` é a regra de bolso para monoespaçada, e a
 * grade usa 12 px. Erro aqui só afeta o palpite inicial, que o arrasto corrige.
 */
const POR_CARACTERE = 12 * 0.6;

/**
 * O tipo da coluna é desenhado numa fonte menor (10 px), e mede diferente.
 *
 * Sem contá-lo, a coluna `id` de uma tabela do MySQL nascia com 48 px — o
 * mínimo — e escondia o próprio `bigint unsigned` e o campo `contém…`.
 */
const POR_CARACTERE_DO_TIPO = 10 * 0.6;

/** A coluna do número da linha e a da caixa de apagar: fixas, não se arrastam. */
const LARGURA_DO_NUMERO = 44;
const LARGURA_DA_MARCA = 30;

/** Ordenar pelo cabeçalho. Ausente: o cabeçalho não vira botão. */
export interface OrdenacaoDaGrade {
  readonly atual: OrdenacaoDeTabela | null;
  alternar(coluna: string): void;
}

/** A faixa `contém…` de cada coluna. Ausente: a faixa não existe. */
export interface FiltroDaGrade {
  readonly valores: Readonly<Record<string, string>>;
  definir(coluna: string, valor: string): void;
}

export interface GradeProps {
  readonly colunas: readonly TableColumn[];
  readonly linhas: readonly (readonly CellValue[])[];
  readonly aparencia: Aparencia;
  /**
   * O número da primeira linha desta página, para a coluna cinza.
   *
   * Vem de fora porque só quem pagina sabe: a aba de tabela conta pelo tamanho
   * de página, e a de `Result` pela página do próprio resultado.
   */
  readonly primeiraLinha: number;
  readonly ordenacao?: OrdenacaoDaGrade;
  readonly filtroPorColuna?: FiltroDaGrade;
  readonly rascunho?: Rascunho;
  readonly motivoSemEdicao: string | null;
  /**
   * De onde a lupa busca o valor INTEIRO, quando dá.
   *
   * Ausente é resposta legítima: sem tabela conhecida ou sem chave primária não
   * há como pedir a célula de volta, e aí o visor mostra o que a grade tem e
   * **diz que está cortado** — melhor que uma promessa quebrada em silêncio.
   */
  readonly buscarCelula?: (id: string, coluna: string) => Promise<CellResult>;
}

export function Grade({
  colunas, linhas, rascunho, motivoSemEdicao, aparencia, primeiraLinha,
  ordenacao, filtroPorColuna, buscarCelula,
}: GradeProps) {
  const editavel = rascunho !== undefined && motivoSemEdicao === null;
  // Esconder a coluna de controle esconde as caixas de apagar, e é escolha
  // dele. Editar célula continua funcionando: são coisas diferentes.
  const marcas = editavel && aparencia.colunaDeControle;
  const bordas = bordasDe(aparencia);
  const larguras = useLarguras();

  /**
   * A largura com que cada coluna nasce: o que o conteúdo da PÁGINA pede, com
   * teto. Recalculada quando a página muda, e não a cada repintura — são 500
   * linhas vezes o número de colunas.
   */
  const automaticas = useMemo(
    () =>
      Object.fromEntries(
        colunas.map((c, j) => [
          c.name,
          Math.max(
            larguraDoConteudo([c.name, ...linhas.map((l) => String(l[j] ?? ''))], POR_CARACTERE),
            larguraDoConteudo([c.type ?? ''], POR_CARACTERE_DO_TIPO)
          ),
        ])
      ),
    [colunas, linhas]
  );
  const larguraDe = (coluna: string): number =>
    larguras.larguraDe(coluna) ?? automaticas[coluna] ?? 120;

  // Qual célula está no visor. Guarda o ID DA LINHA e o nome da coluna, e não a
  // posição: ordenar ou paginar com o visor aberto trocaria a linha embaixo dele.
  const [naLupa, setNaLupa] = useState<{
    readonly id: string;
    readonly coluna: string;
    readonly valor: CellValue;
    readonly editavel: boolean;
  } | null>(null);

  // A largura TOTAL, somada aqui.
  //
  // `table-layout: fixed` não vale nada quando a largura da tabela é
  // `auto` ou `max-content`: o navegador volta ao arranjo automático e
  // dimensiona pelo conteúdo — foi assim que uma célula de 120 caracteres
  // ficou com 902 px numa coluna declarada de 420. Com a soma explícita, o
  // arranjo fixo entra em vigor e o `colgroup` passa a mandar.
  const larguraTotal =
    (aparencia.numeroDaLinha ? LARGURA_DO_NUMERO : 0) +
    (marcas ? LARGURA_DA_MARCA : 0) +
    colunas.reduce((soma, c) => soma + larguraDe(c.name), 0);
  return (
    <Box data-grade sx={{ flex: 1, overflow: 'auto', minHeight: 0, minWidth: 0 }}>
      <Box
        component="table"
        sx={{
          // `table-layout: fixed` (spec 062, fase C): sem ele o navegador
          // redistribui as larguras sozinho a cada repintura, e arrastar UMA
          // coluna mexeria em todas as outras.
          borderCollapse: 'collapse', tableLayout: 'fixed', width: larguraTotal,
          fontFamily: tokens.fontMono, fontSize: 12,
          '& th, & td': {
            borderRight: bordas.direita ? 1 : 0,
            borderBottom: bordas.baixo ? 1 : 0,
            borderColor: 'divider', px: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
          // A altura é da LINHA, e não da célula: pôr no `td` deixaria o
          // cabeçalho de fora, e ele tem duas linhas (nome e tipo).
          '& tbody td': { height: aparencia.alturaDaLinha, py: 0 },
          '& thead th': {
            py: '3px',
            position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1,
          },
        }}
      >
        {/* O `colgroup` é o que faz a largura valer (spec 062, fase C).
            Com `table-layout: fixed` o navegador tira as larguras da PRIMEIRA
            linha — mas só quando a tabela tem largura definida. Como a nossa é
            `max-content`, o `width` posto no `th` não chegava às células: a
            coluna continuava se dimensionando pelo conteúdo, e arrastar a alça
            mexia no cabeçalho sem mexer no corpo. O `colgroup` declara a largura
            da COLUNA, e não de uma célula, e vale para os dois. */}
        <colgroup>
          {aparencia.numeroDaLinha && <col style={{ width: LARGURA_DO_NUMERO }} />}
          {marcas && <col style={{ width: LARGURA_DA_MARCA }} />}
          {colunas.map((coluna) => (
            <col key={coluna.name} style={{ width: larguraDe(coluna.name) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {aparencia.numeroDaLinha && <Box component="th" sx={{ bgcolor: 'background.paper' }} />}
            {marcas && <Box component="th" sx={{ bgcolor: 'background.paper' }} />}
            {colunas.map((coluna, j) => (
              <Cabecalho
                key={coluna.name}
                coluna={coluna}
                ordenacao={ordenacao}
                filtroPorColuna={filtroPorColuna}
                largura={larguraDe(coluna.name)}
                onArrastar={(x) => larguras.comecar(coluna.name, x, larguraDe(coluna.name))}
                onAjustar={() =>
                  larguras.ajustar(
                    coluna.name,
                    // O cabeçalho conta junto: uma coluna chamada
                    // `data_de_atualizacao` com valores `1` precisa caber o nome.
                    [coluna.name, ...linhas.map((l) => String(l[j] ?? ''))],
                    POR_CARACTERE
                  )
                }
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => {
            const id = idDaLinha(colunas, linha);
            const aApagar = rascunho?.remocoes.has(id) === true;
            return (
              <tr key={i}>
                {aparencia.numeroDaLinha && (
                  <Box
                    component="td"
                    sx={{
                      color: 'text.secondary', bgcolor: 'background.paper',
                      textAlign: 'right', userSelect: 'none',
                    }}
                  >
                    {primeiraLinha + i}
                  </Box>
                )}
                {marcas && (
                  <Box component="td" sx={{ bgcolor: 'background.paper', textAlign: 'center' }}>
                    <Box
                      component="input"
                      type="checkbox"
                      aria-label={`Marcar linha ${i + 1} para apagar`}
                      checked={aApagar}
                      onChange={() => rascunho?.alternarRemocao(id)}
                      sx={{ m: 0, cursor: 'pointer' }}
                    />
                  </Box>
                )}
                {linha.map((valor, j) => {
                  const coluna = colunas[j];
                  if (coluna === undefined) return null;
                  const mostrado = editavel ? rascunho.valorDe(id, coluna.name, valor) : valor;
                  return (
                    <Celula
                      key={j}
                      valor={mostrado}
                      // A chave NÃO se edita: trocá-la aqui mudaria a linha que
                      // o `WHERE` usa para achar a própria linha.
                      editavel={editavel && !coluna.chave}
                      alinhamento={alinhamentoDe(aparencia, ehTipoNumerico(coluna.type))}
                      mexida={editavel && rascunho.mexida(id, coluna.name)}
                      riscada={aApagar}
                      titulo={motivoSemEdicao ?? undefined}
                      onEditar={(novo) => rascunho?.alterar(id, coluna.name, valor, novo)}
                      onAbrir={() =>
                        setNaLupa({
                          id,
                          coluna: coluna.name,
                          valor: mostrado,
                          editavel: editavel && !coluna.chave,
                        })
                      }
                    />
                  );
                })}
              </tr>
            );
          })}
          {rascunho?.novas.map((nova) => (
            <LinhaNovaTr
              key={nova.id}
              nova={nova}
              colunas={colunas}
              rascunho={rascunho}
              comMarcas={marcas}
              comNumero={aparencia.numeroDaLinha}
            />
          ))}
        </tbody>
      </Box>

      {naLupa !== null && (
        <VisorDeCelula
          aberto
          coluna={naLupa.coluna}
          valor={naLupa.valor}
          motivoSemEdicao={
            naLupa.editavel ? null : motivoDaCelula(motivoSemEdicao, colunas, naLupa.coluna)
          }
          // Só dá para buscar o valor inteiro quando a IDE sabe QUAL LINHA é:
          // precisa da tabela (em SQL livre ela não sabe) e de chave primária
          // (sem ela, o `WHERE` casaria com várias). Fora disso o visor mostra
          // o que a grade tem e diz que está cortado — que é honesto, e melhor
          // que uma promessa quebrada em silêncio.
          buscarInteiro={
            buscarCelula === undefined || !colunas.some((c) => c.chave)
              ? undefined
              : () => buscarCelula(naLupa.id, naLupa.coluna)
          }
          onFechar={() => setNaLupa(null)}
          onSalvar={
            naLupa.editavel
              ? (novo) => {
                  const linha = linhas.find((l) => idDaLinha(colunas, l) === naLupa.id);
                  const j = colunas.findIndex((c) => c.name === naLupa.coluna);
                  // O `antes` sai da LINHA, e não do visor: é ele que vai para o
                  // `WHERE`, e usar o valor já editado apontaria para uma linha
                  // que não existe mais no banco.
                  rascunho?.alterar(naLupa.id, naLupa.coluna, linha?.[j] ?? null, novo);
                }
              : undefined
          }
        />
      )}
    </Box>
  );
}

/** Por que ESTA célula não se edita — a chave primária tem motivo próprio. */
function motivoDaCelula(
  geral: string | null,
  colunas: readonly TableColumn[],
  nome: string
): string {
  if (geral !== null) return geral;
  const coluna = colunas.find((c) => c.name === nome);
  if (coluna?.chave === true) {
    return 'Esta coluna é chave primária: mudá-la mudaria a linha que o WHERE usa para achá-la.';
  }
  return 'Somente leitura.';
}

function Cabecalho({
  coluna, ordenacao, filtroPorColuna, largura, onArrastar, onAjustar,
}: {
  readonly coluna: TableColumn;
  readonly ordenacao?: OrdenacaoDaGrade;
  readonly filtroPorColuna?: FiltroDaGrade;
  readonly largura: number;
  readonly onArrastar: (xInicial: number) => void;
  readonly onAjustar: () => void;
}) {
  const ordem = ordenacao?.atual?.coluna === coluna.name ? ordenacao.atual : null;
  const seta = ordem === null || ordem === undefined ? '' : ordem.desc ? ' ▼' : ' ▲';
  // Ordenar e filtrar exigem REESCREVER o SQL, e só quem o montou sabe fazê-lo:
  // no SQL livre e na aba de `Result` a IDE não montou nada. Quem não passa a
  // capacidade não ganha o controle — botão que não faz nada é pior que ausente.
  const ordena = ordenacao !== undefined;
  const filtra = filtroPorColuna !== undefined;
  const filtroDaColuna = filtroPorColuna?.valores[coluna.name] ?? '';

  return (
    <Box
      component="th"
      data-coluna={coluna.name}
      // `position: relative` para a alça poder se pendurar na borda direita.
      // A LARGURA não vem daqui: vem do `colgroup`, que é quem o
      // `table-layout: fixed` obedece. Este `width` fica como redundância
      // barata para quem lê o DOM — e é o que o teste mede.
      sx={{ verticalAlign: 'top', width: largura, position: 'relative' }}
    >
      <Box
        component="button"
        type="button"
        disabled={!ordena}
        aria-label={`Ordenar por ${coluna.name}`}
        onClick={() => ordenacao?.alternar(coluna.name)}
        sx={{
          border: 0, bgcolor: 'transparent', color: 'inherit', font: 'inherit',
          p: 0, cursor: ordena ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', gap: 0.4,
        }}
      >
        {coluna.chave && (
          <Box component="span" title="Chave primária" sx={{ color: 'warning.main' }}>
            ⚿
          </Box>
        )}
        <span>{coluna.name}</span>
        {coluna.obrigatoria && (
          <Box component="span" title="NOT NULL" sx={{ color: 'error.main' }}>
            *
          </Box>
        )}
        <Box component="span" sx={{ color: 'primary.main' }}>
          {seta}
        </Box>
      </Box>

      <Box sx={{ color: 'text.secondary', fontSize: 10, fontWeight: 400 }}>{coluna.type}</Box>

      <Alca
        coluna={coluna.name}
        onArrastar={onArrastar}
        onAjustar={onAjustar}
      />

      {filtra && (
      <InputBase
        value={filtroDaColuna}
        placeholder="contém…"
        onChange={(e) => filtroPorColuna?.definir(coluna.name, e.target.value)}
        inputProps={{ 'aria-label': `Filtrar ${coluna.name}` }}
        // A dica sai da MESMA função que o servidor usa para montar o `WHERE`
        // (T057). Duas implementações da mesma gramática divergiriam, e a
        // divergência apareceria como "filtrei e veio coisa errada".
        title={
          explicarFiltro(filtroDaColuna) ??
          'contém… · use >, <, >=, <=, =, != · null · 1..5'
        }
        sx={{
          fontSize: 10, fontFamily: tokens.fontMono, border: 1, borderColor: 'divider',
          borderRadius: 0.5, px: 0.5, py: 0, mt: 0.25, bgcolor: tokens.bgEditor,
          // Não `100%`: os 8 px da direita são da alça, e um campo que passa
          // por baixo dela rouba o arrasto de quem mira a borda.
          width: 'calc(100% - 8px)',
        }}
      />
      )}
      {/* O que a IDE ENTENDEU do que foi digitado. Só aparece quando não é o
          padrão: escrever "contém joshua" embaixo de toda caixa seria ruído. */}
      {filtra && explicarFiltro(filtroDaColuna) !== null && (
        <Box
          data-leitura-do-filtro
          sx={{ fontSize: 9.5, color: 'primary.main', fontWeight: 400, mt: 0.25 }}
        >
          {explicarFiltro(filtroDaColuna)}
        </Box>
      )}
    </Box>
  );
}

/**
 * A alça de redimensionar, na borda direita do cabeçalho (spec 062, fase C).
 *
 * Seis pixels de largura, metade para cada lado da borda: uma alça de 1 px é
 * impossível de pegar, e uma de 12 px rouba o clique de ordenar. A cor só
 * aparece sob o mouse.
 *
 * É um `div`, e não um `button`: arrastar não é ativar, e um botão aqui
 * apareceria na navegação por teclado prometendo algo que o teclado não faz.
 * `aria-hidden` pelo mesmo motivo — quem usa leitor de tela não redimensiona
 * coluna, e o dado está todo acessível sem isso.
 */
function Alca({
  coluna, onArrastar, onAjustar,
}: {
  readonly coluna: string;
  readonly onArrastar: (xInicial: number) => void;
  readonly onAjustar: () => void;
}) {
  return (
    <Box
      aria-hidden
      data-alca={coluna}
      onMouseDown={(e: React.MouseEvent) => {
        // `stopPropagation` para o clique não chegar ao botão de ordenar: quem
        // pega a borda quer largura, não ordem.
        e.preventDefault();
        e.stopPropagation();
        onArrastar(e.clientX);
      }}
      onDoubleClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onAjustar();
      }}
      sx={{
        // DENTRO do cabeçalho, e não a cavalo na borda: o `th` tem
        // `overflow: hidden` para as reticências, e o que passa da borda é
        // recortado — a alça existia e não podia ser pega.
        position: 'absolute', top: 0, right: 0, width: 8, height: '100%',
        cursor: 'col-resize', zIndex: 2,
        '&:hover': { bgcolor: 'primary.main' },
      }}
    />
  );
}

/**
 * Uma linha nova, ainda em rascunho.
 *
 * Fica no fim da grade, com fundo próprio. Não tem chave — o banco a gera — e
 * por isso nenhuma célula dela é intocável.
 */
function LinhaNovaTr({
  nova, colunas, rascunho, comMarcas, comNumero,
}: {
  readonly nova: { readonly id: string; readonly valores: Readonly<Record<string, CellValue>> };
  readonly colunas: readonly TableColumn[];
  readonly rascunho: Rascunho;
  readonly comMarcas: boolean;
  readonly comNumero: boolean;
}) {
  return (
    <Box component="tr" data-linha-nova sx={{ bgcolor: 'action.selected' }}>
      {comNumero && (
        <Box component="td" sx={{ textAlign: 'center', userSelect: 'none' }}>
          <Box
            component="button"
            type="button"
            aria-label="Descartar esta linha nova"
            onClick={() => rascunho.descartarNova(nova.id)}
            sx={{ border: 0, bgcolor: 'transparent', color: 'inherit', cursor: 'pointer', p: 0 }}
          >
            ×
          </Box>
        </Box>
      )}
      {comMarcas && <Box component="td" />}
      {colunas.map((coluna) => (
        <Celula
          key={coluna.name}
          valor={nova.valores[coluna.name] ?? null}
          editavel
          mexida
          riscada={false}
          rotulo={`Nova linha, ${coluna.name}`}
          onEditar={(novo) => rascunho.alterarNova(nova.id, coluna.name, novo)}
        />
      ))}
    </Box>
  );
}

function Celula({
  valor, editavel = false, mexida = false, riscada = false, titulo, rotulo, onEditar, onAbrir,
  alinhamento = 'left',
}: {
  readonly valor: CellValue;
  readonly editavel?: boolean;
  readonly mexida?: boolean;
  readonly riscada?: boolean;
  readonly titulo?: string;
  readonly rotulo?: string;
  readonly onEditar?: (novo: CellValue) => void;
  /** Abre o visor. Ausente na linha nova, que ainda não tem valor guardado. */
  readonly onAbrir?: () => void;
  readonly alinhamento?: 'left' | 'center' | 'right';
}) {
  const nulo = valor === null;
  const [editando, setEditando] = useState(false);

  if (editando && editavel) {
    return (
      <Box component="td" sx={{ p: 0 }}>
        <Box
          component="input"
          autoFocus
          aria-label={rotulo ?? 'Valor da célula'}
          defaultValue={nulo ? '' : String(valor)}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            setEditando(false);
            onEditar?.(e.target.value);
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            // `Escape` desiste: sai sem chamar `onEditar`, e o valor fica como
            // estava. Sem isto, começar a editar por engano já sujaria o rascunho.
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditando(false);
            }
            // `Ctrl+0` põe NULL. Um botão por célula seria ruído; digitar a
            // palavra "NULL" gravaria o TEXTO, que é outra coisa.
            if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              setEditando(false);
              onEditar?.(null);
            }
          }}
          sx={{
            width: '100%', border: 0, outline: 'none', px: 1, py: '3px',
            bgcolor: 'primary.main', color: 'background.default',
            font: 'inherit', fontFamily: tokens.fontMono, fontSize: 12,
          }}
        />
      </Box>
    );
  }

  return (
    <Box
      component="td"
      title={titulo ?? (nulo ? 'NULL' : String(valor))}
      onDoubleClick={editavel ? () => setEditando(true) : undefined}
      // Clicar copia: o caso mais comum é levar um id para a próxima consulta.
      // Editar é DUPLO clique, para não brigar com isso.
      onClick={() => void navigator.clipboard?.writeText(nulo ? '' : String(valor))}
      sx={{
        cursor: 'pointer',
        textAlign: alinhamento,
        // `relative` para a lupa se pendurar no canto direito da célula.
        position: 'relative',
        color: nulo ? 'text.secondary' : 'text.primary',
        fontStyle: nulo ? 'italic' : 'normal',
        textDecoration: riscada ? 'line-through' : 'none',
        opacity: riscada ? 0.5 : 1,
        bgcolor: mexida ? 'warning.main' : undefined,
        ...(mexida ? { color: 'background.default' } : {}),
        '&:hover': { bgcolor: mexida ? 'warning.main' : 'action.hover' },
        // A lupa só sob o mouse: uma por célula, sempre visível, encheria a
        // grade de ícones e roubaria a leitura do dado, que é o que importa.
        '& [data-lupa]': { opacity: 0 },
        '&:hover [data-lupa]': { opacity: 1 },
      }}
    >
      {nulo ? 'NULL' : String(valor)}
      {onAbrir !== undefined && (
        <Box
          component="button"
          type="button"
          data-lupa
          aria-label="Ver o valor inteiro"
          title="Ver o valor inteiro"
          onClick={(e: React.MouseEvent) => {
            // Sem isto o clique da célula copia o valor no mesmo gesto.
            e.stopPropagation();
            onAbrir();
          }}
          onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
          sx={{
            position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
            border: 0, borderRadius: 0.5, p: 0.2, display: 'flex', cursor: 'pointer',
            bgcolor: 'background.paper', color: 'text.secondary',
            '&:hover': { color: 'primary.main' },
          }}
        >
          <Icon name="lucide:zoom-in" size={13} />
        </Box>
      )}
    </Box>
  );
}

