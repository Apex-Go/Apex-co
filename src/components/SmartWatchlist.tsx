import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronLeft, Flag, FolderPlus } from 'lucide-react';
import { AISignal, LiveQuote, WatchlistItem } from '../types/trading';
import { SYMBOL_MAP } from '../lib/schools';
import { useI18n } from '../lib/i18n';

interface SmartWatchlistProps {
  open: boolean;
  onToggle: () => void;
  items: WatchlistItem[];
  onUpdateItems: (items: WatchlistItem[]) => void;
  quotes: Record<string, LiveQuote>;
  signals: AISignal[];
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}

const FLAG_COLORS: Record<WatchlistItem['flagColor'], string> = {
  none: 'text-neutral-300',
  emerald: 'text-emerald-600',
  amber: 'text-amber-500',
  crimson: 'text-red-600',
  blue: 'text-blue-600',
};

const FLAG_ORDER: WatchlistItem['flagColor'][] = ['none', 'emerald', 'amber', 'crimson', 'blue'];

export const SmartWatchlist: React.FC<SmartWatchlistProps> = ({
  open,
  onToggle,
  items,
  onUpdateItems,
  quotes,
  signals,
  activeSymbol,
  onSelectSymbol,
}) => {
  const { dir, t } = useI18n();
  const [folderFilter, setFolderFilter] = useState<string>('All');
  const [newFolderName, setNewFolderName] = useState('');
  const [showAddFolder, setShowAddFolder] = useState(false);

  const folders = useMemo(() => {
    const set = new Set(items.map((i) => i.folder));
    return ['All', ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(() => {
    if (folderFilter === 'All') return items;
    return items.filter((i) => i.folder === folderFilter);
  }, [items, folderFilter]);

  const cycleFlag = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = items.map((it) => {
      if (it.symbol !== symbol) return it;
      const idx = FLAG_ORDER.indexOf(it.flagColor);
      return { ...it, flagColor: FLAG_ORDER[(idx + 1) % FLAG_ORDER.length] };
    });
    onUpdateItems(updated);
  };

  const assignCurrentSymbolToFolder = () => {
    const clean = newFolderName.trim();
    if (!clean) return;
    const exists = items.some((i) => i.symbol === activeSymbol);
    const updated = exists
      ? items.map((i) => (i.symbol === activeSymbol ? { ...i, folder: clean } : i))
      : [...items, { symbol: activeSymbol, folder: clean, flagColor: 'none' as const }];
    onUpdateItems(updated);
    setFolderFilter(clean);
    setNewFolderName('');
    setShowAddFolder(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title={t('Expand Smart Watchlist', 'توسيع قائمة المراقبة الذكية')}
        className="hidden sm:flex flex-col items-center justify-center w-8 bg-white border-l border-neutral-200 hover:bg-neutral-50 text-neutral-700 shrink-0"
      >
        <ChevronLeft className="w-4 h-4" />
        <span className="text-[10px] font-medium [writing-mode:vertical-rl] mt-2">{t('Watchlist', 'المراقبة')}</span>
      </button>
    );
  }

  return (
    <aside dir={dir} className="w-full sm:w-64 lg:w-72 bg-white border-t sm:border-t-0 sm:border-l border-neutral-200 flex flex-col shrink-0 max-h-80 sm:max-h-none overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
        <span className="text-xs font-semibold text-black">{t('Smart Watchlist', 'قائمة المراقبة الذكية')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowAddFolder((v) => !v)}
            className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600"
            title={t('Move current symbol to custom folder', 'نقل الأصل الحالي إلى مجلد مخصص')}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600"
            title={t('Collapse Watchlist', 'طي قائمة المراقبة')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showAddFolder && (
        <div className="p-2 border-b border-neutral-100 flex gap-1.5">
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t(`Folder for ${activeSymbol}...`, `مجلد لـ ${activeSymbol}...`)}
            className="flex-1 h-8 px-2 text-xs border border-neutral-300 rounded-lg focus:outline-none focus:border-black"
          />
          <button
            type="button"
            onClick={assignCurrentSymbolToFolder}
            className="px-2.5 h-8 bg-black text-white text-xs font-medium rounded-lg"
          >
            {t('Save', 'حفظ')}
          </button>
        </div>
      )}

      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-neutral-100 overflow-x-auto no-scrollbar">
        {folders.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFolderFilter(f)}
            className={`px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
              folderFilter === f ? 'bg-black text-white' : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {f === 'All' ? t('All', 'الكل') : f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
        {filtered.map((item) => {
          const q = quotes[item.symbol];
          const info = SYMBOL_MAP[item.symbol];
          const activeSig = signals.find(
            (s) => s.symbol === item.symbol && (s.status === 'Active' || s.status === 'Breakeven' || s.status === 'Watchlist')
          );
          const isSelected = activeSymbol === item.symbol;
          const up = (q?.changePct24h ?? 0) >= 0;

          return (
            <div
              key={item.symbol}
              onClick={() => onSelectSymbol(item.symbol)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectSymbol(item.symbol)}
              className={`w-full flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors ${
                isSelected ? 'bg-neutral-100' : 'hover:bg-neutral-50'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={(e) => cycleFlag(item.symbol, e)}
                  className={`p-0.5 ${FLAG_COLORS[item.flagColor]}`}
                  title={t('Cycle color flag', 'تغيير لون العلامة')}
                >
                  <Flag className="w-3.5 h-3.5 fill-current" />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5" dir="ltr">
                    <span className="text-xs font-bold text-black">{item.symbol}</span>
                    {activeSig && (
                      <span
                        className={`text-[10px] font-semibold ${
                          activeSig.direction === 'BUY' ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {activeSig.status === 'Watchlist' ? t('Forming', 'قيد التشكل') : activeSig.direction}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-neutral-500 truncate">
                    {item.folder} · {info?.category}
                  </div>
                </div>
              </div>

              <div dir="ltr" className="text-right shrink-0">
                <div className="text-xs font-semibold text-black font-mono-tabular">
                  {q ? q.mid.toFixed(info?.decimals ?? 2) : '—'}
                </div>
                <div className={`text-[10px] font-medium font-mono-tabular ${up ? 'text-emerald-700' : 'text-red-600'}`}>
                  {q ? `${up ? '+' : ''}${q.changePct24h.toFixed(2)}%` : '0.00%'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
