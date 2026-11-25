import type {
  AISignal,
  LossRootCauseCategory,
  MissedWinRootCauseCategory,
  MtfSnapshotItem,
  RejectedSetup,
  RootCauseAnalytics,
  UserTrade,
} from '../src/types/trading.ts';
import { SYMBOL_MAP } from '../src/lib/schools.ts';

const LOSS_LABELS_AR: Record<LossRootCauseCategory, string> = {
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

export function classifySignalLossCause(sig: AISignal, minsHeld: number): {
  category: LossRootCauseCategory;
  detail: string;
} {
  const isBuy = sig.direction === 'BUY';
  const expectedBias = isBuy ? 'BULLISH' : 'BEARISH';
  const opposingBias = isBuy ? 'BEARISH' : 'BULLISH';

  const htfOppose = sig.mtfSnapshot.filter(
    (m) => (m.timeframe === '1h' || m.timeframe === '4h') && m.bias === opposingBias
  );
  const mom15 = sig.mtfSnapshot.find((m) => m.timeframe === '15m')?.momentum ?? 0;
  const againstMom = (isBuy && mom15 < -12) || (!isBuy && mom15 > 12);

  if (htfOppose.length >= 1 || againstMom) {
    const tfStr = htfOppose.map((m) => `${m.timeframe.toUpperCase()} ${m.bias}`).join(' & ') || `15M mom ${mom15}`;
    return {
      category: 'Counter-Trend / Against Momentum',
      detail: `Counter-trend ${sig.direction} opposed ${tfStr} without sustained reversal (${minsHeld}m).`,
    };
  }

  const rsi = sig.entryRsi ?? 50;
  const zoneMid = (sig.optimalEntryZone[0] + sig.optimalEntryZone[1]) / 2;
  const zoneDist = Math.abs(sig.entryPrice - zoneMid);
  const slDist = Math.max(1e-6, Math.abs(sig.entryPrice - sig.stopLoss));
  if ((isBuy && rsi >= 65) || (!isBuy && rsi <= 35) || zoneDist > slDist * 0.65) {
    return {
      category: 'Late Entry / Chasing',
      detail: `Chased entry away from pullback zone (RSI ${rsi.toFixed(1)}, zone offset ${zoneDist.toFixed(SYMBOL_MAP[sig.symbol]?.decimals ?? 2)}).`,
    };
  }

  const slAtrRatio = sig.slAtrRatio ?? 1.0;
  if (slAtrRatio > 1.75 || minsHeld <= 12) {
    return {
      category: 'Wide SL / Volatility Spike',
      detail:
        minsHeld <= 12
          ? `Rapid SL sweep within ${minsHeld}m from intraday volatility spike / liquidity whip.`
          : `Stop distance (${slAtrRatio.toFixed(2)}x ATR) exceeded volatility norm for ${sig.recommendedTimeframe.toUpperCase()}.`,
    };
  }

  return {
    category: 'Premature / Weak Confluence',
    detail: `Confluence ${sig.weightedScore}/100 (${sig.schoolsUsed.length} schools) failed follow-through before TP1.`,
  };
}

export function classifyUserTradeLossCause(
  tr: UserTrade,
  linkedSignal?: AISignal,
  mtfSnapshot?: MtfSnapshotItem[],
  minsHeld = 30
): {
  category: LossRootCauseCategory;
  detail: string;
} {
  const isBuy = tr.side === 'BUY';
  const opposingBias = isBuy ? 'BEARISH' : 'BULLISH';
  const snaps = mtfSnapshot ?? linkedSignal?.mtfSnapshot ?? [];
  const htfOppose = snaps.find(
    (m) => (m.timeframe === '1h' || m.timeframe === '4h') && m.bias === opposingBias
  );

  if (htfOppose) {
    return {
      category: 'Counter-Trend / Against Momentum',
      detail: `${tr.side} execution opposed ${htfOppose.timeframe.toUpperCase()} (${htfOppose.bias}) structure.`,
    };
  }

  if (tr.driftPips > (SYMBOL_MAP[tr.symbol]?.typicalSpreadPips ?? 2) * 6 || tr.tags.includes('Late Entry') || tr.tags.includes('FOMO')) {
    return {
      category: 'Late Entry / Chasing',
      detail: `Entered ${tr.driftPips} pips beyond optimal plan zone (${tr.tags.join(', ') || 'chased fill'}).`,
    };
  }

  if (minsHeld <= 12 || tr.rrRatio < 1.0) {
    return {
      category: 'Wide SL / Volatility Spike',
      detail: `Stopped out in ${minsHeld}m with ${tr.rrRatio}:1 R:R geometry under spike volatility.`,
    };
  }

  return {
    category: 'Premature / Weak Confluence',
    detail: `Setup lacked multi-school structural confirmation before hitting SL (${tr.stopLoss}).`,
  };
}

export function classifyMissedWinCause(setup: RejectedSetup): {
  category: MissedWinRootCauseCategory;
  detail: string;
} {
  const g = setup.guardName.toLowerCase();
  const r = setup.reason.toLowerCase();

  if (
    g.includes('confluence score') ||
    (setup.weightedScore !== undefined && setup.weightedScore >= 72 && setup.weightedScore < 80) ||
    r.includes('below strict 80')
  ) {
    return {
      category: 'Near-Threshold Score',
      detail: `Score (${setup.weightedScore ?? '75–79'}/100) narrowly missed cutoff before hitting hypothetical TP1 (+${setup.counterfactualPnlR.toFixed(2)}R).`,
    };
  }

  if (
    g.includes('closed-candle') ||
    g.includes('sweep') ||
    g.includes('structural school') ||
    g.includes('cool-down') ||
    g.includes('cooldown') ||
    g.includes('autopsy')
  ) {
    return {
      category: 'Early Rejection Before Pullback/Confirm',
      detail: `${setup.guardName} rejected setup prior to full candle/pullback confirmation; price later reached TP1.`,
    };
  }

  return {
    category: 'Over-Strict Filter',
    detail: `${setup.guardName} blocked valid ${setup.symbol} ${setup.direction} structure that cleared TP1 (+${setup.counterfactualPnlR.toFixed(2)}R).`,
  };
}

export function computeRootCauseAnalytics(params: {
  signals: AISignal[];
  trades: UserTrade[];
  rejected: RejectedSetup[];
  now?: number;
}): RootCauseAnalytics {
  const now = params.now ?? Date.now();
  const window48h = now - 48 * 3600 * 1000;
  const cooldownWindow12h = now - 12 * 3600 * 1000;

  const lossCounts: Record<LossRootCauseCategory, { count: number; recent12h: number; totalR: number }> = {
    'Counter-Trend / Against Momentum': { count: 0, recent12h: 0, totalR: 0 },
    'Late Entry / Chasing': { count: 0, recent12h: 0, totalR: 0 },
    'Wide SL / Volatility Spike': { count: 0, recent12h: 0, totalR: 0 },
    'Premature / Weak Confluence': { count: 0, recent12h: 0, totalR: 0 },
  };

  for (const s of params.signals) {
    if (s.status !== 'Lost' || s.createdAt < window48h) continue;
    const cat = s.lossCause ?? classifySignalLossCause(s, 20).category;
    lossCounts[cat].count += 1;
    lossCounts[cat].totalR += s.pnlR || -1;
    if ((s.closedAt ?? s.createdAt) >= cooldownWindow12h) {
      lossCounts[cat].recent12h += 1;
    }
  }

  for (const tr of params.trades) {
    if (tr.status !== 'Lost' || tr.createdAt < window48h) continue;
    const cat = tr.lossCause ?? classifyUserTradeLossCause(tr).category;
    const rVal = tr.riskUsd > 0 ? tr.pnlUsd / tr.riskUsd : -1;
    lossCounts[cat].count += 1;
    lossCounts[cat].totalR += rVal;
    if ((tr.closedAt ?? tr.createdAt) >= cooldownWindow12h) {
      lossCounts[cat].recent12h += 1;
    }
  }

  const missedCounts: Record<MissedWinRootCauseCategory, { count: number; missedR: number }> = {
    'Near-Threshold Score': { count: 0, missedR: 0 },
    'Over-Strict Filter': { count: 0, missedR: 0 },
    'Early Rejection Before Pullback/Confirm': { count: 0, missedR: 0 },
  };

  for (const r of params.rejected) {
    if (!r.wouldHaveWon || r.createdAt < window48h) continue;
    // Ignore historical SL Loss Autopsy entries when counting missed-win filter blocks
    if (r.guardName === 'SL Loss Autopsy') continue;
    const cat = r.missedWinCause ?? classifyMissedWinCause(r).category;
    missedCounts[cat].count += 1;
    missedCounts[cat].missedR += Math.max(0.5, r.counterfactualPnlR || 1.2);
  }

  // Self-Correction Policy: tighten on repeating losses, safely calibrate on missed wins
  // NEVER relax Counter-Trend or Late-Entry protection
  let minConfluenceScore = 80;
  let antiLateAtrMult = 1.85;
  let slCapScale = 1.0;
  let chopAtrFloor = 1.15;

  const activeCooldownCauses: LossRootCauseCategory[] = [];
  (Object.keys(lossCounts) as LossRootCauseCategory[]).forEach((cat) => {
    if (lossCounts[cat].recent12h >= 2) {
      activeCooldownCauses.push(cat);
    }
  });

  if (lossCounts['Late Entry / Chasing'].recent12h >= 2) {
    antiLateAtrMult = 1.25;
  } else if (lossCounts['Late Entry / Chasing'].count >= 1) {
    antiLateAtrMult = 1.5;
  }

  if (lossCounts['Wide SL / Volatility Spike'].recent12h >= 2) {
    slCapScale = 0.85;
  } else if (lossCounts['Wide SL / Volatility Spike'].count >= 1) {
    slCapScale = 0.92;
  }

  if (lossCounts['Premature / Weak Confluence'].recent12h >= 2) {
    minConfluenceScore = 84;
  } else if (lossCounts['Premature / Weak Confluence'].count >= 1) {
    minConfluenceScore = 82;
  } else if (
    missedCounts['Near-Threshold Score'].count >= 2 &&
    lossCounts['Premature / Weak Confluence'].count === 0 &&
    lossCounts['Counter-Trend / Against Momentum'].recent12h === 0
  ) {
    minConfluenceScore = 76;
  }

  if (
    missedCounts['Over-Strict Filter'].count >= 2 &&
    lossCounts['Wide SL / Volatility Spike'].count === 0 &&
    lossCounts['Counter-Trend / Against Momentum'].count === 0
  ) {
    chopAtrFloor = 0.95;
  }

  const lossAdjustmentCopy: Record<
    LossRootCauseCategory,
    { adjustmentEn: string; adjustmentAr: string }
  > = {
    'Counter-Trend / Against Momentum': {
      adjustmentEn:
        lossCounts['Counter-Trend / Against Momentum'].recent12h >= 2
          ? 'Cooldown active: 3/3 HTF alignment + closed CHoCH locked'
          : 'Anti-counter-trend lock requires closed-candle CHoCH',
      adjustmentAr:
        lossCounts['Counter-Trend / Against Momentum'].recent12h >= 2
          ? 'تهدئة نشطة: إلزام توافق الفريمات الكبيرة + كسر هيكلي مغلق'
          : 'قفل عكس الاتجاه يتطلب تأكيد كسر هيكلي على شمعة مغلقة',
    },
    'Late Entry / Chasing': {
      adjustmentEn: `No-chase pullback tolerance tightened to ${antiLateAtrMult.toFixed(2)}x ATR`,
      adjustmentAr: `تشديد مسافة الارتداد لمنع المطاردة إلى ${antiLateAtrMult.toFixed(2)}x ATR`,
    },
    'Wide SL / Volatility Spike': {
      adjustmentEn: `Max SL cap scaled to ${Math.round(slCapScale * 100)}% with spike guard`,
      adjustmentAr: `تقليص سقف وقف الخسارة إلى ${Math.round(slCapScale * 100)}% مع درع التذبذب`,
    },
    'Premature / Weak Confluence': {
      adjustmentEn: `Minimum score raised to ${Math.max(80, minConfluenceScore)}/100`,
      adjustmentAr: `رفع حد التوافق الأدنى إلى ${Math.max(80, minConfluenceScore)}/100`,
    },
  };

  const missedAdjustmentCopy: Record<
    MissedWinRootCauseCategory,
    { adjustmentEn: string; adjustmentAr: string }
  > = {
    'Near-Threshold Score': {
      adjustmentEn:
        minConfluenceScore < 80
          ? `Calibrated cutoff to ${minConfluenceScore}/100 for clean structural setups`
          : 'Holding 80+ score floor while weak-confluence losses are active',
      adjustmentAr:
        minConfluenceScore < 80
          ? `معايرة الحد بأمان إلى ${minConfluenceScore}/100 للفرص مكتملة الهيكل`
          : 'الإبقاء على حد 80+ بسبب وجود خسائر ضعف توافق حديثة',
    },
    'Over-Strict Filter': {
      adjustmentEn:
        chopAtrFloor < 1.15
          ? `Calibrated chop range floor to ${chopAtrFloor}x ATR while keeping trend/chase locks`
          : 'Preserving conservative range guard until volatility losses clear',
      adjustmentAr:
        chopAtrFloor < 1.15
          ? `معايرة فلتر التذبذب إلى ${chopAtrFloor}x ATR مع إبقاء قفل الاتجاه والمطاردة`
          : 'الإبقاء على صرامة الفلتر لتفادي خسائر التذبذب السريع',
    },
    'Early Rejection Before Pullback/Confirm': {
      adjustmentEn: 'Promoting valid early structures to Watchlist pending closed confirmation',
      adjustmentAr: 'تحويل الفرص المبكرة الصالحة إلى قائمة المراقبة بانتظار إغلاق التأكيد',
    },
  };

  const lossBreakdown = (Object.keys(lossCounts) as LossRootCauseCategory[])
    .map((category) => ({
      category,
      labelAr: LOSS_LABELS_AR[category],
      count: lossCounts[category].count,
      totalR: Number(lossCounts[category].totalR.toFixed(2)),
      cooldownActive: lossCounts[category].recent12h >= 2,
      adjustmentEn: lossAdjustmentCopy[category].adjustmentEn,
      adjustmentAr: lossAdjustmentCopy[category].adjustmentAr,
    }))
    .sort((a, b) => b.count - a.count);

  const missedWinBreakdown = (Object.keys(missedCounts) as MissedWinRootCauseCategory[])
    .map((category) => ({
      category,
      labelAr: MISSED_WIN_LABELS_AR[category],
      count: missedCounts[category].count,
      missedR: Number(missedCounts[category].missedR.toFixed(2)),
      adjustmentEn: missedAdjustmentCopy[category].adjustmentEn,
      adjustmentAr: missedAdjustmentCopy[category].adjustmentAr,
    }))
    .sort((a, b) => b.count - a.count);

  const learnedAdjustments: RootCauseAnalytics['learnedAdjustments'] = [
    {
      id: 'adj_anti_counter_late',
      kind: 'locked',
      titleEn: 'Anti-Counter-Trend & No-Chase Locks Active',
      titleAr: 'قفل منع عكس الاتجاه ومنع المطاردة مفعل دائماً',
      detailEn: `Pullback offset capped at ${antiLateAtrMult.toFixed(2)}x ATR; counter-trend entries require full HTF alignment + closed CHoCH.`,
      detailAr: `أقصى بعد عن منطقة الارتداد ${antiLateAtrMult.toFixed(2)}x ATR، ولا يسمح بعكس الاتجاه دون كسر هيكلي مغلق.`,
    },
    {
      id: 'adj_confluence_score',
      kind: minConfluenceScore > 80 ? 'tighten' : minConfluenceScore < 80 ? 'calibrate' : 'locked',
      titleEn: `Confluence Cutoff: ${minConfluenceScore}/100`,
      titleAr: `حد التوافق الفعلي: ${minConfluenceScore}/100`,
      detailEn:
        minConfluenceScore > 80
          ? `Tightened after repeated Weak Confluence losses.`
          : minConfluenceScore < 80
            ? `Safely calibrated from 80 after ${missedCounts['Near-Threshold Score'].count} Near-Threshold Missed Wins with zero weak-confluence losses.`
            : `Baseline 80/100 institutional confluence threshold active.`,
      detailAr:
        minConfluenceScore > 80
          ? `تم التشديد بعد تكرار خسائر ضعف التوافق.`
          : minConfluenceScore < 80
            ? `تمت المعايرة بأمان من 80 بعد ${missedCounts['Near-Threshold Score'].count} أرباح فائتة قريبة من الحد دون خسائر ضعف توافق.`
            : `الحد المؤسسي القياسي 80/100 نشط حالياً.`,
    },
    {
      id: 'adj_sl_chop',
      kind: slCapScale < 1 ? 'tighten' : chopAtrFloor < 1.15 ? 'calibrate' : 'locked',
      titleEn: `SL Cap ${Math.round(slCapScale * 100)}% · Chop Floor ${chopAtrFloor.toFixed(2)}x ATR`,
      titleAr: `سقف الوقف ${Math.round(slCapScale * 100)}% · فلتر التذبذب ${chopAtrFloor.toFixed(2)}x ATR`,
      detailEn:
        activeCooldownCauses.length > 0
          ? `Repeated-loss cooldown enforced for: ${activeCooldownCauses.join(', ')}.`
          : `Balancing stop-loss protection with safe missed-win calibration.`,
      detailAr:
        activeCooldownCauses.length > 0
          ? `تهدئة مفعّلة بسبب تكرار: ${activeCooldownCauses.map((c) => LOSS_LABELS_AR[c]).join('، ')}.`
          : `توازن تلقائي بين حماية الوقف ومعايرة الفرص الفائتة الآمنة.`,
    },
  ];

  return {
    lossBreakdown,
    missedWinBreakdown,
    learnedAdjustments,
    policy: {
      minConfluenceScore,
      antiLateAtrMult,
      slCapScale,
      chopAtrFloor,
      activeCooldownCauses,
    },
  };
}
