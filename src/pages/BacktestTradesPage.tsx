import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Crosshair,
  Filter,
  History,
  Trash2,
  Trophy,
  TrendingUp,
  Activity,
  ShieldAlert,
  Eye,
} from 'lucide-react';
import {
  BacktestSetupStatus,
  BacktestTrade,
} from '../types/trading';
import { SCHOOL_MAP, SYMBOL_MAP } from '../lib/schools';
import { computeBacktestMetrics } from '../lib/backtestEngine';
import { formatTimeInTimezone } from '../lib/timezones';
import { TpMilestoneBadges } from '../components/TpMilestoneBadges';
import { useI18n } from '../lib/i18n';

interface BacktestTradesPageProps {
  setups: BacktestTrade[];
  timezone: string;
  onJumpToSetup: (setup: BacktestTrade) => void;
  onOpenTradeCard?: (setup: BacktestTrade) => void;
  onBackToReplay: () => void;
  onClearHistory: () => void;
}

type StatusFilter = 'ALL' | BacktestSetupStatus;

export const BacktestTradesPage: React.FC<BacktestTradesPageProps> = ({
  setups,
  timezone,
  onJumpToSetup,
  onOpenTradeCard,
  onBackToReplay,
  onClearHistory,
}) => {
  const { lang, t } = useI18n();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');

  const availableSymbols = useMemo(() => {
    const uniq = Array.from(new Set(setups.map((s) => s.symbol)));
    return uniq;
  }, [setups]);

  const symbolScopedSetups = useMemo(() => {
    if (symbolFilter === 'ALL') return setups;
    return setups.filter((s) => s.symbol === symbolFilter);
  }, [setups, symbolFilter]);

  const metrics = useMemo(() => computeBacktestMetrics(symbolScopedSetups), [symbolScopedSetups]);

  const filteredSetups = useMemo(() => {
    if (statusFilter === 'ALL') return symbolScopedSetups;
    return symbolScopedSetups.filter((s) => s.status === statusFilter);
  }, [symbolScopedSetups, statusFilter]);

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

  const filterButtons: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: 'ALL', label: t('All', 'الكل'), count: symbolScopedSetups.length },
    { id: 'Won', label: t('Won', 'رابحة'), count: metrics.wonCount },
    { id: 'Lost', label: t('Lost', 'خاسرة'), count: metrics.lostCount },
    { id: 'Breakeven', label: t('Breakeven', 'تعادل'), count: metrics.breakevenCount },
    { id: 'Active', label: t('Active', 'نشطة'), count: metrics.activeCount },
  ];

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-5 space-y-5">
      {/* Header Banner */}
      <div className="p-3.5 sm:p-4 bg-amber-50/70 border border-amber-300 rounded-2xl flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-amber-600 text-white text-[10px] font-bold rounded-md">
              {t('ISOLATED BACKTEST', 'سجل باك تيست معزول')}
            </span>
            <h1 className="text-base sm:text-lg font-bold text-black">
              {t('Backtest Trades', 'صفقات الباك تيست')}
            </h1>
          </div>
          <p className="text-xs text-neutral-600">
            {t(
              'Auto-detected replay setups with zero look-ahead bias · Strictly isolated from Live AI Log & My Trades.',
              'الصفقات المكتشفة تلقائياً أثناء إعادة التشغيل بدون انحياز مستقبلي · معزولة تماماً عن سجل الذكاء وصفقاتي المباشرة.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBackToReplay}
            className="min-h-[38px] px-3.5 bg-black text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 hover:bg-neutral-800"
          >
            <History className="w-3.5 h-3.5" />
            <span>{t('Back to Replay', 'العودة لإعادة التشغيل')}</span>
          </button>
          {setups.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="min-h-[38px] px-3 border border-neutral-300 bg-white text-neutral-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 hover:bg-neutral-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('Clear Log', 'مسح السجل')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="border border-neutral-200 rounded-2xl p-3.5 bg-white">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>{t('Total Setups Found', 'إجمالي الصفقات')}</span>
            <Activity className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div dir="ltr" className="text-2xl font-bold font-mono-tabular text-black mt-1">
            {metrics.totalSetups}
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {t(
              `${metrics.wonCount}W · ${metrics.lostCount}L · ${metrics.breakevenCount}BE · ${metrics.activeCount} Active`,
              `${metrics.wonCount} ربح · ${metrics.lostCount} خسارة · ${metrics.breakevenCount} تعادل · ${metrics.activeCount} نشطة`
            )}
          </div>
        </div>

        <div className="border border-neutral-200 rounded-2xl p-3.5 bg-white">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>{t('Win Rate', 'نسبة النجاح')}</span>
            <Trophy className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div dir="ltr" className="text-2xl font-bold font-mono-tabular text-black mt-1">
            {metrics.winRatePct}%
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {t(`${metrics.closedCount} closed setups`, `${metrics.closedCount} صفقة مغلقة`)}
          </div>
        </div>

        <div className="border border-neutral-200 rounded-2xl p-3.5 bg-white">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>{t('Net R / PnL', 'صافي R والربح')}</span>
            <TrendingUp className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div
            dir="ltr"
            className={`text-2xl font-bold font-mono-tabular mt-1 ${
              metrics.netR > 0 ? 'text-emerald-700' : metrics.netR < 0 ? 'text-red-600' : 'text-black'
            }`}
          >
            {metrics.netR >= 0 ? `+${metrics.netR}R` : `${metrics.netR}R`}
          </div>
          <div
            dir="ltr"
            className={`text-[11px] font-mono-tabular font-semibold mt-0.5 ${
              metrics.netPnlUsd >= 0 ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {metrics.netPnlUsd >= 0 ? `+$${metrics.netPnlUsd}` : `-$${Math.abs(metrics.netPnlUsd)}`}
          </div>
        </div>

        <div className="border border-neutral-200 rounded-2xl p-3.5 bg-white">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>{t('Profit Factor', 'معامل الربح')}</span>
            <TrendingUp className="w-3.5 h-3.5 text-neutral-400" />
          </div>
          <div dir="ltr" className="text-2xl font-bold font-mono-tabular text-black mt-1">
            {metrics.profitFactor === 99.9 ? '∞' : metrics.profitFactor.toFixed(2)}
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {t('Gross Win / Gross Loss', 'إجمالي الربح / إجمالي الخسارة')}
          </div>
        </div>

        <div className="border border-neutral-200 rounded-2xl p-3.5 bg-white col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
            <span>{t('Max Drawdown', 'أقصى تراجع')}</span>
            <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
          </div>
          <div dir="ltr" className="text-2xl font-bold font-mono-tabular text-red-600 mt-1">
            -{metrics.maxDrawdownR}R
          </div>
          <div dir="ltr" className="text-[11px] font-mono-tabular text-neutral-500 mt-0.5">
            -{metrics.maxDrawdownPct}% {t('equity DD', 'من رأس المال')}
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="border border-neutral-200 rounded-2xl p-3 bg-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-neutral-500 flex items-center gap-1 me-1">
            <Filter className="w-3.5 h-3.5" />
            <span>{t('Status:', 'الحالة:')}</span>
          </span>
          {filterButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setStatusFilter(btn.id)}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold border transition-colors ${
                statusFilter === btn.id
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {btn.label} <span dir="ltr" className="opacity-75">({btn.count})</span>
            </button>
          ))}
        </div>

        {availableSymbols.length > 0 && (
          <div dir="ltr" className="flex items-center gap-2">
            <select
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="h-9 px-2.5 border border-neutral-300 rounded-lg text-xs font-semibold bg-white"
            >
              <option value="ALL">{t('All Symbols', 'كل الأزواج')}</option>
              {availableSymbols.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Empty State */}
      {filteredSetups.length === 0 ? (
        <div className="border border-dashed border-neutral-300 rounded-2xl p-8 text-center space-y-3 bg-white">
          <p className="text-sm font-semibold text-neutral-800">
            {setups.length === 0
              ? t(
                  'No backtest setups discovered yet. Press Play or Step +1 Bar on Backtest to auto-detect confluence setups.',
                  'لم يتم اكتشاف صفقات باك تيست بعد. اضغط تشغيل أو خطوة +1 شمعة في صفحة الباك تيست لاكتشاف الفرص تلقائياً.'
                )
              : t('No setups match the selected status filter.', 'لا توجد صفقات مطابقة للفلتر المحدد.')}
          </p>
          <button
            type="button"
            onClick={onBackToReplay}
            className="min-h-[40px] px-4 bg-black text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <History className="w-4 h-4" />
            <span>{t('Go to Backtest Replay', 'الانتقال إلى إعادة التشغيل')}</span>
          </button>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block border border-neutral-200 rounded-2xl overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3 text-start">{t('Symbol / TF', 'الزوج / الفريم')}</th>
                    <th className="py-2.5 px-3 text-start">{t('Direction', 'الاتجاه')}</th>
                    <th className="py-2.5 px-3 text-start">{t('Entry & SL', 'الدخول والوقف')}</th>
                    <th className="py-2.5 px-3 text-start">{t('Live Price', 'السعر الحي')}</th>
                    <th className="py-2.5 px-3 text-start">{t('TP1 / TP2 / TP3 Milestones', 'أهداف TP1 / TP2 / TP3')}</th>
                    <th className="py-2.5 px-3 text-start">{t('Schools Triggered', 'المدارس المتوافقة')}</th>
                    <th className="py-2.5 px-3 text-start">{t('Status / Floating PnL', 'الحالة / العائد')}</th>
                    <th className="py-2.5 px-3 text-start">{t('Timestamp', 'التوقيت')}</th>
                    <th className="py-2.5 px-3 text-end">{t('Chart', 'الشارت')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredSetups.map((tr) => {
                    const dec = (SYMBOL_MAP[tr.symbol] || SYMBOL_MAP.XAUUSD).decimals;
                    const isBuy = tr.direction === 'BUY';
                    const isOpenLive = tr.exitTime === undefined;
                    const livePrice = tr.lastLivePrice ?? tr.entryPrice;
                    const displayR = isOpenLive ? (tr.floatingPnlR ?? 0) : tr.pnlR;
                    const displayUsd = isOpenLive ? (tr.floatingPnlUsd ?? 0) : tr.pnlUsd;

                    return (
                      <tr key={tr.id} className="hover:bg-neutral-50/70">
                        <td className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                          <span className="font-bold text-black">{tr.symbol}</span>{' '}
                          <span className="text-[10px] px-1.5 py-0.5 bg-neutral-100 rounded text-neutral-700 uppercase">
                            {tr.timeframe}
                          </span>
                          <div className="text-[10px] text-neutral-400">Bar #{tr.barIndex + 1}</div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[11px] ${
                              isBuy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {isBuy ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                            {isBuy ? t('BUY', 'شراء') : t('SELL', 'بيع')}
                          </span>
                          <div dir="ltr" className="text-[10px] text-neutral-500 mt-0.5 font-mono-tabular">
                            Score {tr.score}/100
                          </div>
                        </td>
                        <td dir="ltr" className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                          <div className="font-bold text-black">{tr.entryPrice.toFixed(dec)}</div>
                          <div className="text-[10px] text-neutral-500">
                            {tr.entryZone[0].toFixed(dec)} – {tr.entryZone[1].toFixed(dec)}
                          </div>
                          <div className={`text-[10px] ${tr.tp1Hit ? 'text-amber-700 font-semibold' : 'text-red-600'}`}>
                            {tr.tp1Hit ? 'BE/Trail' : 'SL'}: {tr.currentSl.toFixed(dec)}
                          </div>
                        </td>
                        <td dir="ltr" className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                          {isOpenLive ? (
                            <div className="inline-flex items-center gap-1.5 font-bold text-black">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                              <span>{livePrice.toFixed(dec)}</span>
                            </div>
                          ) : (
                            <div className="text-[11px] text-neutral-500">
                              {tr.exitPrice !== undefined ? `${t('Exit', 'إغلاق')}: ${tr.exitPrice.toFixed(dec)}` : t('Closed', 'مغلقة')}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <TpMilestoneBadges
                            tp1={tr.tp1}
                            tp2={tr.tp2}
                            tp3={tr.tp3}
                            tp1Hit={tr.tp1Hit}
                            tp2Hit={tr.tp2Hit}
                            tp3Hit={tr.tp3Hit}
                            decimals={dec}
                          />
                        </td>
                        <td className="py-2.5 px-3 max-w-[200px]">
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
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 border rounded-md text-[11px] font-bold ${statusBadgeClass(tr.status)}`}>
                            {statusLabel(tr.status)}
                          </span>
                          <div
                            dir="ltr"
                            className={`text-[11px] font-mono-tabular font-bold mt-0.5 ${
                              displayR > 0 ? 'text-emerald-700' : displayR < 0 ? 'text-red-600' : 'text-neutral-600'
                            }`}
                          >
                            {displayR >= 0 ? '+' : ''}{displayR}R ({displayUsd >= 0 ? '+' : '-'}${Math.abs(displayUsd).toFixed(2)})
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            {isOpenLive ? t('Floating', 'عائم') : t('Frozen Realized', 'نتيجة مغلقة')}
                          </div>
                        </td>
                        <td dir="ltr" className="py-2.5 px-3 font-mono-tabular text-[11px] text-neutral-600 whitespace-nowrap">
                          {formatTimeInTimezone(tr.entryTime * 1000, timezone, false, true)}
                        </td>
                        <td className="py-2.5 px-3 text-end whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onJumpToSetup(tr)}
                            className="min-h-[34px] px-2.5 bg-black text-white rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-neutral-800"
                          >
                            <Crosshair className="w-3.5 h-3.5" />
                            <span>{t('Jump to Candle', 'معاينة على الشارت')}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Compact Mobile & Tablet Cards (Zero Horizontal Scroll) */}
          <div className="lg:hidden space-y-2.5 w-full max-w-full overflow-x-hidden">
            {filteredSetups.map((tr) => {
              const dec = (SYMBOL_MAP[tr.symbol] || SYMBOL_MAP.XAUUSD).decimals;
              const isBuy = tr.direction === 'BUY';
              const isOpenLive = tr.exitTime === undefined;
              const livePrice = tr.lastLivePrice ?? tr.entryPrice;
              const displayR = isOpenLive ? (tr.floatingPnlR ?? 0) : tr.pnlR;
              const displayUsd = isOpenLive ? (tr.floatingPnlUsd ?? 0) : tr.pnlUsd;

              return (
                <div
                  key={tr.id}
                  onClick={() => (onOpenTradeCard ? onOpenTradeCard(tr) : onJumpToSetup(tr))}
                  className="w-full max-w-full overflow-hidden border border-neutral-200 rounded-2xl p-3 bg-white space-y-2 active:bg-neutral-50 transition-colors cursor-pointer"
                >
                  {/* Top Row: Symbol, Side, TF, Time, Status */}
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span dir="ltr" className="font-bold text-sm text-black font-mono-tabular">
                        {tr.symbol}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-bold text-[10px] ${
                          isBuy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {isBuy ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {isBuy ? 'BUY' : 'SELL'}
                      </span>
                      <span dir="ltr" className="text-[10px] font-mono-tabular font-semibold text-neutral-600 uppercase">
                        {tr.timeframe}
                      </span>
                      <span dir="ltr" className="text-[10px] font-mono-tabular text-neutral-400 truncate">
                        {formatTimeInTimezone(tr.entryTime * 1000, timezone, false, true)}
                      </span>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 border rounded-md text-[10px] font-bold ${statusBadgeClass(tr.status)}`}>
                      {statusLabel(tr.status)}
                    </span>
                  </div>

                  {/* Middle Row: Entry, SL / BE, Live/Final P&L */}
                  <div dir="ltr" className="grid grid-cols-3 gap-2 pt-1.5 border-t border-neutral-100 font-mono-tabular text-[11px]">
                    <div className="min-w-0">
                      <span className="block text-[9.5px] font-sans text-neutral-500">
                        {t('Entry', 'الدخول')}
                      </span>
                      <span className="font-bold text-black block truncate">{tr.entryPrice.toFixed(dec)}</span>
                      <span className="text-[9.5px] text-neutral-500 block truncate">
                        {isOpenLive ? `${livePrice.toFixed(dec)}` : `#${tr.barIndex + 1} · ${tr.score}/100`}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[9.5px] font-sans text-neutral-500">
                        {tr.tp1Hit ? t('BE Protected', 'حماية الدخول') : t('Stop Loss', 'الوقف')}
                      </span>
                      <span className={`font-bold block truncate ${tr.tp1Hit ? 'text-amber-700' : 'text-red-600'}`}>
                        {tr.tp1Hit ? 'BE' : 'SL'} {tr.currentSl.toFixed(dec)}
                      </span>
                    </div>
                    <div className="min-w-0 text-right">
                      <span className="block text-[9.5px] font-sans text-neutral-500">
                        {isOpenLive ? t('Live P&L', 'العائد الحي') : t('Final P&L', 'النتيجة')}
                      </span>
                      <span
                        className={`font-bold block truncate ${
                          displayR > 0 ? 'text-emerald-700' : displayR < 0 ? 'text-red-600' : 'text-neutral-700'
                        }`}
                      >
                        {displayUsd >= 0 ? '+' : '-'}${Math.abs(displayUsd).toFixed(0)} ({displayR >= 0 ? '+' : ''}{displayR}R)
                      </span>
                    </div>
                  </div>

                  {/* Bottom Row: Compact TP1/TP2/TP3 chips + Quick Actions */}
                  <div
                    className="flex items-center justify-between gap-2 pt-1.5 border-t border-neutral-100 min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="min-w-0">
                      <TpMilestoneBadges
                        tp1={tr.tp1}
                        tp2={tr.tp2}
                        tp3={tr.tp3}
                        tp1Hit={tr.tp1Hit}
                        tp2Hit={tr.tp2Hit}
                        tp3Hit={tr.tp3Hit}
                        decimals={dec}
                        compact
                        showBreakevenBadge={false}
                      />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onOpenTradeCard && (
                        <button
                          type="button"
                          onClick={() => onOpenTradeCard(tr)}
                          className="min-h-[30px] px-2 border border-neutral-300 rounded-lg text-[10px] font-semibold text-black inline-flex items-center gap-1 hover:bg-neutral-50"
                        >
                          <Eye className="w-3 h-3" />
                          <span>{t('Card', 'الكارت')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onJumpToSetup(tr)}
                        className="min-h-[30px] px-2.5 bg-black text-white rounded-lg text-[10px] font-semibold inline-flex items-center gap-1 hover:bg-neutral-800"
                      >
                        <Crosshair className="w-3 h-3" />
                        <span>{t('Chart', 'الشارت')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
