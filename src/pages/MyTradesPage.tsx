import React, { useMemo, useState } from 'react';
import { Lock, Download, ArrowUpRight, ArrowDownRight, MessageSquarePlus, Eye } from 'lucide-react';
import { LiveQuote, UserTrade } from '../types/trading';
import { formatTimeInTimezone } from '../lib/timezones';
import { SYMBOL_MAP } from '../lib/schools';
import { TpMilestoneBadges } from '../components/TpMilestoneBadges';
import { useI18n } from '../lib/i18n';

interface MyTradesPageProps {
  trades: UserTrade[];
  quotes: Record<string, LiveQuote>;
  timezone: string;
  onCloseTrade: (tradeId: string, exitPrice: number) => Promise<void>;
  onSaveReflection: (tradeId: string, tags: string[], notes: string) => Promise<void>;
  onInspectSymbol: (symbol: string) => void;
  onOpenTradeCard?: (trade: UserTrade) => void;
}

const BEHAVIOR_TAGS: Array<{ id: string; ar: string }> = [
  { id: 'Followed Plan', ar: 'التزام بالخطة' },
  { id: 'A+ Patience', ar: 'صبر A+' },
  { id: 'Early Exit', ar: 'خروج مبكر' },
  { id: 'Late Entry', ar: 'دخول متأخر' },
  { id: 'FOMO', ar: 'تسرع FOMO' },
  { id: 'Moved SL', ar: 'تحريك الوقف' },
];

