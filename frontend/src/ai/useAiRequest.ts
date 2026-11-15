import { useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '../lib/api';
import { providerSettings } from './profileStore';
import type { AiProfile } from './types';
import { useLanguage } from '../lib/i18n';
import { requestAiJson } from './requestJson';

export function useAiRequest<Request extends object, Result>(contextKey: string, profile: AiProfile | undefined, path: string, validate: (value: unknown, request: Request) => value is Result, failure = '分析失败') {
  const { language } = useLanguage();
  const key = `${path}:${contextKey}:${profile?.id ?? ''}:${profile?.updatedAt ?? ''}:${language}`;
  const pending = useRef<{ key: string; controller: AbortController } | null>(null);
  const [state, setState] = useState<{ key: string; result: Result | null; loading: boolean; error: string | null }>({ key, result: null, loading: false, error: null });
  if (state.key !== key) setState({ key, result: null, loading: false, error: null });
  useEffect(() => () => {
    if (pending.current?.key === key) {
      pending.current.controller.abort();
      pending.current = null;
    }
  }, [key]);

  const run = async (request: Request) => {
    if (!profile) return null;
    pending.current?.controller.abort();
    const current = new AbortController();
    pending.current = { key, controller: current };
    setState(previous => ({ key, loading: true, error: null, result: previous.key === key ? previous.result : null }));
    try {
      const result = await requestAiJson(buildApiUrl(path), { ...request, language, settings: providerSettings(profile) }, current.signal);
      if (!validate(result, request)) throw new Error(failure);
      if (pending.current?.controller === current) { setState({ key, result, loading: false, error: null }); return result; }
      return null;
    } catch (error) {
      if (pending.current?.controller === current) setState(previous => previous.key === key
        ? { ...previous, loading: false, error: error instanceof Error ? error.message : failure } : previous);
      return null;
    } finally {
      if (pending.current?.controller === current) pending.current = null;
    }
  };
  const cancel = () => {
    pending.current?.controller.abort();
    pending.current = null;
    setState(previous => previous.key === key ? { ...previous, loading: false, error: null } : previous);
  };
  const clear = () => {
    pending.current?.controller.abort();
    pending.current = null;
    setState({ key, result: null, loading: false, error: null });
  };
  return { ...(state.key === key ? state : { result: null, loading: false, error: null }), run, cancel, clear };
}
