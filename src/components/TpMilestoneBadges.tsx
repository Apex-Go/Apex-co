import React from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface TpMilestoneBadgesProps {
  tp1: number;
  tp2?: number;
  tp3?: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  decimals?: number;
  compact?: boolean;
  showBreakevenBadge?: boolean;
}

export const TpMilestoneBadges: React.FC<TpMilestoneBadgesProps> = ({
  tp1,
  tp2,
  tp3,
  tp1Hit = false,
  tp2Hit = false,
  tp3Hit = false,
  decimals = 2,
  compact = false,
  showBreakevenBadge = true,
}) => {
  const { t } = useI18n();
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(decimals) : '—');

  const items = [
    { key: 'TP1', price: tp1, hit: Boolean(tp1Hit) },
    ...(tp2 !== undefined ? [{ key: 'TP2', price: tp2, hit: Boolean(tp2Hit) }] : []),
    ...(tp3 !== undefined ? [{ key: 'TP3', price: tp3, hit: Boolean(tp3Hit) }] : []),
  ];

  return (
    <div dir="ltr" className="flex flex-wrap items-center gap-1 font-mono-tabular">
      {items.map((item) => (
        <span
          key={item.key}
          className={`inline-flex items-center gap-1 rounded-md border font-semibold ${
            compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
          } ${
            item.hit
              ? 'bg-emerald-600 text-white border-emerald-700 shadow-2xs'
              : 'bg-neutral-50 text-neutral-600 border-neutral-200'
          }`}
          title={item.hit ? `${item.key} Hit (${fmt(item.price)})` : `${item.key}: ${fmt(item.price)}`}
        >
          {item.hit && <Check className="w-2.5 h-2.5 stroke-[3]" />}
          <span>{item.hit ? `${item.key} Hit` : item.key}</span>
          {!compact && <span className={item.hit ? 'text-emerald-100' : 'text-neutral-500'}>{fmt(item.price)}</span>}
        </span>
      ))}

      {showBreakevenBadge && tp1Hit && (
        <span
          className={`inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 text-amber-800 font-semibold ${
            compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
          }`}
        >
          <ShieldCheck className="w-3 h-3 text-amber-700" />
          <span>{t('SL → BE', 'الوقف ← نقطة الدخول')}</span>
        </span>
      )}
    </div>
  );
};
