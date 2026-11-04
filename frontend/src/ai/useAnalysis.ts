import { useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '../lib/api';
import { providerSettings } from './profileStore';
import type { AiProfile, AnalysisRequest, AnalysisResult } from './types';
import { useLanguage } from '../lib/i18n';

export function useAnalysis(contextKey: string, profile?: AiProfile) {
  const { language } = useLanguage();
  const key = `${contextKey}:${profile?.id ?? ''}:${profile?.updatedAt ?? ''}:${language}`;
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; result: AnalysisResult | null; loading: boolean; error: string | null }>({ key, result: null, loading: false, error: null });
  if (state.key !== key) setState({ key, result: null, loading: false, error: null });
  useEffect(() => () => { controller.current?.abort(); }, [key]);

  const run = async (request: AnalysisRequest) => {
    if (!profile) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ key, loading: true, error: null, result: null });
    try {
      const response = await fetch(buildApiUrl('/ai/analyze'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(95000)]),
        body: JSON.stringify({ ...request, language, settings: providerSettings(profile) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '分析失败');
      if (!current.signal.aborted) setState({ key, result, loading: false, error: null });
    } catch (error) {
      if (!current.signal.aborted) setState({ key, result: null, loading: false, error: error instanceof Error ? error.message : '分析失败' });
    }
  };
  const clear = () => {
    controller.current?.abort();
    setState({ key, result: null, loading: false, error: null });
  };
  return { ...(state.key === key ? state : { result: null, loading: false, error: null }), run, clear };
}
