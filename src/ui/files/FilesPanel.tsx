// Painel de arquivos: cabeçalho da pasta aberta e árvore.
//
// Puramente de apresentação — o estado vive em `usePasta`, porque a árvore, os
// símbolos e o botão de criar arquivo compartilham a mesma verdade.
//
// **Carrega um nível por vez** (spec 034), como a árvore de conexões — cada `>`
// clicado vira uma chamada ao servidor. Antes vinha tudo de uma vez, com teto
// global de nós, e uma `.venv` gastava o teto sozinha: a árvore chegava cortada
// e o conserto de então foi esconder pastas, o que era pior que o defeito.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ICONE_DE_PASTA, ICONE_DE_PASTA_ABERTA, iconeDeArquivo,
} from '../../shared/editor/arquivos';
import { linguagemDe } from '../useWorkspace';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';
import type { FileNode } from '../api';
import type { PastaAberta } from './usePasta';
import { TreeRow } from '../tree/TreeRow';
import { codificarCarga, MIME_DE_ARRASTE } from '../../shared/arrastar';

export interface FilesPanelProps {
  readonly pasta: PastaAberta;
  readonly onAbrirArquivo: (caminho: string) => Promise<void>;
  readonly caminhoAtivo: string | null;
  /** Sobem para o App: quem pergunta é a entrada rápida. */
  readonly onAbrirPasta: () => void;
  readonly onNovoArquivo: () => void;
  readonly onNovaPasta: () => void;
  readonly onErro: (erro: unknown) => void;
  /** Botão direito num item da árvore (T043) — quem monta o menu é o `App`. */
  readonly onMenuDoItem: (no: FileNode, e: React.MouseEvent) => void;
  /** Botão direito no cabeçalho de uma RAIZ (T004). */
  readonly onMenuDaRaiz: (pasta: string, e: React.MouseEvent) => void;
  /** O menu do vazio abaixo da árvore (spec 077). */
  readonly onMenuDoVazio: (e: React.MouseEvent) => void;
  /** Soma outra pasta ao espaço de trabalho (T004). */
  readonly onAcrescentarPasta: () => void;
  /** `F2` e `Delete` no item selecionado — os mesmos fluxos do menu. */
  readonly onRenomear: (no: FileNode) => void;
  readonly onExcluir: (no: FileNode) => void;
}

