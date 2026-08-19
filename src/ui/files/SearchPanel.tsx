// Painel de busca e substituição, na lateral.
//
// Fecha os quatro últimos itens cinzas do menu: `Find in Files`,
// `Replace in Files` e o painel `Search` são a mesma feature vista de dois
// lugares, e sempre foram — o backlog já dizia isso.
//
// Nada de lógica de casamento aqui: o que decide o que casa mora em
// `shared/busca.ts`, e quem varre é o servidor. Este arquivo é formulário,
// lista e dois botões perigosos.
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import type { Ocorrencia } from '../../shared/busca';
import type { Busca } from './useBusca';

export interface SearchPanelProps {
  readonly busca: Busca;
  /** Abre o arquivo na linha e coluna da ocorrência. */
  readonly onAbrir: (caminho: string, ocorrencia: Ocorrencia) => void;
  /** Confirma antes de reescrever arquivos. */
  readonly onConfirmar: (mensagem: string, rotulo: string) => Promise<boolean>;
}

/** Recorta a linha em volta da ocorrência, para caber na lateral estreita. */
function trecho(o: Ocorrencia): { antes: string; casado: string; depois: string } {
  const inicio = Math.max(0, o.coluna - 1 - 24);
  return {
    antes: (inicio > 0 ? '…' : '') + o.texto.slice(inicio, o.coluna - 1),
    casado: o.texto.slice(o.coluna - 1, o.colunaFim - 1),
    depois: o.texto.slice(o.colunaFim - 1, o.colunaFim - 1 + 60),
  };
}

const nomeDe = (caminho: string): string => caminho.split('/').pop() ?? caminho;

