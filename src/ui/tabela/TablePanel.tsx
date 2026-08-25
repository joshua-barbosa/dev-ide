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
import { Grade } from './GradeDaTabela';
import { tokens } from '../theme';
import { paraCsv, paraJson } from '../../shared/exportar';
import { TAMANHOS_DE_PAGINA, type EstadoDaTabela } from './useTabela';
import { BarraDeRascunho } from './BarraDeRascunho';
import type { Rascunho } from './useRascunho';

// `minWidth: 0` NÃO é enfeite (spec 062).
//
// Coluna flex nasce com `min-width: auto`, o que a faz crescer até o
// min-content do filho mais largo em vez de deixá-lo rolar. Com uma tabela de
// 1796 px dentro de uma aba de 1677, o painel inteiro virava 1806 e transbordava
// para FORA da tela — levando junto o botão de executar, que ficava em x=2021
// com a janela em 1920. O `minHeight: 0` já estava aqui desde a spec 041; o
// irmão dele faltava.

/**
 * O SQL do topo, editável (spec 043).
 *
 * É uma `textarea`, e não um Monaco. São três linhas: uma instância de editor
 * por aba de tabela custaria memória e um ciclo de montagem, e traria minimapa,
 * dobradura e lente de código para dentro de uma caixa de três linhas. Quem quer
 * editor completo abre uma query — que é um clique.
 *
 * Sem botão nenhum pendurado no canto (spec 062, fase B). O `▷` morava aqui, à
 * direita de um campo que ocupa a largura da tela — ou seja, a mil e setecentos
 * pixels do olho de quem acabou de editar o SQL na esquerda. Ele foi para a
 * barra de comando, que é onde o olho já está.
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
    <Box
      data-aba-de-tabela
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column',
        minHeight: 0, minWidth: 0, bgcolor: tokens.bgEditor,
      }}
    >
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
      data-barra-de-comando
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

      {/* O atalho vai NO RÓTULO, e não só numa dica: quem lê o nome do botão
          descobre que não precisa dele. */}
      <Acao
        icone="lucide:play"
        rotulo="Executar este SQL (Ctrl+Enter)"
        onClick={estado.executarSql}
        cor="success.main"
      />
      {estado.modoLivre && (
        <Acao
          icone="lucide:corner-left-up"
          rotulo="Voltar ao SQL da tabela"
          onClick={estado.voltarParaTabela}
        />
      )}

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
  icone, rotulo, onClick, desabilitada = false, cor,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
  readonly desabilitada?: boolean;
  /** Destaque. Sem isto o botão herda a cor do texto e some entre os vizinhos. */
  readonly cor?: string;
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
            border: 0, bgcolor: 'transparent', color: cor ?? 'inherit', p: 0.4, borderRadius: 0.5,
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

function Aviso({ texto, erro = false }: { readonly texto: string; readonly erro?: boolean }) {
  return (
    <Box
      // Marcado para o teste poder apontar o ERRO, e não qualquer texto que
      // contenha a mesma palavra: o SQL digitado está no campo acima, e um
      // seletor por texto casava com os dois — passando quando a resposta
      // demorava e falhando quando ela chegava a tempo.
      {...(erro ? { 'data-erro-tabela': true } : {})}
      sx={{
        flex: 1, p: 1.75, color: erro ? 'error.main' : 'text.secondary', fontSize: 12,
        whiteSpace: 'pre-wrap', fontFamily: erro ? tokens.fontMono : 'inherit',
      }}
    >
      {texto}
    </Box>
  );
}
