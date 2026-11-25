import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Columns2,
  Eye,
  EyeOff,
  Calendar,
  Bookmark,
  Search,
  Check,
  ChevronDown,
  Globe,
  Clock,
  ShieldCheck,
  SlidersHorizontal,
  MoreHorizontal,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import {
  AISignal,
  AnalysisMode,
  Candle,
  ChartStyle,
  ChartTemplate,
  CustomIndicator,
  DrawingObject,
  DrawingToolId,
  LiveQuote,
  MagnetMode,
  SchoolId,
  Timeframe,
  UserAccount,
  WatchlistItem,
} from '../types/trading';
import { ANALYSIS_SCHOOLS, SUPPORTED_SYMBOLS, SYMBOL_MAP } from '../lib/schools';
import { buildSchoolOverlays, calculateLotSize, evaluateCustomIndicator } from '../lib/indicators';
import {
  CURATED_TIMEZONES,
  getAllIanaTimezones,
  getGlobalMarketSessions,
  getTimezoneOffsetLabel,
  formatTimeInTimezone,
} from '../lib/timezones';
import { ChartCanvas, LogicalRangeChange } from '../components/ChartCanvas';
import { DrawingToolbar } from '../components/DrawingToolbar';
import { SmartWatchlist } from '../components/SmartWatchlist';
import { TpMilestoneBadges } from '../components/TpMilestoneBadges';

interface ChartPageProps {
  symbol: string;
  onSelectSymbol: (s: string) => void;
  timeframe: Timeframe;
  onSelectTimeframe: (tf: Timeframe) => void;
  analysisMode: AnalysisMode;
  onChangeAnalysisMode: (m: AnalysisMode) => void;
  activeSchools: SchoolId[];
  onToggleSchool: (s: SchoolId) => void;
  onSetSchools: (s: SchoolId[]) => void;
  chartStyle: ChartStyle;
  onChangeChartStyle: (s: ChartStyle) => void;
  splitLayout: 1 | 2 | 4;
  onChangeSplitLayout: (l: 1 | 2 | 4) => void;
  comparisonSymbol: string | null;
  onChangeComparisonSymbol: (s: string | null) => void;
  candlesByKey: Record<string, Candle[]>;
  quotes: Record<string, LiveQuote>;
  signals: AISignal[];
  customIndicators: CustomIndicator[];
  onToggleIndicatorVisibility: (id: string) => void;
  drawings: DrawingObject[];
  onAddDrawing: (d: DrawingObject) => void;
  onUpdateDrawing: (d: DrawingObject, persist?: boolean) => void;
  onDeleteDrawing: (id: string) => void;
  onToggleLockDrawing: (id: string) => void;
  onToggleHideDrawing: (id: string) => void;
  onUndoDrawing: () => void;
  onRedoDrawing: () => void;
  canUndo: boolean;
  canRedo: boolean;
  activeTool: DrawingToolId;
  onSelectTool: (t: DrawingToolId) => void;
  magnetMode: MagnetMode;
  onCycleMagnet: () => void;
  watchlist: WatchlistItem[];
  onUpdateWatchlist: (items: WatchlistItem[]) => void;
  templates: ChartTemplate[];
  onSaveTemplate: (name: string) => void;
  onApplyTemplate: (tpl: ChartTemplate) => void;
  timezone: string;
  onChangeTimezone: (tz: string) => void;
  user: UserAccount | null;
  onJumpToDate: (unixSec: number) => void;
  onLoadMoreHistory?: (sym: string, tf: Timeframe, beforeTime: number) => void;
  isLoadingHistory?: boolean;
  jumpTarget?: { time: number; seq: number } | null;
  onOpenCommandPalette: () => void;
  onExecuteOrder: (order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'STOP';
    lotSize: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    signalId?: string;
  }) => Promise<void>;
  inspectedSignal: AISignal | null;
  onClearInspectedSignal: () => void;
}

