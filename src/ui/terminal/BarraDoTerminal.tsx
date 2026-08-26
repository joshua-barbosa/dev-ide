// A barra da aba de terminal (spec 058).
//
// Na ferramenta de referência ela fica no alto e à direita, e só na sub-aba
// Terminal: `Snippets`, `Reconnect`, `Duplicate`, `Settings`. Aqui o terminal
// abre em aba própria, então a barra é da aba — mesmo lugar relativo, mesma
// função.
//
// **`Snippets` é o item que ele mesmo questionou** e depois aceitou: no banco a
// pasta `Query` (spec 038) já cobria a necessidade, e por isso o comando salvo
// saiu na spec 039. Num terminal não há pasta `Query`, e o argumento não vale.
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import { Api } from '../api';
import { foiMexida, type AparenciaDoTerminal } from '../../shared/terminal/aparencia';
import { PainelDeAparenciaDoTerminal } from './PainelDeAparenciaDoTerminal';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import type { SnippetDeTerminal } from '../../shared/terminal/snippets';

export interface BarraDoTerminalProps {
  /** A chave dos snippets. O terminal geral tem a dele. */
  readonly conexaoId: string;
  /** Manda o comando para o terminal, como se tivesse sido digitado. */
  onEnviar(comando: string): void;
  onReconectar(): void;
  onDuplicar(): void;
  /** Pergunta um texto ao usuário — a entrada rápida da IDE. */
  pedir(opcoes: { titulo: string; placeholder: string; valorInicial?: string }): Promise<string | null>;
  confirmar(opcoes: { mensagem: string; rotuloConfirmar?: string; destrutivo?: boolean }): Promise<boolean>;
  onErro(erro: unknown): void;
  /**
   * Esconde `Reconectar` e `Duplicar` (T087).
   *
   * No painel de baixo os dois JÁ EXISTEM na gestão de terminais dele, e
   * repeti-los aqui daria dois botões para a mesma coisa a dois centímetros um
   * do outro. O que faltava lá eram os snippets.
   */
  readonly soSnippets?: boolean;
  /** A aparência DESTE terminal, e como mudá-la (T086). */
  readonly aparencia?: AparenciaDoTerminal;
  readonly onAparencia?: (nova: AparenciaDoTerminal) => void;
  /**
   * Abre um arquivo no editor, para o `{}` (T085).
   *
   * Ausente no terminal do painel de baixo, que não tem para onde abrir sem
   * roubar o foco da coisa que o usuário está fazendo.
   */
  abrirArquivo?(caminho: string): Promise<void>;
}

