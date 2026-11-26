import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickChart,
  Radar,
  History,
  Sparkles,
  BookLock,
  Briefcase,
  Settings,
  Bell,
  BellOff,
  Radio,
  User,
  X,
  Languages,
  ListChecks,
} from 'lucide-react';
import {
  AISignal,
  AlertEvent,
  AnalysisMode,
  AppLanguage,
  BacktestJumpRequest,
  BacktestTrade,
  Candle,
  ChartStyle,
  ChartTemplate,
  CustomIndicator,
  DrawingObject,
  DrawingToolId,
  FeedHealth,
  LiveQuote,
  MagnetMode,
  PageId,
  RejectedSetup,
  RootCauseAnalytics,
  SchoolId,
  Timeframe,
  UserAccount,
  UserTrade,
  WatchlistItem,
} from './types/trading';
import { DEFAULT_ACTIVE_SCHOOLS } from './lib/schools';
import { getTimeframeSeconds } from './lib/indicators';
import { detectDeviceTimezone } from './lib/timezones';
import { getCachedCandles, setCachedCandles } from './lib/indexedDbCache';
import { I18nContext, pickLang } from './lib/i18n';
import { Logo } from './components/Logo';
import { AuthModal } from './components/AuthModal';
import { CommandPalette } from './components/CommandPalette';
import { TradeDetailsModal, InspectedTradePayload } from './components/TradeDetailsModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ChartPage } from './pages/ChartPage';
import { RadarPage } from './pages/RadarPage';
import { BacktestPage } from './pages/BacktestPage';
import { BacktestTradesPage } from './pages/BacktestTradesPage';
import { AIStudioPage } from './pages/AIStudioPage';
import { AILogPage } from './pages/AILogPage';
import { MyTradesPage } from './pages/MyTradesPage';
import { SettingsPage } from './pages/SettingsPage';

const NAV_ITEMS: Array<{
  id: PageId;
  label: string;
  labelAr: string;
  mobileLabel?: string;
  mobileLabelAr?: string;
  icon: React.ReactNode;
}> = [
  { id: 'chart', label: 'Chart', labelAr: 'الشارت', icon: <CandlestickChart className="w-4 h-4" /> },
  { id: 'radar', label: 'Radar', labelAr: 'الرادار', icon: <Radar className="w-4 h-4" /> },
  { id: 'backtest', label: 'Backtest', labelAr: 'الباك تيست', mobileLabelAr: 'باك تيست', icon: <History className="w-4 h-4" /> },
  {
    id: 'backtest-trades',
    label: 'Backtest Trades',
    labelAr: 'صفقات الباك تيست',
    mobileLabel: 'BT Trades',
    mobileLabelAr: 'صفقات BT',
    icon: <ListChecks className="w-4 h-4" />,
  },
  { id: 'studio', label: 'AI Studio', labelAr: 'مختبر AI', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'ai-log', label: 'AI Log', labelAr: 'سجل الذكاء', mobileLabelAr: 'السجل', icon: <BookLock className="w-4 h-4" /> },
  { id: 'my-trades', label: 'My Trades', labelAr: 'صفقاتي', icon: <Briefcase className="w-4 h-4" /> },
  { id: 'settings', label: 'Settings', labelAr: 'الإعدادات', icon: <Settings className="w-4 h-4" /> },
];

