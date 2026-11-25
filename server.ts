import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  appendUserTradeReflection,
  closeUserTrade,
  createSession,
  db,
  deleteDrawing,
  ensureGuestUser,
  ensureStarterIndicators,
  getChartTemplates,
  getDefaultWatchlistItems,
  getDrawings,
  getSchoolWeights,
  getUserByToken,
  hashPassword,
  hashToken,
  insertUserTrade,
  listAiSignals,
  listAlerts,
  listRecentAllUserTrades,
  listRejectedSetups,
  listUserTrades,
  rowToUserAccount,
  saveChartTemplate,
  saveDrawing,
  verifyPassword,
} from './server/db.ts';
import { marketFeed } from './server/marketFeed.ts';
import { aiEngine, generateStudioIndicatorWithGemini } from './server/aiEngine.ts';
import { classifyUserTradeLossCause, computeRootCauseAnalytics } from './server/rootCauseAnalyzer.ts';
import type {
  ChartTemplate,
  CustomIndicator,
  DrawingObject,
  Timeframe,
  UserAccount,
  UserTrade,
  WatchlistItem,
} from './src/types/trading.ts';
import {
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_RISK_SETTINGS,
  SYMBOL_MAP,
  TIMEFRAMES,
} from './src/lib/schools.ts';
import { calculateLotSize } from './src/lib/indicators.ts';

interface AuthedRequest extends Request {
  user?: UserAccount;
}

function authOptional(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const user = getUserByToken(token);
  req.user = user ?? ensureGuestUser();
  next();
}

