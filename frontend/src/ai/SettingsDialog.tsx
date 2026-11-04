import { t, useLanguage } from '../lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '../lib/api';
import { providerSettings, useAiProfiles } from './profileStore';
import type { AiProfile } from './types';
import { useAppearance } from '../store/appearanceStore';

const presets = {
  custom: { name: '自定义接口', baseUrl: '', protocol: 'chat' as const },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'chat' as const },
  qwen: { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'chat' as const },
  claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' as const },
};

const emptyProfile = (): AiProfile => ({ id: crypto.randomUUID(), ...presets.custom, model: '', apiKey: '', rememberKey: false, updatedAt: Date.now() });
const sections = [
  { id: 'ai', label: 'AI 配置' },
  { id: 'personalization', label: '个性化' },
  { id: 'language', label: '语言' },
] as const;

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { language, setLanguage } = useLanguage();
  const { theme, priceColors, setTheme, setPriceColors } = useAppearance();
  const { profiles, activeId, save, remove, select } = useAiProfiles();
  const [draft, setDraft] = useState<AiProfile>(() => ({ ...(profiles.find(p => p.id === activeId) ?? emptyProfile()) }));
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [preset, setPreset] = useState('custom');
  const [section, setSection] = useState<(typeof sections)[number]['id']>('ai');
  const [editorOpen, setEditorOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const testController = useRef<AbortController | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { testController.current?.abort(); dialog?.close(); };
  }, []);
  const change = (patch: Partial<AiProfile>) => {
    testController.current?.abort();
    setTesting(false);
    setDraft(current => ({ ...current, ...patch }));
    setMessage('');
  };
  const openEditor = (profile?: AiProfile) => {
    change(profile ? { ...profile } : emptyProfile());
    setPreset('custom');
    setShowKey(false);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    testController.current?.abort();
    setTesting(false);
    setMessage('');
    setEditorOpen(false);
  };
  const validate = () => {
    try {
      const url = new URL(draft.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || !draft.name.trim() || !draft.model.trim()) throw new Error();
      return true;
    } catch { setMessage('请填写名称、接口地址和模型'); return false; }
  };
  const test = async () => {
    if (!validate()) return;
    const controller = new AbortController();
    testController.current = controller;
    setTesting(true);
    setMessage('');
    try {
      const response = await fetch(buildApiUrl('/ai/providers/test'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: providerSettings(draft) }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65000)]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '连接失败');
      if (!controller.signal.aborted) setMessage('连接成功');
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '连接失败');
    } finally {
      if (!controller.signal.aborted) setTesting(false);
    }
  };
  return <dialog className="settings-dialog" ref={dialogRef} aria-labelledby="settings-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <header><h2 id="settings-title">{t("设置")}</h2><button type="button" aria-label={t("关闭设置")} onClick={onClose}>{t("关闭 ×")}</button></header>
    <div className="settings-body">
      <nav className="settings-nav" role="tablist" aria-label={t('设置分类')} aria-orientation="vertical" onKeyDown={event => {
        const index = sections.findIndex(item => item.id === section);
        const next = event.key === 'ArrowDown' ? (index + 1) % sections.length
          : event.key === 'ArrowUp' ? (index + sections.length - 1) % sections.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        setSection(sections[next].id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>
        {sections.map(item => <button type="button" key={item.id} id={`settings-tab-${item.id}`} role="tab"
          aria-selected={section === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={section === item.id ? 0 : -1}
          onClick={() => setSection(item.id)}>{t(item.label)}</button>)}
      </nav>
      <div className="settings-content">
      <section id="settings-panel-personalization" className="settings-panel" role="tabpanel" aria-labelledby="settings-tab-personalization" hidden={section !== 'personalization'}>
        <h3>{t('个性化')}</h3>
        <div className="appearance-settings">
      <fieldset><legend>{t("页面主题")}</legend><div className="appearance-options">
        <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{t("深色")}</button>
        <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{t("浅色")}</button>
      </div></fieldset>
      <fieldset><legend>{t("涨跌配色")}</legend><div className="appearance-options">
        <button type="button" aria-pressed={priceColors === 'green-up'} onClick={() => setPriceColors('green-up')}><i className="color-dot green" />{t("绿涨红跌")}</button>
        <button type="button" aria-pressed={priceColors === 'red-up'} onClick={() => setPriceColors('red-up')}><i className="color-dot red" />{t("红涨绿跌")}</button>
      </div></fieldset>
        </div>
      </section>
      <section id="settings-panel-language" className="settings-panel" role="tabpanel" aria-labelledby="settings-tab-language" hidden={section !== 'language'}>
        <h3>{t('语言')}</h3>
        <div className="appearance-options" role="group" aria-label={t('语言')}>
          <button type="button" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
          <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
        </div>
      </section>
      <section id="settings-panel-ai" className="settings-panel" role="tabpanel" aria-labelledby="settings-tab-ai" hidden={section !== 'ai'}>
        <div className="provider-panel-heading">
          {editorOpen ? <><button className="provider-back" type="button" aria-label={t('返回接口列表')} onClick={closeEditor}>‹ {t('返回')}</button><h3>{t(profiles.some(p => p.id === draft.id) ? '编辑接口' : '添加接口')}</h3></>
            : <><h3>{t('AI 配置')}</h3><button className="provider-add" type="button" aria-label={t('添加接口')} title={t('添加接口')} onClick={() => openEditor()}><span aria-hidden="true">＋</span></button></>}
        </div>
        {!editorOpen && <div className="provider-list" aria-label={t('AI 接口')}>
          {profiles.map(p => <button type="button" key={p.id} aria-label={p.name} aria-current={p.id === activeId ? 'true' : undefined} className={p.id === activeId ? 'active' : ''} onClick={() => openEditor(p)}><span>{p.name}</span>{p.id === activeId && <small>{t('当前')}</small>}<i aria-hidden="true">›</i></button>)}
        </div>}
      {editorOpen && <form className="provider-form" onSubmit={e => {
        e.preventDefault();
        if (!validate()) return;
        const profile = { ...draft, name: draft.name.trim(), updatedAt: Date.now() };
        save(profile); select(profile.id); setDraft(profile); closeEditor();
      }}>
        <label>{t("预设")}<select value={preset} onChange={e => {
          setPreset(e.target.value);
          change({ ...presets[e.target.value as keyof typeof presets], model: '' });
        }}><option value="custom">{t("自定义")}</option><option value="deepseek">DeepSeek</option><option value="qwen">{t("通义千问")}</option><option value="claude">Claude</option></select></label>
        <label>{t("名称")}<input aria-label={t("接口名称")} value={draft.name} maxLength={80} onChange={e => change({ name: e.target.value })} required /></label>
        <label>{t("协议")}<select aria-label={t("接口协议")} value={draft.protocol} onChange={e => change({ protocol: e.target.value as AiProfile['protocol'] })}><option value="chat">Chat Completions</option><option value="anthropic">Messages</option></select></label>
        <label>{t("接口地址")}<input aria-label={t("接口地址")} type="url" value={draft.baseUrl} placeholder="https://api.example.com/v1" onChange={e => change({ baseUrl: e.target.value })} autoCapitalize="none" spellCheck={false} required /></label>
        <label>{t("模型")}<input aria-label={t("模型")} value={draft.model} placeholder={t("模型 ID")} onChange={e => change({ model: e.target.value })} autoCapitalize="none" spellCheck={false} required /></label>
        <label>API Key<div className="api-key-field"><input aria-label="API Key" type={showKey ? 'text' : 'password'} value={draft.apiKey} onChange={e => change({ apiKey: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} /><button type="button" onClick={() => setShowKey(!showKey)}>{showKey ? t("隐藏") : t("显示")}</button></div></label>
        <label className="remember-key"><input type="checkbox" checked={draft.rememberKey} onChange={e => change({ rememberKey: e.target.checked })} />{t("在此设备记住密钥")}</label>
        {message && <p className="settings-status" role="status">{t(message)}</p>}
        <footer><button type="button" disabled={testing} onClick={test}>{testing ? t("测试中…") : t("测试连接")}</button><button className="ai-run" type="submit">{t("保存并使用")}</button>{profiles.some(p => p.id === draft.id) && <button type="button" className="delete-provider" onClick={() => { remove(draft.id); closeEditor(); }}>{t("删除")}</button>}</footer>
      </form>}
      </section>
      </div>
    </div>
  </dialog>;
}
