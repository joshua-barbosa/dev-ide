// A aba de tabela (spec 041).
//
// Três faixas, de cima para baixo: o SQL que rodou, a barra de comando, e a
// grade. O SQL fica à vista de propósito — é o que torna a ordenação e o filtro
// auditáveis, e o que ensina quem quiser escrever a consulta na mão.
//
// Nada aqui escreve no banco. Editar célula é a fase F5.
import { useState } from 'react';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { paraCsv, paraJson } from '../../shared/exportar';
import { TAMANHOS_DE_PAGINA, type EstadoDaTabela } from './useTabela';
import type { CellValue, TableColumn } from '../../shared/contracts';
import { BarraDeRascunho } from './BarraDeRascunho';
import { idDaLinha, type Rascunho } from './useRascunho';

/** Largura máxima de coluna, para um BLOB não empurrar a tabela inteira. */
const LARGURA_MAX = 420;

/**
 * O SQL do topo, editável (spec 043).
 *
 * É uma `textarea`, e não um Monaco. São três linhas: uma instância de editor
 * por aba de tabela custaria memória e um ciclo de montagem, e traria minimapa,
 * dobradura e lente de código para dentro de uma caixa de três linhas. Quem quer
 * editor completo abre uma query — que é um clique.
 */
function CampoDeSql({ estado }: { readonly estado: EstadoDaTabela }) {
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'flex-start', gap: 0.5, px: 1, py: 0.5,
        borderBottom: 1, borderColor: 'divider',
      }}
    >
      <Box
        component="textarea"
        data-sql-da-tabela
        aria-label="SQL desta aba"
        spellCheck={false}
        value={estado.sql}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => estado.definirSql(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent) => {
          // `Ctrl+Enter` é o mesmo gesto do editor de query. Um `Enter` sozinho
          // precisa continuar quebrando linha: o SQL tem mais de uma.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            estado.executarSql();
          }
        }}
        rows={3}
        sx={{
          flex: 1, resize: 'vertical', border: 0, outline: 'none',
          bgcolor: 'transparent', color: 'text.secondary',
          fontFamily: tokens.fontMono, fontSize: 11, lineHeight: 1.5,
        }}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Acao icone="lucide:play" rotulo="Executar este SQL" onClick={estado.executarSql} />
        {estado.modoLivre && (
          <Acao
            icone="lucide:corner-left-up"
            rotulo="Voltar ao SQL da tabela"
            onClick={estado.voltarParaTabela}
          />
        )}
      </Box>
    </Box>
  );
}

export interface TablePanelProps {
  readonly estado: EstadoDaTabela;
  readonly titulo: string;
  /** Abre o texto exportado numa aba sem título — o mesmo caminho do JSON da 038. */
  readonly onExportar: (conteudo: string, linguagem: string) => void;
  /** O rascunho de edição (spec 044). Ausente = a aba é só de leitura. */
  readonly rascunho?: Rascunho;
  readonly gravando?: boolean;
  readonly onGravar?: () => void;
  /**
   * Por que não dá para editar, quando não dá.
   *
   * Texto em vez de booleano: "não responde ao clique" é a pior interface
   * possível. O usuário precisa saber se falta chave primária, se a conexão é
   * somente-leitura, ou se ele está em modo livre.
   */
  readonly motivoSemEdicao?: string | null;
}

