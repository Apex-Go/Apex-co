import React, { useMemo, useState } from 'react';
import { Bell, Shield, Server, User, Save, CheckCircle2, Languages, Smartphone } from 'lucide-react';
import { AppLanguage, FeedHealth, UserAccount } from '../types/trading';
import { getAllIanaTimezones, getTimezoneOffsetLabel } from '../lib/timezones';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { useI18n } from '../lib/i18n';

interface SettingsPageProps {
  user: UserAccount | null;
  health: FeedHealth | null;
  onOpenAuthModal: () => void;
  onSaveProfile: (updates: Partial<UserAccount>) => Promise<void>;
  onSaveDefaultPreset: () => Promise<void>;
  onEnablePushNotifications: () => Promise<string>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  user,
  health,
  onOpenAuthModal,
  onSaveProfile,
  onSaveDefaultPreset,
  onEnablePushNotifications,
}) => {
  const { lang, setLang, t } = useI18n();
  const [displayName, setDisplayName] = useState(user?.displayName || 'Local Trader');
  const [timezone, setTimezone] = useState(user?.timezone || 'Africa/Cairo');
  const [autoDst, setAutoDst] = useState(user?.autoDst ?? true);
  const [risk, setRisk] = useState(
    user?.riskSettings || {
      accountBalance: 10000,
      riskPerTradePct: 1,
      maxConcurrentTrades: 3,
      dailyProfitLockPct: 4,
      trailingEquityGuardPct: 2.5,
      dailyMaxLossPct: 3,
      consecutiveLossCooldownCount: 2,
      cooldownMinutes: 45,
      maxSpreadMultiplier: 2.2,
      exposureGuardEnabled: true,
      newsVolatilityShieldEnabled: true,
      splitEntryEnabled: true,
      oneClickTradingEnabled: false,
    }
  );
  const [alerts, setAlerts] = useState(
    user?.alertSettings || {
      pushEnabled: true,
      soundEnabled: true,
      mutedUntil: 0,
      notifyScalp: true,
      notifyEntryApproach: true,
      notifyCandleClose: true,
      notifyTp1Be: true,
      notifyFinalTpSl: true,
      notifyPostEntryGuard: true,
    }
  );
  const [savedMsg, setSavedMsg] = useState('');
  const [pushMsg, setPushMsg] = useState('');

  const allTimezones = useMemo(() => getAllIanaTimezones(), []);

  const handleSave = async () => {
    await onSaveProfile({
      displayName,
      timezone,
      autoDst,
      language: lang,
      riskSettings: risk,
      alertSettings: alerts,
    });
    setSavedMsg(t('All settings & risk guards synced to your account.', 'تمت مزامنة جميع الإعدادات وحماية المخاطر مع حسابك.'));
    setTimeout(() => setSavedMsg(''), 3500);
  };

  const handlePreset = async () => {
    await onSaveDefaultPreset();
    setSavedMsg(t('Default User Preset saved (symbol, timeframe, active schools & layout).', 'تم حفظ الإعداد الافتراضي (الأصل والإطار والمدارس والتخطيط).'));
    setTimeout(() => setSavedMsg(''), 3500);
  };

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-5 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-black">
            {t('Settings & Account', 'الإعدادات والحساب')}
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t(
              '100% Free & Unrestricted · No paywalls, no subscription tiers, no artificial limits.',
              'مجاني 100% بلا قيود · بدون اشتراكات مدفوعة أو باقات أو حدود مصطنعة.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePreset}
            className="min-h-[40px] px-3.5 border border-neutral-300 rounded-xl text-xs font-semibold hover:bg-neutral-50"
          >
            {t('Save Default User Preset', 'حفظ الإعداد الافتراضي')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-[40px] px-4 bg-black text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            <span>{t('Save Settings', 'حفظ الإعدادات')}</span>
          </button>
        </div>
      </div>

      {savedMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedMsg}</span>
        </div>
      )}

      {/* Install Mobile / Desktop PWA App */}
      <section className="border border-neutral-200 rounded-2xl p-4 sm:p-5 bg-neutral-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white border border-neutral-200 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-black" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-black">
              {t('Install App on Mobile & Desktop (PWA)', 'تثبيت التطبيق على الهاتف والكمبيوتر (PWA)')}
            </h2>
            <p className="text-xs text-neutral-600 mt-0.5">
              {t(
                'Install Apex Confluence directly to your home screen for standalone full-screen mode, offline shell caching, and instant tap-to-open trade notifications.',
                'ثبّت أبيكس كونفلوينس مباشرة على شاشتك الرئيسية للعمل بملء الشاشة، والتخزين المؤقت السريع، وفتح كارت الصفقة فور الضغط على الإشعار.'
              )}
            </p>
          </div>
        </div>
        <PWAInstallButton variant="settings" />
      </section>

      {/* Account Profile, Language & Sign-In / Registration */}
      <section className="border border-neutral-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-black flex items-center gap-2">
            <User className="w-4 h-4" />
            <span>{t('Account, Language & Sync', 'الحساب واللغة والمزامنة')}</span>
          </h2>
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="px-3 py-1.5 bg-black text-white rounded-lg text-xs font-semibold"
          >
            {user?.isGuest ? t('Sign In / Create Account', 'تسجيل الدخول / فتح حساب') : t('Manage Account', 'إدارة الحساب')}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Display Name', 'الاسم الظاهر')}</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl text-black"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1 flex items-center gap-1">
              <Languages className="w-3.5 h-3.5" />
              <span>{t('Interface Language', 'لغة الواجهة')}</span>
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-neutral-100 rounded-xl h-10">
              {([
                { id: 'ar', label: 'عربي (RTL)' },
                { id: 'en', label: 'English (LTR)' },
              ] as Array<{ id: AppLanguage; label: string }>).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLang(opt.id)}
                  className={`rounded-lg text-[11px] font-bold transition-colors ${
                    lang === opt.id ? 'bg-black text-white' : 'text-neutral-700 hover:text-black'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Global IANA Timezone', 'المنطقة الزمنية العالمية IANA')}</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              dir="ltr"
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl bg-white text-black"
            >
              {allTimezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz} ({getTimezoneOffsetLabel(tz)})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 h-10 px-3 border border-neutral-200 rounded-xl w-full cursor-pointer">
              <input
                type="checkbox"
                checked={autoDst}
                onChange={(e) => setAutoDst(e.target.checked)}
                className="accent-black"
              />
              <span className="font-medium text-black">{t('Auto DST Adjustment', 'تعديل التوقيت الصيفي تلقائياً')}</span>
            </label>
          </div>
        </div>
      </section>

      {/* 24/7 Engine, Feed Health & Server Environment Status */}
      <section className="border border-neutral-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-black flex items-center gap-2">
            <Server className="w-4 h-4" />
            <span>{t('24/7 Engine, Feeds & Server Environment', 'حالة المحرك 24/7 والتغذية وبيئة الخادم')}</span>
          </h2>
          <span className="text-[11px] font-medium text-neutral-500">
            {t(
              'Credentials are read strictly from server environment variables',
              'يتم قراءة مفاتيح الربط حصرياً من متغيرات بيئة الخادم الآمنة'
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono-tabular">
          <div className="p-3 border border-neutral-200 rounded-xl">
            <div className="text-neutral-500 font-sans">{t('24/7 Worker', 'محرك العمل 24/7')}</div>
            <div dir="ltr" className="font-bold text-emerald-700 mt-0.5 inline-block">
              {health?.engine247Active ? t('ACTIVE', 'نشط') : t('STARTING', 'قيد التشغيل')} · {health?.uptimeSeconds ?? 0}s
            </div>
          </div>
          <div className="p-3 border border-neutral-200 rounded-xl">
            <div className="text-neutral-500 font-sans">{t('Gemini AI Proxy', 'محرك Gemini AI')}</div>
            <div className={`font-bold mt-0.5 ${health?.geminiConfigured ? 'text-emerald-700' : 'text-neutral-800'}`}>
              {health?.geminiConfigured
                ? t('Server Env Active', 'مفعل عبر الخادم')
                : t('Local Engine Fallback', 'الوضع المحلي التلقائي')}
            </div>
          </div>
          <div className="p-3 border border-neutral-200 rounded-xl">
            <div className="text-neutral-500 font-sans">{t('OANDA Feed', 'تغذية OANDA')}</div>
            <div className="font-bold text-black mt-0.5">
              {health?.oandaConfigured
                ? `OANDA ${health.oandaEnv === 'live' ? 'Live' : 'Practice'} (${health.oandaStatus})`
                : t('Public Bridge Active', 'الجسر العام نشط')}
            </div>
          </div>
          <div className="p-3 border border-neutral-200 rounded-xl">
            <div className="text-neutral-500 font-sans">{t('Binance BTCUSDT', 'تغذية Binance BTCUSDT')}</div>
            <div dir="ltr" className="font-bold text-emerald-700 mt-0.5 uppercase inline-block">
              {health?.binanceStatus || 'live'}
            </div>
          </div>
          <div className="p-3 border border-neutral-200 rounded-xl">
            <div className="text-neutral-500 font-sans">{t('Freeze / Gap Guard', 'حماية التوقف والفجوات')}</div>
            <div className="font-bold text-black mt-0.5">
              {health?.freezeDetected ? t('STALE', 'متأخر') : t('NOMINAL', 'مستقر')}
            </div>
          </div>
        </div>
      </section>

      {/* Risk, Loss, Profit-Lock, Exposure & Slippage Guards */}
      <section className="border border-neutral-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <h2 className="text-sm font-bold text-black flex items-center gap-2">
          <Shield className="w-4 h-4" />
          <span>{t('Risk, Profit-Lock, Exposure & Volatility Guards', 'حماية المخاطر وتثبيت الأرباح والتعرض والتذبذب')}</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Account Equity ($)', 'رصيد الحساب ($)')}</label>
            <input
              type="number"
              dir="ltr"
              value={risk.accountBalance}
              onChange={(e) => setRisk({ ...risk, accountBalance: Number(e.target.value) })}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl font-mono-tabular"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Risk Per Trade (%)', 'المخاطرة لكل صفقة (%)')}</label>
            <input
              type="number"
              step="0.1"
              dir="ltr"
              value={risk.riskPerTradePct}
              onChange={(e) => setRisk({ ...risk, riskPerTradePct: Number(e.target.value) })}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl font-mono-tabular"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Max Concurrent Trades', 'أقصى صفقات متزامنة')}</label>
            <input
              type="number"
              dir="ltr"
              value={risk.maxConcurrentTrades}
              onChange={(e) => setRisk({ ...risk, maxConcurrentTrades: Number(e.target.value) })}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl font-mono-tabular"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Daily Profit Lock (%)', 'قفل الربح اليومي (%)')}</label>
            <input
              type="number"
              step="0.5"
              dir="ltr"
              value={risk.dailyProfitLockPct}
              onChange={(e) => setRisk({ ...risk, dailyProfitLockPct: Number(e.target.value) })}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl font-mono-tabular"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Trailing Equity Guard (%)', 'حماية الرصيد المتحركة (%)')}</label>
            <input
              type="number"
              step="0.5"
              dir="ltr"
              value={risk.trailingEquityGuardPct}
              onChange={(e) => setRisk({ ...risk, trailingEquityGuardPct: Number(e.target.value) })}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl font-mono-tabular"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Daily Max Loss (%)', 'أقصى خسارة يومية (%)')}</label>
            <input
              type="number"
              step="0.5"
              dir="ltr"
              value={risk.dailyMaxLossPct}
              onChange={(e) => setRisk({ ...risk, dailyMaxLossPct: Number(e.target.value) })}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl font-mono-tabular"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Loss Streak Cooldown', 'التهدئة بعد الخسائر المتتالية')}</label>
            <input
              type="number"
              dir="ltr"
              value={risk.consecutiveLossCooldownCount}
              onChange={(e) => setRisk({ ...risk, consecutiveLossCooldownCount: Number(e.target.value) })}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl font-mono-tabular"
            />
          </div>
          <div>
            <label className="block font-medium text-neutral-600 mb-1">{t('Max Spread Multiplier', 'مضاعف السبريد الأقصى')}</label>
            <input
              type="number"
              step="0.1"
              dir="ltr"
              value={risk.maxSpreadMultiplier}
              onChange={(e) => setRisk({ ...risk, maxSpreadMultiplier: Number(e.target.value) })}
              className="w-full h-10 px-3 border border-neutral-300 rounded-xl font-mono-tabular"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs pt-1">
          {[
            {
              key: 'exposureGuardEnabled',
              label: t('Currency Exposure & Correlation Guard', 'حماية تعرض العملات والارتباط'),
            },
            {
              key: 'newsVolatilityShieldEnabled',
              label: t('Economic Calendar & Volatility Shield', 'درع الأخبار الاقتصادية والتذبذب'),
            },
            {
              key: 'splitEntryEnabled',
              label: t('Split Entry Sizing Option', 'خيار تقسيم الدخول'),
            },
            {
              key: 'oneClickTradingEnabled',
              label: t('One-Click Order Execution', 'التنفيذ السريع بنقرة واحدة'),
            },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2 p-2.5 border border-neutral-200 rounded-xl cursor-pointer"
            >
              <input
                type="checkbox"
                checked={Boolean(risk[item.key as keyof typeof risk])}
                onChange={(e) => setRisk({ ...risk, [item.key]: e.target.checked })}
                className="accent-black"
              />
              <span className="font-medium text-black">{item.label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Alert & Web Push Settings */}
      <section className="border border-neutral-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-black flex items-center gap-2">
            <Bell className="w-4 h-4" />
            <span>{t('Web Push & Sound Alerts', 'إشعارات الويب والتنبيهات الصوتية')}</span>
          </h2>
          <button
            type="button"
            onClick={async () => {
              const msg = await onEnablePushNotifications();
              setPushMsg(msg);
            }}
            className="px-3 py-1.5 border border-neutral-300 rounded-lg text-xs font-semibold hover:bg-neutral-50"
          >
            {t('Enable Browser Push Notifications', 'تفعيل إشعارات المتصفح الفورية')}
          </button>
        </div>
        {pushMsg && <p className="text-xs text-neutral-700">{pushMsg}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {[
            { key: 'soundEnabled', label: t('In-App Audio Chimes', 'التنبيهات الصوتية داخل التطبيق') },
            { key: 'notifyScalp', label: t('Scalping Alerts (اسكالبينج)', 'تنبيهات صفقات الاسكالبينج') },
            { key: 'notifyEntryApproach', label: t('Approaching Entry Zone', 'الاقتراب من منطقة الدخول') },
            { key: 'notifyCandleClose', label: t('Candle Close Confirmation', 'تأكيد إغلاق الشمعة') },
            { key: 'notifyTp1Be', label: t('TP1 -> Breakeven Moves', 'تحريك الوقف للدخول عند TP1') },
            { key: 'notifyFinalTpSl', label: t('Final TP / SL Hits', 'وصول الأهداف أو وقف الخسارة') },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2 p-2.5 border border-neutral-200 rounded-xl cursor-pointer"
            >
              <input
                type="checkbox"
                checked={Boolean(alerts[item.key as keyof typeof alerts])}
                onChange={(e) => setAlerts({ ...alerts, [item.key]: e.target.checked })}
                className="accent-black"
              />
              <span className="font-medium text-black">{item.label}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
};
