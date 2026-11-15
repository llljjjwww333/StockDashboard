import { t } from '../lib/i18n';
import { formatSigned, changeTone } from '../lib/changePresentation';

type ChangeBasis = '较昨收' | '较区间基准' | '较区间首价' | '较前一根' | '较本根开盘';

export function ChartChange({ price, base, basis, digits }: {
  price: number; base: number; basis: ChangeBasis; digits?: number;
}) {
  const delta = price - base;
  const change = delta / base * 100;
  const valid = base > 0 && Number.isFinite(change);
  const percent = valid ? `${formatSigned(change)}%` : '--';
  const label = t(basis);
  return <em title={label} className={valid ? changeTone(digits === undefined ? change : delta, digits ?? 2) : undefined}>
    <small>{label}</small> {valid && digits !== undefined ? `${formatSigned(delta, digits)} (${percent})` : percent}
  </em>;
}
