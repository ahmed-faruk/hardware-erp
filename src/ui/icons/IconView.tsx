import { createElement } from 'react';

import { iconFor } from './catalog';
import type { IconProps } from './custom';

/** Renders the icon for a stored key (generic box when unknown). A component, so screens never create components during render. */
export function IconView({ iconKey, ...props }: IconProps & { iconKey: string | null | undefined }) {
  return createElement(iconFor(iconKey), props);
}
