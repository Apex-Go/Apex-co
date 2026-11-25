import React from 'react';
import { X, Crosshair, ArrowUpRight, ArrowDownRight, ShieldCheck, AlertTriangle, Layers } from 'lucide-react';
import type {
  AISignal,
  AlertEvent,
  BacktestTrade,
  LiveQuote,
  LossRootCauseCategory,
  UserTrade,
} from '../types/trading';
import { SCHOOL_MAP, SYMBOL_MAP } from '../lib/schools';
import { formatTimeInTimezone } from '../lib/timezones';
import { TpMilestoneBadges } from './TpMilestoneBadges';
import { useI18n } from '../lib/i18n';

const LOSS_CAUSE_AR: Record<LossRootCauseCategory, string> = {
  'Counter-Trend / Against Momentum': 'عكس الاتجاه العام أو الزخم',
  'Late Entry / Chasing': 'دخول متأخر / مطاردة السعر',
  'Wide SL / Volatility Spike': 'وقف خسارة واسع أو تذبذب حاد',
  'Premature / Weak Confluence': 'توافق ضعيف أو عائق قبل TP1',
};

export type InspectedTradePayload =
  | { kind: 'signal'; signal: AISignal; alert?: AlertEvent }
  | { kind: 'user'; trade: UserTrade; alert?: AlertEvent }
  | { kind: 'backtest'; setup: BacktestTrade; alert?: AlertEvent }
  | { kind: 'alertOnly'; alert: AlertEvent };

interface TradeDetailsModalProps {
  payload: InspectedTradePayload | null;
  quotes: Record<string, LiveQuote>;
  timezone: string;
  riskUsdPerR?: number;
  onClose: () => void;
  onJumpToChart: (payload: InspectedTradePayload) => void;
}

