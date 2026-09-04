// A tabela SFTP, estilo FileZilla (spec 055).
//
// É a MESMA coisa que a árvore da lateral vê — o mesmo `RemoteFiles` —, com
// outro gesto: lá se navega em profundidade, aqui se navega uma pasta por vez,
// com colunas, ordenação e o caminho corrente à vista. As duas superfícies
// existem porque servem a dois usos, e nascem do mesmo lugar para não
// divergirem.
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { Api } from '../api';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { paiDe } from '../../shared/remoto/caminho';
import { ordenarPorColuna, type ColunaDeOrdem, type Direcao } from '../../shared/remoto/ordenacao';
import { useUpload } from './useUpload';
import { useDownloadDePasta } from './useDownloadDePasta';
import type { EntradaMenu } from '../ContextMenu';
import { decodificarCarga, MIME_DE_ARRASTE } from '../../shared/arrastar';
import type { RemoteEntry } from '../../shared/contracts';
import { baixarArquivo as entregarArquivo } from '../arquivos/transferencia';

interface Coluna {
  readonly id: ColunaDeOrdem;
  readonly rotulo: string;
  readonly largura: string;
  readonly alinhar?: 'right';
}

const COLUNAS: readonly Coluna[] = [
  { id: 'nome', rotulo: 'NAME', largura: '1fr' },
  { id: 'tamanho', rotulo: 'SIZE', largura: '110px', alinhar: 'right' },
  { id: 'modificado', rotulo: 'MODIFIED', largura: '190px' },
  { id: 'tipo', rotulo: 'KIND', largura: '90px' },
  { id: 'dono', rotulo: 'OWNER', largura: '150px' },
];

const GRADE = COLUNAS.map((c) => c.largura).join(' ');

