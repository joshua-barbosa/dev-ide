// A aba de um arquivo que mora no servidor (spec 053).
//
// Saiu do `useWorkspace` quando o portão do Artigo IV pegou o arquivo em 828
// linhas. O corte é por assunto: aqui está tudo que distingue um arquivo remoto
// de um local, e nada mais.
//
// **A aba NÃO tem `path`.** Não existe esse arquivo em disco — a ferramenta de
// referência baixa para uma pasta temporária porque precisa entregar um caminho
// ao editor do hospedeiro; aqui a aba já guarda o conteúdo. Deixar `path`
// preenchido com algo faria `Ctrl+S` gravar na máquina errada, e o defeito só
// apareceria no arquivo do usuário.
import { Api } from '../api';
import type { EditorHandle } from '../editor/EditorHost';
import type { Tab } from '../../shared/tabs';

/** O que a aba de arquivo remoto carrega além do normal. */
export interface MetaRemota {
  readonly remoteConnectionId?: string;
  readonly remotePath?: string;
}

export function metaRemotaDe(aba: Tab | null): Required<MetaRemota> | null {
  const meta = (aba?.meta ?? {}) as MetaRemota;
  if (meta.remoteConnectionId === undefined || meta.remotePath === undefined) return null;
  return { remoteConnectionId: meta.remoteConnectionId, remotePath: meta.remotePath };
}

export function idDaAbaRemota(conexaoId: string, caminho: string): string {
  return `remote:${conexaoId}:${caminho}`;
}

export interface AberturaRemota {
  readonly id: string;
  readonly type: 'sql' | 'editor';
  readonly title: string;
  readonly icon: string;
  readonly meta: Record<string, unknown>;
}

/** Monta a aba a partir do que o servidor devolveu. */
export async function lerParaAba(
  conexaoId: string,
  caminho: string,
  linguagemDe: (c: string) => string,
  iconeDeArquivo: (c: string, linguagem: string) => string
): Promise<AberturaRemota> {
  const dados = await Api.lerArquivoRemoto(conexaoId, caminho);
  const language = linguagemDe(caminho);
  return {
    id: idDaAbaRemota(conexaoId, caminho),
    type: language === 'sql' ? 'sql' : 'editor',
    title: caminho.split('/').pop() ?? caminho,
    icon: iconeDeArquivo(caminho, language),
    meta: {
      path: null,
      remoteConnectionId: conexaoId,
      remotePath: caminho,
      content: dados.content,
      language,
      view: null,
    },
  };
}

/**
 * Grava de volta no servidor, ou devolve `null` se a aba não for remota.
 *
 * O conteúdo vem do EDITOR quando há um: o `meta` só é atualizado ao trocar de
 * aba, e gravar a partir dele mandaria a versão de antes da última tecla — é o
 * mesmo cuidado que o `salvar` local já toma.
 */
export async function gravarSeRemota(
  aba: Tab,
  editor: EditorHandle | null,
  conteudoDoMeta: string
): Promise<string | null> {
  const remoto = metaRemotaDe(aba);
  if (remoto === null) return null;
  const conteudo = editor === null ? conteudoDoMeta : editor.getValue();
  await Api.gravarArquivoRemoto(remoto.remoteConnectionId, remoto.remotePath, conteudo);
  return remoto.remotePath;
}
