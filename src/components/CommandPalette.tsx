import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ANALYSIS_SCHOOLS, SUPPORTED_SYMBOLS, TIMEFRAMES } from '../lib/schools';
import { DRAWING_TOOLS } from '../lib/drawingTools';
import { DrawingToolId, PageId, SchoolId, Timeframe } from '../types/trading';
import { useI18n } from '../lib/i18n';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelectSymbol: (symbol: string) => void;
  onSelectTimeframe: (tf: Timeframe) => void;
  onToggleSchool: (school: SchoolId) => void;
  onSelectTool: (tool: DrawingToolId) => void;
  onSelectPage: (page: PageId) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  onSelectSymbol,
  onSelectTimeframe,
  onToggleSchool,
  onSelectTool,
  onSelectPage,
}) => {
  const { lang, dir, t } = useI18n();
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: Array<{ group: string; label: string; sub: string; action: () => void }> = [];

    SUPPORTED_SYMBOLS.forEach((s) => {
      list.push({
        group: t('Asset', 'أصل'),
        label: lang === 'ar' ? `${s.symbol} — ${s.nameAr}` : `${s.symbol} — ${s.name}`,
        sub: lang === 'ar' ? `${s.category} · ${s.name}` : `${s.category} · ${s.nameAr}`,
        action: () => { onSelectSymbol(s.symbol); onClose(); },
      });
    });

    TIMEFRAMES.forEach((tf) => {
      list.push({
        group: t('Timeframe', 'إطار زمني'),
        label: lang === 'ar' ? `الإطار الزمني ${tf.label}` : `Timeframe ${tf.label}`,
        sub: lang === 'ar' ? `تبديل الشارت إلى ${tf.label}` : `Switch chart to ${tf.label}`,
        action: () => { onSelectTimeframe(tf.id); onClose(); },
      });
    });

    ANALYSIS_SCHOOLS.forEach((sc) => {
      list.push({
        group: t('School', 'مدرسة تحليل'),
        label: lang === 'ar' ? `${sc.order}. ${sc.nameAr}` : `${sc.order}. ${sc.nameEn}`,
        sub: lang === 'ar' ? sc.nameEn : sc.nameAr,
        action: () => { onToggleSchool(sc.id); onClose(); },
      });
    });

    const pages: { id: PageId; label: string; ar: string }[] = [
      { id: 'chart', label: 'Chart (Live)', ar: 'الشارت المباشر' },
      { id: 'radar', label: 'Radar (MTF Scanner)', ar: 'الرادار' },
      { id: 'backtest', label: 'Backtest & Replay Lab', ar: 'الباك تيست' },
      { id: 'backtest-trades', label: 'Backtest Trades', ar: 'صفقات الباك تيست' },
      { id: 'studio', label: 'AI Indicator Studio', ar: 'مختبر AI' },
      { id: 'ai-log', label: 'AI Signal Log (Immutable)', ar: 'سجل الذكاء' },
      { id: 'my-trades', label: 'My Trades (Immutable)', ar: 'سجل صفقاتي' },
      { id: 'settings', label: 'Settings & Account', ar: 'الإعدادات والحساب' },
    ];
    pages.forEach((p) => {
      list.push({
        group: t('Page', 'صفحة'),
        label: lang === 'ar' ? p.ar : p.label,
        sub: lang === 'ar' ? p.label : p.ar,
        action: () => { onSelectPage(p.id); onClose(); },
      });
    });

    DRAWING_TOOLS.forEach((tool) => {
      list.push({
        group: t('Tool', 'أداة رسم'),
        label: lang === 'ar' ? tool.nameAr : tool.name,
        sub: lang === 'ar' ? tool.name : tool.nameAr,
        action: () => { onSelectTool(tool.id); onClose(); },
      });
    });

    if (!q) return list.slice(0, 28);
    return list
      .filter((it) => it.label.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q) || it.group.toLowerCase().includes(q))
      .slice(0, 32);
  }, [query, lang, t, onSelectSymbol, onSelectTimeframe, onToggleSchool, onSelectTool, onSelectPage, onClose]);

  if (!open) return null;

  return (
    <div dir={dir} className="fixed inset-0 z-50 bg-black/35 backdrop-blur-xs flex items-start justify-center pt-14 px-3">
      <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-neutral-200">
          <Search className="w-4 h-4 text-neutral-500 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(
              'Search symbols, timeframes, 16 schools, drawing tools, pages...',
              'ابحث عن الأصول، الأطر الزمنية، المدارس الـ 16، أدوات الرسم، الصفحات...'
            )}
            className="w-full text-sm text-black placeholder:text-neutral-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-neutral-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-neutral-100">
          {items.map((item, idx) => (
            <button
              key={`${item.group}-${idx}`}
              type="button"
              onClick={item.action}
              className="w-full flex items-center justify-between px-4 py-2.5 text-start hover:bg-neutral-50 transition-colors"
            >
              <div className="min-w-0 px-1">
                <div className="text-sm font-medium text-black truncate">{item.label}</div>
                <div className="text-xs text-neutral-500 truncate">{item.sub}</div>
              </div>
              <span className="text-[11px] font-medium text-neutral-500 shrink-0">{item.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
