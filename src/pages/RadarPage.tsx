import React, { useMemo, useState } from 'react';
import { RefreshCw, ArrowUpRight, ShieldAlert, Radio } from 'lucide-react';
import { AISignal, LiveQuote, RejectedSetup } from '../types/trading';
import { formatTimeInTimezone, getGlobalMarketSessions } from '../lib/timezones';
import { SYMBOL_MAP } from '../lib/schools';
import { TpMilestoneBadges } from '../components/TpMilestoneBadges';
import { useI18n } from '../lib/i18n';

interface RadarPageProps {
  signals: AISignal[];
  rejected: RejectedSetup[];
  quotes: Record<string, LiveQuote>;
  timezone: string;
  onInspectSignal: (signal: AISignal) => void;
  onTriggerScan: () => Promise<void>;
}

export const RadarPage: React.FC<RadarPageProps> = ({
  signals,
  rejected,
  quotes,
  timezone,
  onInspectSignal,
  onTriggerScan,
}) => {
  const { lang, t } = useI18n();
  const [filterTab, setFilterTab] = useState<'all' | 'confirmed' | 'watchlist'>('all');
  const [scanning, setScanning] = useState(false);

  const confirmedSignals = useMemo(
    () => signals.filter((s) => s.status === 'Active' || s.status === 'Breakeven'),
    [signals]
  );
  const watchlistSignals = useMemo(
    () => signals.filter((s) => s.status === 'Watchlist'),
    [signals]
  );
  const top3Setups = useMemo(
    () =>
      [...confirmedSignals, ...watchlistSignals]
        .sort((a, b) => b.weightedScore - a.weightedScore)
        .slice(0, 3),
    [confirmedSignals, watchlistSignals]
  );

  const displayed = useMemo(() => {
    if (filterTab === 'confirmed') return confirmedSignals;
    if (filterTab === 'watchlist') return watchlistSignals;
    return [...confirmedSignals, ...watchlistSignals];
  }, [filterTab, confirmedSignals, watchlistSignals]);

  const dxy = quotes['DXY'];
  const xau = quotes['XAUUSD'];
  const sessions = getGlobalMarketSessions(Date.now());
  const openSessions =
    sessions.filter((s) => s.isOpen).map((s) => s.name).join(' + ') || t('Weekend / Transition', 'عطلة / فترة انتقالية');

  const handleScan = async () => {
    setScanning(true);
    try {
      await onTriggerScan();
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-5 space-y-6">
      {/* Header & Live Confirmed Counter */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-black tracking-tight">
            {t('Multi-Market Radar', 'رادار الأسواق المتعددة')}
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t(
              `${confirmedSignals.length} Confirmed Active · ${watchlistSignals.length} Forming Watchlist · ${rejected.length} Guarded Skips`,
              `${confirmedSignals.length} إشارات مؤكدة نشطة · ${watchlistSignals.length} قيد التشكل · ${rejected.length} صفقات مرفوضة بالحماية`
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={handleScan}
          disabled={scanning}
          className="min-h-[42px] px-4 bg-black text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
          <span>{scanning ? t('Scanning MTF...', 'جارٍ المسح المتعدد...') : t('Run MTF Scan Now', 'تشغيل مسح الأطر المتعددة الآن')}</span>
        </button>
      </div>

      {/* 10-Second Daily Market Briefing */}
      <section className="border border-neutral-200 rounded-2xl p-4 sm:p-5 bg-neutral-50/50 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-black flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-700" />
            <span>{t('10-Second Daily Market Briefing', 'ملخص السوق اليومي في 10 ثوانٍ')}</span>
          </h2>
          <span className="text-xs text-neutral-500 font-mono-tabular">
            {t('Active Session:', 'الجلسة النشطة:')} <span dir="ltr">{openSessions}</span>
          </span>
        </div>
        <p className="text-xs sm:text-sm text-neutral-800 leading-relaxed">
          {lang === 'ar' ? (
            <>
              يتداول الذهب (<span dir="ltr">XAUUSD</span>) عند{' '}
              <strong dir="ltr" className="font-mono-tabular">{xau ? xau.mid.toFixed(2) : '—'}</strong> (
              <span dir="ltr">{xau ? `${xau.changePct24h >= 0 ? '+' : ''}${xau.changePct24h}%` : '—'}</span>)، بينما يستقر مؤشر الدولار{' '}
              <span dir="ltr">DXY</span> عند <strong dir="ltr" className="font-mono-tabular">{dxy ? dxy.mid.toFixed(3) : '—'}</strong>.
              يرصد إجماع الأطر المتعددة حالياً <strong>{confirmedSignals.length} فرص مؤكدة</strong> بشموع مغلقة{' '}
              (<span dir="ltr">CHoCH/BOS</span>) و<strong>{watchlistSignals.length} فرص قيد التشكل</strong>. أعلى توافق حالياً:{' '}
              <strong dir="ltr">{top3Setups[0] ? `${top3Setups[0].symbol} ${top3Setups[0].direction} (${top3Setups[0].tier})` : 'بانتظار الإشارة'}</strong>.
            </>
          ) : (
            <>
              Gold (XAUUSD) trades at <strong className="font-mono-tabular">{xau ? xau.mid.toFixed(2) : '—'}</strong> ({xau ? `${xau.changePct24h >= 0 ? '+' : ''}${xau.changePct24h}%` : '—'}), while DXY sits at{' '}
              <strong className="font-mono-tabular">{dxy ? dxy.mid.toFixed(3) : '—'}</strong>. Multi-timeframe consensus currently flags{' '}
              <strong>{confirmedSignals.length} confirmed</strong> closed-candle CHoCH/BOS setups and{' '}
              <strong>{watchlistSignals.length} forming</strong> liquidity watches. Highest-confluence focus:{' '}
              <strong>{top3Setups[0] ? `${top3Setups[0].symbol} ${top3Setups[0].direction} (${top3Setups[0].tier})` : 'Awaiting trigger'}</strong>.
            </>
          )}
        </p>
      </section>

      {/* Top 3 Live Setups Radar */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-black">{t('Top 3 Live Setups Radar', 'أقوى 3 فرص مباشرة على الرادار')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {top3Setups.length === 0 ? (
            <div className="md:col-span-3 p-6 border border-neutral-200 rounded-2xl text-center text-xs text-neutral-500">
              {t(
                'No live setups active yet. Click Run MTF Scan Now to evaluate current bars.',
                'لا توجد فرص نشطة حالياً. اضغط تشغيل مسح الأطر المتعددة لتقييم الشموع الحالية.'
              )}
            </div>
          ) : (
            top3Setups.map((sig) => {
              const sInfo = SYMBOL_MAP[sig.symbol] || SYMBOL_MAP.XAUUSD;
              const q = quotes[sig.symbol];
              const liveP = q?.mid ?? sig.entryPrice;
              const isBuy = sig.direction === 'BUY';
              const riskD = Math.max(sInfo.pipSize, Math.abs(sig.entryPrice - sig.stopLoss));
              const rawD = isBuy ? liveP - sig.entryPrice : sig.entryPrice - liveP;
              const floatR = Number((rawD / riskD).toFixed(2));
              return (
                <div
                  key={sig.id}
                  className="border border-neutral-200 rounded-2xl p-4 flex flex-col justify-between gap-3 bg-white hover:border-black transition-colors"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span dir="ltr" className="font-bold text-black text-sm">
                        {sig.symbol} ·{' '}
                        <span className={isBuy ? 'text-emerald-700' : 'text-red-600'}>
                          {sig.direction}
                        </span>
                      </span>
                      <span dir="ltr" className="font-mono-tabular font-semibold text-neutral-700">
                        Tier {sig.tier} · {sig.weightedScore}/100
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      {sig.status === 'Watchlist' ? t('Forming (Watchlist)', 'قيد التشكل (مراقبة)') : t('Confirmed Active', 'مؤكدة نشطة')} ·{' '}
                      {t('Dom TF:', 'المهيمن:')} <strong dir="ltr" className="text-black uppercase">{sig.dominantTimeframe}</strong> ·{' '}
                      {t('Rec:', 'الموصى:')} <strong dir="ltr" className="text-black uppercase">{sig.recommendedTimeframe}</strong>
                      {sig.isScalp ? t(' · Scalp', ' · صفقة اسكالبينج') : ''}
                    </div>
                    <div dir="ltr" className="grid grid-cols-3 gap-1.5 pt-1 text-[11px] font-mono-tabular">
                      <div>
                        <span className="text-neutral-400 block font-sans">{t('Entry', 'الدخول')}</span>
                        <span className="font-bold text-black">{sig.entryPrice.toFixed(sInfo.decimals)}</span>
                      </div>
                      <div>
                        <span className="text-neutral-400 block font-sans">{t('Live / Floating', 'الحي / العائم')}</span>
                        <span className={`font-bold ${floatR >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {liveP.toFixed(sInfo.decimals)} ({floatR >= 0 ? '+' : ''}{floatR}R)
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-400 block font-sans">{sig.tp1Hit ? t('BE / SL', 'نقطة الدخول') : t('SL', 'الوقف')}</span>
                        <span className={`font-bold ${sig.tp1Hit ? 'text-amber-700' : 'text-red-600'}`}>
                          {sig.currentSl.toFixed(sInfo.decimals)}
                        </span>
                      </div>
                    </div>
                    <TpMilestoneBadges
                      tp1={sig.tp1}
                      tp2={sig.tp2}
                      tp3={sig.tp3}
                      tp1Hit={sig.tp1Hit}
                      tp2Hit={sig.tp2Hit}
                      tp3Hit={sig.tp3Hit}
                      decimals={sInfo.decimals}
                      compact
                    />
                    <p dir={lang === 'ar' ? 'rtl' : 'ltr'} className="text-[11px] text-neutral-700 pt-1 line-clamp-2">
                      {lang === 'ar'
                        ? sig.rationaleAr
                        : sig.rationaleEn ||
                          `${sig.symbol} ${sig.direction} (${sig.recommendedTimeframe.toUpperCase()}): ${sig.regimeMatch} · Entry ${sig.entryPrice} · SL ${sig.currentSl} · TP1 ${sig.tp1}`}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onInspectSignal(sig)}
                    className="min-h-[40px] w-full border border-neutral-300 rounded-xl text-xs font-semibold text-black hover:bg-neutral-50 flex items-center justify-center gap-1.5"
                  >
                    <span>{t('Inspect on Chart', 'معاينة على الشارت')}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Multi-Market MTF Scanner + Dominant Timeframe Detector */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-black">
            {t('Multi-Market MTF Scanner & Dominant Timeframe Detector', 'ماسح الأسواق متعدد الأطر وكاشف الإطار المهيمن')}
          </h2>
          <div className="flex bg-neutral-100 p-1 rounded-xl gap-1">
            {(
              [
                { id: 'all', label: t(`All (${confirmedSignals.length + watchlistSignals.length})`, `الكل (${confirmedSignals.length + watchlistSignals.length})`) },
                { id: 'confirmed', label: t(`Confirmed (${confirmedSignals.length})`, `المؤكدة (${confirmedSignals.length})`) },
                { id: 'watchlist', label: t(`Watchlist / Forming (${watchlistSignals.length})`, `قيد التشكل (${watchlistSignals.length})`) },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  filterTab === tab.id ? 'bg-white text-black shadow-xs' : 'text-neutral-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-neutral-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Symbol', 'الأصل')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('State', 'الحالة')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Dominant TF', 'الإطار المهيمن')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('MTF Alignment (1m–4h)', 'توافق الأطر (1m–4h)')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Regime Match', 'حالة السوق')}</th>
                <th className="py-2.5 px-3 font-semibold text-end">{t('Action', 'إجراء')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {displayed.map((sig) => (
                <tr key={sig.id} className="hover:bg-neutral-50">
                  <td dir="ltr" className="py-2.5 px-3 font-bold text-black text-start">
                    {sig.symbol}{' '}
                    <span className={sig.direction === 'BUY' ? 'text-emerald-700' : 'text-red-600'}>
                      {sig.direction}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="font-semibold text-black">{sig.status}</span> · {sig.tier}
                  </td>
                  <td dir="ltr" className="py-2.5 px-3 font-mono-tabular uppercase font-semibold">
                    {sig.dominantTimeframe} (Rec: {sig.recommendedTimeframe})
                  </td>
                  <td dir="ltr" className="py-2.5 px-3 font-mono-tabular">
                    <div className="flex items-center gap-1.5">
                      {sig.mtfSnapshot.map((m) => (
                        <span
                          key={m.timeframe}
                          className={`text-[10px] font-semibold ${
                            m.bias === 'BULLISH' ? 'text-emerald-700' : m.bias === 'BEARISH' ? 'text-red-600' : 'text-neutral-400'
                          }`}
                        >
                          {m.timeframe}:{m.bias[0]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-neutral-700">{sig.regimeMatch}</td>
                  <td className="py-2.5 px-3 text-end">
                    <button
                      type="button"
                      onClick={() => onInspectSignal(sig)}
                      className="px-2.5 py-1.5 border border-neutral-300 rounded-lg text-[11px] font-semibold hover:bg-neutral-100"
                    >
                      {t('Open Chart', 'فتح الشارت')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Rejected Setups Log (Why Skipped) */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-black flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <span>{t('Rejected Setups Log (Why Skipped)', 'سجل الفرص المرفوضة (سبب التخطي)')}</span>
        </h2>
        <div className="border border-neutral-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Time', 'الوقت')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Symbol · TF', 'الأصل · الإطار')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Guard Triggered', 'الفلتر المفعّل')}</th>
                <th className="py-2.5 px-3 font-semibold text-start">{t('Why Skipped', 'سبب التخطي')}</th>
                <th className="py-2.5 px-3 font-semibold text-end">{t('Counterfactual', 'الأثر البديل')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rejected.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-neutral-500">
                    {t('No setups rejected by risk/chop/spread guards yet.', 'لم يتم رفض أي صفقات بواسطة فلاتر المخاطر أو السبريد بعد.')}
                  </td>
                </tr>
              ) : (
                rejected.slice(0, 25).map((r) => (
                  <tr key={r.id}>
                    <td dir="ltr" className="py-2.5 px-3 font-mono-tabular text-neutral-600">
                      {formatTimeInTimezone(r.createdAt, timezone, false, true)}
                    </td>
                    <td dir="ltr" className="py-2.5 px-3 font-semibold text-black">
                      {r.symbol} · {r.timeframe.toUpperCase()} ({r.direction})
                    </td>
                    <td className="py-2.5 px-3 font-medium text-amber-700">{r.guardName}</td>
                    <td className="py-2.5 px-3 text-neutral-700">{r.reason}</td>
                    <td dir="ltr" className="py-2.5 px-3 text-end font-mono-tabular">
                      <span className={r.wouldHaveWon ? 'text-amber-700' : 'text-emerald-700 font-semibold'}>
                        {r.wouldHaveWon
                          ? `${t('Missed', 'فائت')} +${Math.abs(r.counterfactualPnlR)}R`
                          : `${t('Saved', 'توفير')} ${r.counterfactualPnlR}R`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