export function TablePanel({
  estado, titulo, onExportar, rascunho, gravando = false, onGravar, motivoSemEdicao = null,
}: TablePanelProps) {
  const { pagina, carregando, erro } = estado;
  const [busca, setBusca] = useState('');

  const colunas = pagina?.columns ?? [];
  const linhas = pagina?.resultado.rows ?? [];
  // Busca na PÁGINA, e não no banco: o filtro por coluna é que vai ao servidor.
  // Um campo que faz as duas coisas confundiria o que o total significa.
  const visiveis =
    busca.trim() === ''
      ? linhas
      : linhas.filter((l) => l.some((v) => String(v ?? '').toLowerCase().includes(busca.toLowerCase())));

  const exportar = (formato: 'csv' | 'json'): void => {
    if (pagina === null) return;
    const cols = colunas.map((c) => ({ name: c.name, type: c.type }));
    onExportar(
      formato === 'csv' ? paraCsv(cols, visiveis) : paraJson(cols, visiveis),
      formato === 'csv' ? 'plain' : 'json'
    );
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: tokens.bgEditor }}>
      <CampoDeSql estado={estado} />

      <BarraDeComando
        estado={estado}
        busca={busca}
        onBusca={setBusca}
        onExportar={exportar}
        mostrando={visiveis.length}
        podeEditar={rascunho !== undefined && motivoSemEdicao === null}
        onAcrescentar={() => rascunho?.acrescentarLinha()}
      />

      {rascunho !== undefined && onGravar !== undefined && (
        <BarraDeRascunho rascunho={rascunho} gravando={gravando} onGravar={onGravar} />
      )}

      {erro !== null ? (
        <Aviso texto={erro} erro />
      ) : carregando && pagina === null ? (
        <Aviso texto="carregando…" />
      ) : colunas.length === 0 ? (
        <Aviso texto={`Sem colunas em ${titulo}.`} />
      ) : (
        <Grade
          estado={estado}
          colunas={colunas}
          linhas={visiveis}
          rascunho={rascunho}
          motivoSemEdicao={motivoSemEdicao}
        />
      )}
    </Box>
  );
}

function BarraDeComando({
  estado, busca, onBusca, onExportar, mostrando, podeEditar, onAcrescentar,
}: {
  readonly estado: EstadoDaTabela;
  readonly busca: string;
  readonly onBusca: (v: string) => void;
  readonly onExportar: (formato: 'csv' | 'json') => void;
  readonly mostrando: number;
  readonly podeEditar: boolean;
  readonly onAcrescentar: () => void;
}) {
  const { pagina, numero, totalDePaginas, carregando } = estado;
  const ultima = totalDePaginas !== null && numero >= totalDePaginas;

  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.5,
        borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper',
        fontSize: 11, color: 'text.secondary', flexWrap: 'wrap',
      }}
    >
      <InputBase
        value={busca}
        placeholder="Filtrar na página"
        onChange={(e) => onBusca(e.target.value)}
        inputProps={{ 'aria-label': 'Filtrar na página' }}
        sx={{
          fontSize: 11, fontFamily: tokens.fontMono, border: 1, borderColor: 'divider',
          borderRadius: 0.5, px: 0.75, py: 0.1, width: 160, bgcolor: tokens.bgEditor,
        }}
      />

      {/* "a tabela" no rótulo: a lateral já tem vários "Recarregar", e um nome
          ambíguo é ruim para quem usa leitor de tela e para quem escreve teste. */}
      <Acao icone="lucide:refresh-cw" rotulo="Recarregar a tabela" onClick={estado.recarregar} />
      {podeEditar && (
        <Acao icone="lucide:plus" rotulo="Acrescentar linha" onClick={onAcrescentar} />
      )}
      <Acao icone="lucide:file-down" rotulo="Exportar CSV" onClick={() => onExportar('csv')} />
      <Acao icone="lucide:braces" rotulo="Exportar JSON" onClick={() => onExportar('json')} />

      <Box sx={{ flex: 1 }} />

      {!estado.modoLivre && (
      <Select
        value={estado.porPagina}
        onChange={(e) => estado.definirPorPagina(Number(e.target.value))}
        variant="standard"
        disableUnderline
        inputProps={{ 'aria-label': 'Linhas por página' }}
        sx={{ fontSize: 11, color: 'inherit', '& .MuiSelect-select': { py: 0 } }}
      >
        {TAMANHOS_DE_PAGINA.map((n) => (
          <MenuItem key={n} value={n} sx={{ fontSize: 11 }}>
            {n} / página
          </MenuItem>
        ))}
      </Select>
      )}

      {estado.modoLivre ? (
        <Box data-modo-livre component="span" sx={{ color: 'warning.main' }}>
          SQL livre — sem paginação, ordenação nem filtro por coluna
        </Box>
      ) : (
        <>
      <Acao
        icone="lucide:chevron-left"
        rotulo="Página anterior"
        desabilitada={numero <= 1 || carregando}
        onClick={() => estado.irPara(numero - 1)}
      />
      <Box component="span" data-pagina-atual sx={{ minWidth: 54, textAlign: 'center' }}>
        {numero}
        {totalDePaginas === null ? '' : ` / ${totalDePaginas}`}
      </Box>
      <Acao
        icone="lucide:chevron-right"
        rotulo="Próxima página"
        desabilitada={ultima || carregando}
        onClick={() => estado.irPara(numero + 1)}
      />
        </>
      )}

      <Box component="span" data-total-da-tabela sx={{ ml: 1 }}>
        <Total pagina={pagina} mostrando={mostrando} />
      </Box>
    </Box>
  );
}

