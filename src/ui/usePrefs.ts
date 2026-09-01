// As preferências, do lado da interface.
//
// Começa pelos padrões, e não por `null`: quem consome quer `prefs['editor.fontSize']`
// e não `prefs?.['editor.fontSize'] ?? 13`. Sem isso, o padrão apareceria
// repetido em cada ponto de uso — e um dia divergiria do esquema.
import { useCallback, useEffect, useState } from 'react';
import { Api } from './api';
import { padroes, type PatchDePreferencias, type Preferencias } from '../shared/prefs';
import { definirTemasDoUsuario } from '../shared/temas';
import { EMMET_PADRAO, type ConfiguracaoDoEmmet } from '../shared/emmet';

export interface PrefsController {
  readonly prefs: Preferencias;
  /** Como o Emmet está configurado (T022). */
  readonly emmet: ConfiguracaoDoEmmet;
  /** As chaves que o `.vscode/settings.json` do projeto sobrescreve (T002). */
  readonly sobrescritas: readonly string[];
  /** Caminho do `config.json`. Vazio até o servidor responder. */
  readonly caminho: string;
  /** Grava e devolve o conjunto resultante; o servidor é quem valida. */
  definir(patch: PatchDePreferencias): Promise<void>;
  /** Relê do servidor — usado depois de salvar o `config.json` pelo editor. */
  recarregar(): Promise<void>;
}

export function usePrefs(aoFalhar: (erro: unknown) => void): PrefsController {
  const [prefs, setPrefs] = useState<Preferencias>(padroes);
  const [caminho, setCaminho] = useState('');
  const [sobrescritas, setSobrescritas] = useState<readonly string[]>([]);
  const [emmet, setEmmet] = useState<ConfiguracaoDoEmmet>(EMMET_PADRAO);

  const recarregar = useCallback(async (): Promise<void> => {
    // Os dois juntos: um tema novo no `config.json` só vale depois de o
    // catálogo saber dele, e o `workbench.theme` pode apontar para ele na mesma
    // gravação. Carregar em duas etapas daria um instante com o tema errado.
    // Os dois que PINTAM a tela vêm juntos: um tema novo no `config.json` só
    // vale depois de o catálogo saber dele, e o `workbench.theme` pode apontar
    // para ele na mesma gravação. Carregar em duas etapas daria um instante com
    // o tema errado.
    const [valores, temas] = await Promise.all([Api.prefs(), Api.prefsThemes()]);
    definirTemasDoUsuario(temas);
    setPrefs(valores);

    // Fora do caminho crítico, como o do projeto: o Emmet só entra em ação
    // quando alguém digita uma abreviação, e esperá-lo atrasaria a pintura.
    Api.prefsEmmet()
      .then(setEmmet)
      .catch(() => {
        // Sem a configuração dele, valem os padrões — que é o que valia antes.
      });

    // O que o projeto sobrescreve fica FORA do caminho crítico: ele só decide
    // um aviso na tela de configurações, e esperá-lo atrasaria a primeira
    // pintura — a IDE ficaria com o tema padrão por mais tempo, piscando.
    Api.prefsProject()
      .then((projeto) => setSobrescritas(projeto.sobrescritas))
      .catch(() => {
        // Sem o aviso a tela ainda funciona; o valor efetivo já veio certo.
      });
  }, []);

  useEffect(() => {
    // Preferência que não carrega não pode travar a IDE: fica no padrão e o
    // erro vai para o diálogo, como qualquer outra falha de rede.
    recarregar().catch(aoFalhar);
    // O caminho é o que permite reconhecer "salvei o config.json" e reler.
    Api.prefsPath().then(({ path }) => setCaminho(path)).catch(aoFalhar);
    // `aoFalhar` fora das dependências de propósito: ele é recriado a cada
    // render e re-carregaria as preferências sem parar.
  }, [recarregar]);

  const definir = useCallback(async (patch: PatchDePreferencias): Promise<void> => {
    // O servidor devolve o EFETIVO — com o projeto por cima, quando há um. Sem
    // isso a tela mostraria o valor gravado e a IDE usaria outro.
    setPrefs(await Api.setPrefs(patch));
  }, []);

  return { prefs, emmet, sobrescritas, caminho, definir, recarregar };
}
