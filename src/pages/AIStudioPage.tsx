import React, { useRef, useState } from 'react';
import { Send, Eye, EyeOff, Download, Upload, FlaskConical, Trash2 } from 'lucide-react';
import { CustomIndicator, SchoolId } from '../types/trading';
import { ANALYSIS_SCHOOLS } from '../lib/schools';
import { useI18n } from '../lib/i18n';

interface AIStudioPageProps {
  indicators: CustomIndicator[];
  onCreateOrUpdateIndicator: (ind: CustomIndicator) => Promise<void>;
  onDeleteIndicator: (id: string) => Promise<void>;
  onToggleVisibility: (id: string) => Promise<void>;
  onSendToBacktest: () => void;
  authHeaders: Record<string, string>;
  onIndicatorGenerated: (ind: CustomIndicator) => void;
}

export const AIStudioPage: React.FC<AIStudioPageProps> = ({
  indicators,
  onCreateOrUpdateIndicator,
  onDeleteIndicator,
  onToggleVisibility,
  onSendToBacktest,
  authHeaders,
  onIndicatorGenerated,
}) => {
  const { lang, t } = useI18n();
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    {
      role: 'assistant',
      text: lang === 'ar'
        ? 'مرحباً بك في مختبر Apex Confluence AI Studio. صف المؤشر أو الاستراتيجية التي تريد بناءها بالعربية أو الإنجليزية (مثال: "أنشئ مؤشر تقاطع EMA 8/21 متوافق مع SMC" أو "Create an RSI liquidity divergence oscillator").'
        : 'Welcome to Apex Confluence AI Studio. Describe any custom indicator or strategy in English or Arabic (e.g., "Create an EMA 8/21 crossover with SMC confluence" or "Create an RSI liquidity divergence oscillator").',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(indicators[0]?.id ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = indicators.find((i) => i.id === selectedId) || indicators[0] || null;

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    const nextHist = [...messages, { role: 'user' as const, text }];
    setMessages(nextHist);
    setSending(true);
    try {
      const res = await fetch('/api/studio/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ message: text, history: nextHist }),
      });
      const data = (await res.json()) as { reply?: string; indicator?: CustomIndicator };
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: data.reply || 'Done.' },
      ]);
      if (data.indicator) {
        onIndicatorGenerated(data.indicator);
        setSelectedId(data.indicator.id);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Connection interrupted. Please retry your indicator request.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleExportJson = (ind: CustomIndicator) => {
    const blob = new Blob([JSON.stringify(ind, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ind.name.toLowerCase().replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt) as CustomIndicator;
      if (!parsed.name || !parsed.blueprint) return;
      const imported: CustomIndicator = {
        ...parsed,
        id: `ind_imp_${Date.now()}`,
        createdAt: Date.now(),
      };
      await onCreateOrUpdateIndicator(imported);
      setSelectedId(imported.id);
    } catch {
      // ignore invalid JSON
    }
  };

  const updateInputVal = async (ind: CustomIndicator, key: string, val: number | string) => {
    const updated: CustomIndicator = {
      ...ind,
      inputs: ind.inputs.map((inp) => (inp.key === key ? { ...inp, value: val } : inp)),
    };
    await onCreateOrUpdateIndicator(updated);
  };

  const toggleLinkedSchool = async (ind: CustomIndicator, sid: SchoolId) => {
    const has = ind.linkedSchools.includes(sid);
    const updated: CustomIndicator = {
      ...ind,
      linkedSchools: has ? ind.linkedSchools.filter((x) => x !== sid) : [...ind.linkedSchools, sid],
    };
    await onCreateOrUpdateIndicator(updated);
  };

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-black">
            {t('AI Indicator & Strategy Studio', 'مختبر المؤشرات والاستراتيجيات الذكي')}
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t(
              'Conversational custom indicator builder, sandboxed parameter controls, JSON export/import & 16-school confluence linkage.',
              'بناء المؤشرات المخصصة بالمحادثة، ضبط المعاملات بأمان، استيراد/تصدير JSON، والربط مع المدارس الـ 16.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJson}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[40px] px-3 border border-neutral-300 rounded-xl text-xs font-semibold hover:bg-neutral-50 flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{t('Import JSON', 'استيراد JSON')}</span>
          </button>
          <button
            type="button"
            onClick={onSendToBacktest}
            className="min-h-[40px] px-3.5 bg-black text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 flex items-center gap-1.5"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>{t('Send to Backtest Lab', 'إرسال لمختبر الباك تيست')}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Conversational Studio Chat */}
        <div className="lg:col-span-6 border border-neutral-200 rounded-2xl flex flex-col h-[520px] bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100 text-xs font-bold text-black">
            {t('Conversational Builder (Arabic & English)', 'المساعد المحادث لبناء المؤشرات (عربي وإنجليزي)')}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[88%] p-3 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'ms-auto bg-black text-white'
                    : 'me-auto bg-neutral-100 text-black'
                }`}
              >
                {m.text}
              </div>
            ))}
          </div>
          <form onSubmit={sendChat} className="p-3 border-t border-neutral-200 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t(
                'Describe your indicator or strategy (e.g. Bollinger Squeeze + SMC)...',
                'صف المؤشر أو الاستراتيجية (مثال: تقاطع EMA 8/21 مع سيولة SMC)...'
              )}
              className="flex-1 h-11 px-3 border border-neutral-300 rounded-xl text-xs text-black focus:outline-none focus:border-black"
            />
            <button
              type="submit"
              disabled={sending}
              className="min-h-[44px] px-4 bg-black text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{sending ? '...' : t('Build', 'بناء')}</span>
            </button>
          </form>
        </div>

        {/* Custom Indicator Library & Parameter Inspector */}
        <div className="lg:col-span-6 space-y-4">
          <div className="border border-neutral-200 rounded-2xl p-4 space-y-3">
            <h2 className="text-sm font-bold text-black">
              {t(`Custom Indicator Library (${indicators.length})`, `مكتبة المؤشرات المخصصة (${indicators.length})`)}
            </h2>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {indicators.map((ind) => (
                <div
                  key={ind.id}
                  onClick={() => setSelectedId(ind.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedId(ind.id)}
                  className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between gap-2 ${
                    selected?.id === ind.id ? 'border-black bg-neutral-50' : 'border-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-black truncate">
                      {lang === 'ar' ? ind.nameAr || ind.name : ind.name} ·{' '}
                      <span className="text-neutral-500 font-normal">{lang === 'ar' ? ind.name : ind.nameAr}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500 truncate">{ind.description}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onToggleVisibility(ind.id);
                      }}
                      className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 ${
                        ind.visible
                          ? 'bg-emerald-700 text-white'
                          : 'bg-white border border-neutral-300 text-neutral-700'
                      }`}
                    >
                      {ind.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      <span>{ind.visible ? t('Active', 'تشغيل') : t('Hidden', 'إخفاء')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportJson(ind);
                      }}
                      className="p-2 border border-neutral-200 rounded-lg hover:bg-neutral-100"
                      title={t('Export JSON Blueprint', 'تصدير JSON')}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteIndicator(ind.id);
                      }}
                      className="p-2 border border-neutral-200 rounded-lg text-red-600 hover:bg-red-50"
                      title={t('Delete indicator', 'حذف المؤشر')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selected && (
            <div className="border border-neutral-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-black">
                  {t(`Parameters & Confluence (${selected.name})`, `المعاملات والتوافق (${selected.nameAr || selected.name})`)}
                </h3>
                <span dir="ltr" className="text-[11px] font-mono-tabular text-neutral-500">
                  Pane: {selected.blueprint.pane} · {selected.blueprint.kind}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                {selected.inputs.map((inp) => (
                  <div key={inp.key}>
                    <label className="block text-[11px] font-medium text-neutral-600 mb-1">{inp.label}</label>
                    <input
                      type="number"
                      dir="ltr"
                      value={inp.value}
                      min={inp.min}
                      max={inp.max}
                      step={inp.step || 1}
                      onChange={(e) => void updateInputVal(selected, inp.key, Number(e.target.value))}
                      className="w-full h-9 px-2.5 border border-neutral-300 rounded-lg font-mono-tabular"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">{t('Primary Color', 'اللون الأساسي')}</label>
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(e) => void onCreateOrUpdateIndicator({ ...selected, color: e.target.value })}
                    className="w-full h-9 p-1 border border-neutral-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 mb-1">{t('Line Style', 'نمط الخط')}</label>
                  <select
                    value={selected.lineStyle}
                    onChange={(e) =>
                      void onCreateOrUpdateIndicator({
                        ...selected,
                        lineStyle: e.target.value as CustomIndicator['lineStyle'],
                      })
                    }
                    className="w-full h-9 px-2 border border-neutral-300 rounded-lg bg-white"
                  >
                    <option value="solid">{t('Solid', 'متصل')}</option>
                    <option value="dashed">{t('Dashed', 'متقطع')}</option>
                    <option value="dotted">{t('Dotted', 'منقط')}</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-neutral-600 mb-1.5">
                  {t('Confluence Linkage with 16 Schools', 'الربط التوافقي مع المدارس الـ 16')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ANALYSIS_SCHOOLS.map((sc) => {
                    const linked = selected.linkedSchools.includes(sc.id);
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => void toggleLinkedSchool(selected, sc.id)}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium border ${
                          linked ? 'bg-black text-white border-black' : 'bg-white text-neutral-600 border-neutral-200'
                        }`}
                      >
                        {lang === 'ar' ? sc.nameAr : sc.shortEn}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
