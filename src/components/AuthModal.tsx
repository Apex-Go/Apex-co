import React, { useState } from 'react';
import { X, UserCheck, KeyRound, Globe } from 'lucide-react';
import { UserAccount } from '../types/trading';
import { CURATED_TIMEZONES, detectDeviceTimezone } from '../lib/timezones';
import { SUPPORTED_SYMBOLS } from '../lib/schools';
import { useI18n } from '../lib/i18n';
import { Logo } from './Logo';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  user: UserAccount | null;
  onAuthSuccess: (user: UserAccount, token: string, remember: boolean) => void;
  onLogout: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  onClose,
  user,
  onAuthSuccess,
  onLogout,
}) => {
  const { lang, dir, t } = useI18n();
  const [tab, setTab] = useState<'login' | 'register' | 'forgot'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [timezone, setTimezone] = useState(() => detectDeviceTimezone());
  const [defaultWatchlist, setDefaultWatchlist] = useState<string[]>([
    'XAUUSD',
    'BTCUSDT',
    'USOIL',
    'EURUSD',
    'GBPUSD',
  ]);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const toggleWl = (sym: string) => {
    setDefaultWatchlist((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Sign in failed', 'فشل تسجيل الدخول'));
      onAuthSuccess(data.user, data.token, rememberMe);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Sign in failed', 'فشل تسجيل الدخول'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(t('Passwords do not match.', 'كلمتا المرور غير متطابقتين.'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          email,
          password,
          confirmPassword,
          timezone,
          defaultWatchlist,
          language: lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Registration failed', 'فشل إنشاء الحساب'));
      onAuthSuccess(data.user, data.token, true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Registration failed', 'فشل إنشاء الحساب'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newPassword: newPassword || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setInfoMsg(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/guest', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error('Guest session error');
      onAuthSuccess(data.user, data.token, true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guest error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir={dir} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto p-5 sm:p-6 shadow-xl">
        <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
          <div dir="ltr">
            <Logo showArabic />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-neutral-100 text-neutral-600"
            aria-label={t('Close', 'إغلاق')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {user && !user.isGuest ? (
          <div className="pt-5 space-y-4">
            <div className="p-4 border border-neutral-200 rounded-xl space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-black">
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <span>{user.displayName}</span>
              </div>
              <p dir="ltr" className="text-xs text-neutral-500">{user.email}</p>
              <p className="text-xs text-neutral-500 flex items-center gap-1 pt-1">
                <Globe className="w-3.5 h-3.5" />
                <span dir="ltr">{user.timezone}</span>
              </p>
            </div>
            <p className="text-xs text-neutral-600">
              {t(
                'Your presets, watchlists, templates, custom AI indicators, drawings, and immutable trade log are synced to your account (100% free & unrestricted).',
                'تمت مزامنة إعداداتك المفضلة وقوائم المراقبة والقوالب والمؤشرات المخصصة والرسومات وسجل الصفقات غير القابل للتعديل مع حسابك (مجاني 100% بلا قيود).'
              )}
            </p>
            <button
              type="button"
              onClick={onLogout}
              className="w-full min-h-[44px] py-2.5 px-4 border border-neutral-300 rounded-xl text-sm font-medium text-black hover:bg-neutral-50"
            >
              {t('Sign Out', 'تسجيل الخروج')}
            </button>
          </div>
        ) : (
          <div className="pt-4 space-y-4">
            <div className="grid grid-cols-3 gap-1 p-1 bg-neutral-100 rounded-xl">
              <button
                type="button"
                onClick={() => { setTab('login'); setError(''); setInfoMsg(''); }}
                className={`min-h-[40px] text-xs font-semibold rounded-lg transition-colors ${
                  tab === 'login' ? 'bg-white text-black shadow-xs' : 'text-neutral-600'
                }`}
              >
                {t('Sign In', 'تسجيل الدخول')}
              </button>
              <button
                type="button"
                onClick={() => { setTab('register'); setError(''); setInfoMsg(''); }}
                className={`min-h-[40px] text-xs font-semibold rounded-lg transition-colors ${
                  tab === 'register' ? 'bg-white text-black shadow-xs' : 'text-neutral-600'
                }`}
              >
                {t('Create Account', 'فتح حساب')}
              </button>
              <button
                type="button"
                onClick={() => { setTab('forgot'); setError(''); setInfoMsg(''); }}
                className={`min-h-[40px] text-xs font-semibold rounded-lg transition-colors ${
                  tab === 'forgot' ? 'bg-white text-black shadow-xs' : 'text-neutral-600'
                }`}
              >
                {t('Reset Password', 'استعادة كلمة المرور')}
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {error}
              </div>
            )}
            {infoMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                {infoMsg}
              </div>
            )}

            {tab === 'login' && (
              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">{t('Email', 'البريد الإلكتروني')}</label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@example.com"
                    className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black focus:outline-none focus:border-black"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">{t('Password', 'كلمة المرور')}</label>
                  <input
                    type="password"
                    required
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black focus:outline-none focus:border-black"
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <label className="inline-flex items-center gap-2 text-neutral-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-neutral-300 accent-black"
                    />
                    <span>{t('Remember Me', 'تذكرني')}</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setTab('forgot')}
                    className="text-neutral-600 underline hover:text-black"
                  >
                    {t('Forgot Password?', 'نسيت كلمة المرور؟')}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] bg-black text-white rounded-xl text-sm font-semibold hover:bg-neutral-800 disabled:opacity-50"
                >
                  {loading ? t('Signing in...', 'جارٍ تسجيل الدخول...') : t('Sign In', 'تسجيل الدخول')}
                </button>
              </form>
            )}

            {tab === 'register' && (
              <form onSubmit={handleRegister} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">{t('Display Name', 'الاسم الظاهر')}</label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('Ahmed / Trader Name', 'أحمد / اسم المتداول')}
                    className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black focus:outline-none focus:border-black"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">{t('Email', 'البريد الإلكتروني')}</label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@example.com"
                    className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black focus:outline-none focus:border-black"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">{t('Password', 'كلمة المرور')}</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('Min 6 chars', '6 أحرف على الأقل')}
                      className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">{t('Confirm Password', 'تأكيد كلمة المرور')}</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      dir="ltr"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t('Repeat', 'أعد الكتابة')}
                      className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black focus:outline-none focus:border-black"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">{t('Preferred Timezone', 'المنطقة الزمنية المفضلة')}</label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    dir="ltr"
                    className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black bg-white focus:outline-none focus:border-black"
                  >
                    {CURATED_TIMEZONES.map((tz) => (
                      <option key={tz.id} value={tz.id}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1.5">{t('Default Watchlist', 'قائمة المراقبة الافتراضية')}</label>
                  <div className="flex flex-wrap gap-1.5" dir="ltr">
                    {SUPPORTED_SYMBOLS.filter((s) => s.category !== 'Macro').map((s) => {
                      const active = defaultWatchlist.includes(s.symbol);
                      return (
                        <button
                          key={s.symbol}
                          type="button"
                          onClick={() => toggleWl(s.symbol)}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            active
                              ? 'bg-black text-white border-black'
                              : 'bg-white text-neutral-700 border-neutral-300 hover:border-black'
                          }`}
                        >
                          {s.symbol}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] bg-black text-white rounded-xl text-sm font-semibold hover:bg-neutral-800 disabled:opacity-50"
                >
                  {loading ? t('Creating Account...', 'جارٍ فتح الحساب...') : t('Create Free Account', 'فتح حساب مجاني')}
                </button>
              </form>
            )}

            {tab === 'forgot' && (
              <form onSubmit={handleForgot} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">{t('Registered Email', 'البريد المسجل')}</label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@example.com"
                    className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black focus:outline-none focus:border-black"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">{t('New Password', 'كلمة المرور الجديدة')}</label>
                  <input
                    type="password"
                    minLength={6}
                    dir="ltr"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('Enter new password', 'أدخل كلمة المرور الجديدة')}
                    className="w-full h-11 px-3 border border-neutral-300 rounded-xl text-sm text-black focus:outline-none focus:border-black"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] bg-black text-white rounded-xl text-sm font-semibold hover:bg-neutral-800 flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{t('Reset Password', 'إعادة تعيين كلمة المرور')}</span>
                </button>
              </form>
            )}

            <div className="pt-3 border-t border-neutral-100">
              <button
                type="button"
                onClick={handleGuest}
                className="w-full min-h-[44px] border border-neutral-300 rounded-xl text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
              >
                {t('Continue in Local / Guest Workspace', 'المتابعة في مساحة العمل المحلية (دخول سريع بدون تسجيل)')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
