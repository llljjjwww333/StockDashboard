import { t } from '../lib/i18n';
import { useOnlineStatus } from '../lib/useOnlineStatus';

export function ResourceError({ error, loading, onRetry, label, hasData = false }: {
  error: string | null; loading: boolean; onRetry: () => void; label: string; hasData?: boolean;
}) {
  const online = useOnlineStatus();
  if (!error) return null;
  return <div className="error-banner resource-error">
    <span role="status">{t(error)}{hasData && <small> · {t('保留上次数据')}</small>}</span>
    <button type="button" aria-label={t(label)} disabled={loading || !online} aria-busy={online && loading} onClick={onRetry}>{t(!online ? '等待网络' : loading ? '重试中…' : '重试')}</button>
  </div>;
}