export const TradeDetailsModal: React.FC<TradeDetailsModalProps> = ({
  payload,
  quotes,
  timezone,
  riskUsdPerR = 100,
  onClose,
  onJumpToChart,
}) => {
  const { lang, t } = useI18n();
  if (!payload) return null;

  const alertCtx = payload.alert;

  let symbol = alertCtx?.symbol || 'XAUUSD';
  let direction: 'BUY' | 'SELL' = 'BUY';
  let timeframeLabel = '15M';
  let timestamp = alertCtx?.createdAt || Date.now();
  let statusText = t('Active', 'نشطة');
  let statusClass = 'text-neutral-900 bg-neutral-100 border-neutral-300';
  let entryPrice = 0;
  let slPrice = 0;
  let tp1 = 0;
  let tp2: number | undefined;
  let tp3: number | undefined;
  let tp1Hit = false;
  let tp2Hit = false;
  let tp3Hit = false;
  let isLiveOpen = false;
  let livePrice = 0;
  let pnlR = 0;
  let pnlUsd = 0;
  let pnlPips = 0;
  let scoreLabel = '';
  let schools: string[] = [];
  let headlineReason = '';
  let rationaleText = '';
  let autopsyText = '';
  let lossCauseLabel = '';
  let optZone: [number, number] | null = null;
  let hasGeometry = true;

  if (payload.kind === 'signal') {
    const s = payload.signal;
    const info = SYMBOL_MAP[s.symbol] || SYMBOL_MAP.XAUUSD;
    symbol = s.symbol;
    direction = s.direction;
    timeframeLabel = s.recommendedTimeframe.toUpperCase();
    timestamp = s.createdAt;
    entryPrice = s.entryPrice;
    slPrice = s.currentSl;
    tp1 = s.tp1;
    tp2 = s.tp2;
    tp3 = s.tp3;
    tp1Hit = Boolean(s.tp1Hit || s.status === 'Won');
    tp2Hit = Boolean(s.tp2Hit ?? (s.status === 'Won' && s.pnlR >= 1.5));
    tp3Hit = Boolean(s.tp3Hit ?? (s.status === 'Won' && s.pnlR >= 2.5));
    optZone = s.optimalEntryZone;

    const isClosed = Boolean(s.closedAt) || s.status === 'Won' || s.status === 'Lost';
    isLiveOpen = !isClosed && (s.status === 'Active' || s.status === 'Breakeven');
    livePrice = quotes[s.symbol]?.mid ?? s.entryPrice;
    const riskDist = Math.max(info.pipSize, Math.abs(s.entryPrice - s.stopLoss));
    const rawDiff = s.direction === 'BUY' ? livePrice - s.entryPrice : s.entryPrice - livePrice;
    pnlR = isLiveOpen ? Number((rawDiff / riskDist).toFixed(2)) : s.pnlR;
    pnlPips = isLiveOpen ? Number((rawDiff / info.pipSize).toFixed(1)) : s.pnlPips;
    pnlUsd = Number((pnlR * riskUsdPerR).toFixed(2));

    scoreLabel = `${s.tier} · ${s.weightedScore}/100`;
    schools = s.schoolsUsed.map((id) => (lang === 'ar' ? SCHOOL_MAP[id]?.nameAr || id : SCHOOL_MAP[id]?.shortEn || id));
    headlineReason = `${s.regimeMatch} · ${s.liquidityFingerprint}`;
    rationaleText = lang === 'ar' ? s.rationaleAr : s.rationaleEn || s.rationaleAr;
    lossCauseLabel = s.lossCause ? (lang === 'ar' ? LOSS_CAUSE_AR[s.lossCause] : s.lossCause) : '';
    autopsyText = s.lossCauseDetail || s.autopsySummary || '';

    statusText =
      s.status === 'Won'
        ? t('Win', 'رابحة')
        : s.status === 'Lost'
          ? t('Closed (SL)', 'مغلقة (SL)')
          : s.status === 'Breakeven'
            ? t('Breakeven', 'تعادل / حماية')
            : s.status === 'Watchlist'
              ? t('Monitoring', 'قيد المراقبة')
              : t('Active', 'نشطة');
    statusClass =
      s.status === 'Won'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : s.status === 'Lost'
          ? 'bg-red-50 text-red-700 border-red-200'
          : s.status === 'Breakeven'
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-neutral-100 text-neutral-900 border-neutral-300';
  } else if (payload.kind === 'user') {
    const tr = payload.trade;
    const info = SYMBOL_MAP[tr.symbol] || SYMBOL_MAP.XAUUSD;
    const dec = info.decimals;
    symbol = tr.symbol;
    direction = tr.side;
    timeframeLabel = `${tr.lotSize}L ${tr.orderType}`;
    timestamp = tr.createdAt;
    entryPrice = tr.entryPrice;
    slPrice = tr.currentSl ?? tr.stopLoss;
    const span = tr.takeProfit - tr.entryPrice;
    tp1 = tr.tp1 ?? Number((tr.entryPrice + span * 0.45).toFixed(dec));
    tp2 = tr.tp2 ?? Number((tr.entryPrice + span * 0.75).toFixed(dec));
    tp3 = tr.tp3 ?? tr.takeProfit;
    tp1Hit = Boolean(tr.tp1Hit || tr.status === 'Won');
    tp2Hit = Boolean(tr.tp2Hit || tr.status === 'Won');
    tp3Hit = Boolean(tr.tp3Hit || tr.status === 'Won');

    const isClosed = Boolean(tr.closedAt) || tr.status === 'Won' || tr.status === 'Lost';
    isLiveOpen = !isClosed && (tr.status === 'Open' || tr.status === 'Breakeven');
    const q = quotes[tr.symbol];
    livePrice = tr.side === 'BUY' ? q?.bid ?? q?.mid ?? tr.entryPrice : q?.ask ?? q?.mid ?? tr.entryPrice;
    const rawDiff = tr.side === 'BUY' ? livePrice - tr.entryPrice : tr.entryPrice - livePrice;
    const riskDist = Math.max(info.pipSize, Math.abs(tr.entryPrice - tr.stopLoss));
    const floatPips = Number((rawDiff / info.pipSize).toFixed(1));
    const floatUsd = Number((floatPips * info.pipSize * info.contractSize * tr.lotSize).toFixed(2));
    const floatR = Number((rawDiff / riskDist).toFixed(2));

    pnlUsd = isLiveOpen ? floatUsd : tr.pnlUsd;
    pnlPips = isLiveOpen ? floatPips : tr.pnlPips;
    pnlR = isLiveOpen ? floatR : tr.riskUsd > 0 ? Number((tr.pnlUsd / tr.riskUsd).toFixed(2)) : 0;

    scoreLabel = `${t('Plan Score', 'الالتزام')}: ${tr.executionVsPlanScore}/100`;
    schools = tr.tags;
    headlineReason = `R:R ${tr.rrRatio}:1 · ${t('Drift', 'انحراف')}: ${tr.driftPips}p`;
    rationaleText = tr.notes || t('Execution locked in immutable ledger.', 'تم قفل بيانات التنفيذ في السجل الثابت.');
    lossCauseLabel = tr.lossCause ? (lang === 'ar' ? LOSS_CAUSE_AR[tr.lossCause] : tr.lossCause) : '';
    autopsyText = tr.lossCauseDetail || '';

    statusText =
      tr.status === 'Won'
        ? t('Win', 'رابحة')
        : tr.status === 'Lost'
          ? t('Closed (SL)', 'مغلقة (SL)')
          : tr.status === 'Breakeven'
            ? t('Breakeven', 'تعادل / حماية')
            : t('Active', 'نشطة');
    statusClass =
      tr.status === 'Won'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : tr.status === 'Lost'
          ? 'bg-red-50 text-red-700 border-red-200'
          : tr.status === 'Breakeven'
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-neutral-100 text-neutral-900 border-neutral-300';
  } else if (payload.kind === 'backtest') {
    const bt = payload.setup;
    symbol = bt.symbol;
    direction = bt.direction;
    timeframeLabel = bt.timeframe.toUpperCase();
    timestamp = bt.entryTime * 1000;
    entryPrice = bt.entryPrice;
    slPrice = bt.currentSl;
    tp1 = bt.tp1;
    tp2 = bt.tp2;
    tp3 = bt.tp3;
    tp1Hit = bt.tp1Hit;
    tp2Hit = bt.tp2Hit;
    tp3Hit = bt.tp3Hit;
    optZone = bt.entryZone;
    isLiveOpen = bt.exitTime === undefined;
    livePrice = bt.lastLivePrice ?? bt.entryPrice;
    pnlR = isLiveOpen ? (bt.floatingPnlR ?? 0) : bt.pnlR;
    pnlUsd = isLiveOpen ? (bt.floatingPnlUsd ?? 0) : bt.pnlUsd;
    pnlPips = isLiveOpen ? (bt.floatingPips ?? 0) : 0;
    scoreLabel = `${bt.score}/100`;
    schools = [
      ...bt.schoolsUsed.map((id) => (lang === 'ar' ? SCHOOL_MAP[id]?.nameAr || id : SCHOOL_MAP[id]?.shortEn || id)),
      ...bt.indicatorMatches,
    ];
    headlineReason = t('Zero Look-Ahead Backtest Setup', 'فرصة باك تيست بدون انحياز مستقبلي');
    rationaleText = lang === 'ar' ? bt.rationaleAr : bt.rationaleEn;
    statusText =
      bt.status === 'Won'
        ? t('Win', 'رابحة')
        : bt.status === 'Lost'
          ? t('Closed (SL)', 'مغلقة (SL)')
          : bt.status === 'Breakeven'
            ? t('Breakeven', 'تعادل / حماية')
            : t('Active', 'نشطة');
    statusClass =
      bt.status === 'Won'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : bt.status === 'Lost'
          ? 'bg-red-50 text-red-700 border-red-200'
          : bt.status === 'Breakeven'
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-neutral-100 text-neutral-900 border-neutral-300';
  } else {
    hasGeometry = false;
    livePrice = quotes[symbol]?.mid ?? 0;
    rationaleText = alertCtx?.message || '';
    statusText = alertCtx?.type || t('Alert', 'تنبيه');
  }

  const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
  const dec = info.decimals;
  const isBuy = direction === 'BUY';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto overflow-x-hidden bg-white border border-neutral-200 rounded-t-3xl sm:rounded-2xl shadow-2xl p-4 sm:p-5 space-y-4"
      >
        {/* Mobile grab handle */}
        <div className="sm:hidden w-10 h-1 bg-neutral-300 rounded-full mx-auto -mt-1 mb-1" />

        {/* Alert Context Banner if opened from a notification */}
        {alertCtx && (
          <div className="px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs">
            <div className="font-bold text-black">{alertCtx.title}</div>
            <div className="text-[11px] text-neutral-600 mt-0.5">{alertCtx.message}</div>
          </div>
        )}

        {/* Header: Symbol, Side, TF, Time, Status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span dir="ltr" className="text-lg font-bold text-black font-mono-tabular">
                {symbol}
              </span>
              {hasGeometry && (
                <span
                  className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-xs font-bold ${
                    isBuy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {isBuy ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  {isBuy ? t('BUY', 'شراء') : t('SELL', 'بيع')}
                </span>
              )}
              <span dir="ltr" className="text-xs font-semibold text-neutral-600 font-mono-tabular">
                {timeframeLabel}
              </span>
              <span className={`px-2 py-0.5 border rounded-md text-[11px] font-bold ${statusClass}`}>
                {statusText}
              </span>
            </div>
            <div dir="ltr" className="text-[11px] text-neutral-500 font-mono-tabular flex flex-wrap items-center gap-2">
              <span>{formatTimeInTimezone(timestamp, timezone, true, true)}</span>
              {scoreLabel && (
                <>
                  <span>·</span>
                  <span className="font-semibold text-black">{scoreLabel}</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close', 'إغلاق')}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-neutral-200 text-neutral-600 hover:text-black hover:bg-neutral-50 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Price & Floating/Realized P&L */}
        {hasGeometry && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-neutral-50 border border-neutral-200 rounded-xl font-mono-tabular text-xs">
            <div>
              <span className="text-[10px] font-sans text-neutral-500 block">{t('Entry', 'الدخول')}</span>
              <span dir="ltr" className="font-bold text-black text-sm">
                {entryPrice.toFixed(dec)}
              </span>
              {optZone && (
                <span dir="ltr" className="block text-[10px] text-neutral-500">
                  {optZone[0].toFixed(dec)}–{optZone[1].toFixed(dec)}
                </span>
              )}
            </div>
            <div>
              <span className="text-[10px] font-sans text-neutral-500 block">
                {tp1Hit ? t('SL (BE Protected)', 'الوقف (تأمين الدخول)') : t('Stop Loss', 'وقف الخسارة')}
              </span>
              <span
                dir="ltr"
                className={`font-bold text-sm inline-flex items-center gap-1 ${
                  tp1Hit ? 'text-amber-700' : 'text-red-600'
                }`}
              >
                {tp1Hit && <ShieldCheck className="w-3.5 h-3.5 shrink-0" />}
                {slPrice.toFixed(dec)}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-sans text-neutral-500 block">
                {isLiveOpen ? t('Live Price', 'السعر الحي') : t('Status Price', 'السعر')}
              </span>
              <span dir="ltr" className="font-bold text-black text-sm">
                {livePrice > 0 ? livePrice.toFixed(dec) : '—'}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-sans text-neutral-500 block">
                {isLiveOpen ? t('Floating P&L', 'الربح/الخسارة العائمة') : t('Final P&L', 'النتيجة النهائية')}
              </span>
              <span
                dir="ltr"
                className={`font-bold text-sm ${
                  pnlR > 0 || pnlUsd > 0
                    ? 'text-emerald-700'
                    : pnlR < 0 || pnlUsd < 0
                      ? 'text-red-600'
                      : 'text-neutral-700'
                }`}
              >
                {pnlUsd >= 0 ? '+' : '-'}${Math.abs(pnlUsd).toFixed(2)} ({pnlR >= 0 ? '+' : ''}{pnlR}R)
              </span>
              {pnlPips !== 0 && (
                <span dir="ltr" className="block text-[10px] text-neutral-500">
                  {pnlPips >= 0 ? '+' : ''}{pnlPips} pips
                </span>
              )}
            </div>
          </div>
        )}

        {/* TP1 / TP2 / TP3 Milestone Chips */}
        {hasGeometry && tp1 > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-neutral-600">
              {t('Take Profit Milestones', 'مستويات الأهداف وحالة التحقق')}
            </div>
            <TpMilestoneBadges
              tp1={tp1}
              tp2={tp2}
              tp3={tp3}
              tp1Hit={tp1Hit}
              tp2Hit={tp2Hit}
              tp3Hit={tp3Hit}
              decimals={dec}
            />
          </div>
        )}

        {/* Confluence Schools & Rationale */}
        {(headlineReason || schools.length > 0 || rationaleText) && (
          <div className="space-y-2 border-t border-neutral-100 pt-3">
            {headlineReason && (
              <div className="text-xs font-semibold text-black flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span>{headlineReason}</span>
              </div>
            )}
            {schools.length > 0 && (
              <div className="text-[11px] text-neutral-600">
                {schools.join(' · ')}
              </div>
            )}
            {rationaleText && (
              <p className="text-xs text-neutral-700 whitespace-pre-line leading-relaxed bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                {rationaleText}
              </p>
            )}
          </div>
        )}

        {/* Loss Autopsy & Root-Cause Banner if stopped out */}
        {(autopsyText || lossCauseLabel) && (
          <div className="p-3 bg-red-50/70 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <div className="space-y-1 min-w-0">
              {lossCauseLabel && (
                <div className="font-bold text-red-900">
                  {t('Root Cause:', 'سبب الخسارة:')} {lossCauseLabel}
                </div>
              )}
              {autopsyText && <div>{autopsyText}</div>}
            </div>
          </div>
        )}

        {/* Action Footer */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onJumpToChart(payload)}
            className="flex-1 min-h-[44px] px-4 bg-black text-white rounded-xl text-xs font-bold hover:bg-neutral-800 flex items-center justify-center gap-2"
          >
            <Crosshair className="w-4 h-4" />
            <span>{t('Open on Chart', 'فتح على الشارت')}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 border border-neutral-300 bg-white text-black rounded-xl text-xs font-semibold hover:bg-neutral-50"
          >
            {t('Close', 'إغلاق')}
          </button>
        </div>
      </div>
    </div>
  );
};
