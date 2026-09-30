// O notebook `.brnb` numa aba (spec 112).
//
// Ele (30/09): *"uma espécie de sqlbook mas no estilo do Jupyter Notebook, que
// colocamos blocos e eles rodam em cascata… e o resultado de uma vai para a
// próxima"* — e decidiu que é feature SEPARADA do sqlbook, com um kernel por
// notebook. Este componente é a tela; o que o arquivo é mora em
// `shared/notebook/modelo.ts`.
//
// O kernel mora em `useKernelDoNotebook` e o rodar em `useExecucaoDoNotebook`;
// aqui fica o que é TELA: a barra, as células, e ler/gravar o arquivo.
//
// A verdade é o TEXTO em `aba.meta.content`, como no sqlbook: é o que faz o
// `Ctrl+S` gravar pelo caminho de sempre, sem ramo especial.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { CelulaDoNotebook } from './CelulaDoNotebook';
import { useKernelDoNotebook } from './useKernelDoNotebook';
import { useExecucaoDoNotebook } from './useExecucaoDoNotebook';
import type { Tab } from '../../shared/tabs';
import type { NomeDoTema } from '../../shared/temas';
import type { Vinculo } from '../../shared/sql/vinculo';
import {
  alterarCelula, escreverNotebook, inserirCelula, KERNELS, lerNotebook, limparSaidas,
  moverCelula, notebookNovo, removerCelula,
  type Kernel, type Notebook, type TipoDeCelula,
} from '../../shared/notebook/modelo';

export interface NotebookHostProps {
  readonly aba: Tab;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  onMudar(id: string, conteudo: string): void;
  /** Pergunta conexão e database. `null` quando ele desiste. */
  escolherConexao(atual: Vinculo | null): Promise<Vinculo | null>;
  /** "MySQL · loja" — o que a barra e a célula mostram. */
  rotuloDaConexao(v: Vinculo): string;
  /** A pasta de projeto que contém o notebook: o limite da busca por `.venv`. */
  readonly raiz: string | null;
  escolherOpcao(
    titulo: string,
    opcoes: readonly { readonly valor: string; readonly rotulo: string; readonly detalhe?: string }[]
  ): Promise<string | null>;
  pedirTexto(titulo: string, placeholder: string): Promise<string | null>;
}

const OUTRO_INTERPRETADOR = '\u0000outro';

const ROTULOS: Record<Kernel, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', php: 'PHP',
};

const novoId = (): string => crypto.randomUUID().slice(0, 8);

/** Lê sem lançar: o erro vira TELA, e não uma aba branca. */
function ler(conteudo: string): { readonly nb: Notebook | null; readonly erro: string | null } {
  try {
    return { nb: lerNotebook(conteudo), erro: null };
  } catch (e) {
    return { nb: null, erro: e instanceof Error ? e.message : String(e) };
  }
}

function Acao({ icone, rotulo, onClick }: { icone: string; rotulo: string; onClick: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5, border: 1, borderColor: 'divider',
        px: 1, py: 0.25, borderRadius: 0.5, cursor: 'pointer', fontSize: 11,
        bgcolor: 'transparent', color: 'text.secondary',
        '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
      }}
    >
      <Icon name={icone} size={13} />
      {rotulo}
    </Box>
  );
}