export function SearchPanel({ busca, onAbrir, onConfirmar }: SearchPanelProps) {
  const [recolhidos, setRecolhidos] = useState<ReadonlySet<string>>(new Set());

  const alternar = (caminho: string): void => {
    setRecolhidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(caminho)) proximo.delete(caminho);
      else proximo.add(caminho);
      return proximo;
    });
  };

  const alternador = (
    titulo: string,
    rotulo: string,
    ligado: boolean,
    aoClicar: () => void
  ): React.ReactNode => (
    <Tooltip title={titulo} placement="bottom">
      <Box
        component="button"
        type="button"
        aria-label={rotulo}
        aria-pressed={ligado}
        onClick={aoClicar}
        sx={{
          border: 1,
          borderColor: ligado ? 'primary.main' : 'transparent',
          bgcolor: ligado ? 'action.selected' : 'transparent',
          color: ligado ? 'primary.main' : 'text.secondary',
          font: 'inherit',
          fontFamily: tokens.fontMono,
          fontSize: 11,
          px: 0.6,
          py: 0.1,
          borderRadius: 0.5,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {rotulo}
      </Box>
    </Tooltip>
  );

  const campo = (
    valor: string,
    placeholder: string,
    rotulo: string,
    aoMudar: (v: string) => void,
    /** Só o campo de pesquisa fica vermelho: quem não compila é a expressão. */
    marcaInvalido = false
  ): React.ReactNode => (
    <InputBase
      value={valor}
      placeholder={placeholder}
      onChange={(e) => aoMudar(e.target.value)}
      inputProps={{ 'aria-label': rotulo }}
      endAdornment={
        // Só existe com algo escrito: um X permanente num campo vazio é ruído,
        // e ainda por cima clicável sem efeito.
        valor === '' ? null : (
          <Tooltip title={`Limpar ${rotulo.toLowerCase()}`} placement="bottom">
            <Box
              component="button"
              type="button"
              aria-label={`Limpar ${rotulo.toLowerCase()}`}
              onClick={() => aoMudar('')}
              sx={{
                border: 0,
                bgcolor: 'transparent',
                color: 'text.secondary',
                cursor: 'pointer',
                p: 0.2,
                mr: -0.3,
                display: 'flex',
                flexShrink: 0,
                '&:hover': { color: 'text.primary' },
              }}
            >
              <Icon name="lucide:x" size={12} />
            </Box>
          </Tooltip>
        )
      }
      sx={{
        flex: 1,
        fontSize: 12,
        fontFamily: tokens.fontMono,
        border: 1,
        borderColor: marcaInvalido && busca.termoInvalido ? 'error.main' : 'divider',
        borderRadius: 0.5,
        px: 0.75,
        py: 0.2,
        bgcolor: tokens.bgEditor,
      }}
    />
  );

  const substituirEm = async (caminhos: readonly string[], quantos: number): Promise<void> => {
    const ok = await onConfirmar(
      `Substituir "${busca.termo}" por "${busca.substituto}" em ${quantos} ocorrência(s), ` +
        `em ${caminhos.length} arquivo(s).\n\nIsto reescreve os arquivos em disco.`,
      'substituir'
    );
    if (ok) await busca.substituir(caminhos);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ px: 1, pb: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {campo(busca.termo, 'Pesquisar', 'Pesquisar', busca.definirTermo, true)}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          {alternador('Diferenciar maiúsculas', 'Aa', busca.opcoes.maiusculas, () =>
            busca.alternarOpcao('maiusculas')
          )}
          {alternador('Palavra inteira', 'ab', busca.opcoes.palavraInteira, () =>
            busca.alternarOpcao('palavraInteira')
          )}
          {alternador('Expressão regular', '.*', busca.opcoes.regex, () =>
            busca.alternarOpcao('regex')
          )}
          {busca.termoInvalido && (
            <Box sx={{ color: 'error.main', fontSize: 10 }}>expressão inválida</Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {campo(busca.substituto, 'Substituir por', 'Substituir por', busca.definirSubstituto)}
          <Tooltip title="Substituir em todos os arquivos encontrados" placement="bottom">
            <Box component="span">
              <Button
                disabled={busca.resultado.arquivos.length === 0}
                onClick={() =>
                  void substituirEm(
                    busca.resultado.arquivos.map((a) => a.caminho),
                    busca.resultado.totalDeOcorrencias
                  )
                }
                aria-label="Substituir em todos"
                sx={{ minWidth: 28, px: 0.5 }}
              >
                <Icon name="lucide:replace-all" size={13} />
              </Button>
            </Box>
          </Tooltip>
        </Box>
      </Box>

      <Box
        data-resumo-busca
        sx={{ px: 1.25, pb: 0.5, color: 'text.secondary', fontSize: 11, minHeight: 18 }}
      >
        {busca.carregando
          ? 'procurando…'
          : busca.termo.trim() === ''
            ? ''
            : busca.resultado.totalDeOcorrencias === 0
              ? 'Nenhum resultado.'
              : `${busca.resultado.totalDeOcorrencias} em ${busca.resultado.arquivos.length} arquivo(s)` +
                (busca.resultado.truncado ? ' — lista cortada' : '')}
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {busca.resultado.arquivos.map((arquivo) => {
          const fechado = recolhidos.has(arquivo.caminho);
          return (
            <Box key={arquivo.caminho}>
              <Box
                data-arquivo-busca={nomeDe(arquivo.caminho)}
                onClick={() => alternar(arquivo.caminho)}
                title={arquivo.caminho}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.3,
                  fontSize: 11.5, cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                  '&:hover .acao-arquivo': { opacity: 1 },
                }}
              >
                <Icon name={fechado ? 'lucide:chevron-right' : 'lucide:chevron-down'} size={12} />
                <Box sx={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {nomeDe(arquivo.caminho)}
                </Box>
                <Box sx={{ color: 'text.secondary', fontSize: 10 }}>
                  {arquivo.ocorrencias.length}
                </Box>
                <Tooltip title="Substituir neste arquivo" placement="left">
                  <Box
                    className="acao-arquivo"
                    component="button"
                    type="button"
                    aria-label={`Substituir em ${nomeDe(arquivo.caminho)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void substituirEm([arquivo.caminho], arquivo.ocorrencias.length);
                    }}
                    sx={{
                      border: 0, bgcolor: 'transparent', color: 'text.secondary',
                      cursor: 'pointer', p: 0.2, display: 'flex', opacity: 0,
                      '&:hover': { color: 'text.primary' },
                    }}
                  >
                    <Icon name="lucide:replace" size={12} />
                  </Box>
                </Tooltip>
              </Box>

              {!fechado &&
                arquivo.ocorrencias.map((o, i) => {
                  const t = trecho(o);
                  return (
                    <Box
                      key={`${o.linha}:${o.coluna}:${i}`}
                      data-ocorrencia={`${nomeDe(arquivo.caminho)}:${o.linha}`}
                      onClick={() => onAbrir(arquivo.caminho, o)}
                      title={`Linha ${o.linha}, coluna ${o.coluna}`}
                      sx={{
                        display: 'flex', gap: 0.5, pl: 3, pr: 1, py: 0.15,
                        fontFamily: tokens.fontMono, fontSize: 11,
                        cursor: 'pointer', whiteSpace: 'pre', overflow: 'hidden',
                        color: 'text.secondary',
                        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                      }}
                    >
                      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden' }}>
                        {t.antes}
                        <Box
                          component="span"
                          sx={{ bgcolor: 'primary.main', color: 'background.default' }}
                        >
                          {t.casado}
                        </Box>
                        {t.depois}
                      </Box>
                    </Box>
                  );
                })}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
