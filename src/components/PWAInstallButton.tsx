import React, { useState } from 'react';
import { Download, Share, PlusSquare, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useI18n } from '../lib/i18n';

interface PWAInstallButtonProps {
  variant?: 'header' | 'settings';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { t } = useI18n();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [guideOpen, setGuideOpen] = useState(false);

  // Suppress header install button when already launched in standalone PWA mode
  if (isInstalled) {
    if (variant === 'settings') {
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{t('App Installed (Standalone Mode)', 'التطبيق مثبّت (وضع التطبيق المستقل)')}</span>
        </div>
      );
    }
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const result = await install();
      if (result !== 'unavailable') return;
    }
    setGuideOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        title={t('Install Apex Confluence App', 'تثبيت تطبيق Apex Confluence')}
        className={
          variant === 'header'
            ? 'min-h-[36px] px-2.5 border border-neutral-300 bg-white rounded-lg text-[11px] font-semibold text-black hover:bg-neutral-50 flex items-center gap-1.5 whitespace-nowrap'
            : 'min-h-[42px] px-4 bg-black text-white rounded-xl text-xs font-bold hover:bg-neutral-800 inline-flex items-center gap-2 whitespace-nowrap'
        }
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className={variant === 'header' ? 'hidden sm:inline' : ''}>
          {t('Install App', 'تثبيت التطبيق')}
        </span>
      </button>

      {guideOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setGuideOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white border border-neutral-200 rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4"
          >
            <div className="sm:hidden w-10 h-1 bg-neutral-300 rounded-full mx-auto -mt-1" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl border border-neutral-200 bg-neutral-50 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-black" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-black">
                    {isIOS
                      ? t('Install Apex on iPhone / iPad', 'تثبيت التطبيق على آيفون / آيباد')
                      : t('Install Apex Confluence App', 'تثبيت تطبيق أبيكس كونفلوينس')}
                  </h3>
                  <p className="text-[11px] text-neutral-500">
                    {t('Runs full-screen with home screen icon & alerts', 'يعمل بملء الشاشة مع أيقونة على الشاشة الرئيسية وإشعارات')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                aria-label={t('Close', 'إغلاق')}
                className="p-1.5 rounded-lg text-neutral-500 hover:text-black hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-2.5 text-xs text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-xl p-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {t('Tap the', 'اضغط على زر')}{' '}
                    <strong className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-neutral-300 rounded-md">
                      <Share className="w-3.5 h-3.5" />
                      {t('Share', 'مشاركة Share')}
                    </strong>{' '}
                    {t('button in Safari toolbar.', 'في شريط سفاري.')}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    {t('Scroll down and tap', 'مرر للأسفل واختر')}{' '}
                    <strong className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-neutral-300 rounded-md">
                      <PlusSquare className="w-3.5 h-3.5" />
                      {t('Add to Home Screen', 'إضافة إلى الشاشة الرئيسية')}
                    </strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 text-xs text-neutral-800 bg-neutral-50 border border-neutral-200 rounded-xl p-3.5">
                <div className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>
                    {t(
                      'Open this app directly in Chrome, Edge, or Android browser (not an embedded frame) and tap the browser install icon in the address bar or menu (⋮).',
                      'افتح التطبيق في متصفح Chrome أو Edge أو أندرويد مباشرة واضغط أيقونة التثبيت في شريط العنوان أو قائمة (⋮).'
                    )}
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>
                    {t(
                      'Select "Install Apex Confluence" / "Add to Home Screen" for standalone full-screen launch.',
                      'اختر "تثبيت Apex Confluence" أو "إضافة إلى الشاشة الرئيسية" لتشغيله كتطبيق مستقل.'
                    )}
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setGuideOpen(false)}
              className="w-full min-h-[42px] bg-black text-white rounded-xl text-xs font-bold hover:bg-neutral-800"
            >
              {t('Got it', 'حسناً')}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
