import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  Swords,
  Sliders,
  RotateCcw,
  ArrowUpRight,
  ArrowDownRight,
  Crosshair,
  ListChecks,
  Sparkles,
  X,
} from 'lucide-react';
import {
  BacktestJumpRequest,
  BacktestSetupStatus,
  BacktestTrade,
  Candle,
  CustomIndicator,
  DrawingObject,
  SchoolId,
  Timeframe,
} from '../types/trading';
import { ANALYSIS_SCHOOLS, SCHOOL_MAP, SUPPORTED_SYMBOLS, SYMBOL_MAP, TIMEFRAMES } from '../lib/schools';
import {
  buildSchoolOverlays,
  calcATR,
  calcEMA,
  calcRSI,
  evaluateCustomIndicator,
  getTimeframeSeconds,
} from '../lib/indicators';
import { computeBacktestMetrics, evaluateCausalBacktest } from '../lib/backtestEngine';
import { formatTimeInTimezone } from '../lib/timezones';
import { ChartCanvas } from '../components/ChartCanvas';
import { TpMilestoneBadges } from '../components/TpMilestoneBadges';
import { useI18n } from '../lib/i18n';

interface BacktestPageProps {
  candlesByKey: Record<string, Candle[]>;
  activeSchools: SchoolId[];
  customIndicators: CustomIndicator[];
  timezone: string;
  onFetchCandles: (symbol: string, tf: Timeframe) => Promise<void>;
  totalSavedBacktestTrades: number;
  onSyncRunSetups: (runKey: string, setups: BacktestTrade[]) => void;
  onOpenBacktestTrades: () => void;
  jumpRequest: BacktestJumpRequest | null;
}

