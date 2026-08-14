// Desenha um ícone a partir do pacote local.
//
// O registro acontece uma vez, na importação: `addCollection` alimenta o
// Iconify com os dados que o build embutiu, e a partir daí nenhuma requisição
// de rede acontece — é o que sustenta o critério de funcionar offline.
import { Icon as IconifyIcon, addCollection, type IconifyJSON } from '@iconify/react';
import pacotes from './generated/icons.json';
import { resolverIcone } from '../shared/icons';

for (const pacote of pacotes as IconifyJSON[]) {
  addCollection(pacote);
}

export interface IconProps {
  /** Nome vindo do contrato (`database`, `table`…); desconhecido cai no genérico. */
  readonly name: string;
  readonly size?: number;
  readonly color?: string;
  readonly title?: string;
}

export function Icon({ name, size = 14, color, title }: IconProps) {
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
