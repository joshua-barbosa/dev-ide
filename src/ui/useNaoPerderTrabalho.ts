// Não perder trabalho ao fechar a janela (T009, T035).
//
// A nota dele no T009 diz o que dá para fazer, e diz certo: *"o possível:
// avisar antes de fechar com arquivo sujo + tentar gravar por sendBeacon"*.
//
// **Salvar de verdade ao fechar é impossível**, e vale escrever por quê: o
// navegador não espera `fetch` durante o descarregamento da página. O que
// existe é o `sendBeacon` — uma entrega de mão única, sem resposta, que o
// navegador promete tentar mesmo com a aba morrendo. Não dá para saber se ela
// chegou; dá para saber que ela foi enviada.
//
// Por isso a IDE faz **duas** coisas, e não uma:
//
// 1. **avisa antes de fechar** (`beforeunload`), para ele ter a chance de
//    voltar e salvar de verdade;
// 2. **manda o rascunho** por `sendBeacon`, para o caso de ele fechar mesmo —
//    e aí o T035 o oferece de volta na próxima abertura.
import { useEffect, useRef } from 'react';
import { Api } from './api';
import type { Workspace } from './useWorkspace';

export interface NaoPerderTrabalhoDeps {
  readonly ws: Workspace;
  /** O que a aba tem AGORA na tela — pode não estar em disco. */
  conteudoDaAba(id: string): string;
  /** Pergunta o que fazer com o rascunho achado (T035). */
  confirmar(o: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
  notificar(mensagem: string, tipo?: 'info' | 'sucesso' | 'atencao' | 'erro'): void;
  onErro(erro: unknown): void;
}

/** As abas de arquivo que estão sujas, com o caminho e o texto de agora. */
function sujasComCaminho(
  deps: NaoPerderTrabalhoDeps
): readonly { readonly caminho: string; readonly conteudo: string }[] {
  const saida: { caminho: string; conteudo: string }[] = [];
  for (const aba of deps.ws.store.list()) {
    if (aba.dirty !== true) continue;
    const caminho = (aba.meta as { path?: string | null }).path ?? null;
    // Aba sem título não tem para onde voltar: um rascunho sem caminho não
    // teria como ser reoferecido, e guardá-lo criaria lixo que nunca sai.
    if (caminho === null) continue;
    saida.push({ caminho, conteudo: deps.conteudoDaAba(aba.id) });
  }
  return saida;
}

export function useNaoPerderTrabalho(deps: NaoPerderTrabalhoDeps): void {
  const { ws } = deps;
  /** Já perguntamos nesta sessão? Perguntar duas vezes seria insistência. */
  const jaPerguntou = useRef(false);

  /**
   * Oferece de volta o que ficou sem salvar (T035).
   *
   * **Uma vez por sessão, e só na abertura.** A nota dele pede o rascunho
   * "marcado como rascunho, com a data de quando foi digitado" — então a IDE
   * mostra a data e deixa ele decidir, em vez de ressuscitar o texto por cima
   * do arquivo sem avisar.
   */
  useEffect(() => {
    if (jaPerguntou.current) return;
    jaPerguntou.current = true;
    let vivo = true;

    void (async () => {
      let pendentes: readonly { caminho: string; quando: number }[];
      try {
        pendentes = (await Api.rascunhosPendentes()) as readonly {
          caminho: string;
          quando: number;
        }[];
      } catch (e) {
        // Falhar aqui não pode atrapalhar a abertura da IDE: o rascunho
        // continua no disco, e a pergunta volta na próxima vez.
        deps.onErro(e);
        return;
      }
      if (!vivo || pendentes.length === 0) return;

      const lista = pendentes
        .slice(0, 5)
        .map((p) => `${p.caminho}\n    de ${new Date(p.quando).toLocaleString()}`)
        .join('\n');

      const abrir = await deps.confirmar({
        titulo: pendentes.length === 1 ? 'Trabalho não salvo' : 'Trabalho não salvo',
        mensagem:
          `A janela fechou com ${pendentes.length} arquivo(s) sem salvar:\n\n${lista}` +
          (pendentes.length > 5 ? `\n… e mais ${pendentes.length - 5}.` : '') +
          '\n\nAbrir? O texto entra no editor como está, e o arquivo em disco ' +
          'continua intocado até você salvar.',
        rotuloConfirmar: 'abrir',
      });

      if (!abrir) {
        // Descartar é decisão dele, e vale: sem isto a IDE perguntaria a mesma
        // coisa em toda abertura, para sempre.
        for (const p of pendentes) {
          await Api.descartarRascunho(p.caminho).catch(() => undefined);
        }
        deps.notificar('Os rascunhos foram descartados.', 'info');
        return;
      }

      for (const p of pendentes) {
        try {
          const versao = await Api.historico(p.caminho);
          const rascunho = versao.find((v) => v.origem === 'rascunho');
          if (rascunho === undefined) continue;
          const texto = await Api.versaoDoHistorico(p.caminho, rascunho.id);
          await ws.abrirArquivo(p.caminho);
          ws.editorRef.current?.setValue(texto.conteudo);
          ws.marcarSujo();
          // O rascunho SAI depois de restaurado: ele virou a aba aberta, e
          // mantê-lo faria a IDE oferecer de novo o que já está na tela.
          await Api.descartarRascunho(p.caminho).catch(() => undefined);
        } catch (e) {
          deps.onErro(e);
        }
      }
      deps.notificar(
        `${pendentes.length} rascunho(s) abertos. Eles ainda NÃO estão em disco.`,
        'atencao'
      );
    })();

    return () => {
      vivo = false;
    };
  }, [deps, ws]);

  useEffect(() => {
    /**
     * O aviso do navegador (T009).
     *
     * O texto é ignorado por todo navegador desde 2016 — eles mostram uma frase
     * fixa deles. O que ainda funciona é o `preventDefault`, e é ele que faz a
     * caixa aparecer.
     *
     * **Só com arquivo sujo.** Uma IDE que pergunta "sair mesmo?" toda vez
     * ensina a clicar em "sair" sem ler, e aí ela deixa de proteger no dia em
     * que havia algo a proteger.
     */
    const aoFechar = (e: BeforeUnloadEvent): void => {
      const sujas = sujasComCaminho(deps);
      if (sujas.length === 0) return;

      // O rascunho vai ANTES do aviso: se ele confirmar a saída, a página some
      // e não haveria segunda chance.
      for (const { caminho, conteudo } of sujas) {
        mandarRascunho(caminho, conteudo);
      }
      e.preventDefault();
    };

    window.addEventListener('beforeunload', aoFechar);
    return () => window.removeEventListener('beforeunload', aoFechar);
    // `deps` inteiro, e não os campos: `conteudoDaAba` é recriado a cada
    // render, e depender dele reinstalaria o ouvinte sem parar. O corpo lê tudo
    // no momento em que roda, que é o que importa aqui.
  }, [deps, ws]);
}

/**
 * Manda um rascunho pelo `sendBeacon`, com `fetch` como plano B.
 *
 * `sendBeacon` é síncrono do ponto de vista de quem chama e o navegador
 * garante a tentativa mesmo com a página indo embora — é a única coisa que
 * funciona aqui. Ele recusa corpos muito grandes (o limite varia, ~64 KB), e é
 * por isso que existe o plano B: um `fetch` com `keepalive`, que tem a mesma
 * promessa e um teto maior.
 */
export function mandarRascunho(caminho: string, conteudo: string): void {
  const corpo = JSON.stringify({ path: caminho, content: conteudo });
  const blob = new Blob([corpo], { type: 'application/json' });

  if (navigator.sendBeacon?.('/api/history/draft', blob) === true) return;

  // O beacon recusou — corpo grande demais, ou navegador sem ele. `keepalive`
  // é o que faz este `fetch` sobreviver ao fechamento da aba.
  void fetch('/api/history/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: corpo,
    keepalive: true,
  }).catch(() => undefined);
}