export function FilesPanel({
  pasta, onAbrirArquivo, caminhoAtivo, onAbrirPasta, onNovoArquivo, onNovaPasta, onErro,
  onMenuDoItem, onMenuDaRaiz, onMenuDoVazio, onAcrescentarPasta, onRenomear, onExcluir,
}: FilesPanelProps) {
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  /**
   * O item SELECIONADO — diferente do arquivo aberto (T043).
   *
   * `F2` e `Delete` precisam de um alvo, e o arquivo aberto não serve: uma
   * pasta nunca é "aberta", e clicar numa pasta para renomeá-la deixaria as
   * teclas apontando para o último arquivo aberto. Duas perguntas diferentes,
   * dois estados.
   */
  const [selecionado, setSelecionado] = useState<FileNode | null>(null);
  /** Pastas cujo conteúdo está sendo pedido agora — a linha mostra "…". */
  const [carregando, setCarregando] = useState<ReadonlySet<string>>(new Set());

  /** Pedidos em voo, para o efeito não disparar dois pelo mesmo caminho. */
  const pedidos = useRef(new Set<string>());
  /**
   * Pastas cujo pedido FALHOU — não se pede de novo sozinho.
   *
   * O efeito abaixo é declarativo: "aberta e sem filhos significa vai buscar".
   * Quando a busca falha, os filhos seguem ausentes e a condição continua
   * verdadeira, então ele pedia outra vez, e outra, sem parar — com o "…"
   * acendendo e apagando. Era metade do "abre fecha abre fecha" que ele viu no
   * Windows (a outra metade era o caminho, em D223). Fechar e reabrir a pasta
   * limpa a marca e tenta de novo, que é o gesto natural de quem quer insistir.
   */
  const falharam = useRef(new Set<string>());
  /**
   * Raízes recolhidas (T004).
   *
   * Guardadas como as FECHADAS, e não como as abertas: assim uma raiz nova
   * nasce aberta, que é o que se espera de uma pasta que se acabou de
   * acrescentar.
   */
  const [raizesFechadas, setRaizesFechadas] = useState<ReadonlySet<string>>(new Set());

  const alternar = useCallback((no: FileNode) => {
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(no.path)) proximo.delete(no.path);
      else {
        // Reabrir é o pedido de tentar de novo depois de uma falha.
        falharam.current.delete(no.path);
        proximo.add(no.path);
      }
      return proximo;
    });
  }, []);

  /**
   * Garante que toda pasta ABERTA tenha o conteúdo dela.
   *
   * Não basta carregar ao clicar: `recarregar()` devolve só o primeiro nível, e
   * qualquer coisa que o chame — salvar um arquivo, criar uma pasta, trocar de
   * projeto — apagava os filhos de tudo que estava aberto. A pasta continuava
   * com o `v` de aberta e o conteúdo sumia, sem ninguém ter fechado nada.
   *
   * Aqui a regra é declarativa: aberta e sem filhos significa "vai buscar".
   * O clique só mexe no conjunto de abertas; quem busca é este efeito.
   */
  useEffect(() => {
    const faltando: string[] = [];
    const procurar = (nos: readonly FileNode[]): void => {
      for (const no of nos) {
        if (no.type !== 'dir' || !abertas.has(no.path)) continue;
        if (no.children === undefined) faltando.push(no.path);
        else procurar(no.children);
      }
    };
    for (const raiz of pasta.raizes) procurar(raiz.arvore);

    for (const caminho of faltando) {
      if (pedidos.current.has(caminho) || falharam.current.has(caminho)) continue;
      pedidos.current.add(caminho);
      setCarregando((atual) => new Set(atual).add(caminho));
      pasta
        .carregarFilhos(caminho)
        .catch((e: unknown) => {
          falharam.current.add(caminho);
          onErro(e);
        })
        .finally(() => {
          pedidos.current.delete(caminho);
          setCarregando((atual) => {
            const proximo = new Set(atual);
            proximo.delete(caminho);
            return proximo;
          });
        });
    }
  }, [abertas, onErro, pasta]);

  /** Um botão do cabeçalho: ícone só, com o nome na dica e no rótulo. */
  const acao = (rotulo: string, icone: string, aoClicar: () => void): React.ReactNode => (
    <Tooltip key={rotulo} title={rotulo} placement="bottom">
      <Box
        component="button"
        type="button"
        aria-label={rotulo}
        onClick={aoClicar}
        sx={{
          border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer',
          p: 0.3, display: 'flex', borderRadius: 0.5,
          '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
        }}
      >
        <Icon name={icone} size={14} />
      </Box>
    </Tooltip>
  );

  const abrir = useCallback(
    (caminho: string) => {
      onAbrirArquivo(caminho).catch(onErro);
    },
    [onAbrirArquivo, onErro]
  );

  const renderizar = (nos: readonly FileNode[], nivel: number): React.ReactNode =>
    nos.map((no) => {
      const aberta = abertas.has(no.path);
      return (
        <Box key={no.path}>
          <TreeRow
            nivel={nivel}
            rotulo={no.name}
            icone={
              no.type === 'dir'
                ? (aberta ? ICONE_DE_PASTA_ABERTA : ICONE_DE_PASTA)
                : iconeDeArquivo(no.path, linguagemDe(no.path))
            }
            expansivel={no.type === 'dir'}
            aberto={aberta}
            ativo={no.path === caminhoAtivo || no.path === selecionado?.path}
            // Cinza e itálico com um significado exato: a IDE não indexa isto.
            // Continua abrindo, arrastando e editando como qualquer outro.
            esmaecido={no.ignored === true}
            titulo={no.ignored === true ? `${no.path} — ignorado pelo .gitignore` : no.path}
            onClick={() => {
              setSelecionado(no);
              if (no.type === 'dir') alternar(no);
              else abrir(no.path);
            }}
            onContextMenu={(e) => {
              // Selecionar ANTES de abrir o menu: sem isso, o item do menu e o
              // que a tecla `Delete` pega poderiam ser dois itens diferentes.
              setSelecionado(no);
              onMenuDoItem(no, e);
            }}
            // Pasta também arrasta desde o T090: o destino é o SFTP, que sobe
            // o conteúdo dela. Quem não sabe o que fazer com pasta — o editor —
            // olha a marca `pasta` e recusa, em vez de tentar abrir um diretório.
            aoArrastar={(e) => {
              e.dataTransfer.setData(
                MIME_DE_ARRASTE,
                codificarCarga({
                  tipo: 'arquivo',
                  caminho: no.path,
                  ...(no.type === 'dir' ? { pasta: true } : {}),
                })
              );
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
          />
          {no.type === 'dir' && aberta && no.children !== undefined
            ? renderizar(no.children, nivel + 1)
            : null}
          {no.type === 'dir' && aberta && carregando.has(no.path) ? (
            <Box
              sx={{
                pl: `${(nivel + 1) * 12 + 20}px`, py: 0.2,
                color: 'text.secondary', fontSize: 11,
              }}
            >
              …
            </Box>
          ) : null}
        </Box>
      );
    });

  if (pasta.erro !== null) {
    return <Box sx={{ p: 1.25, color: 'error.main', fontSize: 11 }}>{pasta.erro}</Box>;
  }

  // Sem pasta aberta a IDE não finge ter uma: diz o que é e oferece a saída.
  if (pasta.pasta === '') {
    return (
      <Box sx={{ px: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.6 }}>
          Nenhuma pasta aberta.
        </Box>
        <Button variant="outlined" size="small" onClick={onAbrirPasta} sx={{ fontSize: 11 }}>
          Abrir pasta…
        </Button>
      </Box>
    );
  }

  return (
    <Box
      data-painel-de-arquivos
      // `flex: 1` para o painel OCUPAR a lateral inteira. Sem isto ele
      // encolhia até a última linha, e o vazio abaixo dele pertencia à barra —
      // que não tem menu nenhum. Era esse o defeito que ele achou: ali o botão
      // direito não fazia nada, e o menu do Chrome aparecia por cima da IDE.
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      // O menu do vazio fica AQUI, e não na lista: é este elemento que possui
      // o espaço em branco. A linha tem `onContextMenu` própria e o
      // `abrirMenu` faz `stopPropagation`, então as duas não se atropelam.
      onContextMenu={onMenuDoVazio}
    >
      <Box
        sx={{
          px: 1, pb: 0.75, display: 'flex', gap: 0.5, alignItems: 'center', minWidth: 0,
          // Só aparecem ao passar o mouse, como no VS Code — e ao receber
          // foco, senão quem navega pelo teclado nunca as alcança.
          '& .acoes-da-arvore': { opacity: 0, transition: 'opacity 120ms' },
          '&:hover .acoes-da-arvore, &:focus-within .acoes-da-arvore': { opacity: 1 },
        }}
      >
        <Tooltip title={pasta.raizes.map((r) => r.pasta).join('\n')} placement="bottom-start">
          <Box
            data-pasta-aberta={pasta.pasta}
            sx={{
              flex: 1, minWidth: 0, fontSize: 11, textTransform: 'uppercase',
              letterSpacing: 0.5, color: 'text.secondary',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {/* Com várias raízes o cabeçalho deixa de nomear UMA pasta: o nome
                de cada uma passa a estar na linha dela. */}
            {pasta.raizes.length > 1 ? 'espaço de trabalho' : pasta.nome}
          </Box>
        </Tooltip>
        {/* As quatro do VS Code, na ordem dele. Abrir pasta NÃO fica aqui:
            mora em File → Open Folder, e ter o mesmo comando em dois lugares
            só faz a barra parecer cheia. */}
        <Box className="acoes-da-arvore" sx={{ display: 'flex', gap: 0.25 }}>
          {acao('Novo arquivo', 'lucide:file-plus', onNovoArquivo)}
          {acao('Nova pasta', 'lucide:folder-plus', onNovaPasta)}
          {acao('Adicionar pasta ao espaço', 'lucide:folder-symlink', onAcrescentarPasta)}
          {acao('Recarregar', 'lucide:refresh-cw', () => {
            pasta.recarregar().catch(onErro);
          })}
          {acao('Recolher tudo', 'lucide:list-collapse', () => {
            setAbertas(new Set());
            setRaizesFechadas(new Set());
          })}
        </Box>
      </Box>

      {pasta.truncada && (
        // Desde a spec 034 isto é raro: o teto passou a ser por PASTA, e só
        // dispara num diretório com mais de 5.000 entradas. Continua sendo dito
        // porque lista cortada em silêncio parece pasta que acabou.
        <Box
          data-arvore-truncada
          sx={{ px: 1.25, pb: 0.5, color: 'warning.main', fontSize: 10, lineHeight: 1.4 }}
        >
          Esta pasta tem entradas demais para listar por inteiro.
        </Box>
      )}

      <Box
        data-arvore
        sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}
        // `tabIndex` porque uma `div` não recebe tecla sem ele — e sem foco na
        // árvore, `F2` e `Delete` seriam atalhos globais roubando o editor.
        tabIndex={-1}
        onKeyDown={(e) => {
          if (selecionado === null) return;
          if (e.key === 'F2') {
            e.preventDefault();
            onRenomear(selecionado);
          } else if (e.key === 'Delete') {
            e.preventDefault();
            onExcluir(selecionado);
          }
        }}
      >
        {/*
          Com UMA raiz, a árvore é ela — exatamente a tela de antes do T004. Com
          mais de uma, cada raiz ganha um cabeçalho que abre e fecha: sem ele
          não haveria como saber de qual projeto é o `src/` que se está vendo.
        */}
        {pasta.raizes.length <= 1 ? (
          (pasta.raizes[0]?.arvore.length ?? 0) === 0 ? (
            <Box sx={{ px: 1.25, color: 'text.secondary', fontSize: 11 }}>
              pasta vazia — crie um arquivo
            </Box>
          ) : (
            renderizar(pasta.raizes[0]?.arvore ?? [], 0)
          )
        ) : (
          pasta.raizes.map((raiz) => {
            const aberta = !raizesFechadas.has(raiz.pasta);
            return (
              <Box key={raiz.pasta} data-raiz={raiz.pasta}>
                <TreeRow
                  nivel={0}
                  rotulo={raiz.nome}
                  icone={aberta ? ICONE_DE_PASTA_ABERTA : ICONE_DE_PASTA}
                  expansivel
                  aberto={aberta}
                  titulo={raiz.pasta}
                  onClick={() =>
                    setRaizesFechadas((atual) => {
                      const proximo = new Set(atual);
                      if (proximo.has(raiz.pasta)) proximo.delete(raiz.pasta);
                      else proximo.add(raiz.pasta);
                      return proximo;
                    })
                  }
                  onContextMenu={(e) => onMenuDaRaiz(raiz.pasta, e)}
                />
                {aberta && raiz.arvore.length === 0 ? (
                  <Box sx={{ pl: 4, py: 0.2, color: 'text.secondary', fontSize: 11 }}>
                    pasta vazia
                  </Box>
                ) : null}
                {aberta ? renderizar(raiz.arvore, 1) : null}
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