function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.user = user;
  next();
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const wsClients = new Set<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
    ws.send(JSON.stringify({ type: 'quotes', payload: marketFeed.getAllQuotes() }));
  });

  const broadcast = (data: unknown) => {
    const raw = JSON.stringify(data);
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  };

  marketFeed.onTick((quote, latestCandles) => {
    broadcast({ type: 'tick', payload: { quote, latestCandles } });
  });

  aiEngine.setBroadcaster((event) => {
    broadcast(event);
  });

  // ------------------------------------------------------------------
  // AUTH & ACCOUNT ROUTES
  // ------------------------------------------------------------------
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { displayName, email, password, confirmPassword, timezone, defaultWatchlist, language } = req.body as {
      displayName?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
      timezone?: string;
      defaultWatchlist?: string[];
      language?: 'ar' | 'en';
    };

    if (!displayName?.trim() || !email?.trim() || !password) {
      res.status(400).json({ error: 'Display name, email, and password are required.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    const normEmail = email.trim().toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normEmail);
    if (exists) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const wl = Array.isArray(defaultWatchlist) && defaultWatchlist.length > 0
      ? defaultWatchlist
      : ['XAUUSD', 'BTCUSDT', 'USOIL', 'EURUSD', 'GBPUSD', 'USDJPY'];
    const nextLang = language === 'ar' ? 'ar' : 'en';

    db.prepare(
      `INSERT INTO users (id, display_name, email, password_hash, is_guest, timezone, auto_dst, language, default_watchlist_json, risk_settings_json, alert_settings_json, created_at)
       VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?, ?, ?, ?)`
    ).run(
      id,
      displayName.trim(),
      normEmail,
      hashPassword(password),
      timezone || 'Africa/Cairo',
      nextLang,
      JSON.stringify(wl),
      JSON.stringify(DEFAULT_RISK_SETTINGS),
      JSON.stringify(DEFAULT_ALERT_SETTINGS),
      now
    );

    const token = createSession(id, true);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;
    ensureStarterIndicators(id);
    res.status(201).json({ token, user: rowToUserAccount(row) });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password, rememberMe } = req.body as {
      email?: string;
      password?: string;
      rememberMe?: boolean;
    };
    if (!email?.trim() || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
      | Record<string, unknown>
      | undefined;
    if (!row || !verifyPassword(password, String(row.password_hash))) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const token = createSession(String(row.id), rememberMe !== false);
    ensureStarterIndicators(String(row.id));
    res.json({ token, user: rowToUserAccount(row) });
  });

  app.post('/api/auth/guest', (_req: Request, res: Response) => {
    const guest = ensureGuestUser();
    const token = createSession(guest.id, true);
    ensureStarterIndicators(guest.id);
    res.json({ token, user: guest });
  });

  app.post('/api/auth/forgot', (req: Request, res: Response) => {
    const { email, newPassword } = req.body as { email?: string; newPassword?: string };
    if (!email?.trim()) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }
    const row = db.prepare('SELECT id, is_guest FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
      | { id: string; is_guest: number }
      | undefined;
    if (!row || row.is_guest) {
      res.status(404).json({ error: 'No registered account found for this email.' });
      return;
    }
    if (newPassword && newPassword.length >= 6) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), row.id);
      res.json({ ok: true, message: 'Password updated successfully.' });
      return;
    }
    res.json({ ok: true, message: 'Account verified. Enter a new password to complete reset.' });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', authOptional, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  app.put('/api/auth/profile', authOptional, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const { displayName, timezone, autoDst, language, defaultWatchlist, riskSettings, alertSettings } = req.body as Partial<UserAccount>;
    const nextName = displayName?.trim() || user.displayName;
    const nextTz = timezone || user.timezone;
    const nextDst = autoDst !== undefined ? (autoDst ? 1 : 0) : user.autoDst ? 1 : 0;
    const nextLang = language === 'ar' || language === 'en' ? language : (user.language || 'en');
    const nextWl = defaultWatchlist ?? user.defaultWatchlist;
    const nextRisk = riskSettings ?? user.riskSettings;
    const nextAlerts = alertSettings ?? user.alertSettings;

    db.prepare(
      `UPDATE users SET display_name = ?, timezone = ?, auto_dst = ?, language = ?, default_watchlist_json = ?, risk_settings_json = ?, alert_settings_json = ? WHERE id = ?`
    ).run(nextName, nextTz, nextDst, nextLang, JSON.stringify(nextWl), JSON.stringify(nextRisk), JSON.stringify(nextAlerts), user.id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as Record<string, unknown>;
    res.json({ user: rowToUserAccount(updated) });
  });

  // ------------------------------------------------------------------
  // MARKET DATA ROUTES
  // ------------------------------------------------------------------
  app.get('/api/market/quotes', (_req: Request, res: Response) => {
    res.json({ quotes: marketFeed.getAllQuotes() });
  });

  app.get('/api/market/candles', async (req: Request, res: Response) => {
    const symbol = String(req.query.symbol || 'XAUUSD').toUpperCase();
    const tfRaw = String(req.query.timeframe || '15m') as Timeframe;
    const tf = TIMEFRAMES.some((t) => t.id === tfRaw) ? tfRaw : '15m';
    const limit = Math.min(1000, Math.max(30, Number(req.query.limit || 420)));
    const beforeTime = req.query.beforeTime ? Number(req.query.beforeTime) : undefined;
    const anchorPrice = req.query.anchorPrice ? Number(req.query.anchorPrice) : undefined;

    if (!SYMBOL_MAP[symbol]) {
      res.status(400).json({ error: 'Unsupported symbol' });
      return;
    }

    try {
      const candles = await marketFeed.ensureCandles(symbol, tf, limit, beforeTime, anchorPrice);
      res.json({ symbol, timeframe: tf, candles, quote: marketFeed.getQuote(symbol) });
    } catch {
      res.status(500).json({ error: 'Failed to load candle data' });
    }
  });

  app.get('/api/market/health', (_req: Request, res: Response) => {
    const signals = listAiSignals(150);
    const activeCount = signals.filter((s) => s.status === 'Active' || s.status === 'Breakeven').length;
    const watchCount = signals.filter((s) => s.status === 'Watchlist').length;
    res.json({ health: marketFeed.getFeedHealth(activeCount, watchCount) });
  });

  // ------------------------------------------------------------------
  // SIGNALS, RADAR & IMMUTABLE AI LOG (Zero Delete / Zero Edit)
  // ------------------------------------------------------------------
  app.get('/api/signals', (_req: Request, res: Response) => {
    res.json({ signals: listAiSignals(250) });
  });

  app.post('/api/signals/scan', async (_req: Request, res: Response) => {
    await aiEngine.runFullScan();
    const signals = listAiSignals(250);
    const rejected = listRejectedSetups(150);
    const rootCauses = computeRootCauseAnalytics({
      signals,
      trades: listRecentAllUserTrades(200),
      rejected,
    });
    res.json({ signals, rejected, rootCauses });
  });

  app.get('/api/rejected', (_req: Request, res: Response) => {
    res.json({ rejected: listRejectedSetups(150) });
  });

  app.get('/api/analytics/root-causes', (_req: Request, res: Response) => {
    const analytics = computeRootCauseAnalytics({
      signals: listAiSignals(200),
      trades: listRecentAllUserTrades(200),
      rejected: listRejectedSetups(150),
    });
    res.json({ analytics });
  });

  app.get('/api/school-weights', (_req: Request, res: Response) => {
    res.json({ weights: getSchoolWeights() });
  });

  app.get('/api/alerts', (_req: Request, res: Response) => {
    res.json({ alerts: listAlerts(60) });
  });

  app.post('/api/alerts/read', (_req: Request, res: Response) => {
    db.prepare('UPDATE alerts SET is_read = 1').run();
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------
  // IMMUTABLE USER TRADES ("My Trades" - Zero Delete, Zero Price Edit)
  // ------------------------------------------------------------------
  app.get('/api/trades', authOptional, (req: AuthedRequest, res: Response) => {
    res.json({ trades: listUserTrades(req.user!.id, 250) });
  });

  app.post('/api/trades', authOptional, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const body = req.body as {
      symbol?: string;
      side?: 'BUY' | 'SELL';
      orderType?: 'MARKET' | 'LIMIT' | 'STOP';
      lotSize?: number;
      entryPrice?: number;
      stopLoss?: number;
      takeProfit?: number;
      signalId?: string;
      notes?: string;
      tags?: string[];
    };

    const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
    const info = SYMBOL_MAP[symbol];
    if (!info) {
      res.status(400).json({ error: 'Unsupported symbol' });
      return;
    }

    const side = body.side === 'SELL' ? 'SELL' : 'BUY';
    const quote = marketFeed.getQuote(symbol);
    const entryPrice = Number(body.entryPrice ?? (side === 'BUY' ? quote?.ask : quote?.bid) ?? 0);
    const stopLoss = Number(body.stopLoss ?? 0);
    const takeProfit = Number(body.takeProfit ?? 0);

    if (!Number.isFinite(entryPrice) || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit) || entryPrice <= 0) {
      res.status(400).json({ error: 'Valid entry, stop loss, and take profit prices are required.' });
      return;
    }

    // Enforce Risk Guards on server
    const allTrades = listUserTrades(user.id, 100);
    const openCount = allTrades.filter((t) => t.status === 'Open').length;
    if (openCount >= user.riskSettings.maxConcurrentTrades) {
      res.status(400).json({ error: `Max concurrent trades guard (${user.riskSettings.maxConcurrentTrades}) reached.` });
      return;
    }

    const sizing = calculateLotSize(
      symbol,
      user.riskSettings.accountBalance,
      user.riskSettings.riskPerTradePct,
      entryPrice,
      stopLoss
    );
    const lotSize = Number(body.lotSize && body.lotSize > 0 ? body.lotSize : sizing.lots);
    const riskDist = Math.max(info.pipSize, Math.abs(entryPrice - stopLoss));
    const rewardDist = Math.abs(takeProfit - entryPrice);
    const rrRatio = Number((rewardDist / riskDist).toFixed(2));

    // Calculate drift & execution score if linked to AI signal
    let driftPips = 0;
    let executionVsPlanScore = 92;
    let tp1 = Number((entryPrice + (takeProfit - entryPrice) * 0.45).toFixed(info.decimals));
    let tp2 = Number((entryPrice + (takeProfit - entryPrice) * 0.75).toFixed(info.decimals));
    let tp3 = takeProfit;
    if (body.signalId) {
      const sig = listAiSignals(100).find((s) => s.id === body.signalId);
      if (sig) {
        driftPips = Number((Math.abs(entryPrice - sig.entryPrice) / info.pipSize).toFixed(1));
        executionVsPlanScore = Math.max(40, Math.min(100, Math.round(100 - driftPips * 2.5)));
        tp1 = sig.tp1;
        tp2 = sig.tp2;
        tp3 = sig.tp3;
      }
    }

    // Count recent consecutive losses
    let streak = 0;
    for (const t of allTrades) {
      if (t.status === 'Lost') streak++;
      else if (t.status === 'Won') break;
    }

    const trade: UserTrade = {
      id: `trd_${crypto.randomUUID().slice(0, 10)}`,
      userId: user.id,
      signalId: body.signalId,
      symbol,
      side,
      orderType: body.orderType || 'MARKET',
      lotSize,
      entryPrice,
      stopLoss,
      currentSl: stopLoss,
      takeProfit,
      tp1,
      tp2,
      tp3,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
      status: 'Open',
      pnlUsd: 0,
      pnlPips: 0,
      riskUsd: sizing.riskUsd,
      riskPct: user.riskSettings.riskPerTradePct,
      rrRatio,
      executionVsPlanScore,
      exitEfficiency: 100,
      driftPips,
      postLossStreakCount: streak,
      tags: Array.isArray(body.tags) ? body.tags : [],
      notes: String(body.notes || ''),
      createdAt: Date.now(),
    };

    insertUserTrade(trade);
    res.status(201).json({ trade });
  });

  app.post('/api/trades/:id/close', authOptional, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const tradeId = req.params.id;
    const trade = listUserTrades(user.id, 250).find((t) => t.id === tradeId);
    if (!trade) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }
    const info = SYMBOL_MAP[trade.symbol] || SYMBOL_MAP.XAUUSD;
    const quote = marketFeed.getQuote(trade.symbol);
    const exitPrice = Number(
      req.body.exitPrice ?? (trade.side === 'BUY' ? quote?.bid : quote?.ask) ?? trade.entryPrice
    );
    const rawDiff = trade.side === 'BUY' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
    const pnlPips = Number((rawDiff / info.pipSize).toFixed(1));
    const pnlUsd = Number((pnlPips * info.pipSize * info.contractSize * trade.lotSize).toFixed(2));
    const status: 'Won' | 'Lost' | 'Breakeven' = pnlUsd > 1 ? 'Won' : pnlUsd < -1 ? 'Lost' : 'Breakeven';
    const targetDist = Math.max(info.pipSize, Math.abs(trade.takeProfit - trade.entryPrice));
    const exitEfficiency = Math.max(0, Math.min(100, Math.round((rawDiff / targetDist) * 100)));

    let lossCause: UserTrade['lossCause'];
    let lossCauseDetail: string | undefined;
    if (status === 'Lost') {
      const minsHeld = Math.max(1, Math.round((Date.now() - trade.createdAt) / 60000));
      const linkedSig = trade.signalId
        ? listAiSignals(120).find((s) => s.id === trade.signalId)
        : undefined;
      const diag = classifyUserTradeLossCause(trade, linkedSig, undefined, minsHeld);
      lossCause = diag.category;
      lossCauseDetail = diag.detail;
    }

    const ok = closeUserTrade(
      tradeId,
      user.id,
      exitPrice,
      status,
      pnlUsd,
      pnlPips,
      exitEfficiency,
      lossCause,
      lossCauseDetail
    );
    if (!ok) {
      res.status(400).json({ error: 'Trade is already closed' });
      return;
    }
    res.json({ trades: listUserTrades(user.id, 250) });
  });

  app.post('/api/trades/:id/reflect', authOptional, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const { tags, notes } = req.body as { tags?: string[]; notes?: string };
    const ok = appendUserTradeReflection(req.params.id, user.id, Array.isArray(tags) ? tags : [], String(notes || ''));
    if (!ok) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }
    res.json({ trades: listUserTrades(user.id, 250) });
  });

  // ------------------------------------------------------------------
  // AI STUDIO & CUSTOM INDICATORS
  // ------------------------------------------------------------------
  app.get('/api/indicators', authOptional, (req: AuthedRequest, res: Response) => {
    const list = ensureStarterIndicators(req.user!.id);
    res.json({ indicators: list });
  });

  app.post('/api/indicators', authOptional, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const ind = req.body as CustomIndicator;
    const requestedId = typeof ind.id === 'string' && ind.id.trim() ? ind.id.trim() : `ind_${crypto.randomUUID().slice(0, 8)}`;
    const existingOwner = db.prepare('SELECT user_id FROM custom_indicators WHERE id = ?').get(requestedId) as
      | { user_id: string }
      | undefined;
    const id = existingOwner && existingOwner.user_id !== user.id ? `ind_${crypto.randomUUID().slice(0, 8)}` : requestedId;
    const full: CustomIndicator = { ...ind, id, userId: user.id, createdAt: ind.createdAt || Date.now() };
    db.prepare('INSERT OR REPLACE INTO custom_indicators (id, user_id, data_json, created_at) VALUES (?, ?, ?, ?)').run(
      full.id,
      user.id,
      JSON.stringify(full),
      full.createdAt
    );
    res.status(201).json({ indicator: full });
  });

  app.put('/api/indicators/:id', authOptional, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const existingOwner = db.prepare('SELECT user_id FROM custom_indicators WHERE id = ?').get(req.params.id) as
      | { user_id: string }
      | undefined;
    if (existingOwner && existingOwner.user_id !== user.id) {
      res.status(403).json({ error: 'Not authorized to modify this indicator' });
      return;
    }
    const ind = req.body as CustomIndicator;
    const full: CustomIndicator = { ...ind, id: req.params.id, userId: user.id };
    db.prepare('INSERT OR REPLACE INTO custom_indicators (id, user_id, data_json, created_at) VALUES (?, ?, ?, ?)').run(
      full.id,
      user.id,
      JSON.stringify(full),
      full.createdAt || Date.now()
    );
    res.json({ indicator: full });
  });

  app.delete('/api/indicators/:id', authOptional, (req: AuthedRequest, res: Response) => {
    db.prepare('DELETE FROM custom_indicators WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
    res.json({ ok: true });
  });

  app.post('/api/studio/chat', authOptional, async (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const { message, history } = req.body as {
      message?: string;
      history?: Array<{ role: 'user' | 'assistant'; text: string }>;
    };
    if (!message?.trim()) {
      res.status(400).json({ error: 'Prompt message is required.' });
      return;
    }
    const result = await generateStudioIndicatorWithGemini(message.trim(), history || [], user.id);
    if (result.indicator) {
      db.prepare('INSERT OR REPLACE INTO custom_indicators (id, user_id, data_json, created_at) VALUES (?, ?, ?, ?)').run(
        result.indicator.id,
        user.id,
        JSON.stringify(result.indicator),
        result.indicator.createdAt
      );
    }
    res.json(result);
  });

  // ------------------------------------------------------------------
  // DRAWINGS, TEMPLATES, WATCHLIST & PRESET SYNC
  // ------------------------------------------------------------------
  app.get('/api/drawings', authOptional, (req: AuthedRequest, res: Response) => {
    const symbol = String(req.query.symbol || 'XAUUSD').toUpperCase();
    res.json({ drawings: getDrawings(req.user!.id, symbol) });
  });

  app.post('/api/drawings', authOptional, (req: AuthedRequest, res: Response) => {
    const drawing = req.body as DrawingObject;
    saveDrawing(req.user!.id, drawing);
    res.json({ ok: true, drawing });
  });

  app.delete('/api/drawings/:id', authOptional, (req: AuthedRequest, res: Response) => {
    deleteDrawing(req.user!.id, req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/templates', authOptional, (req: AuthedRequest, res: Response) => {
    res.json({ templates: getChartTemplates(req.user!.id) });
  });

  app.post('/api/templates', authOptional, (req: AuthedRequest, res: Response) => {
    const tpl = req.body as ChartTemplate;
    saveChartTemplate(req.user!.id, tpl);
    res.json({ templates: getChartTemplates(req.user!.id) });
  });

  app.get('/api/watchlist', authOptional, (req: AuthedRequest, res: Response) => {
    const row = db.prepare('SELECT items_json FROM watchlists WHERE user_id = ?').get(req.user!.id) as
      | { items_json: string }
      | undefined;
    const items = row ? (JSON.parse(row.items_json) as WatchlistItem[]) : getDefaultWatchlistItems();
    res.json({ items });
  });

  app.put('/api/watchlist', authOptional, (req: AuthedRequest, res: Response) => {
    const { items } = req.body as { items?: WatchlistItem[] };
    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'Invalid watchlist payload' });
      return;
    }
    db.prepare('INSERT OR REPLACE INTO watchlists (user_id, items_json, updated_at) VALUES (?, ?, ?)').run(
      req.user!.id,
      JSON.stringify(items),
      Date.now()
    );
    res.json({ items });
  });

  app.get('/api/preset', authOptional, (req: AuthedRequest, res: Response) => {
    const row = db.prepare('SELECT preset_json FROM user_presets WHERE user_id = ?').get(req.user!.id) as
      | { preset_json: string }
      | undefined;
    res.json({ preset: row ? JSON.parse(row.preset_json) : null });
  });

  app.put('/api/preset', authOptional, (req: AuthedRequest, res: Response) => {
    db.prepare('INSERT OR REPLACE INTO user_presets (user_id, preset_json, updated_at) VALUES (?, ?, ?)').run(
      req.user!.id,
      JSON.stringify(req.body),
      Date.now()
    );
    res.json({ ok: true });
  });

  app.post('/api/push/subscribe', authOptional, (req: AuthedRequest, res: Response) => {
    const sub = req.body;
    const id = `sub_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare('INSERT OR REPLACE INTO push_subscriptions (id, user_id, subscription_json, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      req.user!.id,
      JSON.stringify(sub),
      Date.now()
    );
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------
  // VITE / STATIC SPA MOUNTING
  // ------------------------------------------------------------------
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));
  if (isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      plugins: [
        {
          name: 'ai-studio-disable-hmr-client-ws',
          enforce: 'post',
          transform(code, id) {
            if (id.includes('vite/dist/client/client.mjs')) {
              return {
                code: code.replace(
                  /transport\.connect\(createHMRHandler\(handleMessage\)\);?/,
                  '/* HMR WebSocket disabled in AI Studio runtime */'
                ),
                map: null,
              };
            }
          },
        },
      ],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Confluence 24/7 Server listening on http://0.0.0.0:${PORT}`);
    void marketFeed.start().then(() => aiEngine.start());
  });
}

void startServer();