/**
 * O total, e a honestidade sobre ele.
 *
 * Um número exato que não é seria pior que nenhum número: é a mesma regra do
 * "resultado cortado" que a grade segue desde a spec 001.
 */
function Total({
  pagina, mostrando,
}: {
  readonly pagina: EstadoDaTabela['pagina'];
  readonly mostrando: number;
}) {
  if (pagina === null) return null;
  const custo = `${pagina.resultado.durationMs}ms`;
  if (pagina.total !== null) {
    return <>{`${mostrando} de ${pagina.total.toLocaleString('pt-BR')} · ${custo}`}</>;
  }
  const estimado = pagina.totalEstimado;
  return (
    <Tooltip title="Contar exigiria varrer a tabela inteira; este número vem do catálogo.">
      <span>
        {mostrando} de ~{estimado === null ? '?' : estimado.toLocaleString('pt-BR')} (estimado) ·{' '}
        {custo}
      </span>
    </Tooltip>
  );
}

function Acao({
  icone, rotulo, onClick, desabilitada = false,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
  readonly desabilitada?: boolean;
}) {
  return (
    // `describeChild`: sem ele o MUI põe o `title` como `aria-label` TAMBÉM no
    // span que envolve, e o botão passa a ter dois elementos com o mesmo nome.
    // O botão já tem nome próprio; a dica DESCREVE, não nomeia.
    <Tooltip title={rotulo} placement="bottom" describeChild>
      <Box component="span">
        <Box
          component="button"
          type="button"
          aria-label={rotulo}
          disabled={desabilitada}
          onClick={onClick}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'inherit', p: 0.4, borderRadius: 0.5,
            display: 'flex', cursor: desabilitada ? 'default' : 'pointer',
            opacity: desabilitada ? 0.35 : 1,
            '&:hover': { bgcolor: desabilitada ? 'transparent' : 'action.hover' },
          }}
        >
          <Icon name={icone} size={13} />
        </Box>
      </Box>
    </Tooltip>
  );
}