export function NotebookHost({
  aba, fontSize, tabSize, tema, onMudar, escolherConexao, rotuloDaConexao, raiz, escolherOpcao, pedirTexto,
}: NotebookHostProps) {
  const conteudo = String((aba.meta as { content?: string }).content ?? '');
  const inicial = useMemo(() => ler(conteudo), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nb, setNb] = useState<Notebook | null>(inicial.nb);
  const [erroDeLeitura, setErroDeLeitura] = useState<string | null>(inicial.erro);
  /** O último texto que ESTA tela escreveu — para não marcar sujo ao abrir. */
  const escrito = useRef(inicial.nb === null ? conteudo : escreverNotebook(inicial.nb));
  const atual = useRef(nb);
  atual.current = nb;

  // O arquivo mudou por fora (recarregado do disco): relê.
  useEffect(() => {
    if (conteudo === escrito.current) return;
    const lido = ler(conteudo);
    escrito.current = conteudo;
    setNb(lido.nb);
    setErroDeLeitura(lido.erro);
  }, [conteudo]);

  const atualizar = useCallback(
    (fazer: (n: Notebook) => Notebook) => {
      const antes = atual.current;
      if (antes === null) return;
      const depois = fazer(antes);
      atual.current = depois;
      setNb(depois);
      const texto = escreverNotebook(depois);
      if (texto !== escrito.current) {
        escrito.current = texto;
        onMudar(aba.id, texto);
      }
    },
    [aba.id, onMudar]
  );

  const comecar = (kernel: Kernel): void => {
    const novo = notebookNovo(kernel, null);
    atual.current = novo;
    setNb(novo);
    escrito.current = escreverNotebook(novo);
    onMudar(aba.id, escrito.current);
  };

  const caminho = (aba.meta as { path?: string | null }).path ?? null;
  const kernel = useKernelDoNotebook(caminho, nb?.kernel ?? 'python', raiz, nb?.laravel ?? false);
  const execucao = useExecucaoDoNotebook({ atual, atualizar, kernel, caminho });

  const escolherInterpretador = async (): Promise<void> => {
    // JS/TS roda no Node do próprio motor: não há o que escolher, e o ambiente
    // é o `node_modules` da pasta do notebook.
    if (nb?.kernel === 'javascript' || nb?.kernel === 'typescript') return;
    const candidatos = kernel.estado?.candidatos ?? [];
    const escolhido = await escolherOpcao('Com qual Python o notebook roda?', [
      ...candidatos.map((c) => ({ valor: c.caminho, rotulo: c.rotulo, detalhe: c.caminho })),
      { valor: OUTRO_INTERPRETADOR, rotulo: 'Outro interpretador…', detalhe: 'o caminho de um python' },
    ]);
    if (escolhido === null) return;
    const interpretador = escolhido === OUTRO_INTERPRETADOR
      ? await pedirTexto('Caminho do interpretador', '/caminho/para/.venv/bin/python')
      : escolhido;
    if (interpretador !== null && interpretador.trim() !== '') {
      await kernel.trocarInterpretador(interpretador.trim());
    }
  };

  const trocarConexao = async (celulaId: string | null): Promise<void> => {
    const n = atual.current;
    if (n === null) return;
    const antes = celulaId === null ? n.conexao : (n.celulas.find((c) => c.id === celulaId)?.conexao ?? n.conexao);
    const escolhida = await escolherConexao(antes);
    if (escolhida === null) return;
    atualizar((x) =>
      celulaId === null ? { ...x, conexao: escolhida } : alterarCelula(x, celulaId, { conexao: escolhida })
    );
  };

  if (erroDeLeitura !== null) {
    return (
      <Box data-notebook-erro sx={{ p: 3, color: 'error.main', fontSize: 13, whiteSpace: 'pre-wrap' }}>
        {erroDeLeitura}
      </Box>
    );
  }

  // Arquivo vazio (criado pela árvore): o notebook começa pela escolha do kernel.
  if (nb === null) {
    return (
      <Box data-notebook-escolher-kernel sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ fontSize: 15, fontWeight: 600 }}>Novo notebook — qual kernel?</Box>
        <Box sx={{ fontSize: 12, color: 'text.secondary' }}>
          As células de código do notebook são todas nesta linguagem. SQL e Markdown existem em qualquer
          kernel. O kernel não muda depois.
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {KERNELS.map((k) => (
            <Acao key={k} icone="lucide:notebook" rotulo={ROTULOS[k]} onClick={() => comecar(k)} />
          ))}
        </Box>
      </Box>
    );
  }

  const adicionar = (tipo: TipoDeCelula, posicao: number): void =>
    atualizar((x) => inserirCelula(x, tipo, posicao, novoId()));

  // Função, e não componente: um componente declarado dentro do render seria
  // outro a cada render, e o React desmontaria a linha a cada tecla.
  //
  // Entre células ela só aparece sob o mouse, como no Jupyter: sempre à vista,
  // uma fileira de botões entre cada célula pesava mais que o próprio código.
  // A do FIM fica sempre visível — é por onde se começa.
  const linhaDeAdicionar = (posicao: number) => (
    <Box
      data-adicionar={posicao}
      sx={{
        display: 'flex', gap: 0.5, justifyContent: 'center', py: 0.5,
        ...(posicao < nb.celulas.length
          ? { opacity: 0, transition: 'opacity 120ms', '&:hover, &:focus-within': { opacity: 1 } }
          : {}),
      }}
    >
      <Acao icone="lucide:plus" rotulo={ROTULOS[nb.kernel]} onClick={() => adicionar('codigo', posicao)} />
      <Acao icone="lucide:plus" rotulo="SQL" onClick={() => adicionar('sql', posicao)} />
      <Acao icone="lucide:plus" rotulo="Markdown" onClick={() => adicionar('markdown', posicao)} />
    </Box>
  );

  return (
    <Box data-notebook sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75,
          borderBottom: 1, borderColor: 'divider', fontSize: 12,
        }}
      >
        <Box data-kernel={nb.kernel} sx={{ fontWeight: 600 }}>{ROTULOS[nb.kernel]}</Box>
        {/* O ambiente: de onde vêm os pacotes. Clicar troca — antes de subir,
            clicar sobe o kernel para descobrir os candidatos. */}
        <Box
          component="button"
          type="button"
          aria-label="Interpretador do kernel"
          data-estado-do-kernel={
            kernel.subindo ? 'subindo' : kernel.estado === null ? 'parado' : execucao.rodando !== null ? 'ocupado' : 'ocioso'
          }
          onClick={() => void (kernel.estado === null ? kernel.garantir() : escolherInterpretador())}
          title={kernel.estado?.executavel ?? 'O kernel sobe na primeira célula que rodar'}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5, border: 0,
            bgcolor: 'transparent', cursor: 'pointer', fontSize: 12, color: 'text.secondary',
          }}
        >
          <Box
            component="span"
            sx={{
              width: 7, height: 7, borderRadius: '50%',
              bgcolor: kernel.estado === null ? 'text.disabled' : execucao.rodando !== null ? 'warning.main' : 'success.main',
            }}
          />
          {kernel.subindo
            ? 'subindo…'
            : kernel.estado === null
              ? 'kernel parado'
              : `${kernel.estado.interpretador.rotulo} · ${kernel.estado.versao}${kernel.estado.pandas ? ' · pandas' : ''}`}
        </Box>
        <Box
          component="button"
          type="button"
          aria-label="Conexão do notebook"
          onClick={() => void trocarConexao(null)}
          sx={{ border: 0, bgcolor: 'transparent', cursor: 'pointer', fontSize: 12, color: 'text.secondary' }}
        >
          {nb.conexao === null ? 'escolher conexão…' : rotuloDaConexao(nb.conexao)}
        </Box>
        {/* O Laravel: interruptor DESLIGADO por padrão, e o aviso ao lado quando
            ligado — é a única parte que sai da trava de somente-leitura. */}
        {nb.kernel === 'php' && kernel.estado?.laravelDisponivel === true && (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              component="button"
              type="button"
              role="switch"
              aria-checked={nb.laravel}
              aria-label="Subir a aplicação Laravel"
              title="Sobe a aplicação Laravel no kernel, como o tinker: Model::, DB:: e facades funcionam."
              onClick={() => {
                const ligado = !nb.laravel;
                atualizar((x) => ({ ...x, laravel: ligado }));
                void kernel.trocarLaravel(ligado);
              }}
              sx={{
                border: 1, borderColor: 'divider', borderRadius: 0.5, px: 0.75, py: 0.1,
                fontSize: 11, cursor: 'pointer', bgcolor: nb.laravel ? 'warning.main' : 'transparent',
                color: nb.laravel ? 'background.default' : 'text.secondary',
              }}
            >
              Laravel {nb.laravel ? 'ligado' : 'desligado'}
            </Box>
            {nb.laravel && (
              <Box data-aviso-laravel sx={{ fontSize: 11, color: 'warning.main' }}>
                ⚠ usa o banco do .env do projeto, fora da trava de somente-leitura da IDE
              </Box>
            )}
          </Box>
        )}
        {kernel.erro !== null && (
          <Box data-erro-do-kernel sx={{ color: 'error.main', fontSize: 11, maxWidth: 420 }} title={kernel.erro}>
            {kernel.erro}
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <Acao icone="lucide:fast-forward" rotulo="Rodar tudo" onClick={() => void execucao.rodarDesde(0)} />
        {execucao.rodando !== null && (
          <Acao icone="lucide:square" rotulo="Parar" onClick={() => void execucao.parar()} />
        )}
        {kernel.estado !== null && (
          <Acao icone="lucide:refresh-cw" rotulo="Reiniciar kernel" onClick={() => void kernel.reiniciar()} />
        )}
        <Acao icone="lucide:eraser" rotulo="Limpar saídas" onClick={() => atualizar((x) => limparSaidas(x))} />
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 3, py: 2 }}>
        {linhaDeAdicionar(0)}
        {nb.celulas.map((celula, i) => (
          <Box key={celula.id}>
            <CelulaDoNotebook
              celula={celula}
              kernel={nb.kernel}
              rodando={execucao.rodando === celula.id}
              rotuloDaConexao={
                (celula.conexao ?? nb.conexao) === null
                  ? 'sem conexão'
                  : rotuloDaConexao((celula.conexao ?? nb.conexao) as Vinculo)
              }
              fontSize={fontSize}
              tabSize={tabSize}
              tema={tema}
              onMudar={(m) => atualizar((x) => alterarCelula(x, celula.id, m))}
              onRodar={() => void execucao.rodarCelula(celula.id)}
              onRodarDesde={() => void execucao.rodarDesde(i)}
              onEscolherConexao={() => void trocarConexao(celula.id)}
              onUsarConexaoDoNotebook={() => atualizar((x) => alterarCelula(x, celula.id, { conexao: null }))}
              onLimparSaida={() => atualizar((x) => limparSaidas(x, celula.id))}
              onMover={(d) => atualizar((x) => moverCelula(x, celula.id, i + d))}
              onRemover={() => atualizar((x) => removerCelula(x, celula.id))}
            />
            {linhaDeAdicionar(i + 1)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