export const ChartPage: React.FC<ChartPageProps> = ({
  symbol,
  onSelectSymbol,
  timeframe,
  onSelectTimeframe,
  analysisMode,
  onChangeAnalysisMode,
  activeSchools,
  onToggleSchool,
  onSetSchools,
  chartStyle,
  onChangeChartStyle,
  splitLayout,
  onChangeSplitLayout,
  comparisonSymbol,
  onChangeComparisonSymbol,
  candlesByKey,
  quotes,
  signals,
  customIndicators,
  onToggleIndicatorVisibility,
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  onDeleteDrawing,
  onToggleLockDrawing,
  onToggleHideDrawing,
  onUndoDrawing,
  onRedoDrawing,
  canUndo,
  canRedo,
  activeTool,
  onSelectTool,
  magnetMode,
  onCycleMagnet,
  watchlist,
  onUpdateWatchlist,
  templates,
  onSaveTemplate,
  onApplyTemplate,
  timezone,
  onChangeTimezone,
  user,
  onJumpToDate,
  onLoadMoreHistory,
  isLoadingHistory = false,
  jumpTarget = null,
  onOpenCommandPalette,
  onExecuteOrder,
  inspectedSignal,
  onClearInspectedSignal,
}) => {
  const { lang, dir, t } = useI18n();
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const [showAllDrawings, setShowAllDrawings] = useState(true);
  const [schoolsModalOpen, setSchoolsModalOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpDateStr, setJumpDateStr] = useState('2025-01-15');
  const [zenMode, setZenMode] = useState(false);
  const [sessionFocus, setSessionFocus] = useState(false);
  const [syncedCrosshairTime, setSyncedCrosshairTime] = useState<number | null>(null);
  const [tzDrawerOpen, setTzDrawerOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');

  // Order Ticket state
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP'>('MARKET');
  const [customEntry, setCustomEntry] = useState<string>('');
  const [customSl, setCustomSl] = useState<string>('');
  const [customTp, setCustomTp] = useState<string>('');
  const [manualLots, setManualLots] = useState<string>('');
  const [orderFeedback, setOrderFeedback] = useState<string>('');
  const [executing, setExecuting] = useState(false);

  const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
  const quote = quotes[symbol];
  const candles = candlesByKey[`${symbol}:${timeframe}`] || [];
  const compCandles = comparisonSymbol ? candlesByKey[`${comparisonSymbol}:${timeframe}`] || [] : undefined;

  const activeSymbolSignal = useMemo(() => {
    if (inspectedSignal && inspectedSignal.symbol === symbol) return inspectedSignal;
    return (
      signals.find(
        (s) => s.symbol === symbol && (s.status === 'Active' || s.status === 'Breakeven' || s.status === 'Watchlist')
      ) ||
      signals.find((s) => s.isScalp && (s.status === 'Active' || s.status === 'Breakeven')) ||
      signals[0] ||
      null
    );
  }, [inspectedSignal, signals, symbol]);

  const overlays = useMemo(() => {
    const schoolsForOverlay = analysisMode === 'ai' ? activeSchools : activeSchools.slice(0, 3);
    const sigToDraw =
      analysisMode === 'ai'
        ? activeSymbolSignal && activeSymbolSignal.symbol === symbol
          ? activeSymbolSignal
          : null
        : null;
    return buildSchoolOverlays(candles, timeframe, schoolsForOverlay, sigToDraw, analysisMode === 'ai');
  }, [candles, timeframe, activeSchools, activeSymbolSignal, symbol, analysisMode]);

  const customSeries = useMemo(() => {
    return customIndicators.flatMap((ind) => evaluateCustomIndicator(candles, ind));
  }, [candles, customIndicators]);

  const sessions = useMemo(() => getGlobalMarketSessions(Date.now()), []);
  const allTimezones = useMemo(() => getAllIanaTimezones(), []);

  // Macro correlation values
  const dxyQuote = quotes['DXY'];
  const us10yQuote = quotes['US10Y'];
  const macroCorrelation = useMemo(() => {
    if (!quote || !dxyQuote) {
      return {
        label: t('Inverse Gold–DXY', 'علاقة عكسية الذهب–الدولار'),
        score: -0.78,
      };
    }
    const sameSign = (quote.changePct24h >= 0 && dxyQuote.changePct24h >= 0) || (quote.changePct24h < 0 && dxyQuote.changePct24h < 0);
    return {
      label: sameSign
        ? t('SMT Divergence Active', 'تباعد SMT نشط')
        : t('Normal Inverse Flow', 'تدفق عكسي طبيعي'),
      score: sameSign ? 0.34 : -0.82,
    };
  }, [quote, dxyQuote, t]);

  // Order calculations
  const currentPrice = quote?.mid ?? candles[candles.length - 1]?.close ?? 0;
  const effectiveEntry = Number(customEntry) > 0 ? Number(customEntry) : currentPrice;
  const defaultSlDist = info.pipSize * 15;
  const effectiveSl =
    Number(customSl) > 0
      ? Number(customSl)
      : Number((orderSide === 'BUY' ? effectiveEntry - defaultSlDist : effectiveEntry + defaultSlDist).toFixed(info.decimals));
  const effectiveTp =
    Number(customTp) > 0
      ? Number(customTp)
      : Number((orderSide === 'BUY' ? effectiveEntry + defaultSlDist * 2.2 : effectiveEntry - defaultSlDist * 2.2).toFixed(info.decimals));

  const riskSettings = user?.riskSettings;
  const sizing = calculateLotSize(
    symbol,
    riskSettings?.accountBalance ?? 10000,
    riskSettings?.riskPerTradePct ?? 1.0,
    effectiveEntry || 1,
    effectiveSl || 1
  );
  const finalLots = Number(manualLots) > 0 ? Number(manualLots) : sizing.lots;
  const rrRatio =
    Math.abs(effectiveEntry - effectiveSl) > 0
      ? Number((Math.abs(effectiveTp - effectiveEntry) / Math.abs(effectiveEntry - effectiveSl)).toFixed(2))
      : 0;

  const loadSignalIntoOrder = (sig: AISignal) => {
    if (sig.symbol !== symbol) onSelectSymbol(sig.symbol);
    setOrderSide(sig.direction);
    setOrderType('MARKET');
    setCustomEntry(String(sig.entryPrice));
    setCustomSl(String(sig.currentSl));
    setCustomTp(String(sig.tp2));
    setOrderFeedback(
      t(
        `Loaded ${sig.symbol} ${sig.direction} plan into ticket.`,
        `تم تحميل خطة ${sig.symbol} ${sig.direction} إلى تذكرة الأمر.`
      )
    );
  };

  const submitOrder = async (sideOverride?: 'BUY' | 'SELL') => {
    const side = sideOverride || orderSide;
    setExecuting(true);
    setOrderFeedback('');
    try {
      await onExecuteOrder({
        symbol,
        side,
        orderType,
        lotSize: finalLots,
        entryPrice: effectiveEntry,
        stopLoss: effectiveSl,
        takeProfit: effectiveTp,
        signalId: activeSymbolSignal?.symbol === symbol ? activeSymbolSignal.id : undefined,
      });
      setOrderFeedback(
        t(
          `Executed ${side} ${finalLots} lots on ${symbol} (logged to My Trades).`,
          `تم تنفيذ ${side} بحجم ${finalLots} لوت على ${symbol} (مسجل في صفقاتي).`
        )
      );
    } catch (err) {
      setOrderFeedback(err instanceof Error ? err.message : t('Order rejected by risk guard.', 'تم رفض الأمر بواسطة حماية المخاطر.'));
    } finally {
      setExecuting(false);
    }
  };

  const splitCharts = useMemo<Array<{ sym: string; tf: Timeframe }>>(() => {
    if (splitLayout === 1) return [{ sym: symbol, tf: timeframe }];
    if (splitLayout === 2) {
      const altTf: Timeframe = timeframe === '15m' ? '1h' : '15m';
      return [{ sym: symbol, tf: timeframe }, { sym: symbol, tf: altTf }];
    }
    return [
      { sym: symbol, tf: '5m' },
      { sym: symbol, tf: '15m' },
      { sym: symbol, tf: '1h' },
      { sym: symbol, tf: '4h' },
    ];
  }, [splitLayout, symbol, timeframe]);

  return (
    <div className="flex flex-col flex-1 w-full bg-white">
      {/* Inspected Historical Signal Banner */}
      {inspectedSignal && (
        <div className="px-3 py-2 bg-neutral-900 text-white text-xs flex items-center justify-between gap-2">
          <span>
            {t('Inspecting AI Log Signal:', 'معاينة إشارة سجل الذكاء:')}{' '}
            <strong dir="ltr">{inspectedSignal.symbol} {inspectedSignal.direction}</strong> ({inspectedSignal.status} · {inspectedSignal.tier})
          </span>
          <button
            type="button"
            onClick={onClearInspectedSignal}
            className="px-2.5 py-1 bg-white text-black rounded-md font-semibold text-[11px]"
          >
            {t('Exit Inspection', 'إنهاء المعاينة')}
          </button>
        </div>
      )}

      {/* Slim Single-Row Top Chart Controls Strip: Left Utilities + Top-Right Single "تحليل AI" Toggle */}
      {!zenMode && (
        <div dir="ltr" className="border-b border-neutral-200 px-2.5 sm:px-4 py-1.5 flex items-center justify-between gap-2 bg-white">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Symbol Search & Quick Picker */}
            <button
              type="button"
              onClick={onOpenCommandPalette}
              title={t('Symbol Search (⌘K)', 'بحث الرموز (⌘K)')}
              className="h-8 w-8 border border-neutral-200 rounded-lg text-xs font-bold text-black hover:bg-neutral-50 flex items-center justify-center shrink-0"
            >
              <Search className="w-3.5 h-3.5 text-neutral-600" />
            </button>

            <select
              value={symbol}
              onChange={(e) => onSelectSymbol(e.target.value)}
              aria-label={t('Select Symbol', 'اختر الأصل')}
              dir="ltr"
              className="h-8 px-2 border border-neutral-300 rounded-lg text-xs font-bold bg-white text-black shrink-0"
            >
              {SUPPORTED_SYMBOLS.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol}
                </option>
              ))}
            </select>

            {/* Explicit Hide / Show All Chart Drawings Button */}
            <button
              type="button"
              onClick={() => setShowAllDrawings((v) => !v)}
              aria-pressed={!showAllDrawings}
              title={t(
                'Temporarily hide/show all manual drawings and AI chart overlays without deleting them',
                'إخفاء/إظهار جميع الرسومات اليدوية وطبقات التحليل مؤقتاً دون حذفها'
              )}
              className={`h-8 px-2 border rounded-lg text-xs font-semibold flex items-center gap-1 whitespace-nowrap transition-colors shrink-0 ${
                !showAllDrawings
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'border-neutral-200 text-black hover:bg-neutral-50'
              }`}
            >
              {showAllDrawings ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span className="hidden xs:inline sm:inline">
                {showAllDrawings ? t('Hide Drawings', 'إخفاء الرسومات') : t('Drawings Hidden', 'الرسومات مخفية')}
              </span>
            </button>

            {/* Jump to Date / Month / Year */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setJumpOpen((v) => !v);
                  setTemplatesOpen(false);
                  setOptionsOpen(false);
                }}
                title={t('Jump to Historical Date', 'الانتقال إلى تاريخ قديم')}
                className="h-8 px-2 border border-neutral-200 rounded-lg text-xs font-medium text-black hover:bg-neutral-50 flex items-center gap-1"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{t('Jump Date', 'انتقال لتاريخ')}</span>
              </button>
              {jumpOpen && (
                <div dir={dir} className="absolute left-0 top-full mt-1 w-60 bg-white border border-neutral-200 rounded-xl shadow-xl p-3 z-40 space-y-2">
                  <div className="text-xs font-semibold text-black">{t('Jump to Date / Month / Year', 'الانتقال إلى تاريخ / شهر / سنة')}</div>
                  <input
                    type="date"
                    dir="ltr"
                    value={jumpDateStr}
                    onChange={(e) => setJumpDateStr(e.target.value)}
                    className="w-full h-9 px-2 border border-neutral-300 rounded-lg text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const ts = Math.floor(new Date(jumpDateStr).getTime() / 1000);
                      if (Number.isFinite(ts) && ts > 0) onJumpToDate(ts);
                      setJumpOpen(false);
                    }}
                    className="w-full h-9 bg-black text-white rounded-lg text-xs font-semibold"
                  >
                    {t('Load Historical Candles', 'تحميل الشموع التاريخية')}
                  </button>
                </div>
              )}
            </div>

            {/* Saved Chart Templates */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setTemplatesOpen((v) => !v);
                  setJumpOpen(false);
                  setOptionsOpen(false);
                }}
                title={t('Chart Templates', 'القوالب المحفوظة')}
                className="h-8 px-2 border border-neutral-200 rounded-lg text-xs font-medium text-black hover:bg-neutral-50 flex items-center gap-1"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{t('Templates', 'القوالب')}</span>
              </button>
              {templatesOpen && (
                <div dir={dir} className="absolute left-0 top-full mt-1 w-64 bg-white border border-neutral-200 rounded-xl shadow-xl p-3 z-40 space-y-2">
                  <div className="text-xs font-semibold text-black">{t('Saved Chart Templates', 'قوالب الشارت المحفوظة')}</div>
                  <div className="flex gap-1.5">
                    <input
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      placeholder={t('Template name...', 'اسم القالب...')}
                      className="flex-1 h-8 px-2 border border-neutral-300 rounded-lg text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (tplName.trim()) {
                          onSaveTemplate(tplName.trim());
                          setTplName('');
                        }
                      }}
                      className="px-2.5 h-8 bg-black text-white rounded-lg text-xs font-semibold"
                    >
                      {t('Save', 'حفظ')}
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-neutral-100">
                    {templates.length === 0 ? (
                      <p className="text-[11px] text-neutral-500 py-2">{t('No saved templates yet.', 'لا توجد قوالب محفوظة بعد.')}</p>
                    ) : (
                      templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => {
                            onApplyTemplate(tpl);
                            setTemplatesOpen(false);
                          }}
                          className="w-full py-1.5 text-start text-xs hover:bg-neutral-50 flex items-center justify-between"
                        >
                          <span className="font-medium text-black truncate">{tpl.name}</span>
                          <span dir="ltr" className="text-[10px] text-neutral-500">{tpl.symbol} · {tpl.timeframe}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Optional Tools Menu (Chart Style, SMT Overlay, Split View, Session Focus, Zen) */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setOptionsOpen((v) => !v);
                  setJumpOpen(false);
                  setTemplatesOpen(false);
                }}
                title={t('Chart Options', 'خيارات الشارت')}
                className="h-8 px-2 border border-neutral-200 rounded-lg text-xs font-medium text-black hover:bg-neutral-50 flex items-center gap-1"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {optionsOpen && (
                <div dir={dir} className="absolute left-0 top-full mt-1 w-64 bg-white border border-neutral-200 rounded-xl shadow-xl p-3 z-40 space-y-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-600 mb-1">{t('Chart Style', 'نمط الشموع')}</label>
                    <select
                      value={chartStyle}
                      onChange={(e) => onChangeChartStyle(e.target.value as ChartStyle)}
                      className="w-full h-8 px-2 border border-neutral-300 rounded-lg text-xs font-medium bg-white text-black"
                    >
                      <option value="candles">{t('Candles', 'شموع يابانية')}</option>
                      <option value="ohlc">{t('OHLC Bars', 'أعمدة OHLC')}</option>
                      <option value="line">{t('Line', 'خطي')}</option>
                      <option value="area">{t('Area', 'مساحي')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-600 mb-1">{t('SMT Comparison Overlay', 'مقارنة الترابط SMT')}</label>
                    <select
                      value={comparisonSymbol || ''}
                      onChange={(e) => onChangeComparisonSymbol(e.target.value || null)}
                      className="w-full h-8 px-2 border border-neutral-300 rounded-lg text-xs font-medium bg-white text-black"
                    >
                      <option value="">{t('Overlay: None', 'مقارنة: بدون')}</option>
                      <option value="DXY">{t('Overlay DXY (SMT)', 'مقارنة DXY (SMT)')}</option>
                      <option value="XAGUSD">{t('Overlay XAGUSD (SMT)', 'مقارنة XAGUSD (SMT)')}</option>
                    </select>
                  </div>
                  <div className="hidden md:flex items-center justify-between pt-1">
                    <span className="text-[11px] font-semibold text-neutral-600">{t('Split View', 'تقسيم الشارت')}</span>
                    <div className="flex items-center border border-neutral-200 rounded-lg p-0.5">
                      {([1, 2, 4] as const).map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => onChangeSplitLayout(cnt)}
                          className={`px-2 py-0.5 text-[11px] font-semibold rounded-md flex items-center gap-0.5 ${
                            splitLayout === cnt ? 'bg-black text-white' : 'text-neutral-600 hover:text-black'
                          }`}
                        >
                          <Columns2 className="w-3 h-3" />
                          <span>{cnt}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1 border-t border-neutral-100">
                    <button
                      type="button"
                      onClick={() => setSessionFocus((v) => !v)}
                      className={`flex-1 h-8 px-2 border rounded-lg text-[11px] font-semibold ${
                        sessionFocus ? 'bg-black text-white border-black' : 'border-neutral-300 text-black hover:bg-neutral-50'
                      }`}
                    >
                      {t('Session Focus', 'تركيز الجلسة')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setZenMode(true);
                        setOptionsOpen(false);
                      }}
                      className="flex-1 h-8 px-2 border border-neutral-300 rounded-lg text-[11px] font-semibold text-black hover:bg-neutral-50"
                    >
                      {t('Zen Mode', 'وضع التركيز')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Single Clean "تحليل AI" Toggle at Top-Right */}
          <button
            type="button"
            onClick={() => onChangeAnalysisMode(analysisMode === 'ai' ? 'manual' : 'ai')}
            aria-pressed={analysisMode === 'ai'}
            className={`h-8 px-3 rounded-lg text-xs font-bold border flex items-center gap-1.5 whitespace-nowrap transition-colors shrink-0 ${
              analysisMode === 'ai'
                ? 'bg-black text-white border-black'
                : 'bg-white text-black border-neutral-300 hover:bg-neutral-50'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span dir={dir}>{t('AI Analysis', 'تحليل AI')}</span>
          </button>
        </div>
      )}

      {zenMode && (
        <div dir="ltr" className="px-3 py-1.5 border-b border-neutral-200 flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-black">
            {symbol} · {timeframe.toUpperCase()} ({t('Clean Zen Mode', 'وضع التركيز النظيف')})
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowAllDrawings((v) => !v)}
              className={`px-2.5 py-1 border rounded-md font-semibold flex items-center gap-1 ${
                !showAllDrawings
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'border-neutral-300 text-black hover:bg-neutral-50'
              }`}
            >
              {showAllDrawings ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>{showAllDrawings ? t('Hide Drawings', 'إخفاء الرسومات') : t('Drawings Hidden', 'الرسومات مخفية')}</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeAnalysisMode(analysisMode === 'ai' ? 'manual' : 'ai')}
              aria-pressed={analysisMode === 'ai'}
              className={`px-2.5 py-1 border rounded-md font-semibold flex items-center gap-1 ${
                analysisMode === 'ai' ? 'bg-black text-white border-black' : 'border-neutral-300 text-black'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('AI Analysis', 'تحليل AI')}</span>
            </button>
            <button
              type="button"
              onClick={() => setZenMode(false)}
              className="px-2.5 py-1 bg-black text-white rounded-md font-medium"
            >
              {t('Exit Zen Mode', 'خروج من وضع التركيز')}
            </button>
          </div>
        </div>
      )}

      {/* 16 Analysis Schools Selector Bar + Custom Indicators */}
      {!zenMode && (
        <div className="border-b border-neutral-200 px-2.5 sm:px-4 py-1 flex items-center gap-2 bg-neutral-50/60">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSchoolsModalOpen((v) => !v)}
              className="min-h-[36px] px-2.5 bg-white border border-neutral-300 rounded-lg text-xs font-semibold text-black flex items-center gap-1.5 hover:bg-neutral-50"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{t(`16 Schools (${activeSchools.length})`, `16 مدرسة (${activeSchools.length})`)}</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {schoolsModalOpen && (
              <div className={`absolute ${dir === 'rtl' ? 'right-0' : 'left-0'} top-full mt-1 w-80 sm:w-96 max-h-[65vh] overflow-y-auto bg-white border border-neutral-200 rounded-2xl shadow-2xl p-3 z-40`}>
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-100">
                  <span className="text-xs font-bold text-black">{t('All 16 Analysis Schools', 'جميع مدارس التحليل الـ 16')}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSetSchools(ANALYSIS_SCHOOLS.map((s) => s.id))}
                      className="text-[11px] font-semibold text-emerald-700 hover:underline"
                    >
                      {t('Enable All', 'تفعيل الكل')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetSchools([])}
                      className="text-[11px] font-semibold text-neutral-500 hover:underline"
                    >
                      {t('Clear', 'مسح')}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {ANALYSIS_SCHOOLS.map((sc) => {
                    const active = activeSchools.includes(sc.id);
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => onToggleSchool(sc.id)}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-start border transition-colors ${
                          active ? 'border-black bg-neutral-50' : 'border-transparent hover:bg-neutral-50'
                        }`}
                      >
                        <div className="min-w-0 px-1">
                          <div className="text-xs font-semibold text-black flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sc.color }} />
                            <span className="truncate">{sc.order}. {lang === 'ar' ? sc.nameAr : sc.nameEn}</span>
                          </div>
                          <div className="text-[11px] text-neutral-500 truncate">{lang === 'ar' ? sc.nameEn : sc.nameAr}</div>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                            active ? 'bg-black text-white' : 'border border-neutral-300'
                          }`}
                        >
                          {active && <Check className="w-3.5 h-3.5" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Scrollable Quick-Select School Chips */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 flex-1">
            {ANALYSIS_SCHOOLS.map((sc) => {
              const active = activeSchools.includes(sc.id);
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => onToggleSchool(sc.id)}
                  className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors ${
                    active
                      ? 'bg-black text-white border-black'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
                  }`}
                >
                  {lang === 'ar' ? sc.nameAr : sc.shortEn}
                </button>
              );
            })}
            {customIndicators.map((ind) => (
              <button
                key={ind.id}
                type="button"
                onClick={() => onToggleIndicatorVisibility(ind.id)}
                className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors ${
                  ind.visible
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-neutral-600 border-dashed border-neutral-300'
                }`}
              >
                AI: {lang === 'ar' && ind.nameAr ? ind.nameAr : ind.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Chart Workspace: Left Drawing Toolbar + Chart Canvas(es) + Right Smart Watchlist */}
      <div dir="ltr" className="flex flex-col sm:flex-row flex-1 items-stretch w-full border-b border-neutral-200">
        <div className="flex flex-1 min-w-0 items-stretch">
          <DrawingToolbar
            activeTool={activeTool}
            onSelectTool={onSelectTool}
            magnetMode={magnetMode}
            onCycleMagnet={onCycleMagnet}
            drawings={drawings}
            onToggleLock={onToggleLockDrawing}
            onToggleHide={onToggleHideDrawing}
            onDeleteDrawing={onDeleteDrawing}
            onUndo={onUndoDrawing}
            onRedo={onRedoDrawing}
            canUndo={canUndo}
            canRedo={canRedo}
            showAllDrawings={showAllDrawings}
            onToggleShowAllDrawings={() => setShowAllDrawings((v) => !v)}
          />

          <div
            className={`flex-1 min-w-0 grid ${
              splitLayout === 1
                ? 'grid-cols-1'
                : splitLayout === 2
                  ? 'grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-200'
                  : 'grid-cols-1 md:grid-cols-2 divide-y md:divide-x divide-neutral-200'
            }`}
          >
            {splitCharts.map((pane, idx) => {
              const paneCandles = candlesByKey[`${pane.sym}:${pane.tf}`] || candles;
              const paneOverlays =
                idx === 0
                  ? overlays
                  : buildSchoolOverlays(paneCandles, pane.tf, activeSchools, null, false);
              const dynamicHeightClass = zenMode
                ? 'h-full min-h-[calc(100dvh-146px)] md:min-h-[calc(100dvh-92px)]'
                : splitLayout === 4
                  ? 'h-[calc(50dvh-85px)] min-h-[260px]'
                  : 'h-full min-h-[calc(100dvh-198px)] sm:min-h-[calc(100dvh-152px)]';
              return (
                <ChartCanvas
                  key={`${pane.sym}-${pane.tf}-${idx}`}
                  symbol={pane.sym}
                  timeframe={pane.tf}
                  onSelectTimeframe={idx === 0 ? onSelectTimeframe : undefined}
                  candles={paneCandles}
                  comparisonCandles={idx === 0 ? compCandles : undefined}
                  comparisonSymbol={idx === 0 ? comparisonSymbol : null}
                  overlays={paneOverlays}
                  customSeries={idx === 0 ? customSeries : []}
                  chartStyle={chartStyle}
                  activeTool={activeTool}
                  magnetMode={magnetMode}
                  drawings={drawings}
                  showAllDrawings={showAllDrawings}
                  onAddDrawing={onAddDrawing}
                  onUpdateDrawing={onUpdateDrawing}
                  onDeleteDrawing={onDeleteDrawing}
                  timezone={timezone}
                  sessionFocus={sessionFocus}
                  zenMode={zenMode}
                  syncedCrosshairTime={syncedCrosshairTime}
                  onCrosshairTimeChange={splitLayout > 1 ? setSyncedCrosshairTime : undefined}
                  onVisibleLogicalRangeChanged={(range: LogicalRangeChange) => {
                    if (onLoadMoreHistory && range.startIdx <= 45 && range.oldestTime !== null) {
                      onLoadMoreHistory(pane.sym, pane.tf, range.oldestTime);
                    }
                  }}
                  isLoadingHistory={idx === 0 ? isLoadingHistory : false}
                  jumpTarget={idx === 0 ? jumpTarget : null}
                  heightClass={dynamicHeightClass}
                  onResetToolToCursor={() => onSelectTool('crosshair')}
                />
              );
            })}
          </div>
        </div>

        {!zenMode && (
          <SmartWatchlist
            open={watchlistOpen}
            onToggle={() => setWatchlistOpen((v) => !v)}
            items={watchlist}
            onUpdateItems={onUpdateWatchlist}
            quotes={quotes}
            signals={signals}
            activeSymbol={symbol}
            onSelectSymbol={onSelectSymbol}
          />
        )}
      </div>

      {/* Macro Correlation, ADR Meter, Global Session Clocks & Timezone Switcher */}
      {!zenMode && (
        <div className="px-3 sm:px-4 py-3 border-b border-neutral-200 grid grid-cols-1 md:grid-cols-3 gap-3 bg-white">
          {/* Macro Correlation Bar */}
          <div className="p-3 border border-neutral-200 rounded-xl flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium text-neutral-500">
                {t('Macro Correlation (Gold vs DXY / US10Y)', 'الارتباط الكلي (الذهب مقابل DXY / US10Y)')}
              </div>
              <div className="text-xs font-bold text-black mt-0.5">{macroCorrelation.label}</div>
              <div dir="ltr" className="text-[11px] text-neutral-600 font-mono-tabular mt-0.5 inline-block">
                DXY {dxyQuote ? dxyQuote.mid.toFixed(2) : '—'} · US10Y {us10yQuote ? `${us10yQuote.mid.toFixed(2)}%` : '—'}
              </div>
            </div>
            <div dir="ltr" className="text-right font-mono-tabular shrink-0">
              <div className="text-base font-bold text-black">{macroCorrelation.score.toFixed(2)}</div>
              <div className="text-[10px] text-neutral-500">{t('Corr Coeff', 'معامل الارتباط')}</div>
            </div>
          </div>

          {/* ADR Daily Range Remaining Meter */}
          <div className="p-3 border border-neutral-200 rounded-xl flex flex-col justify-between gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-neutral-600">{t('ADR (14) Range Used', 'استهلاك المدى اليومي ADR (14)')}</span>
              <span dir="ltr" className="font-bold text-black font-mono-tabular">
                {quote ? `${quote.adrUsedPct}% · ${t('Rem', 'متبقي')} ${quote.adrRemaining}` : '—'}
              </span>
            </div>
            <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  (quote?.adrUsedPct ?? 0) > 95 ? 'bg-red-600' : 'bg-black'
                }`}
                style={{ width: `${Math.min(100, quote?.adrUsedPct ?? 30)}%` }}
              />
            </div>
            <div className="text-[11px] text-neutral-500 font-mono-tabular flex justify-between">
              <span>{t('Spread:', 'السبريد:')} <span dir="ltr">{quote ? `${quote.spreadPips} pips` : '—'}</span></span>
              <span>{t(`Overlays Checked: ${overlays.sanityCheckedCount} (Rejected: ${overlays.rejectedOverlayCount})`, `فحص الطبقات: ${overlays.sanityCheckedCount} (مرفوض: ${overlays.rejectedOverlayCount})`)}</span>
            </div>
          </div>

          {/* Live Session Clocks & Quick Timezone Switcher */}
          <div className="p-3 border border-neutral-200 rounded-xl flex flex-col justify-between gap-1.5 relative">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-black">
                <Clock className="w-3.5 h-3.5" />
                <span dir="ltr" className="font-mono-tabular">
                  {formatTimeInTimezone(Date.now(), timezone, true, false)}
                </span>
                <span dir="ltr" className="text-[11px] text-neutral-500 font-normal">
                  ({getTimezoneOffsetLabel(timezone)})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTzDrawerOpen((v) => !v)}
                dir="ltr"
                className="text-[11px] font-semibold text-black border border-neutral-300 rounded-md px-2 py-1 hover:bg-neutral-50 flex items-center gap-1"
              >
                <Globe className="w-3 h-3" />
                <span className="truncate max-w-[110px]">{timezone}</span>
              </button>
            </div>
            <div dir="ltr" className="flex items-center gap-2 overflow-x-auto no-scrollbar text-[10px]">
              {sessions.map((s) => (
                <span key={s.id} className="whitespace-nowrap text-neutral-700 font-mono-tabular">
                  <strong className={s.isOpen ? 'text-emerald-700' : 'text-neutral-400'}>{s.name}</strong>{' '}
                  {s.countdownLabel}
                </span>
              ))}
            </div>

            {tzDrawerOpen && (
              <div className={`absolute ${dir === 'rtl' ? 'left-0' : 'right-0'} bottom-full mb-1 w-72 bg-white border border-neutral-200 rounded-xl shadow-2xl p-2.5 z-40`}>
                <input
                  value={tzSearch}
                  onChange={(e) => setTzSearch(e.target.value)}
                  placeholder={t('Search any IANA timezone (Auto DST)...', 'ابحث عن أي منطقة زمنية IANA...')}
                  className="w-full h-8 px-2 text-xs border border-neutral-300 rounded-lg mb-2 focus:outline-none focus:border-black"
                />
                <div className="max-h-48 overflow-y-auto divide-y divide-neutral-100">
                  {(tzSearch ? allTimezones.filter((tz) => tz.toLowerCase().includes(tzSearch.toLowerCase())) : CURATED_TIMEZONES.map((c) => c.id))
                    .slice(0, 40)
                    .map((tz) => (
                      <button
                        key={tz}
                        type="button"
                        dir="ltr"
                        onClick={() => {
                          onChangeTimezone(tz);
                          setTzDrawerOpen(false);
                        }}
                        className={`w-full py-1.5 px-2 text-left text-xs rounded hover:bg-neutral-50 flex items-center justify-between ${
                          timezone === tz ? 'font-bold text-black bg-neutral-100' : 'text-neutral-700'
                        }`}
                      >
                        <span className="truncate">{tz}</span>
                        <span className="text-[10px] text-neutral-500 font-mono-tabular">
                          {getTimezoneOffsetLabel(tz)}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scalping Trade Card (صفقة اسكالبينج) + Order Execution Ticket */}
      {!zenMode && (
        <div className="p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 bg-white">
          {/* Scalping Trade Card */}
          <div className="lg:col-span-7 border border-neutral-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-neutral-100">
              <div>
                <div className="text-xs font-medium text-neutral-500">
                  {activeSymbolSignal?.isScalp
                    ? t('Scalping Setup (صفقة اسكالبينج) · Live MTF Setup', 'صفقة اسكالبينج · إعداد مباشر متعدد الأطر')
                    : t('Live MTF AI Setup', 'إعداد ذكاء اصطناعي مباشر متعدد الأطر')}
                </div>
                <h2 className="text-base font-bold text-black mt-0.5">
                  {activeSymbolSignal
                    ? `${activeSymbolSignal.symbol} · ${activeSymbolSignal.direction} (${activeSymbolSignal.tier})`
                    : t('Scanning Multi-Timeframe Confluence...', 'جارٍ مسح التوافق متعدد الأطر...')}
                </h2>
              </div>
              {activeSymbolSignal && (
                <div className="flex items-center gap-2">
                  <span dir="ltr" className="text-xs font-mono-tabular font-semibold text-neutral-700">
                    {t('Score', 'التقييم')} {activeSymbolSignal.weightedScore}/100 · {activeSymbolSignal.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => loadSignalIntoOrder(activeSymbolSignal)}
                    className="min-h-[38px] px-3 bg-black text-white rounded-xl text-xs font-semibold hover:bg-neutral-800"
                  >
                    {t('Load into Ticket', 'تحميل للتنفيذ')}
                  </button>
                </div>
              )}
            </div>

            {activeSymbolSignal ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono-tabular">
                  <div className="p-2.5 border border-neutral-200 rounded-xl">
                    <div className="text-[10px] text-neutral-500 font-sans">{t('Optimal Entry Zone', 'منطقة الدخول المثلى')}</div>
                    <div dir="ltr" className="font-bold text-black mt-0.5 inline-block">
                      {activeSymbolSignal.optimalEntryZone[0]} – {activeSymbolSignal.optimalEntryZone[1]}
                    </div>
                  </div>
                  <div className="p-2.5 border border-neutral-200 rounded-xl">
                    <div className="text-[10px] text-neutral-500 font-sans">
                      {activeSymbolSignal.tp1Hit
                        ? t('SL → Breakeven', 'الوقف ← نقطة الدخول')
                        : t('Stop / Hard Inval.', 'الوقف / الإلغاء')}
                    </div>
                    <div dir="ltr" className={`font-bold mt-0.5 inline-block ${activeSymbolSignal.tp1Hit ? 'text-amber-700' : 'text-red-600'}`}>
                      {activeSymbolSignal.currentSl} / {activeSymbolSignal.hardInvalidation}
                    </div>
                  </div>
                  <div className="p-2.5 border border-neutral-200 rounded-xl">
                    <div className="text-[10px] text-neutral-500 font-sans">{t('Live Price / Floating', 'السعر الحي / العائم')}</div>
                    {(() => {
                      const q = quotes[activeSymbolSignal.symbol];
                      const lp = q?.mid ?? activeSymbolSignal.entryPrice;
                      const isBuy = activeSymbolSignal.direction === 'BUY';
                      const riskD = Math.max(info.pipSize, Math.abs(activeSymbolSignal.entryPrice - activeSymbolSignal.stopLoss));
                      const rawD = isBuy ? lp - activeSymbolSignal.entryPrice : activeSymbolSignal.entryPrice - lp;
                      const flR = Number((rawD / riskD).toFixed(2));
                      return (
                        <div dir="ltr" className="mt-0.5 flex items-center gap-1.5 font-bold">
                          <span className="text-black">{lp.toFixed(info.decimals)}</span>
                          <span className={flR >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                            ({flR >= 0 ? '+' : ''}{flR}R)
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="p-2.5 border border-neutral-200 rounded-xl">
                    <div className="text-[10px] text-neutral-500 font-sans">{t('Rec. / Dominant TF', 'الإطار الموصى / المهيمن')}</div>
                    <div dir="ltr" className="font-bold text-black mt-0.5 inline-block">
                      {activeSymbolSignal.recommendedTimeframe.toUpperCase()} / {activeSymbolSignal.dominantTimeframe.toUpperCase()}
                    </div>
                  </div>
                </div>

                {/* TP1 / TP2 / TP3 Individual Milestone Badges */}
                <TpMilestoneBadges
                  tp1={activeSymbolSignal.tp1}
                  tp2={activeSymbolSignal.tp2}
                  tp3={activeSymbolSignal.tp3}
                  tp1Hit={activeSymbolSignal.tp1Hit}
                  tp2Hit={activeSymbolSignal.tp2Hit}
                  tp3Hit={activeSymbolSignal.tp3Hit}
                  decimals={info.decimals}
                />

                {/* MTF Snapshot 1m, 5m, 15m, 1h, 4h */}
                <div dir="ltr" className="grid grid-cols-5 gap-1.5 text-center">
                  {activeSymbolSignal.mtfSnapshot.map((m) => (
                    <div key={m.timeframe} className="py-1.5 px-1 border border-neutral-200 rounded-lg">
                      <div className="text-[10px] font-bold text-black uppercase">{m.timeframe}</div>
                      <div
                        className={`text-[10px] font-semibold ${
                          m.bias === 'BULLISH' ? 'text-emerald-700' : m.bias === 'BEARISH' ? 'text-red-600' : 'text-neutral-500'
                        }`}
                      >
                        {m.bias}
                      </div>
                      <div className="text-[9px] text-neutral-500">{m.structure}</div>
                    </div>
                  ))}
                </div>

                {/* 3-line Trade Rationale */}
                <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-black leading-relaxed whitespace-pre-line">
                  {lang === 'ar'
                    ? activeSymbolSignal.rationaleAr
                    : activeSymbolSignal.rationaleEn ||
                      `${activeSymbolSignal.symbol} ${activeSymbolSignal.direction} (${activeSymbolSignal.recommendedTimeframe.toUpperCase()}): ${activeSymbolSignal.regimeMatch} across ${activeSymbolSignal.schoolsUsed.slice(0, 4).join(', ')}.\nEntry ${activeSymbolSignal.entryPrice} · SL ${activeSymbolSignal.currentSl} · TP1 ${activeSymbolSignal.tp1}.\n${activeSymbolSignal.devilsAdvocate}`}
                </div>

                {/* Checklist + Devil's Advocate + Pattern Twin */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div className="space-y-1">
                    <div className="font-semibold text-black flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                      <span>{t('One-Tap Execution Checklist', 'قائمة التحقق السريع للتنفيذ')}</span>
                    </div>
                    {activeSymbolSignal.checklist.map((item, idx) => (
                      <div key={idx} className="text-[11px] text-neutral-700 flex items-center gap-1.5">
                        <span className={item.passed ? 'text-emerald-700 font-bold' : 'text-amber-600 font-bold'}>
                          {item.passed ? '✓' : '•'}
                        </span>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1 text-[11px] text-neutral-600">
                    <div>
                      <strong className="text-black">{t("Devil's Advocate:", 'الرأي المعاكس:')}</strong> {activeSymbolSignal.devilsAdvocate}
                    </div>
                    <div>
                      <strong className="text-black">{t('Pre-TP1 Check:', 'فحص ما قبل TP1:')}</strong> {activeSymbolSignal.preTp1ObstacleCheck}
                    </div>
                    {activeSymbolSignal.patternTwin && (
                      <div>
                        <strong className="text-black">{t(`Historical Twin (${activeSymbolSignal.patternTwin.similarityPct}%):`, `التوأم التاريخي (${activeSymbolSignal.patternTwin.similarityPct}%):`)}</strong>{' '}
                        {activeSymbolSignal.patternTwin.outcome} (<span dir="ltr">{activeSymbolSignal.patternTwin.moveR}R</span>)
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-neutral-500 py-6 text-center">
                {t(
                  '24/7 MTF engine is evaluating setups. Confirmed signals appear here automatically.',
                  'محرك الأطر المتعددة 24/7 يقيّم الفرص حالياً. الإشارات المؤكدة تظهر هنا تلقائياً.'
                )}
              </p>
            )}
          </div>

          {/* Order Execution & Risk Panel */}
          <div className="lg:col-span-5 border border-neutral-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <div>
                <h3 className="text-sm font-bold text-black">{t(`Order Execution (${symbol})`, `تنفيذ الأوامر (${symbol})`)}</h3>
                <p dir="ltr" className="text-[11px] text-neutral-500 font-mono-tabular">
                  Bid {quote ? quote.bid.toFixed(info.decimals) : '—'} · Ask {quote ? quote.ask.toFixed(info.decimals) : '—'} · Spread {quote?.spreadPips ?? 0} pips
                </p>
              </div>
              <div dir="ltr" className="flex bg-neutral-100 p-0.5 rounded-lg">
                {(['MARKET', 'LIMIT', 'STOP'] as const).map((ot) => (
                  <button
                    key={ot}
                    type="button"
                    onClick={() => setOrderType(ot)}
                    className={`px-2 py-1 text-[11px] font-semibold rounded-md ${
                      orderType === ot ? 'bg-white text-black shadow-xs' : 'text-neutral-600'
                    }`}
                  >
                    {ot}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOrderSide('BUY')}
                className={`min-h-[42px] rounded-xl text-xs font-bold border transition-colors ${
                  orderSide === 'BUY'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                }`}
              >
                {t('BUY', 'شراء (BUY)')}
              </button>
              <button
                type="button"
                onClick={() => setOrderSide('SELL')}
                className={`min-h-[42px] rounded-xl text-xs font-bold border transition-colors ${
                  orderSide === 'SELL'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-red-600 border-red-200 hover:bg-red-50'
                }`}
              >
                {t('SELL', 'بيع (SELL)')}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                  {t(`Lot Size (Auto: ${sizing.lots})`, `حجم اللوت (تلقائي: ${sizing.lots})`)}
                </label>
                <input
                  type="number"
                  step="0.01"
                  dir="ltr"
                  value={manualLots}
                  onChange={(e) => setManualLots(e.target.value)}
                  placeholder={String(sizing.lots)}
                  className="w-full h-10 px-2.5 border border-neutral-300 rounded-xl font-mono-tabular text-black"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">
                  {t(`Entry (${orderType})`, `سعر الدخول (${orderType})`)}
                </label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={customEntry}
                  onChange={(e) => setCustomEntry(e.target.value)}
                  placeholder={currentPrice.toFixed(info.decimals)}
                  className="w-full h-10 px-2.5 border border-neutral-300 rounded-xl font-mono-tabular text-black"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">{t('Stop Loss', 'وقف الخسارة')}</label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={customSl}
                  onChange={(e) => setCustomSl(e.target.value)}
                  placeholder={String(effectiveSl)}
                  className="w-full h-10 px-2.5 border border-neutral-300 rounded-xl font-mono-tabular text-red-600"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-neutral-600 mb-1">{t('Take Profit', 'جني الأرباح')}</label>
                <input
                  type="number"
                  step="any"
                  dir="ltr"
                  value={customTp}
                  onChange={(e) => setCustomTp(e.target.value)}
                  placeholder={String(effectiveTp)}
                  className="w-full h-10 px-2.5 border border-neutral-300 rounded-xl font-mono-tabular text-emerald-700"
                />
              </div>
            </div>

            <div className="p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl flex items-center justify-between text-xs font-mono-tabular">
              <span>
                {t('Risk:', 'المخاطرة:')} <strong dir="ltr">${sizing.riskUsd}</strong> ({riskSettings?.riskPerTradePct ?? 1}%)
              </span>
              <span>
                SL: <strong dir="ltr">{sizing.slPips} pips</strong>
              </span>
              <span>
                R:R <strong dir="ltr">1:{rrRatio}</strong>
              </span>
            </div>

            {orderFeedback && (
              <div className="p-2.5 bg-neutral-100 border border-neutral-200 rounded-xl text-xs text-black">
                {orderFeedback}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={executing}
                onClick={() => submitOrder('BUY')}
                className="min-h-[44px] bg-emerald-700 text-white rounded-xl text-xs font-bold hover:bg-emerald-800 disabled:opacity-50"
              >
                {executing ? t('Placing...', 'جارٍ التنفيذ...') : t(`Buy ${finalLots} Lots`, `شراء ${finalLots} لوت`)}
              </button>
              <button
                type="button"
                disabled={executing}
                onClick={() => submitOrder('SELL')}
                className="min-h-[44px] bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 disabled:opacity-50"
              >
                {executing ? t('Placing...', 'جارٍ التنفيذ...') : t(`Sell ${finalLots} Lots`, `بيع ${finalLots} لوت`)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
