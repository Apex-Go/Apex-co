import React, { useState } from 'react';
import {
  Crosshair,
  TrendingUp,
  Square,
  GitCommitHorizontal,
  Activity,
  Ruler,
  Magnet,
  Undo2,
  Redo2,
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { DRAWING_CATEGORIES, DRAWING_TOOLS, TOOL_MAP } from '../lib/drawingTools';
import { DrawingObject, DrawingToolCategory, DrawingToolId, MagnetMode } from '../types/trading';
import { useI18n } from '../lib/i18n';

interface DrawingToolbarProps {
  activeTool: DrawingToolId;
  onSelectTool: (tool: DrawingToolId) => void;
  magnetMode: MagnetMode;
  onCycleMagnet: () => void;
  drawings: DrawingObject[];
  onToggleLock: (id: string) => void;
  onToggleHide: (id: string) => void;
  onDeleteDrawing: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  showAllDrawings: boolean;
  onToggleShowAllDrawings: () => void;
}

const CATEGORY_ICONS: Record<DrawingToolCategory, React.ReactNode> = {
  cursors: <Crosshair className="w-4 h-4" />,
  lines: <TrendingUp className="w-4 h-4" />,
  geometric: <Square className="w-4 h-4" />,
  fib_gann: <GitCommitHorizontal className="w-4 h-4" />,
  elliott_harmonic: <Activity className="w-4 h-4" />,
  position_measure: <Ruler className="w-4 h-4" />,
};

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  magnetMode,
  onCycleMagnet,
  drawings,
  onToggleLock,
  onToggleHide,
  onDeleteDrawing,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  showAllDrawings,
  onToggleShowAllDrawings,
}) => {
  const { lang, dir, t } = useI18n();
  const [openCategory, setOpenCategory] = useState<DrawingToolCategory | null>(null);
  const [showObjectTree, setShowObjectTree] = useState(false);

  const activeCategory = TOOL_MAP[activeTool]?.category;

  return (
    <div className="relative flex flex-col items-center bg-white border-r border-neutral-200 py-1.5 px-1 gap-1 select-none shrink-0 z-20">
      {DRAWING_CATEGORIES.map((cat) => {
        const isCatActive = activeCategory === cat.id;
        const isOpen = openCategory === cat.id;
        return (
          <div key={cat.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenCategory(isOpen ? null : cat.id)}
              title={lang === 'ar' ? `${cat.labelAr} (${cat.label})` : `${cat.label} (${cat.labelAr})`}
              className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg transition-colors relative ${
                isCatActive || isOpen
                  ? 'bg-black text-white shadow-xs'
                  : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {CATEGORY_ICONS[cat.id]}
              {isCatActive && activeTool !== 'crosshair' && activeTool !== 'dot' && activeTool !== 'arrow_cursor' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1 right-1" />
              )}
              <ChevronRight className="w-2.5 h-2.5 absolute right-0.5 bottom-0.5 opacity-60" />
            </button>

            {isOpen && (
              <div dir={dir} className="absolute left-full top-0 ml-1.5 w-64 max-h-[65vh] overflow-y-auto bg-white border border-neutral-200 rounded-xl shadow-xl p-1.5 z-40">
                <div className="px-2.5 py-1.5 border-b border-neutral-100 text-[11px] font-semibold text-neutral-500 flex items-center justify-between">
                  <span>{lang === 'ar' ? cat.labelAr : cat.label}</span>
                  <span>{lang === 'ar' ? cat.label : cat.labelAr}</span>
                </div>
                <div className="py-1 space-y-0.5">
                  {DRAWING_TOOLS.filter((tool) => tool.category === cat.id).map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => {
                        onSelectTool(tool.id);
                        setOpenCategory(null);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${
                        activeTool === tool.id
                          ? 'bg-black text-white font-semibold'
                          : 'text-neutral-800 hover:bg-neutral-100'
                      }`}
                    >
                      <span className="truncate">{lang === 'ar' ? tool.nameAr : tool.name}</span>
                      <span className={`text-[10px] mx-2 shrink-0 ${activeTool === tool.id ? 'text-neutral-300' : 'text-neutral-400'}`}>
                        {lang === 'ar' ? tool.name : tool.nameAr}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="w-6 h-px bg-neutral-200 my-0.5" />

      <button
        type="button"
        onClick={onCycleMagnet}
        title={t(`OHLC Magnet: ${magnetMode.toUpperCase()}`, `مغناطيس OHLC: ${magnetMode === 'off' ? 'مغلق' : magnetMode === 'weak' ? 'ضعيف' : 'قوي'}`)}
        className={`min-h-[40px] min-w-[40px] flex flex-col items-center justify-center rounded-lg text-[9px] font-semibold transition-colors ${
          magnetMode !== 'off' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'text-neutral-600 hover:bg-neutral-100'
        }`}
      >
        <Magnet className="w-3.5 h-3.5" />
        <span>
          {magnetMode === 'off'
            ? t('Mag', 'مغناطيس')
            : magnetMode === 'weak'
              ? t('Weak', 'ضعيف')
              : t('Str', 'قوي')}
        </span>
      </button>

      <button
        type="button"
        onClick={onToggleShowAllDrawings}
        title={showAllDrawings ? t('Hide All Drawings & Overlays', 'إخفاء جميع الرسومات والطبقات') : t('Show All Drawings & Overlays', 'إظهار جميع الرسومات والطبقات')}
        className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
          !showAllDrawings
            ? 'bg-amber-600 text-white'
            : 'text-neutral-700 hover:bg-neutral-100'
        }`}
      >
        {showAllDrawings ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
      </button>

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title={t('Undo Drawing', 'تراجع عن الرسم')}
        className="min-h-[36px] min-w-[40px] flex items-center justify-center rounded-lg text-neutral-700 hover:bg-neutral-100 disabled:opacity-30"
      >
        <Undo2 className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title={t('Redo Drawing', 'إعادة الرسم')}
        className="min-h-[36px] min-w-[40px] flex items-center justify-center rounded-lg text-neutral-700 hover:bg-neutral-100 disabled:opacity-30"
      >
        <Redo2 className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => setShowObjectTree((v) => !v)}
        title={t('Object Tree / Layers', 'شجرة العناصر والطبقات')}
        className={`min-h-[40px] min-w-[40px] flex flex-col items-center justify-center rounded-lg text-[9px] font-semibold ${
          showObjectTree ? 'bg-black text-white' : 'text-neutral-700 hover:bg-neutral-100'
        }`}
      >
        <Layers className="w-4 h-4" />
        <span>{drawings.length}</span>
      </button>

      {showObjectTree && (
        <div dir={dir} className="absolute left-full bottom-2 ml-1.5 w-64 max-h-72 overflow-y-auto bg-white border border-neutral-200 rounded-xl shadow-xl p-2 z-40">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-neutral-100">
            <span className="text-xs font-semibold text-black">{t(`Object Tree (${drawings.length})`, `شجرة الرسومات (${drawings.length})`)}</span>
            <button
              type="button"
              onClick={() => setShowObjectTree(false)}
              className="text-xs text-neutral-500 hover:text-black"
            >
              {t('Close', 'إغلاق')}
            </button>
          </div>
          {drawings.length === 0 ? (
            <p className="text-xs text-neutral-500 py-4 text-center">{t('No drawings on this symbol yet.', 'لا توجد رسومات على هذا الأصل بعد.')}</p>
          ) : (
            <div className="space-y-1">
              {drawings.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded-lg border border-neutral-100 text-xs"
                >
                  <span className="truncate font-medium text-neutral-800">
                    {lang === 'ar'
                      ? TOOL_MAP[d.tool]?.nameAr || TOOL_MAP[d.tool]?.name || d.tool
                      : TOOL_MAP[d.tool]?.name || d.tool}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleHide(d.id)}
                      className="p-1 hover:bg-neutral-100 rounded"
                      title={t('Toggle visibility', 'إظهار/إخفاء')}
                    >
                      {d.hidden ? <EyeOff className="w-3.5 h-3.5 text-neutral-400" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleLock(d.id)}
                      className="p-1 hover:bg-neutral-100 rounded"
                      title={t('Toggle lock', 'قفل/فتح القفل')}
                    >
                      {d.locked ? <Lock className="w-3.5 h-3.5 text-amber-600" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDrawing(d.id)}
                      className="p-1 hover:bg-red-50 text-red-600 rounded"
                      title={t('Delete object', 'حذف العنصر')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
