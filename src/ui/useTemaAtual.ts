// Qual tema vale AGORA (T012, T013).
//
// Duas fontes decidem: o que ele escolheu no `config.json`, e — quando ele
// pediu — o que o sistema operacional está usando.
//
// **Seguir o sistema é escolher entre DOIS temas declarados**, e não alternar
// um interruptor claro/escuro. Quem gosta de Nord à noite não quer o `claro`
// genérico quando o sistema clareia de manhã; quer o `github-claro` que ele
// mesmo indicou. É o desenho do VS Code, e é o único que sobrevive a ter nove
// temas.
import { useEffect, useState } from 'react';
import type { NomeDoTema } from '../shared/temas';
import type { Preferencias } from '../shared/prefs';

const ESCURO = '(prefers-color-scheme: dark)';

/**
 * O sistema está no escuro?
 *
 * `null` quando o navegador não sabe responder — e aí seguir o sistema não faz
 * sentido, então quem chama fica com a escolha manual. Um `false` nesse caso
 * clarearia a tela de quem nunca pediu isso.
 */
function sistemaNoEscuro(): boolean | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  const consulta = window.matchMedia(ESCURO);
  // `media` volta `not all` quando o navegador não conhece a consulta.
  return consulta.media === ESCURO ? consulta.matches : null;
}

export function useTemaAtual(prefs: Preferencias): NomeDoTema {
  const [escuroNoSistema, setEscuroNoSistema] = useState<boolean | null>(sistemaNoEscuro);

  useEffect(() => {
    const consulta =
      typeof window.matchMedia === 'function' ? window.matchMedia(ESCURO) : null;
    if (consulta === null || consulta.media !== ESCURO) return;

    const aoMudar = (): void => setEscuroNoSistema(consulta.matches);
    consulta.addEventListener('change', aoMudar);
    // Uma leitura agora também: entre o primeiro render e este efeito o sistema
    // pode ter mudado, e ficar esperando o próximo evento seria esperar horas.
    aoMudar();
    return () => consulta.removeEventListener('change', aoMudar);
  }, []);

  const seguir = prefs['workbench.followSystem'] === true;
  if (!seguir || escuroNoSistema === null) return prefs['workbench.theme'];
  return escuroNoSistema ? prefs['workbench.themeDark'] : prefs['workbench.themeLight'];
}