function tamanhoLegivel(bytes: number | null): string {
  if (bytes === null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ['KB', 'MB', 'GB', 'TB'];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toFixed(2)} ${unidades[i]}`;
}

function quando(ms: number | null): string {
  if (ms === null) return '--';
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** O que a coluna `KIND` mostra — a extensão, como na ferramenta de referência. */
function tipoLegivel(entrada: RemoteEntry): string {
  if (entrada.kind === 'folder') return 'folder';
  if (entrada.kind === 'link') return 'link';
  const nome = entrada.name;
  const ponto = nome.lastIndexOf('.');
  return ponto > 0 ? nome.slice(ponto + 1) : 'file';
}

export interface SftpPanelProps {
  readonly conexaoId: string;
  /** Onde abrir. Vem da sessão — não é sempre `/` (spec 055). */
  readonly raiz: string;
  readonly somenteLeitura: boolean;
  onAbrirArquivo(conexaoId: string, caminho: string): Promise<void>;
  /** Abre o menu de botão direito nas coordenadas do cursor (T079). */
  abrirMenu(e: React.MouseEvent, entradas: readonly EntradaMenu[]): void;
  /** Pergunta antes do que não tem volta — apagar no servidor DELE (T079). */
  confirmar(o: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
  /**
   * Pergunta um texto — nome novo, permissões, nome de arquivo.
   *
   * Chega por props, e não por `window.prompt`, por dois motivos que apontam
   * para o mesmo lado: dentro da webview do editor o `prompt` devolve `null`
   * calado, e na IDE quem pergunta é a entrada rápida, que já existe. Quem
   * monta a tela decide qual caixa aparece.
   */
  pedirTexto(o: {
    titulo: string;
    valorInicial?: string;
  }): Promise<string | null>;
  onErro(erro: unknown): void;
}

export function SftpPanel({
  conexaoId, raiz, somenteLeitura, onAbrirArquivo, abrirMenu, confirmar, pedirTexto, onErro,
}: SftpPanelProps) {
  const [caminho, setCaminho] = useState(raiz);
  const [entradas, setEntradas] = useState<readonly RemoteEntry[] | null>(null);
  const [coluna, setColuna] = useState<ColunaDeOrdem>('nome');
  const [direcao, setDirecao] = useState<Direcao>('asc');
  const [carregando, setCarregando] = useState(false);
  const [sobre, setSobre] = useState(false);

  const listar = useCallback(
    async (alvo: string) => {
      setCarregando(true);
      try {
        setEntradas(await Api.listarRemoto(conexaoId, alvo));
        setCaminho(alvo);
      } finally {
        setCarregando(false);
      }
    },
    [conexaoId]
  );

  useEffect(() => {
    listar(caminho).catch(onErro);
    // Só na montagem: navegar depois é gesto do usuário, e refazer a listagem a
    // cada renderização faria uma ida ao servidor por tecla digitada em
    // qualquer lugar da IDE.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ir = (alvo: string): void => {
    listar(alvo).catch(onErro);
  };

  // O arraste de fora (spec 060). Depois de subir, a lista recarrega sozinha —
  // um upload que não aparece parece um upload que não aconteceu.
  const download = useDownloadDePasta(onErro);
  /** Andamento do upload de pasta arrastada da IDE (T090). */
  const [subindoPasta, setSubindoPasta] = useState<{ feitos: number; total: number } | null>(null);
  const upload = useUpload(() => {
    listar(caminho).catch(onErro);
  });

  const ordenadas = entradas === null ? [] : ordenarPorColuna(entradas, coluna, direcao);
  // Não há para onde subir a partir da raiz da CONEXÃO — e com `Prender na
  // raiz` ligado, tentar seria recusado pela rota.
  const naRaiz = caminho === raiz;

  const alternarOrdem = (id: ColunaDeOrdem): void => {
    if (id === coluna) setDirecao((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setColuna(id);
      setDirecao('asc');
    }
  };

  return (
    <Box
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
        position: 'relative',
        ...(sobre && { outline: 2, outlineStyle: 'dashed', outlineColor: 'primary.main' }),
      }}
      onDragOver={(e: React.DragEvent) => {
        // Sem o `preventDefault` o navegador ABRE o arquivo arrastado, em vez
        // de entregá-lo à página.
        if (somenteLeitura) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e: React.DragEvent) => {
        if (somenteLeitura) return;
        e.preventDefault();
        setSobre(false);
        // Duas origens, e a de DENTRO vem primeiro (T090): um arraste da árvore
        // da IDE também traz `dataTransfer.files` vazio, e cair no `upload`
        // não subiria nada e não diria por quê.
        const carga = decodificarCarga(e.dataTransfer.getData(MIME_DE_ARRASTE));
        if (carga?.tipo === 'arquivo') {
          void (carga.pasta === true
            ? subirPastaDaIde(carga.caminho)
            : subirDaIde(carga.caminho)
          ).catch(onErro);
          return;
        }
        void upload.soltar(e, conexaoId, caminho).catch(onErro);
      }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5,
          borderBottom: 1, borderColor: 'divider', flexShrink: 0,
        }}
      >
        <Acao
          icone="lucide:chevron-up"
          rotulo="Subir uma pasta"
          desabilitada={naRaiz}
          onClick={() => ir(paiDe(caminho))}
        />
        <Acao icone="lucide:refresh-cw" rotulo="Recarregar" onClick={() => ir(caminho)} />
        {!somenteLeitura && (
          <>
            <Acao
              icone="lucide:folder-plus"
              rotulo="Nova pasta"
              onClick={() => void criar('pasta')}
            />
            <Acao
              icone="lucide:file-plus-2"
              rotulo="Novo arquivo"
              onClick={() => void criar('arquivo')}
            />
          </>
        )}
        <Box
          data-caminho-sftp
          sx={{
            ml: 1, fontFamily: tokens.fontMono, fontSize: 11.5, color: 'text.secondary',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {caminho}
        </Box>
        {carregando && (
          <Box sx={{ ml: 'auto', fontSize: 11, color: 'text.secondary' }}>carregando…</Box>
        )}
        {upload.estado.total > 0 && (
          <Box data-progresso-upload sx={{ ml: 'auto', fontSize: 11, color: 'text.secondary' }}>
            {upload.estado.enviando
              ? `enviando ${upload.estado.enviados} de ${upload.estado.total}…`
              : `${upload.estado.enviados} de ${upload.estado.total} enviados`}
          </Box>
        )}
      </Box>

      {/*
        O andamento do download da pasta (T089), com o cancelar ao lado. Ocupa
        a largura toda porque o nome do arquivo em curso é longo — espremê-lo na
        barra de cima deixaria só as reticências à vista.
      */}
      {subindoPasta !== null && (
        <Box
          data-progresso-upload-pasta
          sx={{
            px: 1.25, py: 0.5, borderBottom: 1, borderColor: 'divider',
            fontSize: 11, color: 'text.secondary',
          }}
        >
          subindo {subindoPasta.feitos} de {subindoPasta.total}…
        </Box>
      )}
      {download.estado.fase !== 'parado' && (
        <Box
          data-progresso-download
          sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5,
            borderBottom: 1, borderColor: 'divider', fontSize: 11,
          }}
        >
          <Box sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
            {download.estado.fase === 'varrendo' && 'procurando arquivos…'}
            {download.estado.fase === 'baixando' &&
              `baixando ${download.estado.feitos} de ${download.estado.total}…`}
            {download.estado.fase === 'compactando' &&
              `compactando ${download.estado.feitos} de ${download.estado.total}…`}
          </Box>
          <Box
            sx={{
              flex: 1, minWidth: 0, fontFamily: tokens.fontMono, fontSize: 10,
              color: 'text.secondary',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              direction: 'rtl', textAlign: 'left',
            }}
          >
            {/* `direction: rtl` corta pela ESQUERDA: num caminho longo o que
                interessa é o fim, e não `/var/www/htdocs/…` repetido. */}
            {download.estado.detalhe}
          </Box>
          <Box
            component="button"
            type="button"
            data-cancelar-download
            onClick={download.cancelar}
            sx={{
              border: 0, bgcolor: 'transparent', font: 'inherit', fontSize: 10.5,
              color: 'error.main', cursor: 'pointer', px: 0.5, borderRadius: 0.5,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            cancelar
          </Box>
        </Box>
      )}

      <Box
        sx={{
          display: 'grid', gridTemplateColumns: GRADE, gap: 1, px: 1, py: 0.5,
          borderBottom: 1, borderColor: 'divider', flexShrink: 0,
          fontSize: 10.5, color: 'text.secondary', letterSpacing: 0.4,
        }}
      >
        {COLUNAS.map((c) => (
          <Box
            key={c.id}
            component="button"
            type="button"
            onClick={() => alternarOrdem(c.id)}
            data-coluna={c.id}
            aria-label={`Ordenar por ${c.rotulo}`}
            sx={{
              border: 0, bgcolor: 'transparent', font: 'inherit', cursor: 'pointer',
              color: coluna === c.id ? 'text.primary' : 'inherit',
              display: 'flex', alignItems: 'center', gap: 0.25, p: 0,
              justifyContent: c.alinhar === 'right' ? 'flex-end' : 'flex-start',
            }}
          >
            {c.rotulo}
            <Icon
              name={
                coluna !== c.id
                  ? 'lucide:chevrons-up-down'
                  : direcao === 'asc'
                    ? 'lucide:chevron-up'
                    : 'lucide:chevron-down'
              }
              size={10}
            />
          </Box>
        ))}
      </Box>

      {download.estado.erro !== null && (
        <Box
          data-erro-download
          sx={{
            px: 1.25, py: 0.5, bgcolor: 'error.main', color: 'background.default',
            fontSize: 11, display: 'flex', alignItems: 'center', gap: 1,
          }}
        >
          <Box sx={{ flex: 1 }}>{download.estado.erro}</Box>
          <Box
            component="button"
            type="button"
            onClick={download.limpar}
            sx={{
              border: 0, bgcolor: 'transparent', font: 'inherit', fontSize: 11,
              color: 'inherit', cursor: 'pointer',
            }}
          >
            ✕
          </Box>
        </Box>
      )}
      {upload.estado.erro !== null && (
        <Box
          data-erro-upload
          sx={{
            px: 1.25, py: 0.5, bgcolor: 'error.main', color: 'background.default',
            fontSize: 11, flexShrink: 0,
          }}
        >
          {upload.estado.erro}
        </Box>
      )}
      {upload.estado.recusados.length > 0 && (
        <Box
          data-recusados-upload
          sx={{ px: 1.25, py: 0.5, bgcolor: 'warning.main', color: 'background.default', fontSize: 11 }}
        >
          {upload.estado.recusados.length} arquivo(s) recusado(s) por tentarem sair da pasta.
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {!naRaiz && (
          <Linha marca=".." onDuploClique={() => ir(paiDe(caminho))}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Icon name="lucide:corner-left-up" size={13} />
              ..
            </Box>
            <Box />
            <Box />
            <Box sx={{ color: 'text.secondary' }}>folder</Box>
            <Box />
          </Linha>
        )}

        {ordenadas.map((e) => (
          <Linha
            key={e.path}
            marca={e.path}
            onDuploClique={() => {
              // Dois cliques: pasta ENTRA, arquivo ABRE. É o gesto do FileZilla,
              // e é o que o usuário descreveu.
              if (e.kind === 'file') void onAbrirArquivo(conexaoId, e.path).catch(onErro);
              else ir(e.path);
            }}
            onMenu={(evento) => menuDaEntrada(evento, e)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
              <Icon
                name={
                  e.kind === 'folder'
                    ? 'lucide:folder'
                    : e.kind === 'link'
                      ? 'lucide:link'
                      : 'lucide:file'
                }
                size={13}
              />
              <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</Box>
            </Box>
            <Box sx={{ textAlign: 'right', color: 'text.secondary' }}>
              {tamanhoLegivel(e.size)}
            </Box>
            <Box sx={{ color: 'text.secondary' }}>{quando(e.modifiedAt)}</Box>
            <Box sx={{ color: 'text.secondary' }}>{tipoLegivel(e)}</Box>
            <Box sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.owner ?? '--'}
            </Box>
          </Linha>
        ))}

        {entradas !== null && ordenadas.length === 0 && (
          <Box sx={{ p: 2, color: 'text.secondary', fontSize: 12 }}>(pasta vazia)</Box>
        )}
      </Box>
    </Box>
  );

  /**
   * O menu de botão direito de uma entrada (T079).
   *
   * Os itens que ele escolheu, e o que **não** aparece é tão decidido quanto o
   * que aparece: numa conexão somente-leitura só ficam ler, baixar e copiar o
   * caminho — o resto muda o servidor.
   */
  function menuDaEntrada(evento: React.MouseEvent, entrada: RemoteEntry): void {
    const ehPasta = entrada.kind === 'folder';
    abrirMenu(evento, [
      {
        label: ehPasta ? 'Abrir' : 'Abrir no editor',
        onClick: () =>
          ehPasta ? ir(entrada.path) : onAbrirArquivo(conexaoId, entrada.path).catch(onErro),
      },
      {
        label: ehPasta ? 'Baixar pasta (.zip)' : 'Baixar',
        onClick: () =>
          ehPasta
            ? download.baixar(conexaoId, entrada.path)
            : baixarUm(entrada),
      },
      null,
      { label: 'Copiar caminho', onClick: () => void copiarTexto(entrada.path) },
      ...(somenteLeitura
        ? []
        : [
            null,
            { label: 'Renomear…', onClick: () => renomear(entrada) },
            { label: 'Permissões…', onClick: () => trocarPermissoes(entrada) },
            null,
            {
              label: 'Excluir',
              danger: true,
              onClick: () => excluir(entrada),
            },
          ]),
    ]);
  }

  /**
   * Sobe um arquivo arrastado DE DENTRO da IDE (T090).
   *
   * O caminho é local, então quem lê o arquivo é o servidor da IDE — e ele já
   * sabe fazer isso pela rota que o editor usa. Passar o conteúdo pelo
   * navegador seria descer e subir os mesmos bytes por um motivo nenhum.
   *
   * **Em bytes**, e não em texto: arrastar um `.png` para o servidor é o caso
   * mais provável de todos, e texto o corromperia.
   */
  async function subirDaIde(caminhoLocal: string): Promise<void> {
    const nome = caminhoLocal.split('/').pop() ?? 'arquivo';
    const alvo = `${caminho === '/' ? '' : caminho}/${nome}`;
    try {
      const dados = await Api.lerBytesLocais(caminhoLocal);
      await Api.enviarArquivoRemoto(conexaoId, alvo, dados.buffer as ArrayBuffer);
      await listar(caminho);
    } catch (e) {
      onErro(e);
    }
  }

  /**
   * Sobe uma PASTA arrastada de dentro da IDE (T090).
   *
   * Pergunta antes, com o número de arquivos e o que o `.gitignore` tirou:
   * é escrita no servidor DELE, e um arraste sem querer não pode virar upload.
   */
  async function subirPastaDaIde(pastaLocal: string): Promise<void> {
    const nome = pastaLocal.split('/').filter((p) => p !== '').pop() ?? 'pasta';
    let lista: Awaited<ReturnType<typeof Api.arquivosDaPasta>>;
    try {
      lista = await Api.arquivosDaPasta(pastaLocal);
    } catch (e) {
      onErro(e);
      return;
    }

    if (lista.files.length === 0) {
      await confirmar({
        titulo: 'Subir pasta',
        mensagem: `"${nome}" não tem arquivos para subir.`,
        rotuloConfirmar: 'ok',
      });
      return;
    }

    const mb = lista.files.reduce((soma, f) => soma + f.bytes, 0) / 1024 / 1024;
    const ok = await confirmar({
      titulo: 'Subir pasta para o servidor',
      mensagem:
        `Subir "${nome}" para ${caminho}?\n\n` +
        `${lista.files.length} arquivo(s), ${mb.toFixed(1)} MB.` +
        (lista.ignored > 0
          ? `\n\n${lista.ignored} arquivo(s) ficam de fora por estarem no .gitignore.`
          : '') +
        (lista.truncated ? '\n\nA pasta é grande demais e a lista foi cortada.' : ''),
      rotuloConfirmar: 'subir',
    });
    if (!ok) return;

    setSubindoPasta({ feitos: 0, total: lista.files.length });
    try {
      for (const [i, arquivo] of lista.files.entries()) {
        setSubindoPasta({ feitos: i, total: lista.files.length });
        const destino = `${caminho === '/' ? '' : caminho}/${nome}/${arquivo.relative}`;
        const dados = await Api.lerBytesLocais(arquivo.path);
        // Um de cada vez: o SFTP tem UM canal por sessão. É a mesma nota do
        // upload de fora, e pelo mesmo motivo.
        await Api.enviarArquivoRemoto(conexaoId, destino, dados.buffer as ArrayBuffer);
      }
      await listar(caminho);
    } catch (e) {
      onErro(e);
    } finally {
      setSubindoPasta(null);
    }
  }

  /** Um arquivo só: sem zip, que seria uma casca em volta de um arquivo. */
  async function baixarUm(entrada: RemoteEntry): Promise<void> {
    try {
      const dados = await Api.lerBytesRemotos(conexaoId, entrada.path);
      await entregarArquivo(entrada.name, dados);
    } catch (e) {
      onErro(e);
    }
  }

  async function renomear(entrada: RemoteEntry): Promise<void> {
    const nome = await pedirTexto({ titulo: 'Novo nome', valorInicial: entrada.name });
    if (nome === null || nome.trim() === '' || nome === entrada.name) return;
    try {
      await Api.renomearRemoto(conexaoId, entrada.path, `${paiDe(entrada.path)}/${nome.trim()}`);
      await listar(caminho);
    } catch (e) {
      onErro(e);
    }
  }

  async function trocarPermissoes(entrada: RemoteEntry): Promise<void> {
    // O modo em octal, como no `chmod` — traduzir para caixas de seleção
    // esconderia o número que quem administra servidor já sabe de cor.
    const atual = (entrada.mode ?? '').slice(-3);
    const modo = await pedirTexto({
      titulo: `Permissões de "${entrada.name}" (ex.: 755)`,
      valorInicial: atual,
    });
    if (modo === null || modo.trim() === '') return;
    try {
      await Api.permissoesRemotas(conexaoId, entrada.path, modo.trim());
      await listar(caminho);
    } catch (e) {
      onErro(e);
    }
  }

  async function excluir(entrada: RemoteEntry): Promise<void> {
    const ok = await confirmar({
      titulo: 'Excluir no servidor',
      mensagem:
        `Excluir "${entrada.name}" do servidor?\n\n${entrada.path}\n\n` +
        (entrada.kind === 'folder'
          ? 'A pasta e tudo que está dentro dela vão junto. Não há lixeira.'
          : 'Não há lixeira: isto não tem volta.'),
      rotuloConfirmar: 'excluir',
      destrutivo: true,
    });
    if (!ok) return;
    try {
      await Api.apagarRemoto(conexaoId, entrada.path);
      await listar(caminho);
    } catch (e) {
      onErro(e);
    }
  }

  /** Copia para a área de transferência, com o caminho do `document` como saída. */
  async function copiarTexto(texto: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
    } catch (e) {
      // Sem permissão de área de transferência. O caminho velho — um textarea
      // escondido com `execCommand('copy')` — falha CALADO dentro da webview
      // do editor, o que é pior que não copiar: quem clicou vai colar o que
      // estava antes. Então diz.
      onErro(e);
    }
  }

  async function criar(tipo: 'pasta' | 'arquivo'): Promise<void> {
    const nome = await pedirTexto({
      titulo: tipo === 'pasta' ? 'Nome da nova pasta' : 'Nome do novo arquivo',
    });
    if (nome === null || nome.trim() === '') return;
    const alvo = `${caminho === '/' ? '' : caminho}/${nome.trim()}`;
    try {
      if (tipo === 'pasta') await Api.criarPastaRemota(conexaoId, alvo);
      else await Api.gravarArquivoRemoto(conexaoId, alvo, '');
      await listar(caminho);
    } catch (e) {
      onErro(e);
    }
  }
}

function Linha({
  children, marca, onDuploClique, onMenu,
}: {
  readonly children: React.ReactNode;
  readonly marca?: string;
  onDuploClique(): void;
  onMenu?(e: React.MouseEvent): void;
}) {
  return (
    <Box
      data-linha-sftp={marca}
      onDoubleClick={onDuploClique}
      onContextMenu={onMenu}
      sx={{
        display: 'grid', gridTemplateColumns: GRADE, gap: 1, px: 1, py: 0.4,
        fontSize: 12, cursor: 'default', userSelect: 'none',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {children}
    </Box>
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
    <Tooltip title={rotulo} placement="bottom" describeChild>
      <Box component="span">
        <Box
          component="button"
          type="button"
          aria-label={rotulo}
          disabled={desabilitada}
          onClick={onClick}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'inherit', p: 0.5, borderRadius: 0.5,
            display: 'flex', cursor: desabilitada ? 'default' : 'pointer',
            opacity: desabilitada ? 0.3 : 1,
            '&:hover': { bgcolor: desabilitada ? 'transparent' : 'action.hover' },
          }}
        >
          <Icon name={icone} size={14} />
        </Box>
      </Box>
    </Tooltip>
  );
}
