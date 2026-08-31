// Gravar em disco: salvar, salvar tudo e reverter.
//
// Saiu de `useWorkspace` quando ele passou do teto de 800 linhas do Artigo IV
// pela terceira vez. O corte é por assunto: aqui está tudo que **escreve**, e
// lá ficou o que abre, fecha e organiza.
//
// Três regras que este arquivo repete porque cada uma já custou um defeito:
//
// 1. **o conteúdo vem do EDITOR, não do `meta`** — o `meta` só é atualizado ao
//    trocar de aba, então salvar dali gravaria a versão de antes da última
//    tecla;
// 2. **o caderno é a exceção** — ele não tem editor do Monaco, e o `meta` dele
//    é a verdade, atualizado a cada tecla pelos blocos;
// 3. **`emDisco` acompanha a gravação** (T047) — sem isso o vigia compararia
//    com a versão de quando a aba abriu, e todo salvamento viraria "mudou em
//    disco" na notificação que o próprio salvamento gera.
import { Api } from '../api';
import { idBaseDe } from '../../shared/abas-gemeas';
import { gravarSeRemota } from '../remoto/abaRemota';
import type { EditorHandle } from '../editor/EditorHost';
import type { Tab, TabStore } from '../../shared/tabs';
import type { EditorTabMeta } from '../useWorkspace';

export interface DepsDaGravacao {
  readonly store: TabStore;
  /** A aba em foco agora. */
  abaAtiva(): Tab | null;
  /** O editor do grupo em foco. */
  editorAtivo(): EditorHandle | null;
  ehEditavel(aba: Tab | null): boolean;
  metaDe(aba: Tab): EditorTabMeta;
  /** Limpa a marca de "não salvo" nas gêmeas e registra o que foi gravado. */
  marcarComGemeas(id: string, sujo: boolean, gravado?: string): void;
  /** Descarrega TODOS os editores para o store — o `Save All` depende disso. */
  salvarTodosOsGrupos(): void;
  /** Roda `fn` sem que a mudança conte como edição do usuário. */
  semSujar(fn: () => void): void;
}

export function gravacao(deps: DepsDaGravacao) {
  const { store, metaDe, ehEditavel, marcarComGemeas } = deps;

  /**
   * Grava a aba ativa e devolve o caminho.
   *
   * Devolve `null` quando não há arquivo conhecido — aba sem título ou aba de
   * query. Quem chama decide o que fazer: no caso do sem-título, pedir o nome.
   * Esta função não pergunta nada, para continuar sem depender de interface.
   */
  const salvar = async (): Promise<string | null> => {
    const aba = deps.abaAtiva();
    if (aba === null) return null;
    const meta = metaDe(aba);

    // Arquivo do servidor (spec 053): vai de volta por onde veio. Vem ANTES da
    // guarda de `path`, que é nulo aqui — o arquivo não existe em disco.
    const remoto = await gravarSeRemota(
      aba,
      ehEditavel(aba) ? deps.editorAtivo() : null,
      meta.content
    );
    if (remoto !== null) {
      marcarComGemeas(aba.id, false);
      return remoto;
    }

    if (meta.path === null) return null;

    if (aba.type === 'caderno') {
      await Api.saveFile(meta.path, meta.content);
      store.update(aba.id, { dirty: false, meta: { ...meta, emDisco: meta.content } });
      return meta.path;
    }

    const editor = deps.editorAtivo();
    if (editor === null || !ehEditavel(aba)) return null;
    const gravado = editor.getValue();
    await Api.saveFile(meta.path, gravado);
    marcarComGemeas(aba.id, false, gravado);
    return meta.path;
  };

  /**
   * Grava tudo que está sujo e tem para onde ir.
   *
   * O conteúdo da aba ATIVA vem do editor, não do estado da aba (AC-2 da spec
   * 015) — por isso a descarga dos editores vem primeiro.
   */
  const salvarTodas = async (): Promise<{ gravadas: number; semNome: number }> => {
    // Todos os grupos, não só o focado: "Save All" com a tela dividida tem que
    // gravar os dois lados.
    deps.salvarTodosOsGrupos();

    // Uma gravação por ARQUIVO, e não por vista: com o mesmo arquivo aberto
    // dos dois lados (T028), as duas abas estão sujas e gravá-lo duas vezes
    // contaria dois em "3 arquivos salvos".
    const vistos = new Set<string>();
    const sujas = store
      .list()
      .filter((aba) => aba.dirty && ehEditavel(aba))
      .filter((aba) => {
        const base = idBaseDe(aba.id);
        if (vistos.has(base)) return false;
        vistos.add(base);
        return true;
      });

    let gravadas = 0;
    let semNome = 0;
    for (const aba of sujas) {
      const meta = metaDe(aba);
      if (meta.path === null) {
        semNome += 1;
        continue;
      }
      await Api.saveFile(meta.path, meta.content);
      marcarComGemeas(aba.id, false, meta.content);
      gravadas += 1;
    }
    return { gravadas, semNome };
  };

  /**
   * Volta a aba ativa ao que está em disco.
   *
   * Deixa o erro subir quando o arquivo sumiu: reverter para o nada seria
   * destruir o que restou no editor (AC-14 da spec 015).
   */
  const reverter = async (): Promise<void> => {
    const aba = deps.abaAtiva();
    const editor = deps.editorAtivo();
    if (aba === null || editor === null || !ehEditavel(aba)) {
      throw new Error('Não há arquivo aberto para reverter.');
    }
    const meta = metaDe(aba);
    if (meta.path === null) {
      throw new Error('Esta aba ainda não foi salva — não há versão em disco para voltar.');
    }

    const dados = await Api.readFile(meta.path);
    deps.semSujar(() => editor.setValue(dados.content));
    store.update(aba.id, {
      dirty: false,
      meta: { ...meta, content: dados.content, emDisco: dados.content, view: null },
    });
  };

  return { salvar, salvarTodas, reverter };
}
