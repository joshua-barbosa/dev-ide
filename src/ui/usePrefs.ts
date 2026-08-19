// As preferências, do lado da interface.
//
// Começa pelos padrões, e não por `null`: quem consome quer `prefs['editor.fontSize']`
// e não `prefs?.['editor.fontSize'] ?? 13`. Sem isso, o padrão apareceria
// repetido em cada ponto de uso — e um dia divergiria do esquema.
import { useCallback, useEffect, useState } from 'react';
import { Api } from './api';
import { padroes, type PatchDePreferencias, type Preferencias } from '../shared/prefs';

export interface PrefsController {
  readonly prefs: Preferencias;
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

  const recarregar = useCallback(async (): Promise<void> => {
    setPrefs(await Api.prefs());
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
    setPrefs(await Api.setPrefs(patch));
  }, []);

  return { prefs, caminho, definir, recarregar };
}