export const MyTradesPage: React.FC<MyTradesPageProps> = ({
  trades,
  quotes,
  timezone,
  onCloseTrade,
  onSaveReflection,
  onInspectSymbol,
  onOpenTradeCard,
}) => {
  const { lang, t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [tagInput, setTagInput] = useState<string[]>([]);

  const analytics = useMemo(() => {
    const closed = trades.filter(
      (t) => Boolean(t.closedAt) || t.status === 'Won' || t.status === 'Lost'
    );
    const won = closed.filter((t) => t.status === 'Won');
    const netUsd = Number(closed.reduce((a, b) => a + b.pnlUsd, 0).toFixed(2));
    const avgPlanScore =
      trades.length > 0
        ? Math.round(trades.reduce((a, b) => a + b.executionVsPlanScore, 0) / trades.length)
        : 100;
    const avgExitEff =
      closed.length > 0
        ? Math.round(closed.reduce((a, b) => a + b.exitEfficiency, 0) / closed.length)
        : 100;
    const avgDrift =
      trades.length > 0
        ? Number((trades.reduce((a, b) => a + b.driftPips, 0) / trades.length).toFixed(1))
        : 0;
    const postLossTrades = trades.filter((t) => t.postLossStreakCount > 0);
    const postLossWinRate =
      postLossTrades.length > 0
        ? Math.round((postLossTrades.filter((t) => t.status === 'Won').length / postLossTrades.length) * 100)
        : 100;

    return {
      total: trades.length,
      winRate: closed.length > 0 ? Math.round((won.length / closed.length) * 100) : 0,
      netUsd,
      avgPlanScore,
      avgExitEff,
      avgDrift,
      postLossWinRate,
    };
  }, [trades]);

  const exportCsv = () => {
    const headers = ['ID', 'OpenedAt', 'Symbol', 'Side', 'Type', 'Lots', 'Entry', 'SL', 'TP1', 'TP2', 'TP3', 'Exit', 'Status', 'PnL_USD', 'PnL_Pips', 'PlanScore', 'DriftPips'];
    const rows = trades.map((t) => [
      t.id,
      new Date(t.createdAt).toISOString(),
      t.symbol,
      t.side,
      t.orderType,
      t.lotSize,
      t.entryPrice,
      t.currentSl ?? t.stopLoss,
      t.tp1 ?? '',
      t.tp2 ?? '',
      t.tp3 ?? t.takeProfit,
      t.exitPrice ?? '',
      t.status,
      t.pnlUsd,
      t.pnlPips,
      t.executionVsPlanScore,
      t.driftPips,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apex_confluence_my_trades_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startReflect = (t: UserTrade) => {
    setEditingId(t.id);
    setNoteInput(t.notes);
    setTagInput(t.tags);
  };

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-neutral-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
            <Lock className="w-3.5 h-3.5 text-black" />
            <span>{t('Permanently Locked · Non-Deletable & Non-Editable Execution Ledger', 'مقفل نهائياً · سجل تنفيذ ثابت غير قابل للحذف أو التعديل')}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-black mt-0.5">
            {t('My Trades Journal', 'سجل صفقاتي')}
          </h1>
        </div>

        <button
          type="button"
          onClick={exportCsv}
          className="min-h-[40px] px-3.5 border border-neutral-300 rounded-xl text-xs font-semibold text-black hover:bg-neutral-50 flex items-center gap-1.5"
        >
          <Download className="w-4 h-4" />
          <span>{t('Read-Only CSV Export', 'تصدير CSV للقراءة فقط')}</span>
        </button>
      </div>

      {/* Behavioral & Execution-vs-Plan Analytics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono-tabular">
        <div className="border border-neutral-200 rounded-2xl p-4">
          <div className="text-xs font-sans text-neutral-500">{t('Execution vs. Plan Score', 'درجة الالتزام بالخطة')}</div>
          <div dir="ltr" className="text-2xl font-bold text-black mt-1 inline-block">{analytics.avgPlanScore}/100</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {t('AI Signal Drift:', 'انحراف السعر عن AI:')} <span dir="ltr">{analytics.avgDrift} pips</span>
          </div>
        </div>
        <div className="border border-neutral-200 rounded-2xl p-4">
          <div className="text-xs font-sans text-neutral-500">{t('Exit Efficiency', 'كفاءة الخروج')}</div>
          <div dir="ltr" className="text-2xl font-bold text-black mt-1 inline-block">{analytics.avgExitEff}%</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {t('Target capture ratio', 'نسبة اقتناص الهدف')}
          </div>
        </div>
        <div className="border border-neutral-200 rounded-2xl p-4">
          <div className="text-xs font-sans text-neutral-500">{t('Realized Net PnL', 'صافي الربح/الخسارة المحقق')}</div>
          <div dir="ltr" className={`text-2xl font-bold mt-1 inline-block ${analytics.netUsd >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {analytics.netUsd >= 0 ? '+' : ''}${analytics.netUsd}
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {t(`Win Rate: ${analytics.winRate}% (${analytics.total} trades)`, `نسبة النجاح: ${analytics.winRate}% (${analytics.total} صفقات)`)}
          </div>
        </div>
        <div className="border border-neutral-200 rounded-2xl p-4">
          <div className="text-xs font-sans text-neutral-500">{t('Post-Loss Streak Discipline', 'الانضباط بعد الخسائر')}</div>
          <div dir="ltr" className="text-2xl font-bold text-black mt-1 inline-block">{analytics.postLossWinRate}%</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {t('Recovery win-rate after SL', 'نسبة النجاح في الصفقات التالية للخسارة')}
          </div>
        </div>
      </div>

      {/* Compact Mobile Cards (Zero Horizontal Scroll) */}
      <div className="lg:hidden space-y-2.5 w-full max-w-full overflow-x-hidden">
        {trades.length === 0 ? (
          <div className="border border-dashed border-neutral-300 rounded-2xl p-6 text-center text-xs text-neutral-500 bg-white">
            {t(
              'No executed trades yet. Place an order from the Chart Order Execution ticket to log permanently.',
              'لا توجد صفقات منفذة بعد. نفذ أمراً من تذكرة الأوامر في الشارت لتسجيله نهائياً.'
            )}
          </div>
        ) : (
          trades.map((tr) => {
            const q = quotes[tr.symbol];
            const info = SYMBOL_MAP[tr.symbol] || SYMBOL_MAP.XAUUSD;
            const dec = info.decimals;
            const isClosed =
              Boolean(tr.closedAt) || tr.status === 'Won' || tr.status === 'Lost';
            const isOpenLive = !isClosed && (tr.status === 'Open' || tr.status === 'Breakeven');
            const livePrice =
              tr.side === 'BUY'
                ? q?.bid ?? q?.mid ?? tr.entryPrice
                : q?.ask ?? q?.mid ?? tr.entryPrice;

            const isBuy = tr.side === 'BUY';
            const rawDiff = isBuy ? livePrice - tr.entryPrice : tr.entryPrice - livePrice;
            const riskDist = Math.max(info.pipSize, Math.abs(tr.entryPrice - tr.stopLoss));
            const floatingPips = Number((rawDiff / info.pipSize).toFixed(1));
            const floatingUsd = Number((floatingPips * info.pipSize * info.contractSize * tr.lotSize).toFixed(2));
            const floatingR = Number((rawDiff / riskDist).toFixed(2));

            const displayUsd = isOpenLive ? floatingUsd : tr.pnlUsd;
            const displayPips = isOpenLive ? floatingPips : tr.pnlPips;
            const displayR = isOpenLive
              ? floatingR
              : tr.riskUsd > 0
                ? Number((tr.pnlUsd / tr.riskUsd).toFixed(2))
                : 0;

            const span = tr.takeProfit - tr.entryPrice;
            const tp1 = tr.tp1 ?? Number((tr.entryPrice + span * 0.45).toFixed(dec));
            const tp2 = tr.tp2 ?? Number((tr.entryPrice + span * 0.75).toFixed(dec));
            const tp3 = tr.tp3 ?? tr.takeProfit;
            const tp1Hit = Boolean(tr.tp1Hit || tr.status === 'Won');
            const tp2Hit = Boolean(tr.tp2Hit || tr.status === 'Won');
            const tp3Hit = Boolean(tr.tp3Hit || tr.status === 'Won');
            const activeSl = tr.currentSl ?? tr.stopLoss;

            const statusLabel =
              tr.status === 'Won'
                ? t('Win', 'رابحة')
                : tr.status === 'Lost'
                  ? t('Closed', 'مغلقة')
                  : tr.status === 'Breakeven'
                    ? t('Breakeven', 'تعادل')
                    : t('Active', 'نشطة');

            return (
              <div
                key={tr.id}
                onClick={() => (onOpenTradeCard ? onOpenTradeCard(tr) : onInspectSymbol(tr.symbol))}
                className="w-full max-w-full overflow-hidden border border-neutral-200 rounded-2xl p-3 bg-white space-y-2 active:bg-neutral-50 transition-colors cursor-pointer"
              >
                {/* Top Row: Symbol, Side, Lot, Timestamp, Status */}
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
                      {tr.side}
                    </span>
                    <span dir="ltr" className="text-[10px] font-mono-tabular font-semibold text-neutral-600">
                      {tr.lotSize}L
                    </span>
                    <span dir="ltr" className="text-[10px] font-mono-tabular text-neutral-400 truncate">
                      {formatTimeInTimezone(tr.createdAt, timezone, false, true)}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-bold ${
                      tr.status === 'Won'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : tr.status === 'Lost'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : tr.status === 'Breakeven'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-neutral-100 text-neutral-800 border-neutral-300'
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>

                {/* Middle Row: Entry, SL / BE, Live/Final P&L */}
                <div dir="ltr" className="grid grid-cols-3 gap-2 pt-1.5 border-t border-neutral-100 font-mono-tabular text-[11px]">
                  <div className="min-w-0">
                    <span className="block text-[9.5px] font-sans text-neutral-500">
                      {t('Entry', 'الدخول')}
                    </span>
                    <span className="font-bold text-black block truncate">{tr.entryPrice.toFixed(dec)}</span>
                    {isOpenLive && (
                      <span className="text-[9.5px] text-neutral-500 inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                        {livePrice.toFixed(dec)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[9.5px] font-sans text-neutral-500">
                      {tp1Hit ? t('BE Protected', 'حماية الدخول') : t('Stop Loss', 'الوقف')}
                    </span>
                    <span className={`font-bold block truncate ${tp1Hit ? 'text-amber-700' : 'text-red-600'}`}>
                      {tp1Hit ? 'BE' : 'SL'} {activeSl.toFixed(dec)}
                    </span>
                  </div>
                  <div className="min-w-0 text-right">
                    <span className="block text-[9.5px] font-sans text-neutral-500">
                      {isOpenLive ? t('Live P&L', 'العائد الحي') : t('Final P&L', 'النتيجة')}
                    </span>
                    <span
                      className={`font-bold block truncate ${
                        displayUsd > 0 ? 'text-emerald-700' : displayUsd < 0 ? 'text-red-600' : 'text-neutral-700'
                      }`}
                    >
                      {displayUsd >= 0 ? '+' : '-'}${Math.abs(displayUsd).toFixed(2)} ({displayR >= 0 ? '+' : ''}{displayR}R)
                    </span>
                    <span className="text-[9.5px] text-neutral-500 block">
                      {displayPips >= 0 ? '+' : ''}{displayPips}p
                    </span>
                  </div>
                </div>

                {/* Bottom Row: Compact TP1/TP2/TP3 chips + Quick Actions */}
                <div
                  className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-neutral-100 min-w-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="min-w-0">
                    <TpMilestoneBadges
                      tp1={tp1}
                      tp2={tp2}
                      tp3={tp3}
                      tp1Hit={tp1Hit}
                      tp2Hit={tp2Hit}
                      tp3Hit={tp3Hit}
                      decimals={dec}
                      compact
                      showBreakevenBadge={false}
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isOpenLive && (
                      <button
                        type="button"
                        onClick={() => void onCloseTrade(tr.id, livePrice)}
                        className="min-h-[30px] px-2 bg-black text-white rounded-lg text-[10px] font-semibold"
                      >
                        {t('Close', 'إغلاق')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startReflect(tr)}
                      className="min-h-[30px] px-2 border border-neutral-300 rounded-lg text-[10px] font-medium hover:bg-neutral-50 inline-flex items-center gap-1"
                    >
                      <MessageSquarePlus className="w-3 h-3" />
                    </button>
                    {onOpenTradeCard && (
                      <button
                        type="button"
                        onClick={() => onOpenTradeCard(tr)}
                        className="min-h-[30px] px-2 border border-neutral-300 rounded-lg text-[10px] font-semibold hover:bg-neutral-50 inline-flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(tr.symbol)}
                      className="min-h-[30px] px-2 border border-neutral-300 rounded-lg text-[10px] font-semibold hover:bg-neutral-50 inline-flex items-center gap-1"
                    >
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Inline Reflection Drawer for Mobile Card */}
                {editingId === tr.id && (
                  <div
                    className="pt-2 border-t border-neutral-200 space-y-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {BEHAVIOR_TAGS.map((tg) => {
                        const active = tagInput.includes(tg.id);
                        return (
                          <button
                            key={tg.id}
                            type="button"
                            onClick={() =>
                              setTagInput((prev) =>
                                prev.includes(tg.id) ? prev.filter((x) => x !== tg.id) : [...prev, tg.id]
                              )
                            }
                            className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${
                              active ? 'bg-black text-white border-black' : 'bg-white text-neutral-700 border-neutral-300'
                            }`}
                          >
                            {lang === 'ar' ? tg.ar : tg.id}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      placeholder={t('Append reflection note...', 'أضف ملاحظة مراجعة...')}
                      className="w-full h-9 px-3 border border-neutral-300 rounded-xl text-xs bg-white"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await onSaveReflection(tr.id, tagInput, noteInput);
                          setEditingId(null);
                        }}
                        className="flex-1 min-h-[34px] bg-black text-white rounded-xl text-xs font-semibold"
                      >
                        {t('Save', 'حفظ')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="min-h-[34px] px-3 border border-neutral-300 rounded-xl text-xs font-medium bg-white"
                      >
                        {t('Cancel', 'إلغاء')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Trades Table */}
      <div className="hidden lg:block border border-neutral-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-start text-xs">
          <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
            <tr>
              <th className="py-2.5 px-3 font-semibold text-start">{t('Time', 'الوقت')}</th>
              <th className="py-2.5 px-3 font-semibold text-start">{t('Asset · Side', 'الأصل · الاتجاه')}</th>
              <th className="py-2.5 px-3 font-semibold text-start">{t('Lots · Entry / SL', 'اللوت · الدخول / الوقف')}</th>
              <th className="py-2.5 px-3 font-semibold text-start">{t('Live Price', 'السعر الحي')}</th>
              <th className="py-2.5 px-3 font-semibold text-start">{t('TP1 / TP2 / TP3 Milestones', 'أهداف TP1 / TP2 / TP3')}</th>
              <th className="py-2.5 px-3 font-semibold text-start">{t('Status', 'الحالة')}</th>
              <th className="py-2.5 px-3 font-semibold text-start">{t('Floating / Realized PnL', 'الربح/الخسارة ($ · R)')}</th>
              <th className="py-2.5 px-3 font-semibold text-start">{t('Notes', 'الملاحظات')}</th>
              <th className="py-2.5 px-3 font-semibold text-end">{t('Actions', 'إجراءات')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {trades.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-neutral-500">
                  {t(
                    'No executed trades yet. Place an order from the Chart Order Execution ticket to log permanently.',
                    'لا توجد صفقات منفذة بعد. نفذ أمراً من تذكرة الأوامر في الشارت لتسجيله نهائياً.'
                  )}
                </td>
              </tr>
            ) : (
              trades.map((tr) => {
                const q = quotes[tr.symbol];
                const info = SYMBOL_MAP[tr.symbol] || SYMBOL_MAP.XAUUSD;
                const dec = info.decimals;
                const isClosed =
                  Boolean(tr.closedAt) || tr.status === 'Won' || tr.status === 'Lost';
                const isOpenLive = !isClosed && (tr.status === 'Open' || tr.status === 'Breakeven');
                const livePrice =
                  tr.side === 'BUY'
                    ? q?.bid ?? q?.mid ?? tr.entryPrice
                    : q?.ask ?? q?.mid ?? tr.entryPrice;

                const isBuy = tr.side === 'BUY';
                const rawDiff = isBuy ? livePrice - tr.entryPrice : tr.entryPrice - livePrice;
                const riskDist = Math.max(info.pipSize, Math.abs(tr.entryPrice - tr.stopLoss));
                const floatingPips = Number((rawDiff / info.pipSize).toFixed(1));
                const floatingUsd = Number((floatingPips * info.pipSize * info.contractSize * tr.lotSize).toFixed(2));
                const floatingR = Number((rawDiff / riskDist).toFixed(2));

                const displayUsd = isOpenLive ? floatingUsd : tr.pnlUsd;
                const displayPips = isOpenLive ? floatingPips : tr.pnlPips;
                const displayR = isOpenLive
                  ? floatingR
                  : tr.riskUsd > 0
                    ? Number((tr.pnlUsd / tr.riskUsd).toFixed(2))
                    : 0;

                const span = tr.takeProfit - tr.entryPrice;
                const tp1 = tr.tp1 ?? Number((tr.entryPrice + span * 0.45).toFixed(dec));
                const tp2 = tr.tp2 ?? Number((tr.entryPrice + span * 0.75).toFixed(dec));
                const tp3 = tr.tp3 ?? tr.takeProfit;
                const tp1Hit = Boolean(tr.tp1Hit || tr.status === 'Won');
                const tp2Hit = Boolean(tr.tp2Hit || tr.status === 'Won');
                const tp3Hit = Boolean(tr.tp3Hit || tr.status === 'Won');
                const activeSl = tr.currentSl ?? tr.stopLoss;

                const statusLabel =
                  tr.status === 'Won'
                    ? t('Won', 'رابحة')
                    : tr.status === 'Lost'
                      ? t('Lost', 'خاسرة')
                      : tr.status === 'Breakeven'
                        ? t('Breakeven', 'تعادل')
                        : t('Active', 'نشطة');

                return (
                  <React.Fragment key={tr.id}>
                    <tr className="hover:bg-neutral-50">
                      <td dir="ltr" className="py-2.5 px-3 font-mono-tabular text-neutral-600 whitespace-nowrap">
                        {formatTimeInTimezone(tr.createdAt, timezone, false, true)}
                      </td>
                      <td dir="ltr" className="py-2.5 px-3 font-bold text-black whitespace-nowrap">
                        {tr.symbol}{' '}
                        <span className={isBuy ? 'text-emerald-700' : 'text-red-600'}>
                          {tr.side}
                        </span>
                      </td>
                      <td dir="ltr" className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                        <div className="font-semibold text-black">
                          {tr.lotSize}L · {tr.entryPrice.toFixed(dec)}
                        </div>
                        <div className={`text-[10px] ${tp1Hit ? 'text-amber-700 font-semibold' : 'text-red-600'}`}>
                          {tp1Hit ? 'BE' : 'SL'}: {activeSl.toFixed(dec)}
                        </div>
                      </td>
                      <td dir="ltr" className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                        {isOpenLive ? (
                          <div className="inline-flex items-center gap-1.5 font-bold text-black">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                            <span>{livePrice.toFixed(dec)}</span>
                          </div>
                        ) : (
                          <div className="text-neutral-500 text-[11px]">
                            {tr.exitPrice !== undefined ? `${t('Exit', 'إغلاق')}: ${tr.exitPrice.toFixed(dec)}` : t('Closed', 'مغلقة')}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <TpMilestoneBadges
                          tp1={tp1}
                          tp2={tp2}
                          tp3={tp3}
                          tp1Hit={tp1Hit}
                          tp2Hit={tp2Hit}
                          tp3Hit={tp3Hit}
                          decimals={dec}
                        />
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold ${
                            tr.status === 'Won'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : tr.status === 'Lost'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : tr.status === 'Breakeven'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-neutral-100 text-neutral-800 border-neutral-300'
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td dir="ltr" className="py-2.5 px-3 font-mono-tabular whitespace-nowrap">
                        <div
                          className={`font-bold ${
                            displayUsd > 0 ? 'text-emerald-700' : displayUsd < 0 ? 'text-red-600' : 'text-neutral-700'
                          }`}
                        >
                          {displayUsd >= 0 ? '+' : '-'}${Math.abs(displayUsd).toFixed(2)} ({displayR >= 0 ? '+' : ''}{displayR}R)
                        </div>
                        <div className="text-[10px] text-neutral-500">
                          {isOpenLive ? t('Floating', 'عائم') : t('Realized', 'محقق')} · {displayPips >= 0 ? '+' : ''}{displayPips}p
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-neutral-700 max-w-[160px]">
                        {tr.tags.length > 0 && <div className="font-semibold text-black truncate">{tr.tags.join(' · ')}</div>}
                        <div className="truncate text-[11px] text-neutral-500">{tr.notes || '—'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-end space-x-1 whitespace-nowrap">
                        {isOpenLive && (
                          <button
                            type="button"
                            onClick={() => void onCloseTrade(tr.id, livePrice)}
                            className="px-2.5 py-1 bg-black text-white rounded-lg text-[11px] font-semibold mx-1"
                          >
                            {t('Close Now', 'إغلاق الآن')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => startReflect(tr)}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-300 rounded-lg text-[11px] font-medium hover:bg-neutral-100 mx-1"
                        >
                          <MessageSquarePlus className="w-3 h-3" />
                          <span>{t('Note', 'ملاحظة')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onInspectSymbol(tr.symbol)}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-neutral-300 rounded-lg text-[11px] font-medium hover:bg-neutral-100"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                    {editingId === tr.id && (
                      <tr className="bg-neutral-50">
                        <td colSpan={9} className="p-3 space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {BEHAVIOR_TAGS.map((tg) => {
                              const active = tagInput.includes(tg.id);
                              return (
                                <button
                                  key={tg.id}
                                  type="button"
                                  onClick={() =>
                                    setTagInput((prev) =>
                                      prev.includes(tg.id) ? prev.filter((x) => x !== tg.id) : [...prev, tg.id]
                                    )
                                  }
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                                    active ? 'bg-black text-white border-black' : 'bg-white text-neutral-700 border-neutral-300'
                                  }`}
                                >
                                  {lang === 'ar' ? tg.ar : tg.id}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-2">
                            <input
                              value={noteInput}
                              onChange={(e) => setNoteInput(e.target.value)}
                              placeholder={t(
                                'Append post-trade reflection note (trade parameters remain permanently locked)...',
                                'أضف ملاحظة مراجعة بعد الصفقة (تظل بيانات الصفقة مقفلة نهائياً)...'
                              )}
                              className="flex-1 h-9 px-3 border border-neutral-300 rounded-xl text-xs bg-white"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                await onSaveReflection(tr.id, tagInput, noteInput);
                                setEditingId(null);
                              }}
                              className="px-4 h-9 bg-black text-white rounded-xl text-xs font-semibold"
                            >
                              {t('Save Reflection', 'حفظ الملاحظة')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-3 h-9 border border-neutral-300 rounded-xl text-xs font-medium bg-white"
                            >
                              {t('Cancel', 'إلغاء')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
