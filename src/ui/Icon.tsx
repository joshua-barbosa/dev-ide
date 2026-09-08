// Desenha um ícone a partir do pacote local.
//
// O registro acontece uma vez, na importação: `addCollection` alimenta o
// Iconify com os dados que o build embutiu, e a partir daí nenhuma requisição
// de rede acontece — é o que sustenta o critério de funcionar offline.
import { Icon as IconifyIcon, addCollection, type IconifyJSON } from '@iconify/react';
import pacotes from './generated/icons.json';
import proprios from './generated/icones-proprios.json';
import { resolverIcone } from '../shared/icons';

// O JSON gerado tem um formato literal por conjunto; a asserção direta deixa de
// valer quando há mais de um, porque o TS infere uma união. O dado é o mesmo.
for (const pacote of pacotes as unknown as IconifyJSON[]) {
  addCollection(pacote);
}

export interface IconProps {
  /** Nome vindo do contrato (`database`, `table`…); desconhecido cai no genérico. */
  readonly name: string;
  readonly size?: number;
  readonly color?: string;
  readonly title?: string;
}

/** O desenho dele, quando existe um `.svg` com este nome em `icones/`. */
const DELE: Readonly<Record<string, string>> = proprios;

export function Icon({ name, size = 14, color, title }: IconProps) {
  // **O ícone dele ganha do catálogo.** Vai como `<img>` de data-URI, e não
  // pelo Iconify: o desenho pode ser colorido (é o caso dos que vêm de um tema
  // de ícones), e o Iconify o pintaria de uma cor só.
  const meu = DELE[name];
  if (meu !== undefined) {
    return (
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(meu)}`}
        width={size}
        height={size}
        alt={title ?? ''}
        aria-hidden={title === undefined}
        style={{ flexShrink: 0, display: 'block' }}
      />
    );
  }

  return (
    <IconifyIcon
      icon={resolverIcone(name)}
      width={size}
      height={size}
      color={color}
      aria-label={title}
      aria-hidden={title === undefined}
      style={{ flexShrink: 0, display: 'block' }}
    />
  );
}
