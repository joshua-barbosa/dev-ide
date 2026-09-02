// O arquivo `.desktop`: clicar no ícone e a IDE abrir (T094).
//
// Pedido dele em 02/09/2026, logo depois de ver o aplicativo rodar: *"seria
// interessante gerar um .desktop dele para eu poder clicar"*.
//
// Puro de propósito. O formato tem três armadilhas silenciosas — escape,
// caminho relativo e associação da janela —, e todas dão o mesmo sintoma: o
// atalho aparece e não faz nada, ou abre sem ícone. Errar aqui não estoura; só
// não funciona.

export interface DadosDoAtalho {
  readonly nome: string;
  /** Caminho ABSOLUTO do executável. */
  readonly executavel: string;
  /** Caminho absoluto do `.png`, ou vazio enquanto não houver ícone. */
  readonly icone: string;
  /**
   * O `--no-sandbox` é necessário nesta máquina.
   *
   * Quem decide isto é quem conhece o estado do `chrome-sandbox` — ver
   * `precisaDeNoSandbox`. O texto do atalho não adivinha nada.
   */
  readonly semSandbox: boolean;
}

/**
 * Escapa um valor para o `Exec=`.
 *
 * A especificação manda escapar `"` e `\` dentro de argumento entre aspas. Sem
 * isso, um caminho com espaço vira dois argumentos e o atalho não abre nada —
 * e não há mensagem de erro em lugar nenhum.
 */
export function escaparExec(valor: string): string {
  return `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Escapa um valor comum (`Name=`, `Comment=`): só a barra invertida e a quebra. */
export function escaparCampo(valor: string): string {
  return valor.replace(/\\/g, '\\\\').replace(/\n/g, ' ').trim();
}

/**
 * Se o ajudante de sandbox está utilizável.
 *
 * O Chromium exige `chrome-sandbox` **de root e com modo 4755**. No Ubuntu
 * 23.10+ o AppArmor fecha o caminho alternativo (namespaces sem privilégio),
 * então sem isso o aplicativo aborta na hora — e o atalho abriria e sumiria,
 * sem janela e sem mensagem.
 */
export function precisaDeNoSandbox(
  ajudante: { readonly existe: boolean; readonly dono: number; readonly modo: number } | null
): boolean {
  if (ajudante === null || !ajudante.existe) return true;
  // `0o4755` inclui o bit SUID; comparar só os últimos 9 bits deixaria passar
  // um `0755`, que é exatamente o caso que não funciona.
  return ajudante.dono !== 0 || (ajudante.modo & 0o7777) !== 0o4755;
}

/**
 * O conteúdo do `.desktop`.
 *
 * `StartupWMClass` é o que amarra a JANELA ao ícone: sem ele, o ambiente abre um
 * segundo lugar na barra de tarefas, com ícone genérico, ao lado do atalho.
 */
export function conteudoDoAtalho(d: DadosDoAtalho): string {
  if (!d.executavel.startsWith('/')) {
    // Caminho relativo num `.desktop` é ignorado em silêncio: o atalho aparece
    // bonito e não abre nada.
    throw new Error(`O .desktop exige caminho ABSOLUTO: ${d.executavel}`);
  }

  const exec = d.semSandbox
    ? `${escaparExec(d.executavel)} --no-sandbox`
    : escaparExec(d.executavel);

  const linhas = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${escaparCampo(d.nome)}`,
    'Comment=A IDE dele, rodando como aplicativo',
    `Exec=${exec} %U`,
    'Terminal=false',
    'Categories=Development;IDE;',
    'StartupNotify=true',
    `StartupWMClass=${escaparCampo(d.nome)}`,
  ];
  // Sem ícone, a linha NÃO entra: um `Icon=` vazio faz alguns ambientes
  // desenharem um quadrado quebrado, que é pior que o ícone padrão.
  if (d.icone !== '') linhas.push(`Icon=${escaparCampo(d.icone)}`);

  return `${linhas.join('\n')}\n`;
}