export const BacktestPage: React.FC<BacktestPageProps> = ({
  candlesByKey,
  activeSchools,
  customIndicators,
  timezone,
  onFetchCandles,
  totalSavedBacktestTrades,
  onSyncRunSetups,
  onOpenBacktestTrades,
  jumpRequest,
}) => {
  const { lang, t } = useI18n();
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [btSchools, setBtSchools] = useState<SchoolId[]>(activeSchools);
  const [replayIdxByKey, setReplayIdxByKey] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 5 | 10>(1);
  const [drawings, setDrawings] = useState<DrawingObject[]>([]);
  const [previewSetupId, setPreviewSetupId] = useState<string | null>(null);
  const [chartJumpTarget, setChartJumpTarget] = useState<{ time: number; seq: number } | null>(null);
  const jumpSeqRef = useRef(0);
  const handledJumpReqSeqRef = useRef(0);

  const runKey = `${symbol}:${timeframe}`;
  const replayIdx = replayIdxByKey[runKey] ?? 80;
  const setReplayIdxForKey = (targetKey: string, updater: number | ((prev: number) => number)) => {
    setReplayIdxByKey((prev) => {
      const cur = prev[targetKey] ?? 80;
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return next === cur ? prev : { ...prev, [targetKey]: next };
    });
  };
  const setReplayIdx = (updater: number | ((prev: number) => number)) => {
    setReplayIdxForKey(runKey, updater);
  };

  const [battleReport, setBattleReport] = useState<{
    teamA: { name: string; winRate: number; totalR: number; trades: number };
    teamB: { name: string; winRate: number; totalR: number; trades: number };
  } | null>(null);
  const [optimizerRows, setOptimizerRows] = useState<
    Array<{ fast: number; slow: number; slMult: number; winRate: number; netR: number }>
  >([]);

  const fullCandles = candlesByKey[`${symbol}:${timeframe}`] || [];
  const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;

  useEffect(() => {
    if (fullCandles.length === 0) {
      void onFetchCandles(symbol, timeframe);
    }
  }, [symbol, timeframe, fullCandles.length, onFetchCandles]);

  // Handle cross-page "Jump to Candle" requests from Backtest Trades page
  useEffect(() => {
    if (!jumpRequest || jumpRequest.seq === handledJumpReqSeqRef.current) return;
    handledJumpReqSeqRef.current = jumpRequest.seq;
    const targetKey = `${jumpRequest.symbol}:${jumpRequest.timeframe}`;
    setPlaying(false);
    setSymbol(jumpRequest.symbol);
    setTimeframe(jumpRequest.timeframe);
    setReplayIdxByKey((prev) => {
      const cur = prev[targetKey] ?? 80;
      const next = Math.max(cur, Math.max(35, jumpRequest.barIndex));
      return next === cur ? prev : { ...prev, [targetKey]: next };
    });
    setPreviewSetupId(jumpRequest.setupId);
    jumpSeqRef.current += 1;
    setChartJumpTarget({ time: jumpRequest.entryTime, seq: jumpSeqRef.current });
  }, [jumpRequest]);

  // Zero Look-Ahead Bias: slice strictly up to replayIdx!
  const visibleCandles = useMemo(() => {
    if (fullCandles.length === 0) return [];
    const safeIdx = Math.max(30, Math.min(fullCandles.length - 1, replayIdx));
    return fullCandles.slice(0, safeIdx + 1);
  }, [fullCandles, replayIdx]);

  const currentBar = visibleCandles[visibleCandles.length - 1];

  // Auto-advance playback
  useEffect(() => {
    if (!playing) return;
    const ms = Math.max(80, Math.round(900 / speed));
    const timer = setInterval(() => {
      setReplayIdxByKey((prev) => {
        const cur = prev[runKey] ?? 80;
        if (cur >= fullCandles.length - 1) {
          setPlaying(false);
          return prev;
        }
        return { ...prev, [runKey]: cur + 1 };
      });
    }, ms);
    return () => clearInterval(timer);
  }, [playing, speed, fullCandles.length, runKey]);

  // Strictly Causal Auto-Detection of Available Setups & Live Bar-by-Bar Outcomes
  const detectedSetups = useMemo(
    () => evaluateCausalBacktest(visibleCandles, symbol, timeframe, btSchools, customIndicators),
    [visibleCandles, symbol, timeframe, btSchools, customIndicators]
  );

  // Sync discovered setups to isolated Backtest Trades store (never touches AI Log / My Trades)
  useEffect(() => {
    onSyncRunSetups(`${symbol}:${timeframe}`, detectedSetups);
  }, [symbol, timeframe, detectedSetups, onSyncRunSetups]);

  const runMetrics = useMemo(() => computeBacktestMetrics(detectedSetups), [detectedSetups]);

  const previewSetup = useMemo(
    () => detectedSetups.find((s) => s.id === previewSetupId) ?? null,
    [detectedSetups, previewSetupId]
  );

  const overlays = useMemo(() => {
    const base = buildSchoolOverlays(visibleCandles, timeframe, btSchools, null, false);
    if (!previewSetup || !currentBar) return base;

    const tfSec = getTimeframeSeconds(timeframe);
    const isBuy = previewSetup.direction === 'BUY';
    const zoneEndTime = Math.min(
      currentBar.time + tfSec * 4,
      Math.max(previewSetup.entryTime + tfSec * 4, previewSetup.exitTime ?? currentBar.time)
    );

    return {
      ...base,
      zones: [
        ...base.zones,
        {
          id: `bt-zone-${previewSetup.id}`,
          school: previewSetup.schoolsUsed[0] ?? 'smc',
          label: t(`Entry Zone (${previewSetup.direction})`, `نطاق الدخول (${isBuy ? 'شراء' : 'بيع'})`),
          startTime: previewSetup.entryTime,
          endTime: zoneEndTime,
          topPrice: previewSetup.entryZone[1],
          bottomPrice: previewSetup.entryZone[0],
          color: isBuy ? '#059669' : '#DC2626',
          fillAlpha: 0.14,
        },
      ],
      markers: [
        ...base.markers,
        {
          id: `bt-marker-${previewSetup.id}`,
          school: previewSetup.schoolsUsed[0] ?? 'smc',
          time: previewSetup.entryTime,
          price: previewSetup.entryPrice,
          label: `${previewSetup.direction} ${previewSetup.score}`,
          position: isBuy ? ('below' as const) : ('above' as const),
          color: isBuy ? '#059669' : '#DC2626',
          shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
        },
      ],
      tradeLevels: {
        signalId: previewSetup.id,
        direction: previewSetup.direction,
        entry: previewSetup.entryPrice,
        optimalZoneHigh: previewSetup.entryZone[1],
        optimalZoneLow: previewSetup.entryZone[0],
        sl: previewSetup.currentSl,
        be: previewSetup.tp1Hit ? previewSetup.entryPrice : undefined,
        tp1: previewSetup.tp1,
        tp2: previewSetup.tp2,
        tp3: previewSetup.tp3,
        tp1Hit: previewSetup.tp1Hit,
        tp2Hit: previewSetup.tp2Hit,
        tp3Hit: previewSetup.tp3Hit,
        invalidation: previewSetup.stopLoss,
      },
    };
  }, [visibleCandles, timeframe, btSchools, previewSetup, currentBar, t]);

  const customSeries = useMemo(
    () => customIndicators.flatMap((ind) => evaluateCustomIndicator(visibleCandles, ind)),
    [visibleCandles, customIndicators]
  );

  const handlePreviewOnChart = (setup: BacktestTrade) => {
    setPlaying(false);
    setPreviewSetupId(setup.id);
    jumpSeqRef.current += 1;
    setChartJumpTarget({ time: setup.entryTime, seq: jumpSeqRef.current });
  };

  const statusLabel = (status: BacktestSetupStatus) => {
    if (status === 'Won') return t('Won', 'رابحة');
    if (status === 'Lost') return t('Lost', 'خاسرة');
    if (status === 'Breakeven') return t('Breakeven', 'تعادل');
    return t('Active', 'نشطة');
  };

  const statusBadgeClass = (status: BacktestSetupStatus) => {
    if (status === 'Won') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'Lost') return 'bg-red-50 text-red-700 border-red-200';
    if (status === 'Breakeven') return 'bg-amber-50 text-amber-800 border-amber-200';
    return 'bg-neutral-100 text-neutral-800 border-neutral-300';
  };

  const runAbBattle = () => {
    if (fullCandles.length < 80) return;
    const simulate = (fastP: number, slowP: number) => {
      const emaF = calcEMA(fullCandles, fastP);
      const emaS = calcEMA(fullCandles, slowP);
      const fMap = new Map(emaF.map((p) => [p.time, p.value]));
      const sMap = new Map(emaS.map((p) => [p.time, p.value]));
      let wins = 0;
      let total = 0;
      let netR = 0;
      for (let i = 30; i < fullCandles.length - 12; i += 6) {
        const c = fullCandles[i];
        const f = fMap.get(c.time);
        const s = sMap.get(c.time);
        if (!f || !s) continue;
        const dir = f > s ? 'BUY' : 'SELL';
        const atr = calcATR(fullCandles.slice(i - 20, i + 1), 14);
        const sl = dir === 'BUY' ? c.close - atr * 1.3 : c.close + atr * 1.3;
        const tp = dir === 'BUY' ? c.close + atr * 2.3 : c.close - atr * 2.3;
        let outcome = 0;
        for (let k = i + 1; k < Math.min(fullCandles.length, i + 15); k++) {
          const bar = fullCandles[k];
          if ((dir === 'BUY' && bar.low <= sl) || (dir === 'SELL' && bar.high >= sl)) {
            outcome = -1;
            break;
          }
          if ((dir === 'BUY' && bar.high >= tp) || (dir === 'SELL' && bar.low <= tp)) {
            outcome = 1.77;
            break;
          }
        }
        if (outcome !== 0) {
          total++;
          if (outcome > 0) wins++;
          netR += outcome;
        }
      }
      return {
        trades: total,
        winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
        totalR: Number(netR.toFixed(2)),
      };
    };

    setBattleReport({
      teamA: { name: 'SMC + ICT + Price Action', ...simulate(8, 21) },
      teamB: { name: 'Classical + Indicators + VSA', ...simulate(13, 50) },
    });
  };

  const runOptimizer = () => {
    if (fullCandles.length < 80) return;
    const rsi = calcRSI(fullCandles, 14);
    const rMap = new Map(rsi.map((p) => [p.time, p.value]));
    const grid = [
      { fast: 5, slow: 15, slMult: 1.2 },
      { fast: 8, slow: 21, slMult: 1.4 },
      { fast: 10, slow: 34, slMult: 1.5 },
      { fast: 12, slow: 50, slMult: 1.8 },
    ];
    const results = grid.map((cfg) => {
      const f = calcEMA(fullCandles, cfg.fast);
      const s = calcEMA(fullCandles, cfg.slow);
      const fMap = new Map(f.map((p) => [p.time, p.value]));
      const sMap = new Map(s.map((p) => [p.time, p.value]));
      let wins = 0;
      let total = 0;
      let netR = 0;
      for (let i = 35; i < fullCandles.length - 12; i += 5) {
        const c = fullCandles[i];
        const fv = fMap.get(c.time);
        const sv = sMap.get(c.time);
        const rv = rMap.get(c.time) ?? 50;
        if (!fv || !sv) continue;
        const dir = fv > sv && rv > 48 ? 'BUY' : fv < sv && rv < 52 ? 'SELL' : null;
        if (!dir) continue;
        const atr = calcATR(fullCandles.slice(i - 20, i + 1), 14);
        const sl = dir === 'BUY' ? c.close - atr * cfg.slMult : c.close + atr * cfg.slMult;
        const tp = dir === 'BUY' ? c.close + atr * cfg.slMult * 1.9 : c.close - atr * cfg.slMult * 1.9;
        for (let k = i + 1; k < Math.min(fullCandles.length, i + 16); k++) {
          const b = fullCandles[k];
          if ((dir === 'BUY' && b.low <= sl) || (dir === 'SELL' && b.high >= sl)) {
            total++;
            netR -= 1;
            break;
          }
          if ((dir === 'BUY' && b.high >= tp) || (dir === 'SELL' && b.low <= tp)) {
            total++;
            wins++;
            netR += 1.9;
            break;
          }
        }
      }
      return {
        ...cfg,
        winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
        netR: Number(netR.toFixed(2)),
      };
    });
    setOptimizerRows(results.sort((a, b) => b.netR - a.netR));
  };

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-5 space-y-4">
      {/* Isolated BACKTEST MODE Banner */}
      <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="px-2.5 py-1 bg-amber-600 text-white text-[11px] font-bold rounded-lg">
            {t('BACKTEST MODE', 'وضع الباك تيست')}
          </span>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-black">
              {t('Historical Bar Replay & Auto-Confluence Lab', 'مختبر إعادة التشغيل واكتشاف الصفقات تلقائياً')}
            </h1>
            <p className="text-xs text-neutral-700">
              {t(
                'Zero Look-Ahead Bias · Auto-detects school & indicator setups bar-by-bar without mixing into live AI Log or My Trades.',
                'بدون انحياز مستقبلي · يكتشف صفقات المدارس والمؤشرات تلقائياً شمعة بشمعة بمعزل تام عن سجل الذكاء وصفقاتي.'
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div dir="ltr" className="flex items-center gap-2">
            <select
              value={symbol}
              onChange={(e) => {
                setPlaying(false);
                setPreviewSetupId(null);
                setSymbol(e.target.value);
              }}
              className="h-9 px-2.5 border border-neutral-300 rounded-lg text-xs font-semibold bg-white"
            >
              {SUPPORTED_SYMBOLS.map((s) => (
                <option key={s.symbol} value={s.symbol}>{s.symbol}</option>
              ))}
            </select>
            <select
              value={timeframe}
              onChange={(e) => {
                setPlaying(false);
                setPreviewSetupId(null);
                setTimeframe(e.target.value as Timeframe);
              }}
              className="h-9 px-2.5 border border-neutral-300 rounded-lg text-xs font-semibold bg-white"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf.id} value={tf.id}>{tf.label}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onOpenBacktestTrades}
            className="h-9 px-3 bg-black text-white rounded-lg text-xs font-bold flex items-center gap-1.5 hover:bg-neutral-800 whitespace-nowrap"
          >
            <ListChecks className="w-3.5 h-3.5" />
            <span>
              {t('Backtest Trades', 'صفقات الباك تيست')} ({totalSavedBacktestTrades})
            </span>
          </button>
        </div>
      </div>

      {/* Replay Transport Bar (Manual BUY/SELL removed — pure auto-discovery) */}
      <div className="border border-neutral-200 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 bg-white">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="min-h-[40px] px-3.5 bg-black text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{playing ? t('Pause', 'إيقاف مؤقت') : t('Play', 'تشغيل')}</span>
          </button>
          <button
            type="button"
            onClick={() => setReplayIdx((i) => Math.min(fullCandles.length - 1, i + 1))}
            className="min-h-[40px] px-3 border border-neutral-300 rounded-xl text-xs font-semibold flex items-center gap-1 hover:bg-neutral-50"
          >
            <SkipForward className="w-4 h-4" />
            <span>{t('Step +1 Bar', 'خطوة +1 شمعة')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setPreviewSetupId(null);
              setReplayIdx(50);
            }}
            className="min-h-[40px] px-3 border border-neutral-300 rounded-xl text-xs font-semibold flex items-center gap-1 hover:bg-neutral-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('Cut to Start', 'العودة للبداية')}</span>
          </button>

          <div dir="ltr" className="flex bg-neutral-100 p-0.5 rounded-lg">
            {([1, 2, 5, 10] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setSpeed(sp)}
                className={`px-2 py-1 text-xs font-semibold rounded-md ${
                  speed === sp ? 'bg-white text-black shadow-xs' : 'text-neutral-600'
                }`}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-[200px] flex items-center gap-3">
          <span dir="ltr" className="text-xs font-mono-tabular text-neutral-600 whitespace-nowrap">
            {t('Bar', 'شمعة')} {visibleCandles.length} / {fullCandles.length}
          </span>
          <input
            type="range"
            min={35}
            max={Math.max(40, fullCandles.length - 1)}
            value={Math.min(replayIdx, Math.max(40, fullCandles.length - 1))}
            onChange={(e) => {
              setPlaying(false);
              setReplayIdx(Number(e.target.value));
            }}
            className="w-full accent-black"
          />
        </div>

        {/* Live Auto-Scan Status Pill */}
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {t('Auto-Scan Active:', 'الكشف التلقائي نشط:')} {detectedSetups.length} {t('setups', 'صفقة')}
            </span>
          </span>
          {previewSetup && (
            <button
              type="button"
              onClick={() => setPreviewSetupId(null)}
              className="min-h-[34px] px-2.5 border border-neutral-300 rounded-xl text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t('Clear Preview', 'إلغاء المعاينة')}</span>
            </button>
          )}
        </div>
      </div>

      {/* School Selector for Backtest */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {ANALYSIS_SCHOOLS.map((sc) => {
          const active = btSchools.includes(sc.id);
          return (
            <button
              key={sc.id}
              type="button"
              onClick={() =>
                setBtSchools((prev) =>
                  prev.includes(sc.id) ? prev.filter((x) => x !== sc.id) : [...prev, sc.id]
                )
              }
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap shrink-0 ${
                active ? 'bg-black text-white border-black' : 'bg-white text-neutral-700 border-neutral-200'
              }`}
            >
              {lang === 'ar' ? sc.nameAr : sc.shortEn}
            </button>
          );
        })}
      </div>

      {/* Isolated Replay Chart */}
      <div dir="ltr" className="border border-neutral-200 rounded-2xl overflow-hidden">
        <ChartCanvas
          symbol={symbol}
          timeframe={timeframe}
          candles={visibleCandles}
          overlays={overlays}
          customSeries={customSeries}
          chartStyle="candles"
          activeTool="crosshair"
          magnetMode="off"
          drawings={drawings}
          showAllDrawings
          onAddDrawing={(d) => setDrawings((prev) => [...prev, d])}
          onUpdateDrawing={(d) => setDrawings((prev) => prev.map((x) => (x.id === d.id ? d : x)))}
          onDeleteDrawing={(id) => setDrawings((prev) => prev.filter((d) => d.id !== id))}
          timezone={timezone}
          jumpTarget={chartJumpTarget}
          isBacktest
          heightClass="h-[380px] sm:h-[460px]"
        />
      </div>

      {/* Available Backtest Setups Panel (Auto-Detected During Replay) */}
      <div className="border border-neutral-200 rounded-2xl p-4 bg-white space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-neutral-100">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-black flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-700" />
              <span>
                {t('Available Backtest Setups', 'الصفقات المتاحة')} ({detectedSetups.length})
              </span>
            </h2>
            <p className="text-[11px] text-neutral-500">
              {t(
                'Automatically discovered by active schools & custom indicators up to the current replay candle.',
                'صفقات مكتشفة تلقائياً عبر المدارس والمؤشرات النشطة حتى شمعة إعادة التشغيل الحالية دون أي تسريب مستقبلي.'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular">
            <span dir="ltr" className="px-2.5 py-1 bg-neutral-100 rounded-lg font-semibold text-black">
              WR {runMetrics.winRatePct}% · {runMetrics.netR >= 0 ? `+${runMetrics.netR}R` : `${runMetrics.netR}R`}
            </span>
            <button
              type="button"
              onClick={onOpenBacktestTrades}
              className="min-h-[34px] px-3 border border-black rounded-lg text-xs font-bold text-black hover:bg-neutral-50 flex items-center gap-1.5"
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>{t('Open Full Backtest Trades', 'عرض صفحة صفقات الباك تيست')}</span>
            </button>
          </div>
        </div>

        {detectedSetups.length === 0 ? (
          <div className="py-8 text-center text-xs text-neutral-500">
            {t(
              'No setups triggered yet at this replay candle. Press Play or Step +1 Bar to scan forward.',
              'لم تتحقق شروط توافق حتى هذه الشمعة بعد. اضغط تشغيل أو خطوة +1 شمعة لاكتشاف الصفقات المتاحة.'
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pe-1">
            {detectedSetups.map((tr) => {
              const isBuy = tr.direction === 'BUY';
              const isSelected = tr.id === previewSetupId;
              const isOpenLive = tr.exitTime === undefined;
              const livePrice = tr.lastLivePrice ?? tr.entryPrice;
              const displayR = isOpenLive ? (tr.floatingPnlR ?? 0) : tr.pnlR;
              const displayUsd = isOpenLive ? (tr.floatingPnlUsd ?? 0) : tr.pnlUsd;

              return (
                <div
                  key={tr.id}
                  className={`border rounded-2xl p-3 space-y-2.5 transition-colors ${
                    isSelected ? 'border-black bg-neutral-50/70' : 'border-neutral-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[11px] ${
                          isBuy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {isBuy ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {isBuy ? t('Buy', 'شراء') : t('Sell', 'بيع')}
                      </span>
                      <span dir="ltr" className="text-xs font-bold text-black font-mono-tabular">
                        {tr.score}/100
                      </span>
                      <span dir="ltr" className="text-[10px] text-neutral-400 font-mono-tabular">
                        #{tr.barIndex + 1}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 border rounded-md text-[10px] font-bold ${statusBadgeClass(tr.status)}`}>
                        {statusLabel(tr.status)}
                      </span>
                      <span
                        dir="ltr"
                        className={`text-[11px] font-mono-tabular font-bold ${
                          displayR > 0 ? 'text-emerald-700' : displayR < 0 ? 'text-red-600' : 'text-neutral-600'
                        }`}
                      >
                        {displayR >= 0 ? '+' : ''}{displayR}R ({displayUsd >= 0 ? '+' : '-'}${Math.abs(displayUsd).toFixed(0)})
                      </span>
                    </div>
                  </div>

                  {/* Entry Zone, Live/Exit Price, SL */}
                  <div dir="ltr" className="grid grid-cols-3 gap-1.5 text-[11px] font-mono-tabular bg-neutral-50 p-2 rounded-xl">
                    <div>
                      <span className="text-[9px] text-neutral-500 block">ENTRY</span>
                      <span className="font-bold text-black">{tr.entryPrice.toFixed(info.decimals)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-neutral-500 block">
                        {isOpenLive ? 'LIVE PRICE' : 'EXIT'}
                      </span>
                      <span className="font-bold text-black">
                        {isOpenLive ? livePrice.toFixed(info.decimals) : (tr.exitPrice ?? tr.entryPrice).toFixed(info.decimals)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-neutral-500 block">
                        SL {tr.tp1Hit ? '(BE)' : ''}
                      </span>
                      <span className={`font-bold ${tr.tp1Hit ? 'text-amber-700' : 'text-red-600'}`}>
                        {tr.currentSl.toFixed(info.decimals)}
                      </span>
                    </div>
                  </div>

                  <TpMilestoneBadges
                    tp1={tr.tp1}
                    tp2={tr.tp2}
                    tp3={tr.tp3}
                    tp1Hit={tr.tp1Hit}
                    tp2Hit={tr.tp2Hit}
                    tp3Hit={tr.tp3Hit}
                    decimals={info.decimals}
                  />

                  {/* Schools & Custom Indicator Match Chips */}
                  <div className="flex flex-wrap gap-1">
                    {tr.schoolsUsed.map((sid) => (
                      <span
                        key={sid}
                        className="px-1.5 py-0.5 bg-neutral-100 text-neutral-800 rounded text-[10px] font-medium"
                      >
                        {lang === 'ar' ? SCHOOL_MAP[sid]?.nameAr || sid : SCHOOL_MAP[sid]?.shortEn || sid}
                      </span>
                    ))}
                    {tr.indicatorMatches.map((name) => (
                      <span
                        key={name}
                        className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium"
                      >
                        {name}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-100">
                    <span dir="ltr" className="text-[10px] font-mono-tabular text-neutral-500">
                      {formatTimeInTimezone(tr.entryTime * 1000, timezone, false, true)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handlePreviewOnChart(tr)}
                      className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
                        isSelected
                          ? 'bg-emerald-700 text-white'
                          : 'bg-black text-white hover:bg-neutral-800'
                      }`}
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      <span>{isSelected ? t('Previewing', 'قيد المعاينة') : t('Preview on Chart', 'معاينة على الشارت')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* A/B Battles & AI Parameter Optimizer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* School A/B Battle */}
        <div className="border border-neutral-200 rounded-2xl p-4 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-black flex items-center gap-1.5">
              <Swords className="w-4 h-4" />
              <span>{t('School A/B Battle', 'منافسة المدارس A/B')}</span>
            </h3>
            <button
              type="button"
              onClick={runAbBattle}
              className="px-3 py-1.5 bg-black text-white rounded-lg text-xs font-semibold"
            >
              {t('Run Battle', 'بدء المنافسة')}
            </button>
          </div>
          {battleReport ? (
            <div className="space-y-2 text-xs font-mono-tabular">
              <div className="p-2.5 border border-neutral-200 rounded-xl flex justify-between">
                <span className="font-sans font-semibold text-black">{battleReport.teamA.name}</span>
                <span dir="ltr">WR {battleReport.teamA.winRate}% · {battleReport.teamA.totalR}R</span>
              </div>
              <div className="p-2.5 border border-neutral-200 rounded-xl flex justify-between">
                <span className="font-sans font-semibold text-black">{battleReport.teamB.name}</span>
                <span dir="ltr">WR {battleReport.teamB.winRate}% · {battleReport.teamB.totalR}R</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              {t(
                `Pit two school combinations head-to-head on historical ${symbol} data.`,
                `قارن أداء مجموعتين من المدارس وجهاً لوجه على البيانات التاريخية لـ ${symbol}.`
              )}
            </p>
          )}
        </div>

        {/* AI Parameter Optimizer */}
        <div className="border border-neutral-200 rounded-2xl p-4 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-black flex items-center gap-1.5">
              <Sliders className="w-4 h-4" />
              <span>{t('AI Parameter Optimizer', 'محسّن المعاملات الذكي')}</span>
            </h3>
            <button
              type="button"
              onClick={runOptimizer}
              className="px-3 py-1.5 bg-black text-white rounded-lg text-xs font-semibold"
            >
              {t('Optimize', 'تحسين')}
            </button>
          </div>
          {optimizerRows.length > 0 ? (
            <div dir="ltr" className="space-y-1.5 text-xs font-mono-tabular">
              {optimizerRows.map((row, idx) => (
                <div key={idx} className="flex justify-between py-1 border-b border-neutral-100">
                  <span>EMA {row.fast}/{row.slow} · SL {row.slMult}x</span>
                  <span className={row.netR >= 0 ? 'text-emerald-700 font-bold' : 'text-red-600'}>
                    WR {row.winRate}% · {row.netR}R
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              {t(
                'Tests stable parameter bands without curve-fitting or look-ahead leakage.',
                'يختبر نطاقات معاملات مستقرة دون إفراط في التخصيص أو تسريب مستقبلي.'
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
