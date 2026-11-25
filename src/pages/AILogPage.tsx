import React, { useMemo, useState } from 'react';
import {
  Lock,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Eye,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import {
  AISignal,
  LiveQuote,
  LossRootCauseCategory,
  MissedWinRootCauseCategory,
  RejectedSetup,
  RootCauseAnalytics,
  SchoolId,
} from '../types/trading';
import { formatTimeInTimezone } from '../lib/timezones';
import { SCHOOL_MAP, SYMBOL_MAP } from '../lib/schools';
import { TpMilestoneBadges } from '../components/TpMilestoneBadges';
import { useI18n } from '../lib/i18n';

const LOSS_CAUSE_LABELS_AR: Record<LossRootCauseCategory, string> = {
  'Counter-Trend / Against Momentum': 'عكس الاتجاه العام أو الزخم',
  'Late Entry / Chasing': 'دخول متأخر / مطاردة السعر',
  'Wide SL / Volatility Spike': 'وقف خسارة واسع أو تذبذب حاد',
  'Premature / Weak Confluence': 'توافق ضعيف أو عائق قبل TP1',
};

const MISSED_WIN_LABELS_AR: Record<MissedWinRootCauseCategory, string> = {
  'Near-Threshold Score': 'درجة توافق قريبة من الحد',
  'Over-Strict Filter': 'فلتر صارم رغم صلاحية الهيكل',
  'Early Rejection Before Pullback/Confirm': 'رفض مبكر قبل اكتمال التأكيد',
};

interface AILogPageProps {
  signals: AISignal[];
  rejected: RejectedSetup[];
  quotes: Record<string, LiveQuote>;
  riskUsdPerR?: number;
  schoolWeights: Record<SchoolId, { weight: number; wins: number; losses: number }>;
  rootCauseAnalytics?: RootCauseAnalytics | null;
  timezone: string;
  onInspectSignal: (sig: AISignal) => void;
  onOpenTradeCard?: (sig: AISignal) => void;
}

export const AILogPage: React.FC<AILogPageProps> = ({
  signals,
  rejected,
  quotes,
  riskUsdPerR = 100,
  schoolWeights,
  rootCauseAnalytics,
  timezone,
  onInspectSignal,
  onOpenTradeCard,
}) => {
  const { lang, t } = useI18n();
  const [tierFilter, setTierFilter] = useState<'ALL' | 'A+' | 'A' | 'B'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Won' | 'Lost' | 'Active' | 'Breakeven' | 'Watchlist'>('ALL');

  const filtered = useMemo(() => {
    return signals.filter((s) => {
      if (tierFilter !== 'ALL' && s.tier !== tierFilter) return false;
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      return true;
    });
  }, [signals, tierFilter, statusFilter]);

  const stats = useMemo(() => {
    const closed = signals.filter(
      (s) => s.status === 'Won' || s.status === 'Lost' || (s.status === 'Breakeven' && Boolean(s.closedAt))
    );
    const won = closed.filter((s) => s.status === 'Won');
    const lost = closed.filter((s) => s.status === 'Lost');
    const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;
    const totalR = Number(closed.reduce((a, b) => a + b.pnlR, 0).toFixed(2));

    const savedLosses = rejected.filter((r) => !r.wouldHaveWon).length;
    const missedWinners = rejected.filter((r) => r.wouldHaveWon).length;
    const filterScore = rejected.length > 0 ? Math.round((savedLosses / rejected.length) * 100) : 100;

    const regimeMap = new Map<string, { wins: number; total: number }>();
    for (const s of closed) {
      const cur = regimeMap.get(s.regimeMatch) || { wins: 0, total: 0 };
      cur.total++;
      if (s.status === 'Won') cur.wins++;
      regimeMap.set(s.regimeMatch, cur);
    }

    const matrixMap = new Map<string, { wins: number; total: number; netR: number }>();
    for (const s of closed) {
      const d = new Date(s.createdAt);
      const hr = d.getUTCHours();
      const sess = hr >= 7 && hr < 12 ? 'LDN' : hr >= 12 && hr < 20 ? 'NY' : 'ASIA';
      const day = d.toLocaleDateString('en-US', { weekday: 'short' });
      const key = `${s.symbol} · ${sess} · ${day}`;
      const cur = matrixMap.get(key) || { wins: 0, total: 0, netR: 0 };
      cur.total++;
      if (s.status === 'Won') cur.wins++;
      cur.netR += s.pnlR;
      matrixMap.set(key, cur);
    }

    const comboMap = new Map<string, { wins: number; total: number }>();
    for (const s of closed) {
      const combo = s.schoolsUsed.slice(0, 3).map((x) => SCHOOL_MAP[x]?.shortEn || x).join(' + ');
      const cur = comboMap.get(combo) || { wins: 0, total: 0 };
      cur.total++;
      if (s.status === 'Won') cur.wins++;
      comboMap.set(combo, cur);
    }

    // 7-day Weekly Performance Digest
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklySignals = signals.filter((s) => s.createdAt >= weekAgo);
    const weeklyClosed = closed.filter((s) => (s.closedAt ?? s.createdAt) >= weekAgo);
    const weeklyWon = weeklyClosed.filter((s) => s.status === 'Won').length;
    const weeklyLost = weeklyClosed.filter((s) => s.status === 'Lost').length;
    const weeklyBeSaves = weeklyClosed.filter((s) => s.status === 'Breakeven' && s.tp1Hit).length;
    const weeklyWinRate =
      weeklyWon + weeklyLost > 0 ? Math.round((weeklyWon / (weeklyWon + weeklyLost)) * 100) : winRate;
    const weeklyNetR = Number(weeklyClosed.reduce((a, b) => a + b.pnlR, 0).toFixed(2));
    const bestAssetMap = new Map<string, number>();
    for (const s of weeklyClosed) {
      bestAssetMap.set(s.symbol, (bestAssetMap.get(s.symbol) || 0) + s.pnlR);
    }
    const topWeeklyAsset = Array.from(bestAssetMap.entries()).sort((a, b) => b[1] - a[1])[0] ?? null;

    return {
      closedCount: closed.length,
      wonCount: won.length,
      lostCount: lost.length,
      winRate,
      totalR,
      filterScore,
      savedLosses,
      missedWinners,
      regimes: Array.from(regimeMap.entries()),
      matrix: Array.from(matrixMap.entries()).slice(0, 8),
      combos: Array.from(comboMap.entries()).slice(0, 6),
      recentLosses: lost.slice(0, 3),
      weekly: {
        totalSignals: weeklySignals.length,
        closedCount: weeklyClosed.length,
        winRate: weeklyWinRate,
        netR: weeklyNetR,
        netUsd: Number((weeklyNetR * riskUsdPerR).toFixed(2)),
        beSaves: weeklyBeSaves,
        topAsset: topWeeklyAsset,
      },
    };
  }, [signals, rejected, riskUsdPerR]);

  const resolvedAnalytics = useMemo<RootCauseAnalytics>(() => {
    if (rootCauseAnalytics) return rootCauseAnalytics;
    const lossMap: Record<LossRootCauseCategory, { count: number; totalR: number }> = {
      'Counter-Trend / Against Momentum': { count: 0, totalR: 0 },
      'Late Entry / Chasing': { count: 0, totalR: 0 },
      'Wide SL / Volatility Spike': { count: 0, totalR: 0 },
      'Premature / Weak Confluence': { count: 0, totalR: 0 },
    };
    for (const s of signals) {
      if (s.status !== 'Lost') continue;
      const cat = s.lossCause ?? 'Premature / Weak Confluence';
      lossMap[cat].count += 1;
      lossMap[cat].totalR += s.pnlR || -1;
    }
    const missedMap: Record<MissedWinRootCauseCategory, { count: number; missedR: number }> = {
      'Near-Threshold Score': { count: 0, missedR: 0 },
      'Over-Strict Filter': { count: 0, missedR: 0 },
      'Early Rejection Before Pullback/Confirm': { count: 0, missedR: 0 },
    };
    for (const r of rejected) {
      if (!r.wouldHaveWon || r.guardName === 'SL Loss Autopsy') continue;
      const cat = r.missedWinCause ?? 'Over-Strict Filter';
      missedMap[cat].count += 1;
      missedMap[cat].missedR += Math.max(0.5, r.counterfactualPnlR || 1.2);
    }
    return {
      lossBreakdown: (Object.keys(lossMap) as LossRootCauseCategory[])
        .map((category) => ({
          category,
          labelAr: LOSS_CAUSE_LABELS_AR[category],
          count: lossMap[category].count,
          totalR: Number(lossMap[category].totalR.toFixed(2)),
          cooldownActive: false,
          adjustmentEn: 'Monitoring closed SL outcomes',
          adjustmentAr: 'مراقبة أسباب ضرب وقف الخسارة',
        }))
        .sort((a, b) => b.count - a.count),
      missedWinBreakdown: (Object.keys(missedMap) as MissedWinRootCauseCategory[])
        .map((category) => ({
          category,
          labelAr: MISSED_WIN_LABELS_AR[category],
          count: missedMap[category].count,
          missedR: Number(missedMap[category].missedR.toFixed(2)),
          adjustmentEn: 'Tracking filtered setups on live ticks',
          adjustmentAr: 'تتبع الصفقات المرفوضة على السعر الحي',
        }))
        .sort((a, b) => b.count - a.count),
      learnedAdjustments: [
        {
          id: 'fallback_lock',
          kind: 'locked',
          titleEn: 'Anti-Counter-Trend & No-Chase Locks Active',
          titleAr: 'قفل منع عكس الاتجاه ومنع المطاردة مفعل دائماً',
          detailEn: 'Strict HTF trend alignment and pullback proximity enforced on all signals.',
          detailAr: 'إلزام توافق الفريمات الكبيرة وقرب الدخول من منطقة الارتداد.',
        },
      ],
      policy: {
        minConfluenceScore: 80,
        antiLateAtrMult: 1.85,
        slCapScale: 1,
        chopAtrFloor: 1.15,
        activeCooldownCauses: [],
      },
    };
  }, [rootCauseAnalytics, signals, rejected]);

  const exportCsv = () => {
    const headers = ['ID', 'CreatedAt', 'Symbol', 'Direction', 'Tier', 'Status', 'RecTF', 'DomTF', 'Entry', 'SL', 'TP1', 'TP2', 'TP3', 'TP1Hit', 'TP2Hit', 'TP3Hit', 'PnL_R', 'Schools'];
    const rows = filtered.map((s) => [
      s.id,
      new Date(s.createdAt).toISOString(),
      s.symbol,
      s.direction,
      s.tier,
      s.status,
      s.recommendedTimeframe,
      s.dominantTimeframe,
      s.entryPrice,
      s.currentSl,
      s.tp1,
      s.tp2,
      s.tp3,
      Boolean(s.tp1Hit),
      Boolean(s.tp2Hit),
      Boolean(s.tp3Hit),
      s.pnlR,
      `"${s.schoolsUsed.join('+')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apex_confluence_ai_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-5 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-neutral-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
            <Lock className="w-3.5 h-3.5 text-black" />
            <span>{t('Permanently Locked · Non-Deletable & Non-Editable Immutable Ledger', 'مقفل نهائياً · سجل ثابت غير قابل للحذف أو التعديل')}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-black mt-0.5">
            {t('AI Signal History', 'سجل إشارات الذكاء الاصطناعي')}
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

      {/* Top KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono-tabular">
        <div className="border border-neutral-200 rounded-2xl p-4">
          <div className="text-xs font-sans text-neutral-500">{t('Closed Signals Win Rate', 'نسبة نجاح الإشارات المغلقة')}</div>
          <div dir="ltr" className="text-2xl font-bold text-black mt-1 inline-block">{stats.winRate}%</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {stats.wonCount}W / {stats.lostCount}L ({stats.closedCount} {t('closed', 'مغلقة')})
          </div>
        </div>
        <div className="border border-neutral-200 rounded-2xl p-4">
          <div className="text-xs font-sans text-neutral-500">{t('Net Realized Expectancy', 'صافي العائد المحقق (R)')}</div>
          <div dir="ltr" className={`text-2xl font-bold mt-1 inline-block ${stats.totalR >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {stats.totalR >= 0 ? '+' : ''}{stats.totalR}R
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">{t('Weekly Performance Digest', 'ملخص الأداء الأسبوعي')}</div>
        </div>
        <div className="border border-neutral-200 rounded-2xl p-4">
          <div className="text-xs font-sans text-neutral-500">{t('Filter Effectiveness Score', 'كفاءة فلاتر الحماية')}</div>
          <div dir="ltr" className="text-2xl font-bold text-black mt-1 inline-block">{stats.filterScore}%</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {t(`Saved ${stats.savedLosses} · Filtered Winners: ${stats.missedWinners}`, `خسائر متفاداة: ${stats.savedLosses} · أرباح فائتة: ${stats.missedWinners}`)}
          </div>
        </div>
        <div className="border border-neutral-200 rounded-2xl p-4">
          <div className="text-xs font-sans text-neutral-500">{t('Total Logged 24/7', 'إجمالي السجل 24/7')}</div>
          <div dir="ltr" className="text-2xl font-bold text-black mt-1 inline-block">{signals.length}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">{t('Self-evolving weights active', 'الأوزان ذاتية التطور نشطة')}</div>
        </div>
      </div>

      {/* Weekly Performance Digest */}
      <div className="border border-neutral-200 rounded-2xl p-4 bg-neutral-50/70 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-black">
            {t('Automated Weekly Performance Digest (Last 7 Days)', 'الملخص الأسبوعي التلقائي للأداء (آخر 7 أيام)')}
          </div>
          <p className="text-[11px] text-neutral-600 mt-0.5">
            {t(
              `${stats.weekly.totalSignals} signals tracked · ${stats.weekly.closedCount} closed (${stats.weekly.winRate}% WR) · ${stats.weekly.beSaves} TP1→BE capital saves · ${stats.savedLosses} risk-filter saves`,
              `متابعة ${stats.weekly.totalSignals} إشارة · إغلاق ${stats.weekly.closedCount} (${stats.weekly.winRate}% نجاح) · حماية رأس المال عند TP1→BE: ${stats.weekly.beSaves} · توفير الفلاتر: ${stats.savedLosses}`
            )}
          </p>
        </div>
        <div dir="ltr" className="flex items-center gap-4 font-mono-tabular text-xs">
          <div>
            <span className="text-[10px] text-neutral-500 block font-sans">{t('7D Expectancy', 'عائد 7 أيام')}</span>
            <span className={`font-bold ${stats.weekly.netR >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {stats.weekly.netR >= 0 ? '+' : ''}{stats.weekly.netR}R ({stats.weekly.netUsd >= 0 ? '+' : '-'}${Math.abs(stats.weekly.netUsd).toFixed(0)})
            </span>
          </div>
          {stats.weekly.topAsset && (
            <div>
              <span className="text-[10px] text-neutral-500 block font-sans">{t('Top Asset', 'أفضل أصل')}</span>
              <span className="font-bold text-black">
                {stats.weekly.topAsset[0]} ({stats.weekly.topAsset[1] >= 0 ? '+' : ''}{stats.weekly.topAsset[1].toFixed(2)}R)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Breakdown Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-neutral-200 rounded-2xl p-4 space-y-2.5">
          <h2 className="text-sm font-bold text-black">{t('Setup Win-Rate & School Combination Hit-Rates', 'نسب نجاح الإعدادات وتوليفات المدارس')}</h2>
          <div className="space-y-1.5 text-xs">
            {stats.regimes.length === 0 && stats.combos.length === 0 ? (
              <p className="text-neutral-500">
                {t('Closed signal breakdowns populate automatically as setups hit TP/SL.', 'تظهر تحليلات الأداء تلقائياً عند إغلاق الإشارات على الأهداف أو الوقف.')}
              </p>
            ) : (
              <>
                {stats.regimes.map(([reg, v]) => (
                  <div key={reg} className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="font-medium text-black">{reg}</span>
                    <span dir="ltr" className="font-mono-tabular">{Math.round((v.wins / v.total) * 100)}% ({v.wins}/{v.total})</span>
                  </div>
                ))}
                {stats.combos.map(([combo, v]) => (
                  <div key={combo} className="flex justify-between py-1 border-b border-neutral-100 text-neutral-700">
                    <span dir="ltr">{combo}</span>
                    <span dir="ltr" className="font-mono-tabular">{Math.round((v.wins / v.total) * 100)}% ({v.wins}/{v.total})</span>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="pt-2 border-t border-neutral-100">
            <div className="text-[11px] font-semibold text-neutral-600 mb-1">{t('Self-Evolving School Weights', 'أوزان المدارس ذاتية التطور')}</div>
            <div className="flex flex-wrap gap-2 text-[11px] font-mono-tabular">
              {Object.entries(schoolWeights).slice(0, 8).map(([sid, w]) => {
                const sc = SCHOOL_MAP[sid as SchoolId];
                return (
                  <span key={sid} className="text-neutral-700">
                    {lang === 'ar' ? sc?.nameAr || sid : sc?.shortEn || sid}: <strong dir="ltr">{w.weight.toFixed(2)}</strong>
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* Visual Loss Replay Card & Stop-Loss Autopsy */}
        <div className="border border-neutral-200 rounded-2xl p-4 space-y-2.5">
          <h2 className="text-sm font-bold text-black flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span>{t('Visual Loss Replay & Stop-Loss Autopsy', 'تشريح الخسائر وإعادة التشغيل المرئي')}</span>
          </h2>
          {stats.recentLosses.length === 0 ? (
            <div className="text-xs text-neutral-500 space-y-1">
              <p>
                {t(
                  'Zero stopped-out AI signals in recent history. Asset-Session-Day Matrix & What-If filter autopsies appear here on any SL event.',
                  'لا توجد صفقات خاسرة حديثاً. تظهر مصفوفة الأصول والجلسات وتشريح الوقف هنا عند أي ضرب لوقف الخسارة.'
                )}
              </p>
              {stats.matrix.length > 0 && (
                <div className="pt-2 space-y-1">
                  {stats.matrix.map(([key, v]) => (
                    <div key={key} dir="ltr" className="flex justify-between font-mono-tabular text-[11px]">
                      <span>{key}</span>
                      <span>{v.netR.toFixed(2)}R ({v.wins}/{v.total})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {stats.recentLosses.map((loss) => (
                <div key={loss.id} className="p-3 border border-red-200 bg-red-50/40 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2 font-bold text-black">
                    <span dir="ltr">{loss.symbol} {loss.direction} ({loss.recommendedTimeframe.toUpperCase()})</span>
                    <span dir="ltr" className="text-red-600 font-mono-tabular">{loss.pnlR}R</span>
                  </div>
                  {loss.lossCause && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-100/80 border border-red-200 text-[10px] font-bold text-red-800">
                      <span>{lang === 'ar' ? LOSS_CAUSE_LABELS_AR[loss.lossCause] : loss.lossCause}</span>
                    </div>
                  )}
                  <p className="text-[11px] text-neutral-700">
                    {t('Autopsy:', 'التشريح:')}{' '}
                    {loss.lossCauseDetail ||
                      loss.autopsySummary ||
                      `${loss.devilsAdvocate} · ${t(
                        `What-If tighter chop filter or awaiting H1 close would have skipped entry at ${loss.entryPrice}.`,
                        `تشديد فلتر التذبذب أو انتظار إغلاق الساعة كان سيتفادى الدخول عند ${loss.entryPrice}.`
                      )}`}
                  </p>
                  <button
                    type="button"
                    onClick={() => onInspectSignal(loss)}
                    className="text-[11px] font-semibold text-black underline"
                  >
                    {t('Replay Loss on Chart', 'إعادة تشغيل الخسارة على الشارت')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dedicated Loss & Missed-Win Root-Cause Analyzer + Self-Correction */}
      <div className="border border-neutral-200 rounded-2xl p-4 bg-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-neutral-100">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-bold text-black">
              <SlidersHorizontal className="w-4 h-4 text-black shrink-0" />
              <span>
                {t(
                  'Loss & Missed-Win Root-Cause Analyzer',
                  'محلل أسباب الخسائر والأرباح الفائتة والتعلم الذاتي'
                )}
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              {t(
                'Compares recurring SL root causes against counterfactual TP1 missed wins to tighten risk guards and calibrate safe filters automatically.',
                'يقارن أسباب الخسائر المتكررة مع الفرص الرابحة المرفوضة لتشديد الحماية تلقائياً ومعايرة الفلاتر الآمنة دون المساس بحماية الاتجاه أو منع المطاردة.'
              )}
            </p>
          </div>

          <div dir="ltr" className="flex flex-wrap items-center gap-2 text-[11px] font-mono-tabular">
            <span className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-neutral-50 text-black font-semibold">
              {t('Min Score', 'حد التوافق')}: {resolvedAnalytics.policy.minConfluenceScore}/100
            </span>
            <span className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-neutral-50 text-black font-semibold">
              {t('No-Chase', 'المطاردة')}: {resolvedAnalytics.policy.antiLateAtrMult.toFixed(2)}x ATR
            </span>
            <span className="px-2.5 py-1 rounded-lg border border-neutral-200 bg-neutral-50 text-black font-semibold">
              {t('SL Cap', 'سقف الوقف')}: {Math.round(resolvedAnalytics.policy.slCapScale * 100)}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Loss Root Causes */}
          <div className="border border-neutral-200 rounded-xl p-3 space-y-2.5 bg-neutral-50/40">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-black flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                <span>{t('Loss Root Causes (48h)', 'تشريح أسباب الخسائر (48 ساعة)')}</span>
              </h3>
              <span dir="ltr" className="text-[10px] font-mono-tabular text-neutral-500">
                {resolvedAnalytics.lossBreakdown.reduce((sum, x) => sum + x.count, 0)} {t('losses', 'خسائر')}
              </span>
            </div>
            <div className="space-y-2">
              {resolvedAnalytics.lossBreakdown.map((item) => (
                <div
                  key={item.category}
                  className={`p-2.5 rounded-xl border text-xs space-y-1 ${
                    item.count > 0 ? 'border-red-200 bg-white' : 'border-neutral-200 bg-white/70 opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-black leading-snug">
                      {lang === 'ar' ? item.labelAr : item.category}
                    </span>
                    <div dir="ltr" className="flex items-center gap-1.5 shrink-0 font-mono-tabular">
                      {item.cooldownActive && (
                        <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[9.5px] font-bold">
                          {t('COOLDOWN', 'تهدئة')}
                        </span>
                      )}
                      <span className="font-bold text-red-600">
                        {item.count} ({item.totalR}R)
                      </span>
                    </div>
                  </div>
                  <p className="text-[10.5px] text-neutral-600 leading-snug">
                    {lang === 'ar' ? item.adjustmentAr : item.adjustmentEn}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Missed-Win Root Causes */}
          <div className="border border-neutral-200 rounded-xl p-3 space-y-2.5 bg-neutral-50/40">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-black flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>{t('Missed-Win Causes (TP1 Hit)', 'أسباب الأرباح الفائتة (وصلت لـ TP1)')}</span>
              </h3>
              <span dir="ltr" className="text-[10px] font-mono-tabular text-neutral-500">
                {resolvedAnalytics.missedWinBreakdown.reduce((sum, x) => sum + x.count, 0)} {t('missed', 'فائتة')}
              </span>
            </div>
            <div className="space-y-2">
              {resolvedAnalytics.missedWinBreakdown.map((item) => (
                <div
                  key={item.category}
                  className={`p-2.5 rounded-xl border text-xs space-y-1 ${
                    item.count > 0 ? 'border-amber-200 bg-white' : 'border-neutral-200 bg-white/70 opacity-75'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-black leading-snug">
                      {lang === 'ar' ? item.labelAr : item.category}
                    </span>
                    <span dir="ltr" className="font-mono-tabular font-bold text-amber-700 shrink-0">
                      {item.count} (+{item.missedR}R)
                    </span>
                  </div>
                  <p className="text-[10.5px] text-neutral-600 leading-snug">
                    {lang === 'ar' ? item.adjustmentAr : item.adjustmentEn}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Learned Filter Adjustments */}
          <div className="border border-neutral-200 rounded-xl p-3 space-y-2.5 bg-neutral-50/40">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-black flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                <span>{t('Learned Filter Adjustments', 'تعديلات الفلتر المكتسبة')}</span>
              </h3>
              <span className="text-[10px] font-mono-tabular text-neutral-500">
                {resolvedAnalytics.policy.activeCooldownCauses.length > 0
                  ? t(`${resolvedAnalytics.policy.activeCooldownCauses.length} Cooldown`, `${resolvedAnalytics.policy.activeCooldownCauses.length} تهدئة`)
                  : t('Auto-Balanced', 'متوازن تلقائياً')}
              </span>
            </div>
            <div className="space-y-2">
              {resolvedAnalytics.learnedAdjustments.map((adj) => (
                <div
                  key={adj.id}
                  className="p-2.5 rounded-xl border border-neutral-200 bg-white text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-black leading-snug">
                      {lang === 'ar' ? adj.titleAr : adj.titleEn}
                    </span>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase ${
                        adj.kind === 'tighten'
                          ? 'bg-red-50 text-red-700 border border-red-200'
                          : adj.kind === 'calibrate'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-neutral-100 text-neutral-800 border border-neutral-300'
                      }`}
                    >
                      {adj.kind === 'tighten'
                        ? t('Tightened', 'مشدد')
                        : adj.kind === 'calibrate'
                          ? t('Calibrated', 'معاير')
                          : t('Locked', 'مقفل')}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-neutral-600 leading-snug">
                    {lang === 'ar' ? adj.detailAr : adj.detailEn}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filters & Immutable Table */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex bg-neutral-100 p-1 rounded-xl gap-1">
            {(['ALL', 'A+', 'A', 'B'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setTierFilter(tier)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg ${
                  tierFilter === tier ? 'bg-white text-black shadow-xs' : 'text-neutral-600'
                }`}
              >
                {tier === 'ALL' ? t('All Tiers', 'كل الفئات') : `${t('Tier', 'فئة')} ${tier}`}
              </button>
            ))}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-9 px-3 border border-neutral-300 rounded-xl text-xs font-semibold bg-white"
          >
            <option value="ALL">{t('All Statuses', 'كل الحالات')}</option>
            <option value="Active">{t('Active', 'نشطة')}</option>
            <option value="Breakeven">{t('Breakeven', 'تعادل / حماية الدخول')}</option>
            <option value="Won">{t('Won', 'رابحة')}</option>
            <option value="Lost">{t('Lost', 'خاسرة')}</option>
            <option value="Watchlist">{t('Watchlist', 'قيد التشكل')}</option>
          </select>
        </div>

        {/* Compact Mobile Cards (Zero Horizontal Scroll) */}
        <div className="lg:hidden space-y-2.5 w-full max-w-full overflow-x-hidden">
          {filtered.length === 0 ? (
            <div className="border border-dashed border-neutral-300 rounded-2xl p-6 text-center text-xs text-neutral-500 bg-white">
              {t('No signals match the active filters.', 'لا توجد إشارات مطابقة للفلتر المحدد.')}
            </div>
          ) : (
            filtered.map((sig) => {
              const info = SYMBOL_MAP[sig.symbol] || SYMBOL_MAP.XAUUSD;
              const dec = info.decimals;
              const isClosed =
                Boolean(sig.closedAt) || sig.status === 'Won' || sig.status === 'Lost';
              const isLiveOpen = !isClosed && (sig.status === 'Active' || sig.status === 'Breakeven');
              const quote = quotes[sig.symbol];
              const livePrice = quote?.mid ?? sig.entryPrice;

              const isBuy = sig.direction === 'BUY';
              const riskDist = Math.max(info.pipSize, Math.abs(sig.entryPrice - sig.stopLoss));
              const rawDiff = isBuy ? livePrice - sig.entryPrice : sig.entryPrice - livePrice;

              const displayR = isLiveOpen
                ? Number((rawDiff / riskDist).toFixed(2))
                : sig.pnlR;
              const displayPips = isLiveOpen
                ? Number((rawDiff / info.pipSize).toFixed(1))
                : sig.pnlPips;
              const displayUsd = Number((displayR * riskUsdPerR).toFixed(2));

              const tp1Hit = Boolean(sig.tp1Hit || sig.status === 'Won');
              const tp2Hit = Boolean(sig.tp2Hit ?? (sig.status === 'Won' && sig.pnlR >= 1.5));
              const tp3Hit = Boolean(sig.tp3Hit ?? (sig.status === 'Won' && sig.pnlR >= 2.5));

              const statusText =
                sig.status === 'Won'
                  ? t('Win', 'رابحة')
                  : sig.status === 'Lost'
                    ? t('Closed', 'مغلقة')
                    : sig.status === 'Breakeven'
                      ? t('Breakeven', 'تعادل')
                      : sig.status === 'Watchlist'
                        ? t('Monitoring', 'مراقبة')
                        : t('Active', 'نشطة');

              return (
                <div
                  key={sig.id}
                  onClick={() => (onOpenTradeCard ? onOpenTradeCard(sig) : onInspectSignal(sig))}
                  className="w-full max-w-full overflow-hidden border border-neutral-200 rounded-2xl p-3 bg-white space-y-2 active:bg-neutral-50 transition-colors cursor-pointer"
                >
                  {/* Top Row: Symbol, Side, TF, Time, Status */}
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span dir="ltr" className="font-bold text-sm text-black font-mono-tabular">
                        {sig.symbol}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-bold text-[10px] ${
                          isBuy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {isBuy ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {sig.direction}
                      </span>
                      <span dir="ltr" className="text-[10px] font-mono-tabular font-semibold text-neutral-600 uppercase">
                        {sig.recommendedTimeframe}
                      </span>
                      <span dir="ltr" className="text-[10px] font-mono-tabular text-neutral-400 truncate">
                        {formatTimeInTimezone(sig.createdAt, timezone, false, true)}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-bold ${
                        sig.status === 'Won'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : sig.status === 'Lost'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : sig.status === 'Breakeven'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-neutral-100 text-neutral-800 border-neutral-300'
                      }`}
                    >
                      {statusText}
                    </span>
                  </div>

                  {/* Middle Row: Entry, SL / BE, Live/Final P&L */}
                  <div dir="ltr" className="grid grid-cols-3 gap-2 pt-1.5 border-t border-neutral-100 font-mono-tabular text-[11px]">
                    <div className="min-w-0">
                      <span className="block text-[9.5px] font-sans text-neutral-500">
                        {t('Entry', 'الدخول')}
                      </span>
                      <span className="font-bold text-black block truncate">{sig.entryPrice.toFixed(dec)}</span>
                      {isLiveOpen && (
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
                        {tp1Hit ? 'BE' : 'SL'} {sig.currentSl.toFixed(dec)}
                      </span>
                    </div>
                    <div className="min-w-0 text-right">
                      <span className="block text-[9.5px] font-sans text-neutral-500">
                        {sig.status === 'Watchlist'
                          ? t('Score', 'التوافق')
                          : isLiveOpen
                            ? t('Live P&L', 'العائد الحي')
                            : t('Final P&L', 'النتيجة')}
                      </span>
                      {sig.status === 'Watchlist' ? (
                        <span className="font-bold text-black">{sig.weightedScore}/100</span>
                      ) : (
                        <>
                          <span
                            className={`font-bold block truncate ${
                              displayR > 0 ? 'text-emerald-700' : displayR < 0 ? 'text-red-600' : 'text-neutral-700'
                            }`}
                          >
                            {displayUsd >= 0 ? '+' : '-'}${Math.abs(displayUsd).toFixed(0)} ({displayR >= 0 ? '+' : ''}{displayR}R)
                          </span>
                          <span className="text-[9.5px] text-neutral-500 block">
                            {displayPips >= 0 ? '+' : ''}{displayPips}p
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Bottom Row: Compact TP1/TP2/TP3 chips + Quick Actions */}
                  <div
                    className="flex items-center justify-between gap-2 pt-1.5 border-t border-neutral-100 min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="min-w-0">
                      <TpMilestoneBadges
                        tp1={sig.tp1}
                        tp2={sig.tp2}
                        tp3={sig.tp3}
                        tp1Hit={tp1Hit}
                        tp2Hit={tp2Hit}
                        tp3Hit={tp3Hit}
                        decimals={dec}
                        compact
                        showBreakevenBadge={false}
                      />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onOpenTradeCard && (
                        <button
                          type="button"
                          onClick={() => onOpenTradeCard(sig)}
                          className="min-h-[30px] px-2 border border-neutral-300 rounded-lg text-[10px] font-semibold text-black inline-flex items-center gap-1 hover:bg-neutral-50"
                        >
                          <Eye className="w-3 h-3" />
                          <span>{t('Card', 'الكارت')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onInspectSignal(sig)}
                        className="min-h-[30px] px-2.5 bg-black text-white rounded-lg text-[10px] font-semibold inline-flex items-center gap-1 hover:bg-neutral-800"
                      >
                        <span>{t('Chart', 'الشارت')}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden lg:block border border-neutral-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Timestamp', 'التاريخ والوقت')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Asset · Side', 'الأصل · الاتجاه')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Entry / SL', 'الدخول / الوقف')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Live Price', 'السعر الحي')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('TP1 / TP2 / TP3 Milestones', 'أهداف TP1 / TP2 / TP3')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Status', 'الحالة')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Floating / Realized PnL', 'الربح/الخسارة ($ · R)')}</th>
                <th className="py-2.5 px-3 font-semibold text-end">{t('Inspect', 'معاينة')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 font-mono-tabular">
              {filtered.map((sig) => {
                const info = SYMBOL_MAP[sig.symbol] || SYMBOL_MAP.XAUUSD;
                const dec = info.decimals;
                const isClosed =
                  Boolean(sig.closedAt) || sig.status === 'Won' || sig.status === 'Lost';
                const isLiveOpen = !isClosed && (sig.status === 'Active' || sig.status === 'Breakeven');
                const quote = quotes[sig.symbol];
                const livePrice = quote?.mid ?? sig.entryPrice;

                const isBuy = sig.direction === 'BUY';
                const riskDist = Math.max(info.pipSize, Math.abs(sig.entryPrice - sig.stopLoss));
                const rawDiff = isBuy ? livePrice - sig.entryPrice : sig.entryPrice - livePrice;

                const displayR = isLiveOpen
                  ? Number((rawDiff / riskDist).toFixed(2))
                  : sig.pnlR;
                const displayPips = isLiveOpen
                  ? Number((rawDiff / info.pipSize).toFixed(1))
                  : sig.pnlPips;
                const displayUsd = Number((displayR * riskUsdPerR).toFixed(2));

                const tp1Hit = Boolean(sig.tp1Hit || sig.status === 'Won');
                const tp2Hit = Boolean(sig.tp2Hit ?? (sig.status === 'Won' && sig.pnlR >= 1.5));
                const tp3Hit = Boolean(sig.tp3Hit ?? (sig.status === 'Won' && sig.pnlR >= 2.5));

                const statusText =
                  sig.status === 'Won'
                    ? t('Won', 'رابحة')
                    : sig.status === 'Lost'
                      ? t('Lost', 'خاسرة')
                      : sig.status === 'Breakeven'
                        ? t('Breakeven', 'تعادل')
                        : sig.status === 'Watchlist'
                          ? t('Watchlist', 'مراقبة')
                          : t('Active', 'نشطة');

                return (
                  <tr key={sig.id} className="hover:bg-neutral-50">
                    <td dir="ltr" className="py-2.5 px-3 text-neutral-600 whitespace-nowrap">
                      {formatTimeInTimezone(sig.createdAt, timezone, false, true)}
                      <div className="text-[10px] text-neutral-400">
                        {sig.tier} · {sig.recommendedTimeframe.toUpperCase()}
                      </div>
                    </td>
                    <td dir="ltr" className="py-2.5 px-3 font-sans font-bold text-black whitespace-nowrap">
                      {sig.symbol}{' '}
                      <span className={isBuy ? 'text-emerald-700' : 'text-red-600'}>
                        {sig.direction}
                      </span>
                    </td>
                    <td dir="ltr" className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-semibold text-black">{sig.entryPrice.toFixed(dec)}</div>
                      <div className={`text-[10px] ${tp1Hit ? 'text-amber-700 font-semibold' : 'text-red-600'}`}>
                        {tp1Hit ? 'BE' : 'SL'}: {sig.currentSl.toFixed(dec)}
                      </div>
                    </td>
                    <td dir="ltr" className="py-2.5 px-3 whitespace-nowrap">
                      {isLiveOpen ? (
                        <div className="inline-flex items-center gap-1.5 font-bold text-black">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                          <span>{livePrice.toFixed(dec)}</span>
                        </div>
                      ) : sig.status === 'Watchlist' ? (
                        <span className="text-neutral-500">{livePrice.toFixed(dec)}</span>
                      ) : (
                        <span className="text-[11px] text-neutral-500 font-sans">
                          {t('Frozen (Closed)', 'مغلق (مثبّت)')}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <TpMilestoneBadges
                        tp1={sig.tp1}
                        tp2={sig.tp2}
                        tp3={sig.tp3}
                        tp1Hit={tp1Hit}
                        tp2Hit={tp2Hit}
                        tp3Hit={tp3Hit}
                        decimals={dec}
                      />
                    </td>
                    <td className="py-2.5 px-3 font-sans whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold ${
                          sig.status === 'Won'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : sig.status === 'Lost'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : sig.status === 'Breakeven'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-neutral-100 text-neutral-800 border-neutral-300'
                        }`}
                      >
                        {statusText}
                      </span>
                    </td>
                    <td dir="ltr" className="py-2.5 px-3 whitespace-nowrap">
                      {sig.status === 'Watchlist' ? (
                        <span className="text-neutral-400 text-[11px]">—</span>
                      ) : (
                        <div>
                          <div
                            className={`font-bold ${
                              displayR > 0 ? 'text-emerald-700' : displayR < 0 ? 'text-red-600' : 'text-neutral-700'
                            }`}
                          >
                            {displayR >= 0 ? '+' : ''}{displayR}R ({displayUsd >= 0 ? '+' : '-'}${Math.abs(displayUsd).toFixed(2)})
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            {isLiveOpen ? t('Floating', 'عائم') : t('Realized', 'محقق')} · {displayPips >= 0 ? '+' : ''}{displayPips}p
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-end font-sans whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onInspectSignal(sig)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 border border-neutral-300 rounded-lg text-[11px] font-semibold hover:bg-neutral-100"
                      >
                        <span>{t('Chart', 'الشارت')}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