function playAlertBeep(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // ignore audio restriction
  }
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('chart');

  // Keep-alive persistent workspace state
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('ai');
  const [activeSchools, setActiveSchools] = useState<SchoolId[]>(DEFAULT_ACTIVE_SCHOOLS);
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles');
  const [splitLayout, setSplitLayout] = useState<1 | 2 | 4>(1);
  const [comparisonSymbol, setComparisonSymbol] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(() => detectDeviceTimezone());
  const [lang, setLangState] = useState<AppLanguage>(() => {
    try {
      const saved = localStorage.getItem('apex_lang');
      return saved === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });

  // Auth held purely in React memory
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Market & Signals state
  const [candlesByKey, setCandlesByKey] = useState<Record<string, Candle[]>>({});
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [health, setHealth] = useState<FeedHealth | null>(null);
  const [signals, setSignals] = useState<AISignal[]>([]);
  const [rejected, setRejected] = useState<RejectedSetup[]>([]);
  const [schoolWeights, setSchoolWeights] = useState<Record<SchoolId, { weight: number; wins: number; losses: number }>>({} as Record<SchoolId, { weight: number; wins: number; losses: number }>);
  const [trades, setTrades] = useState<UserTrade[]>([]);
  const [customIndicators, setCustomIndicators] = useState<CustomIndicator[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [templates, setTemplates] = useState<ChartTemplate[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [rootCauseAnalytics, setRootCauseAnalytics] = useState<RootCauseAnalytics | null>(null);

  // Drawing state + undo/redo stack
  const [drawings, setDrawings] = useState<DrawingObject[]>([]);
  const [redoStack, setRedoStack] = useState<DrawingObject[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingToolId>('crosshair');
  const [magnetMode, setMagnetMode] = useState<MagnetMode>('weak');

  // UI popovers & modals
  const [cmdOpen, setCmdOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsMuted, setAlertsMuted] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [inspectedSignal, setInspectedSignal] = useState<AISignal | null>(null);
  const [inspectedTradeModal, setInspectedTradeModal] = useState<InspectedTradePayload | null>(null);
  const [activeToastAlert, setActiveToastAlert] = useState<AlertEvent | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [historyLoadingByKey, setHistoryLoadingByKey] = useState<Record<string, boolean>>({});
  const [jumpTarget, setJumpTarget] = useState<{ time: number; seq: number } | null>(null);
  const [btSetupsByKey, setBtSetupsByKey] = useState<Record<string, BacktestTrade[]>>({});
  const [btJumpRequest, setBtJumpRequest] = useState<BacktestJumpRequest | null>(null);
  const btJumpSeqRef = useRef(0);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const historyLastBeforeRef = useRef<Record<string, number>>({});
  const candlesByKeyRef = useRef(candlesByKey);
  candlesByKeyRef.current = candlesByKey;
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const tradesRef = useRef(trades);
  tradesRef.current = trades;
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const authHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
  }, [authToken]);

  const alertsMutedRef = useRef(alertsMuted);
  alertsMutedRef.current = alertsMuted;

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openAlertTradeCard = useCallback(
    (data: { alert?: AlertEvent; signalId?: string; tradeId?: string; symbol?: string; alertId?: string }) => {
      const matchedAlert =
        data.alert ??
        (data.alertId ? alertsRef.current.find((a) => a.id === data.alertId) : undefined);
      const targetSignalId = data.signalId || matchedAlert?.signalId;
      const targetTradeId = data.tradeId || matchedAlert?.tradeId;
      const targetSymbol = data.symbol || matchedAlert?.symbol;

      if (targetSignalId) {
        const sig = signalsRef.current.find((s) => s.id === targetSignalId);
        if (sig) {
          setInspectedTradeModal({ kind: 'signal', signal: sig, alert: matchedAlert });
          return;
        }
      }

      if (targetTradeId) {
        const tr = tradesRef.current.find((x) => x.id === targetTradeId);
        if (tr) {
          setInspectedTradeModal({ kind: 'user', trade: tr, alert: matchedAlert });
          return;
        }
      }

      if (targetSymbol) {
        const latestSig =
          signalsRef.current.find(
            (s) => s.symbol === targetSymbol && (s.status === 'Active' || s.status === 'Breakeven')
          ) ?? signalsRef.current.find((s) => s.symbol === targetSymbol);
        if (latestSig) {
          setInspectedTradeModal({ kind: 'signal', signal: latestSig, alert: matchedAlert });
          return;
        }
        const latestTrade = tradesRef.current.find((tr) => tr.symbol === targetSymbol);
        if (latestTrade) {
          setInspectedTradeModal({ kind: 'user', trade: latestTrade, alert: matchedAlert });
          return;
        }
      }

      if (matchedAlert) {
        setInspectedTradeModal({ kind: 'alertOnly', alert: matchedAlert });
      }
    },
    []
  );

  // Register Service Worker & listen for notification-click deep links
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      const onSwMessage = (evt: MessageEvent) => {
        if (evt.data?.type === 'OPEN_TRADE_ALERT' && evt.data.data) {
          openAlertTradeCard(evt.data.data);
        }
      };
      navigator.serviceWorker.addEventListener('message', onSwMessage);
      return () => {
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      };
    }
    return undefined;
  }, [openAlertTradeCard]);

  // Handle deep link query params (?alertSymbol=...&signalId=...&tradeId=...) when opened from OS notification
  const pendingDeepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (pendingDeepLinkHandledRef.current) return;
    if (signals.length === 0 && trades.length === 0 && alerts.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const alertSymbol = params.get('alertSymbol') || undefined;
    const signalId = params.get('signalId') || undefined;
    const tradeId = params.get('tradeId') || undefined;
    if (alertSymbol || signalId || tradeId) {
      pendingDeepLinkHandledRef.current = true;
      openAlertTradeCard({ symbol: alertSymbol, signalId, tradeId });
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, [signals, trades, alerts, openAlertTradeCard]);

  const loadWorkspaceData = useCallback(async (headers: Record<string, string>) => {
    const [sigRes, rejRes, wRes, trRes, indRes, wlRes, tplRes, alRes, hRes, qRes, preRes, rcRes] =
      await Promise.allSettled([
        fetch('/api/signals', { headers }),
        fetch('/api/rejected', { headers }),
        fetch('/api/school-weights', { headers }),
        fetch('/api/trades', { headers }),
        fetch('/api/indicators', { headers }),
        fetch('/api/watchlist', { headers }),
        fetch('/api/templates', { headers }),
        fetch('/api/alerts', { headers }),
        fetch('/api/market/health', { headers }),
        fetch('/api/market/quotes', { headers }),
        fetch('/api/preset', { headers }),
        fetch('/api/analytics/root-causes', { headers }),
      ]);

    if (sigRes.status === 'fulfilled' && sigRes.value.ok) {
      const d = await sigRes.value.json();
      setSignals(d.signals || []);
    }
    if (rejRes.status === 'fulfilled' && rejRes.value.ok) {
      const d = await rejRes.value.json();
      setRejected(d.rejected || []);
    }
    if (wRes.status === 'fulfilled' && wRes.value.ok) {
      const d = await wRes.value.json();
      setSchoolWeights(d.weights || {});
    }
    if (trRes.status === 'fulfilled' && trRes.value.ok) {
      const d = await trRes.value.json();
      setTrades(d.trades || []);
    }
    if (indRes.status === 'fulfilled' && indRes.value.ok) {
      const d = await indRes.value.json();
      setCustomIndicators(d.indicators || []);
    }
    if (wlRes.status === 'fulfilled' && wlRes.value.ok) {
      const d = await wlRes.value.json();
      setWatchlist(d.items || []);
    }
    if (tplRes.status === 'fulfilled' && tplRes.value.ok) {
      const d = await tplRes.value.json();
      setTemplates(d.templates || []);
    }
    if (alRes.status === 'fulfilled' && alRes.value.ok) {
      const d = await alRes.value.json();
      setAlerts(d.alerts || []);
    }
    if (hRes.status === 'fulfilled' && hRes.value.ok) {
      const d = await hRes.value.json();
      setHealth(d.health || null);
    }
    if (qRes.status === 'fulfilled' && qRes.value.ok) {
      const d = await qRes.value.json();
      setQuotes(d.quotes || {});
    }
    if (preRes.status === 'fulfilled' && preRes.value.ok) {
      const d = await preRes.value.json();
      if (d.preset) {
        if (d.preset.symbol) setSymbol(d.preset.symbol);
        if (d.preset.timeframe) setTimeframe(d.preset.timeframe);
        if (d.preset.activeSchools) setActiveSchools(d.preset.activeSchools);
        if (d.preset.analysisMode) setAnalysisMode(d.preset.analysisMode);
        if (d.preset.language === 'ar' || d.preset.language === 'en') {
          setLangState(d.preset.language);
        }
      }
    }
    if (rcRes.status === 'fulfilled' && rcRes.value.ok) {
      const d = await rcRes.value.json();
      setRootCauseAnalytics(d.analytics || null);
    }
  }, []);

  // Initialize Local / Guest session immediately on boot + hydrate workspace
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/guest', { method: 'POST' });
        if (res.ok && active) {
          const data = (await res.json()) as { user: UserAccount; token: string };
          setAuthToken(data.token);
          setUser(data.user);
          if (data.user.timezone) setTimezone(data.user.timezone);
          if (data.user.language === 'ar' || data.user.language === 'en') {
            try {
              if (!localStorage.getItem('apex_lang')) {
                setLangState(data.user.language);
              }
            } catch {
              setLangState(data.user.language);
            }
          }
          await loadWorkspaceData({ Authorization: `Bearer ${data.token}` });
        }
      } catch {
        await loadWorkspaceData({});
      }
    })();
    return () => {
      active = false;
    };
  }, [loadWorkspaceData]);

  // Fetch candles (IndexedDB instant cache -> server live fetch + anchored historical pagination)
  const fetchCandles = useCallback(async (sym: string, tf: Timeframe, beforeTime?: number, anchorPrice?: number) => {
    const key = `${sym}:${tf}`;
    if (!beforeTime) {
      const cached = await getCachedCandles(sym, tf);
      if (cached && cached.length > 20) {
        setCandlesByKey((prev) => (prev[key] ? prev : { ...prev, [key]: cached }));
      }
    }
    try {
      const qs = new URLSearchParams({ symbol: sym, timeframe: tf, limit: '500' });
      if (beforeTime) {
        qs.set('beforeTime', String(beforeTime));
        const fallbackAnchor = anchorPrice ?? candlesByKeyRef.current[key]?.[0]?.open;
        if (fallbackAnchor && Number.isFinite(fallbackAnchor) && fallbackAnchor > 0) {
          qs.set('anchorPrice', String(fallbackAnchor));
        }
      }
      const res = await fetch(`/api/market/candles?${qs.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { candles: Candle[]; quote?: LiveQuote };
      if (data.candles?.length) {
        setCandlesByKey((prev) => {
          const existing = prev[key] || [];
          const map = new Map<number, Candle>();
          for (const c of existing) map.set(c.time, c);
          for (const c of data.candles) map.set(c.time, c);
          const merged = Array.from(map.values()).sort((a, b) => a.time - b.time);
          void setCachedCandles(sym, tf, merged);
          return { ...prev, [key]: merged };
        });
      }
      if (data.quote) {
        setQuotes((prev) => ({ ...prev, [sym]: data.quote! }));
      }
    } catch {
      // keep cached candles
    }
  }, []);

  const handleLoadMoreHistory = useCallback(
    async (sym: string, tf: Timeframe, beforeTime: number) => {
      const key = `${sym}:${tf}`;
      if (historyInFlightRef.current.has(key)) return;
      const prevCursor = historyLastBeforeRef.current[key];
      if (prevCursor !== undefined && beforeTime >= prevCursor) return;

      historyInFlightRef.current.add(key);
      historyLastBeforeRef.current[key] = beforeTime;
      setHistoryLoadingByKey((prev) => ({ ...prev, [key]: true }));
      try {
        const anchor = candlesByKeyRef.current[key]?.[0]?.open;
        await fetchCandles(sym, tf, beforeTime, anchor);
      } finally {
        historyInFlightRef.current.delete(key);
        setHistoryLoadingByKey((prev) => ({ ...prev, [key]: false }));
      }
    },
    [fetchCandles]
  );

  const handleJumpToHistoricalDate = useCallback(
    async (ts: number) => {
      const key = `${symbol}:${timeframe}`;
      const tfSec = getTimeframeSeconds(timeframe);
      const beforeCursor = ts + tfSec * 120;
      setHistoryLoadingByKey((prev) => ({ ...prev, [key]: true }));
      try {
        await fetchCandles(symbol, timeframe, beforeCursor);
        setJumpTarget({ time: ts, seq: Date.now() });
      } finally {
        setHistoryLoadingByKey((prev) => ({ ...prev, [key]: false }));
      }
    },
    [symbol, timeframe, fetchCandles]
  );

  useEffect(() => {
    void fetchCandles(symbol, timeframe);
    if (comparisonSymbol) void fetchCandles(comparisonSymbol, timeframe);
    if (splitLayout > 1) {
      void fetchCandles(symbol, '5m');
      void fetchCandles(symbol, '1h');
      void fetchCandles(symbol, '4h');
    }
  }, [symbol, timeframe, comparisonSymbol, splitLayout, fetchCandles]);

  // Fetch drawings for current symbol
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/drawings?symbol=${encodeURIComponent(symbol)}`, {
          headers: authHeaders,
        });
        if (res.ok) {
          const d = await res.json();
          setDrawings(d.drawings || []);
        }
      } catch {
        // ignore
      }
    })();
  }, [symbol, authHeaders]);

