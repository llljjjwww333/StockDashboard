import { t } from '../lib/i18n';
import { useKeyboard } from '../store/keyboardStore';

const shortcuts = [
  ['/', '搜索股票'], ['1', '研究台'], ['2', '市场'], ['3', '情报'], ['4', '策略'], ['5', '模拟'],
  ['J / K', '下一只 / 上一只自选'], ['F', '切换沉浸看盘'], ['?', '打开使用帮助'],
] as const;

export function UsageHelp() {
  const { enabled, setEnabled } = useKeyboard();
  return <div className="usage-help">
    <h3>{t('使用帮助')}</h3>
    <p>{t('按 Tab 可显示“跳到主内容”，按回车直接进入当前页面，跳过导航和自选列表。')}</p>
    <h4>{t('快捷键')}</h4>
    <label className="keyboard-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{t('启用单键快捷操作')}</label>
    <p>{t('快捷键在输入文字、打开弹窗或操作图表菜单时暂停。自选切换遵循当前筛选结果和排序。')}</p>
    <dl className="shortcut-list">{shortcuts.map(([key, action]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{t(action)}</dd></div>)}</dl>
    <p>{t('Esc 关闭搜索或当前弹窗；沉浸看盘时退出沉浸。')}</p>
    <h4>{t('图表读数')}</h4>
    <p>{t('先点击或用 Tab 聚焦图表，再用左右方向键逐点查看，Home / End 跳到首尾。')}</p>
    <h4>{t('行情数据导出')}</h4>
    <p>{t('图表下方可导出当前时间范围的 CSV。成交量以股数保存，缓存数据会标记。')}</p>
    <h4>{t('保存自选')}</h4>
    <p>{t('搜索和市场榜单选股后先预览，点击“加入自选”保存。移除后可撤销；换浏览器前可在“自选备份”导出。')}</p>
  </div>;
}