export function BarraDoTerminal({
  conexaoId, onEnviar, onReconectar, onDuplicar, pedir, confirmar, onErro, abrirArquivo,
  soSnippets = false, aparencia, onAparencia,
}: BarraDoTerminalProps) {
  const [ancora, setAncora] = useState<HTMLElement | null>(null);
  const [ancoraDoVisual, setAncoraDoVisual] = useState<HTMLElement | null>(null);
  const [snippets, setSnippets] = useState<readonly SnippetDeTerminal[]>([]);

  useEffect(() => {
    Api.snippetsDoTerminal(conexaoId).then(setSnippets).catch(onErro);
  }, [conexaoId, onErro]);

  /**
   * Pergunta nome e comando.
   *
   * Duas caixas em sequência, e não um formulário: a entrada rápida da IDE
   * pergunta uma coisa por vez, e inventar um diálogo próprio para dois campos
   * traria uma segunda forma de pedir texto para a IDE manter.
   */
  const perguntar = async (
    atual?: SnippetDeTerminal
  ): Promise<{ nome: string; comando: string } | null> => {
    const nome = await pedir({
      titulo: atual === undefined ? 'Novo snippet' : `Editar "${atual.nome}"`,
      placeholder: 'nome do snippet',
      valorInicial: atual?.nome,
    });
    if (nome === null || nome.trim() === '') return null;
    const comando = await pedir({
      titulo: `Comando de "${nome.trim()}"`,
      placeholder: 'ex.: du -h -d 1 | sort -h',
      valorInicial: atual?.comando,
    });
    if (comando === null || comando.trim() === '') return null;
    return { nome: nome.trim(), comando: comando.trim() };
  };

  const salvar = async (atual?: SnippetDeTerminal): Promise<void> => {
    const dados = await perguntar(atual);
    if (dados === null) return;
    setSnippets(
      await Api.guardarSnippetDeTerminal(conexaoId, { ...dados, ...(atual && { id: atual.id }) })
    );
  };

  const apagar = async (s: SnippetDeTerminal): Promise<void> => {
    if (!(await confirmar({
      mensagem: `Apagar o snippet "${s.nome}"?`,
      rotuloConfirmar: 'Apagar',
      destrutivo: true,
    }))) {
      return;
    }
    setSnippets(await Api.apagarSnippetDeTerminal(conexaoId, s.id));
  };

  const chamar = (acao: () => Promise<unknown>) => () => {
    acao().catch(onErro);
  };

  return (
    <Box
      data-barra-do-terminal
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.25, px: 0.75, py: 0.25,
        borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0,
      }}
    >
      <Box sx={{ flex: 1 }} />
      {/* Aparência DESTE terminal (T086). Eu tinha recusado dizendo que a IDE
          já tem as chaves no `config.json` — o argumento vale para
          preferência, e não é disso que se trata: com N terminais abertos, ele
          quer DISTINGUIR um dos outros. Some no F5, e herda o arquivo. */}
      {onAparencia !== undefined && aparencia !== undefined && (
        <Acao
          icone="lucide:sliders-horizontal"
          rotulo={foiMexida(aparencia) ? 'Aparência deste terminal (mexida)' : 'Aparência deste terminal'}
          onClick={(e) => setAncoraDoVisual(e.currentTarget)}
        />
      )}
      <Acao
        icone="lucide:code"
        rotulo="Snippets"
        onClick={(e) => setAncora(e.currentTarget)}
      />
      {/* O `{}` do print dele (T085): abre o arquivo de snippets no editor.
          Eu tinha chutado duas vezes o que este botão fazia — ele respondeu
          que é editar o `snippets.json` daquele servidor. */}
      {abrirArquivo !== undefined && (
        <Acao
          icone="lucide:braces"
          rotulo="Editar o arquivo de snippets (todas as conexões)"
          onClick={chamar(async () => {
            const { path } = await Api.arquivoDeSnippetsDeTerminal();
            await abrirArquivo(path);
          })}
        />
      )}
      {!soSnippets && (
        <>
          <Acao icone="lucide:zap" rotulo="Reconectar" onClick={onReconectar} />
          <Acao icone="lucide:copy" rotulo="Duplicar terminal" onClick={onDuplicar} />
        </>
      )}

      {onAparencia !== undefined && aparencia !== undefined && (
        <PainelDeAparenciaDoTerminal
          ancora={ancoraDoVisual}
          aparencia={aparencia}
          onMudar={onAparencia}
          onFechar={() => setAncoraDoVisual(null)}
        />
      )}

      <Popover
        open={ancora !== null}
        anchorEl={ancora}
        onClose={() => setAncora(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box data-lista-de-snippets sx={{ p: 1, minWidth: 300, maxWidth: 460 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Box sx={{ fontSize: 12 }}>Snippets</Box>
            <Box sx={{ ml: 'auto' }}>
              <Acao icone="lucide:plus" rotulo="Novo snippet" onClick={chamar(() => salvar())} />
            </Box>
          </Box>

          {snippets.length === 0 && (
            <Box sx={{ fontSize: 11.5, color: 'text.secondary', px: 0.5, py: 1 }}>
              Nenhum snippet nesta conexão.
            </Box>
          )}

          {snippets.map((s) => (
            <Box
              key={s.id}
              data-snippet={s.nome}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.5,
                borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ overflow: 'hidden' }}>
                <Box sx={{ fontSize: 12 }}>{s.nome}</Box>
                <Box
                  sx={{
                    fontFamily: tokens.fontMono, fontSize: 10.5, color: 'text.secondary',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {s.comando}
                </Box>
              </Box>
              <Box sx={{ ml: 'auto', display: 'flex', gap: 0.25 }}>
                <Acao
                  icone="lucide:play"
                  rotulo={`Rodar ${s.nome}`}
                  onClick={() => {
                    // Fecha ANTES de enviar: o popover rouba o foco do
                    // terminal, e o comando chegaria numa tela que não está
                    // olhando para o teclado.
                    setAncora(null);
                    onEnviar(s.comando);
                  }}
                />
                <Acao
                  icone="lucide:pencil"
                  rotulo={`Editar ${s.nome}`}
                  onClick={chamar(() => salvar(s))}
                />
                <Acao
                  icone="lucide:trash-2"
                  rotulo={`Apagar ${s.nome}`}
                  onClick={chamar(() => apagar(s))}
                />
              </Box>
            </Box>
          ))}
        </Box>
      </Popover>
    </Box>
  );
}

function Acao({
  icone, rotulo, onClick,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      sx={{
        border: 0, bgcolor: 'transparent', color: 'text.secondary', p: 0.4, borderRadius: 0.5,
        display: 'flex', cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
      }}
    >
      <Icon name={icone} size={13} />
    </Box>
  );
}