// Real-Time Live Feed (Binance WS for Crypto + OANDA Live Polling for Gold/Forex/Oil)
  useEffect(() => {
    const key = `${symbol}:${timeframe}`;
    const tfSec = getTimeframeSeconds(timeframe);
    const cleanSym = symbol.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const isCrypto =
      cleanSym.endsWith('usdt') || cleanSym.endsWith('busd') || cleanSym.endsWith('usdc');

    const binanceIntervalMap: Record<Timeframe, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
    };

    if (isCrypto) {
      let ws: WebSocket | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let closed = false;

      const connectBinance = () => {
        if (closed) return;
        try {
          ws = new WebSocket(
            `wss://stream.binance.com:9443/ws/${cleanSym}@kline_${binanceIntervalMap[timeframe] || '15m'}`
          );
          ws.onmessage = (evt) => {
            try {
              const msg = JSON.parse(evt.data) as {
                k?: { t: number; o: string; h: string; l: string; c: string; v: string };
              };
              const k = msg.k;
              if (!k) return;
              const liveCandle: Candle = {
                time: Math.floor(k.t / 1000),
                open: Number(k.o),
                high: Number(k.h),
                low: Number(k.l),
                close: Number(k.c),
                volume: Number(k.v),
              };
              setCandlesByKey((prev) => {
                const existing = prev[key] || [];
                if (existing.length === 0) return { ...prev, [key]: [liveCandle] };
                const next = [...existing];
                const lastIdx = next.length - 1;
                if (next[lastIdx].time === liveCandle.time) {
                  next[lastIdx] = liveCandle;
                } else if (liveCandle.time > next[lastIdx].time) {
                  next.push(liveCandle);
                }
                return { ...prev, [key]: next };
              });
            } catch {
              // ignore malformed message
            }
          };
          ws.onclose = () => {
            if (!closed) reconnectTimer = setTimeout(connectBinance, 3000);
          };
        } catch {
          if (!closed) reconnectTimer = setTimeout(connectBinance, 3000);
        }
      };

      connectBinance();
      return () => {
        closed = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) ws.close();
      };
    }

    const oandaKey = import.meta.env.VITE_OANDA_API_KEY as string | undefined;
    const oandaEnv = (
      (import.meta.env.VITE_OANDA_ENV as string | undefined) || 'practice'
    ).toLowerCase();
    const oandaBaseUrl =
      oandaEnv === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';

    const toOandaInstrument = (rawSym: string): string => {
      const clean = rawSym.replace(/[^A-Za-z0-9_]/g, '').toUpperCase();
      const map: Record<string, string> = {
        USOIL: 'WTICO_USD',
        WTI: 'WTICO_USD',
        WTICOUSD: 'WTICO_USD',
        UKOIL: 'BCO_USD',
        BRENT: 'BCO_USD',
        BCOUSD: 'BCO_USD',
        NATGAS: 'NATGAS_USD',
        NATGASUSD: 'NATGAS_USD',
        XAUUSD: 'XAU_USD',
        XAGUSD: 'XAG_USD',
        XPTUSD: 'XPT_USD',
        XPDUSD: 'XPD_USD',
        XCUUSD: 'XCU_USD',
        US30: 'US30_USD',
        NAS100: 'NAS100_USD',
        SPX500: 'SPX500_USD',
        GER40: 'DE30_EUR',
        UK100: 'UK100_GBP',
      };
      if (map[clean]) return map[clean];
      if (clean.includes('_')) return clean;
      if (clean.length === 6) return `${clean.slice(0, 3)}_${clean.slice(3, 6)}`;
      return clean;
    };

    const instrument = toOandaInstrument(symbol);
    const decimals = symbol === 'XAUUSD' ? 2 : symbol.includes('JPY') ? 3 : 5;

    const pollOandaPrice = async () => {
      if (!oandaKey) return;
      try {
        const res = await fetch(
          `${oandaBaseUrl}/v3/pricing?instruments=${encodeURIComponent(instrument)}`,
          {
            headers: {
              Authorization: `Bearer ${oandaKey}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          prices?: Array<{ bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }>;
        };
        const p = data.prices?.[0];
        if (!p) return;
        const bid = Number(p.bids?.[0]?.price ?? p.asks?.[0]?.price);
        const ask = Number(p.asks?.[0]?.price ?? p.bids?.[0]?.price);
        if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
        const mid = Number(((bid + ask) / 2).toFixed(decimals));
        const nowBarTime = Math.floor(Math.floor(Date.now() / 1000) / tfSec) * tfSec;

        setCandlesByKey((prev) => {
          const existing = prev[key];
          if (!existing || existing.length === 0) return prev;
          const next = [...existing];
          const last = next[next.length - 1];
          if (last.time === nowBarTime) {
            next[next.length - 1] = {
              ...last,
              close: mid,
              high: Number(Math.max(last.high, mid).toFixed(decimals)),
              low: Number(Math.min(last.low, mid).toFixed(decimals)),
            };
          } else if (nowBarTime > last.time) {
            next.push({
              time: nowBarTime,
              open: last.close,
              high: Number(Math.max(last.close, mid).toFixed(decimals)),
              low: Number(Math.min(last.close, mid).toFixed(decimals)),
              close: mid,
              volume: 0,
            });
          }
          return { ...prev, [key]: next };
        });

        setQuotes((qPrev) => ({
          ...qPrev,
          [symbol]: {
            ...(qPrev[symbol] || { symbol, change24h: 0, changePct24h: 0 }),
            symbol,
            bid,
            ask,
            mid,
            updatedAt: Date.now(),
          } as LiveQuote,
        }));
      } catch {
        // ignore transient network error
      }
    };

    void pollOandaPrice();
    const pollTimer = setInterval(pollOandaPrice, 2000);
    return () => clearInterval(pollTimer);
  }, [symbol, timeframe]);
