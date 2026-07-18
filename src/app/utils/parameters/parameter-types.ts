import type { TipoParametroOrm } from '../../types/b5d-orm';

export function isCostParameterType(tipo: TipoParametroOrm | string | null | undefined): boolean {
  return tipo === 'costo' || tipo === 'costo_porcentaje';
}
