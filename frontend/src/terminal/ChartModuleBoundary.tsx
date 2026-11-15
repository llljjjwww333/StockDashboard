import { Component, type ReactNode } from 'react';
import { t, useLanguage } from '../lib/i18n';
import { recoverChartModule } from '../lib/chartModuleRecovery';

const reloadKey = 'marketdesk:chart-module-reload:v1';

function ChartFailure() {
  useLanguage();
  return <div className="chart-module-error" role="status">
    <span>{t('K线图暂不可用')}</span>
    <button type="button" onClick={() => window.location.reload()}>{t('重新加载')}</button>
  </div>;
}

export class ChartModuleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private controller = new AbortController();

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error) {
    void recoverChartModule(error, {
      currentEntry: document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? null,
      latestEntry: async signal => {
        const response = await fetch(window.location.href, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null;
        const html = new DOMParser().parseFromString(await response.text(), 'text/html');
        const entry = html.querySelector('script[type="module"][src]')?.getAttribute('src');
        if (!entry) return null;
        const url = new URL(entry, window.location.href);
        return url.origin === window.location.origin ? url.href : null;
      },
      lastReloadedEntry: () => { try { return sessionStorage.getItem(reloadKey); } catch { return null; } },
      rememberEntry: entry => { try { sessionStorage.setItem(reloadKey, entry); } catch { /* The version comparison also prevents repeated reloads. */ } },
      canReload: () => !document.querySelector('dialog[open]') &&
        !document.activeElement?.closest('input, textarea, select, [contenteditable="true"]'),
      reload: () => window.location.reload(),
    }, this.controller.signal);
  }

  componentWillUnmount() { this.controller.abort(); }

  render() { return this.state.failed ? <ChartFailure /> : this.props.children; }
}
