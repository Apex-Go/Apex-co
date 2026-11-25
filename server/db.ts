import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AISignal,
  AlertEvent,
  ChartTemplate,
  CustomIndicator,
  DrawingObject,
  RejectedSetup,
  SchoolId,
  UserAccount,
  UserTrade,
  WatchlistItem,
} from '../src/types/trading.ts';
import {
  ANALYSIS_SCHOOLS,
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_RISK_SETTINGS,
} from '../src/lib/schools.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'apex_confluence.sqlite');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_guest INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
    auto_dst INTEGER NOT NULL DEFAULT 1,
    language TEXT NOT NULL DEFAULT 'en',
    default_watchlist_json TEXT NOT NULL,
    risk_settings_json TEXT NOT NULL,
    alert_settings_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    remember_me INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_presets (
    user_id TEXT PRIMARY KEY,
    preset_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS watchlists (
    user_id TEXT PRIMARY KEY,
    items_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chart_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drawings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_indicators (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- IMMUTABLE AI SIGNAL LOG (No delete, only status progression)
  CREATE TABLE IF NOT EXISTS ai_signals (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    tier TEXT NOT NULL,
    status TEXT NOT NULL,
    recommended_tf TEXT NOT NULL,
    dominant_tf TEXT NOT NULL,
    is_scalp INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER
  );

  -- APPEND-ONLY REJECTED SETUPS LOG
  CREATE TABLE IF NOT EXISTS rejected_setups (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    direction TEXT NOT NULL,
    guard_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    would_have_won INTEGER NOT NULL,
    counterfactual_pnl_r REAL NOT NULL,
    price_at_check REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- IMMUTABLE USER TRADES LOG (No delete, no price/entry/SL/TP edits)
  CREATE TABLE IF NOT EXISTS user_trades (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    signal_id TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    order_type TEXT NOT NULL,
    lot_size REAL NOT NULL,
    entry_price REAL NOT NULL,
    stop_loss REAL NOT NULL,
    take_profit REAL NOT NULL,
    exit_price REAL,
    status TEXT NOT NULL,
    pnl_usd REAL NOT NULL DEFAULT 0,
    pnl_pips REAL NOT NULL DEFAULT 0,
    risk_usd REAL NOT NULL,
    risk_pct REAL NOT NULL,
    rr_ratio REAL NOT NULL,
    execution_vs_plan_score REAL NOT NULL,
    exit_efficiency REAL NOT NULL,
    drift_pips REAL NOT NULL,
    post_loss_streak_count INTEGER NOT NULL DEFAULT 0,
    tags_json TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS school_weights (
    school_id TEXT PRIMARY KEY,
    weight REAL NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    subscription_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

try {
  db.exec(`ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'`);
} catch {
  // Column already exists
}

for (const alterSql of [
  `ALTER TABLE user_trades ADD COLUMN current_sl REAL`,
  `ALTER TABLE user_trades ADD COLUMN tp1 REAL`,
  `ALTER TABLE user_trades ADD COLUMN tp2 REAL`,
  `ALTER TABLE user_trades ADD COLUMN tp3 REAL`,
  `ALTER TABLE user_trades ADD COLUMN tp1_hit INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE user_trades ADD COLUMN tp2_hit INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE user_trades ADD COLUMN tp3_hit INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE alerts ADD COLUMN signal_id TEXT`,
  `ALTER TABLE alerts ADD COLUMN trade_id TEXT`,
  `ALTER TABLE rejected_setups ADD COLUMN weighted_score REAL`,
  `ALTER TABLE rejected_setups ADD COLUMN entry_rsi REAL`,
  `ALTER TABLE rejected_setups ADD COLUMN hypothetical_sl REAL`,
  `ALTER TABLE rejected_setups ADD COLUMN hypothetical_tp1 REAL`,
  `ALTER TABLE rejected_setups ADD COLUMN counterfactual_status TEXT`,
  `ALTER TABLE rejected_setups ADD COLUMN missed_win_cause TEXT`,
  `ALTER TABLE rejected_setups ADD COLUMN missed_win_detail TEXT`,
  `ALTER TABLE rejected_setups ADD COLUMN resolved_at INTEGER`,
  `ALTER TABLE user_trades ADD COLUMN loss_cause TEXT`,
  `ALTER TABLE user_trades ADD COLUMN loss_cause_detail TEXT`,
]) {
  try {
    db.exec(alterSql);
  } catch {
    // Column already exists
  }
}

// Initialize default school weights if empty
const existingWeights = db.prepare('SELECT COUNT(*) as cnt FROM school_weights').get() as { cnt: number };
if (existingWeights.cnt === 0) {
  const ins = db.prepare('INSERT OR IGNORE INTO school_weights (school_id, weight, wins, losses, updated_at) VALUES (?, ?, ?, ?, ?)');
  const now = Date.now();
  for (const s of ANALYSIS_SCHOOLS) {
    ins.run(s.id, s.defaultWeight, 0, 0, now);
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: string, rememberMe = true): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const ttl = rememberMe ? 30 * 86400 * 1000 : 12 * 3600 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, remember_me, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    tokenHash,
    userId,
    rememberMe ? 1 : 0,
    now + ttl,
    now
  );
  return rawToken;
}

export function getUserByToken(token: string | undefined): UserAccount | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, Date.now()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToUserAccount(row);
}

export function rowToUserAccount(row: Record<string, unknown>): UserAccount {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    email: String(row.email),
    isGuest: Boolean(row.is_guest),
    timezone: String(row.timezone),
    autoDst: Boolean(row.auto_dst),
    language: row.language === 'ar' ? 'ar' : 'en',
    defaultWatchlist: JSON.parse(String(row.default_watchlist_json)),
    riskSettings: JSON.parse(String(row.risk_settings_json)),
    alertSettings: JSON.parse(String(row.alert_settings_json)),
  };
}

export function ensureGuestUser(): UserAccount {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get('guest_local') as Record<string, unknown> | undefined;
  if (existing) return rowToUserAccount(existing);
  const now = Date.now();
  const defaultWl = ['XAUUSD', 'BTCUSDT', 'USOIL', 'EURUSD', 'GBPUSD', 'USDJPY'];
  db.prepare(
    `INSERT INTO users (id, display_name, email, password_hash, is_guest, timezone, auto_dst, default_watchlist_json, risk_settings_json, alert_settings_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'guest_local',
    'Local Trader',
    'guest@apexconfluence.local',
    hashPassword(crypto.randomBytes(16).toString('hex')),
    1,
    'Africa/Cairo',
    1,
    JSON.stringify(defaultWl),
    JSON.stringify(DEFAULT_RISK_SETTINGS),
    JSON.stringify(DEFAULT_ALERT_SETTINGS),
    now
  );
  const created = db.prepare('SELECT * FROM users WHERE id = ?').get('guest_local') as Record<string, unknown>;
  return rowToUserAccount(created);
}

// Seed default starter custom indicators for any user if none exist
export function ensureStarterIndicators(userId: string): CustomIndicator[] {
  const rows = db.prepare('SELECT data_json FROM custom_indicators WHERE user_id = ? ORDER BY created_at DESC').all(userId) as { data_json: string }[];
  if (rows.length > 0) {
    return rows.map((r) => JSON.parse(r.data_json) as CustomIndicator);
  }
  const starters: CustomIndicator[] = [
    {
      id: `ind_ema_cross_${userId}`,
      userId,
      name: 'Apex Institutional EMA Ribbon',
      nameAr: 'شريط المتوسطات المؤسسي',
      description: 'Fast 8/21 EMA momentum ribbon tuned for displacement retests.',
      visible: false,
      color: '#059669',
      secondaryColor: '#DC2626',
      lineStyle: 'solid',
      lineWidth: 1.5,
      linkedSchools: ['smc', 'price_action'],
      inputs: [
        { key: 'fast', label: 'Fast EMA', type: 'number', defaultValue: 8, value: 8, min: 2, max: 50, step: 1 },
        { key: 'slow', label: 'Slow EMA', type: 'number', defaultValue: 21, value: 21, min: 5, max: 200, step: 1 },
      ],
      blueprint: { kind: 'ma_crossover', pane: 'main' },
      createdAt: Date.now(),
    },
    {
      id: `ind_vwap_dev_${userId}`,
      userId,
      name: 'Session VWAP Anchor',
      nameAr: 'متوسط السيولة الحجمي VWAP',
      description: 'Volume-weighted fair value line for VSA & ICT premium/discount confirmation.',
      visible: false,
      color: '#7C3AED',
      secondaryColor: '#7C3AED',
      lineStyle: 'dashed',
      lineWidth: 1.5,
      linkedSchools: ['vsa', 'ict'],
      inputs: [{ key: 'period', label: 'Lookback Bars', type: 'number', defaultValue: 120, value: 120, min: 20, max: 500, step: 10 }],
      blueprint: { kind: 'vwap_deviation', pane: 'main' },
      createdAt: Date.now(),
    },
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO custom_indicators (id, user_id, data_json, created_at) VALUES (?, ?, ?, ?)');
  for (const ind of starters) {
    ins.run(ind.id, userId, JSON.stringify(ind), ind.createdAt);
  }
  return starters;
}

export function getDefaultWatchlistItems(): WatchlistItem[] {
  return [
    { symbol: 'XAUUSD', folder: 'Core Desk', flagColor: 'amber' },
    { symbol: 'BTCUSDT', folder: 'Core Desk', flagColor: 'emerald' },
    { symbol: 'USOIL', folder: 'Commodities', flagColor: 'none' },
    { symbol: 'EURUSD', folder: 'Forex Majors', flagColor: 'blue' },
    { symbol: 'GBPUSD', folder: 'Forex Majors', flagColor: 'blue' },
    { symbol: 'USDJPY', folder: 'Forex Majors', flagColor: 'none' },
    { symbol: 'USDCAD', folder: 'Forex Majors', flagColor: 'none' },
    { symbol: 'AUDUSD', folder: 'Forex Majors', flagColor: 'none' },
    { symbol: 'XAGUSD', folder: 'Commodities', flagColor: 'none' },
    { symbol: 'DXY', folder: 'Macro Index', flagColor: 'crimson' },
    { symbol: 'US10Y', folder: 'Macro Index', flagColor: 'crimson' },
  ];
}

// Immutable AI Signal operations (no delete!)
export function upsertAiSignal(signal: AISignal): void {
  const existing = db.prepare('SELECT status, closed_at FROM ai_signals WHERE id = ?').get(signal.id) as
    | { status: string; closed_at: number | null }
    | undefined;
  if (existing && (existing.closed_at !== null || existing.status === 'Won' || existing.status === 'Lost')) {
    return; // Finalized signals are strictly immutable
  }
  if (existing) {
    db.prepare(
      `UPDATE ai_signals SET status = ?, data_json = ?, updated_at = ?, closed_at = ? WHERE id = ?`
    ).run(signal.status, JSON.stringify(signal), signal.updatedAt, signal.closedAt ?? null, signal.id);
  } else {
    db.prepare(
      `INSERT INTO ai_signals (id, symbol, direction, tier, status, recommended_tf, dominant_tf, is_scalp, data_json, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      signal.id,
      signal.symbol,
      signal.direction,
      signal.tier,
      signal.status,
      signal.recommendedTimeframe,
      signal.dominantTimeframe,
      signal.isScalp ? 1 : 0,
      JSON.stringify(signal),
      signal.createdAt,
      signal.updatedAt,
      signal.closedAt ?? null
    );
  }
}

export function listAiSignals(limit = 200): AISignal[] {
  const rows = db.prepare('SELECT data_json FROM ai_signals ORDER BY created_at DESC LIMIT ?').all(limit) as { data_json: string }[];
  return rows.map((r) => JSON.parse(r.data_json) as AISignal);
}

export function insertRejectedSetup(setup: RejectedSetup): void {
  db.prepare(
    `INSERT OR IGNORE INTO rejected_setups (
      id, symbol, timeframe, direction, guard_name, reason, would_have_won, counterfactual_pnl_r, price_at_check,
      weighted_score, entry_rsi, hypothetical_sl, hypothetical_tp1, counterfactual_status, missed_win_cause, missed_win_detail, resolved_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    setup.id,
    setup.symbol,
    setup.timeframe,
    setup.direction,
    setup.guardName,
    setup.reason,
    setup.wouldHaveWon ? 1 : 0,
    setup.counterfactualPnlR,
    setup.priceAtCheck,
    setup.weightedScore ?? null,
    setup.entryRsi ?? null,
    setup.hypotheticalSl ?? null,
    setup.hypotheticalTp1 ?? null,
    setup.counterfactualStatus ?? (setup.wouldHaveWon ? 'MissedWin' : 'SavedLoss'),
    setup.missedWinCause ?? null,
    setup.missedWinDetail ?? null,
    setup.resolvedAt ?? null,
    setup.createdAt
  );
}

function rowToRejectedSetup(r: Record<string, unknown>): RejectedSetup {
  return {
    id: String(r.id),
    symbol: String(r.symbol),
    timeframe: r.timeframe as RejectedSetup['timeframe'],
    direction: r.direction as 'BUY' | 'SELL',
    guardName: String(r.guard_name),
    reason: String(r.reason),
    wouldHaveWon: Boolean(r.would_have_won),
    counterfactualPnlR: Number(r.counterfactual_pnl_r),
    priceAtCheck: Number(r.price_at_check),
    weightedScore: r.weighted_score != null ? Number(r.weighted_score) : undefined,
    entryRsi: r.entry_rsi != null ? Number(r.entry_rsi) : undefined,
    hypotheticalSl: r.hypothetical_sl != null ? Number(r.hypothetical_sl) : undefined,
    hypotheticalTp1: r.hypothetical_tp1 != null ? Number(r.hypothetical_tp1) : undefined,
    counterfactualStatus: (r.counterfactual_status as RejectedSetup['counterfactualStatus']) ?? undefined,
    missedWinCause: (r.missed_win_cause as RejectedSetup['missedWinCause']) ?? undefined,
    missedWinDetail: r.missed_win_detail ? String(r.missed_win_detail) : undefined,
    resolvedAt: r.resolved_at != null ? Number(r.resolved_at) : undefined,
    createdAt: Number(r.created_at),
  };
}

export function listRejectedSetups(limit = 100): RejectedSetup[] {
  const rows = db.prepare('SELECT * FROM rejected_setups ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(rowToRejectedSetup);
}

export function listPendingRejectedSetupsBySymbol(symbol: string, maxAgeMs = 4 * 3600 * 1000): RejectedSetup[] {
  const cutoff = Date.now() - maxAgeMs;
  const rows = db
    .prepare(
      `SELECT * FROM rejected_setups WHERE symbol = ? AND counterfactual_status = 'Pending' AND created_at >= ? ORDER BY created_at DESC`
    )
    .all(symbol, cutoff) as Record<string, unknown>[];
  return rows.map(rowToRejectedSetup);
}

export function updateRejectedSetupOutcome(setup: RejectedSetup): void {
  db.prepare(
    `UPDATE rejected_setups
     SET would_have_won = ?, counterfactual_pnl_r = ?, counterfactual_status = ?, missed_win_cause = ?, missed_win_detail = ?, resolved_at = ?
     WHERE id = ?`
  ).run(
    setup.wouldHaveWon ? 1 : 0,
    setup.counterfactualPnlR,
    setup.counterfactualStatus ?? null,
    setup.missedWinCause ?? null,
    setup.missedWinDetail ?? null,
    setup.resolvedAt ?? Date.now(),
    setup.id
  );
}

// Immutable User Trades (append-only + close/reflection note append; never delete or alter entry/SL/TP/PnL)
export function insertUserTrade(trade: UserTrade): void {
  db.prepare(
    `INSERT INTO user_trades (
      id, user_id, signal_id, symbol, side, order_type, lot_size, entry_price, stop_loss, current_sl,
      take_profit, tp1, tp2, tp3, tp1_hit, tp2_hit, tp3_hit,
      exit_price, status, pnl_usd, pnl_pips, risk_usd, risk_pct, rr_ratio, execution_vs_plan_score,
      exit_efficiency, drift_pips, post_loss_streak_count, tags_json, notes, created_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    trade.id,
    trade.userId,
    trade.signalId ?? null,
    trade.symbol,
    trade.side,
    trade.orderType,
    trade.lotSize,
    trade.entryPrice,
    trade.stopLoss,
    trade.currentSl ?? trade.stopLoss,
    trade.takeProfit,
    trade.tp1 ?? null,
    trade.tp2 ?? null,
    trade.tp3 ?? null,
    trade.tp1Hit ? 1 : 0,
    trade.tp2Hit ? 1 : 0,
    trade.tp3Hit ? 1 : 0,
    trade.exitPrice ?? null,
    trade.status,
    trade.pnlUsd,
    trade.pnlPips,
    trade.riskUsd,
    trade.riskPct,
    trade.rrRatio,
    trade.executionVsPlanScore,
    trade.exitEfficiency,
    trade.driftPips,
    trade.postLossStreakCount,
    JSON.stringify(trade.tags),
    trade.notes,
    trade.createdAt,
    trade.closedAt ?? null
  );
}

export function closeUserTrade(
  tradeId: string,
  userId: string,
  exitPrice: number,
  status: 'Won' | 'Lost' | 'Breakeven',
  pnlUsd: number,
  pnlPips: number,
  exitEfficiency: number,
  lossCause?: UserTrade['lossCause'],
  lossCauseDetail?: string
): boolean {
  const row = db
    .prepare('SELECT status, closed_at FROM user_trades WHERE id = ? AND user_id = ?')
    .get(tradeId, userId) as { status: string; closed_at: number | null } | undefined;
  if (!row || row.closed_at !== null || (row.status !== 'Open' && row.status !== 'Breakeven')) return false;
  db.prepare(
    `UPDATE user_trades SET exit_price = ?, status = ?, pnl_usd = ?, pnl_pips = ?, exit_efficiency = ?, loss_cause = ?, loss_cause_detail = ?, closed_at = ? WHERE id = ? AND user_id = ?`
  ).run(
    exitPrice,
    status,
    pnlUsd,
    pnlPips,
    exitEfficiency,
    lossCause ?? null,
    lossCauseDetail ?? null,
    Date.now(),
    tradeId,
    userId
  );
  return true;
}

export function updateUserTradeLiveMilestones(trade: UserTrade): void {
  const existing = db
    .prepare('SELECT status, closed_at FROM user_trades WHERE id = ?')
    .get(trade.id) as { status: string; closed_at: number | null } | undefined;
  if (!existing || existing.closed_at !== null || existing.status === 'Won' || existing.status === 'Lost') {
    return; // Closed trades are strictly immutable
  }
  db.prepare(
    `UPDATE user_trades
     SET status = ?, current_sl = ?, tp1_hit = ?, tp2_hit = ?, tp3_hit = ?,
         exit_price = ?, pnl_usd = ?, pnl_pips = ?, exit_efficiency = ?,
         loss_cause = ?, loss_cause_detail = ?, closed_at = ?
     WHERE id = ?`
  ).run(
    trade.status,
    trade.currentSl ?? trade.stopLoss,
    trade.tp1Hit ? 1 : 0,
    trade.tp2Hit ? 1 : 0,
    trade.tp3Hit ? 1 : 0,
    trade.exitPrice ?? null,
    trade.pnlUsd,
    trade.pnlPips,
    trade.exitEfficiency,
    trade.lossCause ?? null,
    trade.lossCauseDetail ?? null,
    trade.closedAt ?? null,
    trade.id
  );
}

export function appendUserTradeReflection(tradeId: string, userId: string, tags: string[], notes: string): boolean {
  const row = db.prepare('SELECT id FROM user_trades WHERE id = ? AND user_id = ?').get(tradeId, userId) as { id: string } | undefined;
  if (!row) return false;
  db.prepare('UPDATE user_trades SET tags_json = ?, notes = ? WHERE id = ? AND user_id = ?').run(
    JSON.stringify(tags),
    notes,
    tradeId,
    userId
  );
  return true;
}

function rowToUserTrade(r: Record<string, unknown>): UserTrade {
  const entry = Number(r.entry_price);
  const tp = Number(r.take_profit);
  const stopLoss = Number(r.stop_loss);
  const span = tp - entry;
  return {
    id: String(r.id),
    userId: String(r.user_id),
    signalId: r.signal_id ? String(r.signal_id) : undefined,
    symbol: String(r.symbol),
    side: r.side as 'BUY' | 'SELL',
    orderType: r.order_type as UserTrade['orderType'],
    lotSize: Number(r.lot_size),
    entryPrice: entry,
    stopLoss,
    currentSl: r.current_sl != null ? Number(r.current_sl) : stopLoss,
    takeProfit: tp,
    tp1: r.tp1 != null ? Number(r.tp1) : Number((entry + span * 0.45).toFixed(5)),
    tp2: r.tp2 != null ? Number(r.tp2) : Number((entry + span * 0.75).toFixed(5)),
    tp3: r.tp3 != null ? Number(r.tp3) : tp,
    tp1Hit: Boolean(r.tp1_hit),
    tp2Hit: Boolean(r.tp2_hit),
    tp3Hit: Boolean(r.tp3_hit),
    exitPrice: r.exit_price != null ? Number(r.exit_price) : undefined,
    status: r.status as UserTrade['status'],
    pnlUsd: Number(r.pnl_usd),
    pnlPips: Number(r.pnl_pips),
    riskUsd: Number(r.risk_usd),
    riskPct: Number(r.risk_pct),
    rrRatio: Number(r.rr_ratio),
    executionVsPlanScore: Number(r.execution_vs_plan_score),
    exitEfficiency: Number(r.exit_efficiency),
    driftPips: Number(r.drift_pips),
    postLossStreakCount: Number(r.post_loss_streak_count),
    lossCause: (r.loss_cause as UserTrade['lossCause']) ?? undefined,
    lossCauseDetail: r.loss_cause_detail ? String(r.loss_cause_detail) : undefined,
    tags: JSON.parse(String(r.tags_json)),
    notes: String(r.notes),
    createdAt: Number(r.created_at),
    closedAt: r.closed_at != null ? Number(r.closed_at) : undefined,
  };
}

export function listUserTrades(userId: string, limit = 250): UserTrade[] {
  const rows = db.prepare('SELECT * FROM user_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as Record<string, unknown>[];
  return rows.map(rowToUserTrade);
}

export function listRecentAllUserTrades(limit = 200): UserTrade[] {
  const rows = db.prepare('SELECT * FROM user_trades ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(rowToUserTrade);
}

export function listOpenUserTradesBySymbol(symbol: string): UserTrade[] {
  const rows = db
    .prepare(`SELECT * FROM user_trades WHERE symbol = ? AND closed_at IS NULL AND status IN ('Open', 'Breakeven')`)
    .all(symbol) as Record<string, unknown>[];
  return rows.map(rowToUserTrade);
}

export function insertAlert(alert: AlertEvent): void {
  db.prepare(
    `INSERT OR IGNORE INTO alerts (id, symbol, signal_id, trade_id, type, title, message, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    alert.id,
    alert.symbol,
    alert.signalId ?? null,
    alert.tradeId ?? null,
    alert.type,
    alert.title,
    alert.message,
    alert.createdAt,
    alert.read ? 1 : 0
  );
}

export function listAlerts(limit = 50): AlertEvent[] {
  const rows = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    symbol: String(r.symbol),
    signalId: r.signal_id ? String(r.signal_id) : undefined,
    tradeId: r.trade_id ? String(r.trade_id) : undefined,
    type: r.type as AlertEvent['type'],
    title: String(r.title),
    message: String(r.message),
    createdAt: Number(r.created_at),
    read: Boolean(r.is_read),
  }));
}

export function getSchoolWeights(): Record<SchoolId, { weight: number; wins: number; losses: number }> {
  const rows = db.prepare('SELECT * FROM school_weights').all() as Record<string, unknown>[];
  const map: Record<string, { weight: number; wins: number; losses: number }> = {};
  for (const r of rows) {
    map[String(r.school_id)] = {
      weight: Number(r.weight),
      wins: Number(r.wins),
      losses: Number(r.losses),
    };
  }
  return map as Record<SchoolId, { weight: number; wins: number; losses: number }>;
}

export function updateSchoolWeightsOnOutcome(schools: SchoolId[], won: boolean): void {
  const stmt = db.prepare(
    `UPDATE school_weights SET weight = ?, wins = wins + ?, losses = losses + ?, updated_at = ? WHERE school_id = ?`
  );
  const current = getSchoolWeights();
  const now = Date.now();
  for (const sid of schools) {
    const cur = current[sid];
    if (!cur) continue;
    const delta = won ? 0.03 : -0.025;
    const nextW = Math.max(0.45, Math.min(1.65, Number((cur.weight + delta).toFixed(3))));
    stmt.run(nextW, won ? 1 : 0, won ? 0 : 1, now, sid);
  }
}

export function getChartTemplates(userId: string): ChartTemplate[] {
  const rows = db.prepare('SELECT data_json FROM chart_templates WHERE user_id = ? ORDER BY created_at DESC').all(userId) as { data_json: string }[];
  return rows.map((r) => JSON.parse(r.data_json) as ChartTemplate);
}

export function saveChartTemplate(userId: string, tpl: ChartTemplate): void {
  db.prepare('INSERT OR REPLACE INTO chart_templates (id, user_id, data_json, created_at) VALUES (?, ?, ?, ?)').run(
    tpl.id,
    userId,
    JSON.stringify(tpl),
    tpl.createdAt
  );
}

export function getDrawings(userId: string, symbol: string): DrawingObject[] {
  const rows = db.prepare('SELECT data_json FROM drawings WHERE user_id = ? AND symbol = ? ORDER BY updated_at ASC').all(userId, symbol) as { data_json: string }[];
  return rows.map((r) => JSON.parse(r.data_json) as DrawingObject);
}

export function saveDrawing(userId: string, drawing: DrawingObject): void {
  const existing = db.prepare('SELECT user_id FROM drawings WHERE id = ?').get(drawing.id) as
    | { user_id: string }
    | undefined;
  const safeId = existing && existing.user_id !== userId ? `drw_${crypto.randomUUID().slice(0, 10)}` : drawing.id;
  db.prepare('INSERT OR REPLACE INTO drawings (id, user_id, symbol, timeframe, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    safeId,
    userId,
    drawing.symbol,
    drawing.timeframe,
    JSON.stringify({ ...drawing, id: safeId }),
    Date.now()
  );
}

export function deleteDrawing(userId: string, drawingId: string): void {
  db.prepare('DELETE FROM drawings WHERE id = ? AND user_id = ?').run(drawingId, userId);
}