function Grade({
  estado, colunas, linhas, rascunho, motivoSemEdicao,
}: {
  readonly estado: EstadoDaTabela;
  readonly colunas: readonly TableColumn[];
  readonly linhas: readonly (readonly CellValue[])[];
  readonly rascunho?: Rascunho;
  readonly motivoSemEdicao: string | null;
}) {
  const editavel = rascunho !== undefined && motivoSemEdicao === null;
  return (
    <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      <Box
        component="table"
        sx={{
          borderCollapse: 'collapse', fontFamily: tokens.fontMono, fontSize: 12,
          '& th, & td': {
            borderRight: 1, borderBottom: 1, borderColor: 'divider', px: 1, py: '3px',
            textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', maxWidth: LARGURA_MAX,
          },
          '& thead th': { position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1 },
        }}
      >
        <thead>
          <tr>
            <Box component="th" sx={{ bgcolor: 'background.paper' }} />
            {editavel && <Box component="th" sx={{ bgcolor: 'background.paper' }} />}
            {colunas.map((coluna) => (
              <Cabecalho key={coluna.name} coluna={coluna} estado={estado} />
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => {
            const id = idDaLinha(colunas, linha);
            const aApagar = rascunho?.remocoes.has(id) === true;
            return (
              <tr key={i}>
                <Box
                  component="td"
                  sx={{
                    color: 'text.secondary', bgcolor: 'background.paper',
                    textAlign: 'right', userSelect: 'none',
                  }}
                >
                  {(estado.numero - 1) * estado.porPagina + i + 1}
                </Box>
                {editavel && (
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
                  return (
                    <Celula
                      key={j}
                      valor={editavel ? rascunho.valorDe(id, coluna.name, valor) : valor}
                      // A chave NÃO se edita: trocá-la aqui mudaria a linha que
                      // o `WHERE` usa para achar a própria linha.
                      editavel={editavel && !coluna.chave}
                      mexida={editavel && rascunho.mexida(id, coluna.name)}
                      riscada={aApagar}
                      titulo={motivoSemEdicao ?? undefined}
                      onEditar={(novo) => rascunho?.alterar(id, coluna.name, valor, novo)}
                    />
                  );
                })}
              </tr>
            );
          })}
          {rascunho?.novas.map((nova) => (
            <LinhaNovaTr key={nova.id} nova={nova} colunas={colunas} rascunho={rascunho} />
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function Cabecalho({
  coluna, estado,
}: {
  readonly coluna: TableColumn;
  readonly estado: EstadoDaTabela;
}) {
  const ordem = estado.ordenar?.coluna === coluna.name ? estado.ordenar : null;
  const seta = ordem === null ? '' : ordem.desc ? ' ▼' : ' ▲';
  // No modo livre não há o que ordenar nem filtrar: a IDE não montou este SQL e
  // não vai reescrevê-lo. Botão que não faz nada é pior que botão ausente.
  const estruturado = !estado.modoLivre;

  return (
    <Box component="th" data-coluna={coluna.name} sx={{ verticalAlign: 'top' }}>
      <Box
        component="button"
        type="button"
        disabled={!estruturado}
        aria-label={`Ordenar por ${coluna.name}`}
        onClick={() => estado.alternarOrdem(coluna.name)}
        sx={{
          border: 0, bgcolor: 'transparent', color: 'inherit', font: 'inherit',
          p: 0, cursor: estruturado ? 'pointer' : 'default',
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

      {estruturado && (
      <InputBase
        value={estado.filtros[coluna.name] ?? ''}
        placeholder="contém…"
        onChange={(e) => estado.definirFiltro(coluna.name, e.target.value)}
        inputProps={{ 'aria-label': `Filtrar ${coluna.name}` }}
        sx={{
          fontSize: 10, fontFamily: tokens.fontMono, border: 1, borderColor: 'divider',
          borderRadius: 0.5, px: 0.5, py: 0, width: '100%', mt: 0.25, bgcolor: tokens.bgEditor,
        }}
      />
      )}
    </Box>
  );
}

/**
 * Uma linha nova, ainda em rascunho.
 *
 * Fica no fim da grade, com fundo próprio. Não tem chave — o banco a gera — e
 * por isso nenhuma célula dela é intocável.
 */
function LinhaNovaTr({
  nova, colunas, rascunho,
}: {
  readonly nova: { readonly id: string; readonly valores: Readonly<Record<string, CellValue>> };
  readonly colunas: readonly TableColumn[];
  readonly rascunho: Rascunho;
}) {
  return (
    <Box component="tr" data-linha-nova sx={{ bgcolor: 'action.selected' }}>
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
      <Box component="td" />
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
  valor, editavel = false, mexida = false, riscada = false, titulo, rotulo, onEditar,
}: {
  readonly valor: CellValue;
  readonly editavel?: boolean;
  readonly mexida?: boolean;
  readonly riscada?: boolean;
  readonly titulo?: string;
  readonly rotulo?: string;
  readonly onEditar?: (novo: CellValue) => void;
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
        color: nulo ? 'text.secondary' : 'text.primary',
        fontStyle: nulo ? 'italic' : 'normal',
        textDecoration: riscada ? 'line-through' : 'none',
        opacity: riscada ? 0.5 : 1,
        bgcolor: mexida ? 'warning.main' : undefined,
        ...(mexida ? { color: 'background.default' } : {}),
        '&:hover': { bgcolor: mexida ? 'warning.main' : 'action.hover' },
      }}
    >
      {nulo ? 'NULL' : String(valor)}
    </Box>
  );
}

function Aviso({ texto, erro = false }: { readonly texto: string; readonly erro?: boolean }) {
  return (
    <Box
      sx={{
        flex: 1, p: 1.75, color: erro ? 'error.main' : 'text.secondary', fontSize: 12,
        whiteSpace: 'pre-wrap', fontFamily: erro ? tokens.fontMono : 'inherit',
      }}
    >
      {texto}
    </Box>
  );
}
