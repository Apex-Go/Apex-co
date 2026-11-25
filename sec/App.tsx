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

  // Real-Time WebSocket listener
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      } catch {
        reconnectTimer = setTimeout(connect, 4000);
        return;
      }
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as { type: string; payload: unknown };
          if (msg.type === 'quotes') {
            setQuotes(msg.payload as Record<string, LiveQuote>);
          } else if (msg.type === 'tick') {
            const { quote, latestCandles } = msg.payload as {
              quote: LiveQuote;
              latestCandles: Partial<Record<Timeframe, Candle>>;
            };
            setQuotes((prev) => ({ ...prev, [quote.symbol]: quote }));
            if (latestCandles) {
              setCandlesByKey((prev) => {
                let changed = false;
                const next = { ...prev };
                for (const [tfKey, bar] of Object.entries(latestCandles)) {
                  if (!bar) continue;
                  const k = `${quote.symbol}:${tfKey}`;
                  const arr = next[k];
                  if (!arr || arr.length === 0) continue;
                  const copy = arr.slice();
                  const last = copy[copy.length - 1];
                  if (last.time === bar.time) {
                    copy[copy.length - 1] = bar;
                  } else if (bar.time > last.time) {
                    copy.push(bar);
                  }
                  next[k] = copy;
                  changed = true;
                }
                return changed ? next : prev;
              });
            }
          } else if (msg.type === 'signal_new' || msg.type === 'signal_update') {
            const sig = msg.payload as AISignal;
            setSignals((prev) => {
              const idx = prev.findIndex((s) => s.id === sig.id);
              if (idx >= 0) {
                const copy = prev.slice();
                copy[idx] = sig;
                return copy;
              }
              return [sig, ...prev];
            });
          } else if (msg.type === 'trade_update') {
            const tr = msg.payload as UserTrade;
            setTrades((prev) => {
              const idx = prev.findIndex((x) => x.id === tr.id);
              if (idx >= 0) {
                const copy = prev.slice();
                copy[idx] = tr;
                return copy;
              }
              return prev;
            });
          } else if (msg.type === 'rejected_update') {
            const rej = msg.payload as RejectedSetup;
            setRejected((prev) => {
              const idx = prev.findIndex((x) => x.id === rej.id);
              if (idx >= 0) {
                const copy = prev.slice();
                copy[idx] = rej;
                return copy;
              }
              return [rej, ...prev].slice(0, 100);
            });
          } else if (msg.type === 'root_causes_update') {
            setRootCauseAnalytics(msg.payload as RootCauseAnalytics);
          } else if (msg.type === 'alert') {
            const al = msg.payload as AlertEvent;
            setAlerts((prev) => [al, ...prev].slice(0, 60));
            setActiveToastAlert(al);
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => {
              setActiveToastAlert((curr) => (curr?.id === al.id ? null : curr));
            }, 9000);
            if (!alertsMutedRef.current) {
              playAlertBeep();
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                const notifData = {
                  alertId: al.id,
                  signalId: al.signalId,
                  tradeId: al.tradeId,
                  symbol: al.symbol,
                };
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                  navigator.serviceWorker.ready
                    .then((reg) =>
                      reg.showNotification(al.title, {
                        body: al.message,
                        tag: al.id,
                        data: notifData,
                      })
                    )
                    .catch(() => {});
                } else {
                  try {
                    const n = new Notification(al.title, {
                      body: al.message,
                      tag: al.id,
                      data: notifData,
                    });
                    n.onclick = () => {
                      window.focus();
                      openAlertTradeCard({ alert: al, ...notifData });
                      n.close();
                    };
                  } catch {
                    // ignore Notification constructor restriction
                  }
                }
              }
            }
          }
        } catch {
          // ignore malformed ws message
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 4000);
        }
      };
    };
    connect();

    // Periodic health refresh
    const healthId = setInterval(async () => {
      try {
        const res = await fetch('/api/market/health');
        if (res.ok) {
          const d = await res.json();
          setHealth(d.health);
        }
      } catch {
        // ignore
      }
    }, 15000);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(healthId);
      ws?.close();
    };
  }, []);

  // Handlers
  const toggleSchool = (sid: SchoolId) => {
    setActiveSchools((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  };

  const handleAddDrawing = async (d: DrawingObject) => {
    setDrawings((prev) => [...prev, d]);
    setRedoStack([]);
    await fetch('/api/drawings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(d),
    }).catch(() => {});
  };

  const handleUpdateDrawing = async (d: DrawingObject, persist = true) => {
    setDrawings((prev) => prev.map((item) => (item.id === d.id ? d : item)));
    if (persist) {
      await fetch('/api/drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(d),
      }).catch(() => {});
    }
  };

  const handleDeleteDrawing = async (id: string) => {
    const target = drawings.find((d) => d.id === id);
    if (target) setRedoStack((prev) => [...prev, target]);
    setDrawings((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/drawings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders,
    }).catch(() => {});
  };

  const handleToggleLockDrawing = async (id: string) => {
    const updated = drawings.map((d) => (d.id === id ? { ...d, locked: !d.locked } : d));
    setDrawings(updated);
    const target = updated.find((d) => d.id === id);
    if (target) {
      await fetch('/api/drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(target),
      }).catch(() => {});
    }
  };

  const handleToggleHideDrawing = async (id: string) => {
    const updated = drawings.map((d) => (d.id === id ? { ...d, hidden: !d.hidden } : d));
    setDrawings(updated);
    const target = updated.find((d) => d.id === id);
    if (target) {
      await fetch('/api/drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(target),
      }).catch(() => {});
    }
  };

  const handleUndo = () => {
    if (drawings.length === 0) return;
    const last = drawings[drawings.length - 1];
    void handleDeleteDrawing(last.id);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    void handleAddDrawing(last);
  };

  const handleSaveTemplate = async (name: string) => {
    const tpl: ChartTemplate = {
      id: `tpl_${Date.now()}`,
      name,
      symbol,
      timeframe,
      chartStyle,
      analysisMode,
      activeSchools,
      comparisonSymbol,
      splitLayout,
      createdAt: Date.now(),
    };
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(tpl),
    });
    if (res.ok) {
      const d = await res.json();
      setTemplates(d.templates || []);
    }
  };

  const handleApplyTemplate = (tpl: ChartTemplate) => {
    setSymbol(tpl.symbol);
    setTimeframe(tpl.timeframe);
    setChartStyle(tpl.chartStyle);
    setAnalysisMode(tpl.analysisMode);
    setActiveSchools(tpl.activeSchools);
    setComparisonSymbol(tpl.comparisonSymbol);
    setSplitLayout(tpl.splitLayout);
  };

  const handleUpdateWatchlist = async (items: WatchlistItem[]) => {
    setWatchlist(items);
    await fetch('/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ items }),
    }).catch(() => {});
  };

  const handleExecuteOrder = async (order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'STOP';
    lotSize: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    signalId?: string;
  }) => {
    const res = await fetch('/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(order),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Order failed');
    setTrades((prev) => [data.trade, ...prev]);
  };

  const handleCloseTrade = async (tradeId: string, exitPrice: number) => {
    const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ exitPrice }),
    });
    if (res.ok) {
      const d = await res.json();
      setTrades(d.trades || []);
    }
  };

  const handleSaveReflection = async (tradeId: string, tags: string[], notes: string) => {
    const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}/reflect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ tags, notes }),
    });
    if (res.ok) {
      const d = await res.json();
      setTrades(d.trades || []);
    }
  };

  const handleCreateOrUpdateIndicator = async (ind: CustomIndicator) => {
    const res = await fetch(`/api/indicators/${encodeURIComponent(ind.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(ind),
    });
    if (res.ok) {
      const d = await res.json();
      setCustomIndicators((prev) => {
        const idx = prev.findIndex((i) => i.id === d.indicator.id);
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = d.indicator;
          return copy;
        }
        return [d.indicator, ...prev];
      });
    }
  };

  const handleDeleteIndicator = async (id: string) => {
    setCustomIndicators((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/indicators/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders,
    }).catch(() => {});
  };

  const handleToggleIndicatorVisibility = async (id: string) => {
    const target = customIndicators.find((i) => i.id === id);
    if (!target) return;
    await handleCreateOrUpdateIndicator({ ...target, visible: !target.visible });
  };

  const setLang = useCallback(
    (nextLang: AppLanguage) => {
      setLangState(nextLang);
      try {
        localStorage.setItem('apex_lang', nextLang);
      } catch {
        // ignore storage restrictions
      }
      void fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ language: nextLang }),
      })
        .then(async (res) => {
          if (res.ok) {
            const d = await res.json();
            if (d.user) setUser(d.user);
          }
        })
        .catch(() => {});
    },
    [authHeaders]
  );

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const i18nValue = useMemo(
    () => ({
      lang,
      dir: (lang === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
      setLang,
      t: (en: string, ar: string) => pickLang(lang, en, ar),
    }),
    [lang, setLang]
  );

  const handleSaveProfile = async (updates: Partial<UserAccount>) => {
    if (updates.timezone) setTimezone(updates.timezone);
    if (updates.language) {
      setLangState(updates.language);
      try {
        localStorage.setItem('apex_lang', updates.language);
      } catch {
        // ignore
      }
    }
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const d = await res.json();
      setUser(d.user);
    }
  };

  const handleSaveDefaultPreset = async () => {
    await fetch('/api/preset', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ symbol, timeframe, activeSchools, analysisMode, language: lang }),
    });
  };

  const handleEnablePush = async (): Promise<string> => {
    if (typeof Notification === 'undefined') {
      return pickLang(lang, 'Browser notifications are not supported on this device.', 'إشعارات المتصفح غير مدعومة على هذا الجهاز.');
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ grantedAt: Date.now() }),
      }).catch(() => {});
      return pickLang(lang, 'Push notifications enabled for signals, TP1->BE, and scalp guards.', 'تم تفعيل إشعارات المتصفح للإشارات وتحريك الوقف والاسكالبينج.');
    }
    return `${pickLang(lang, 'Notification permission status', 'حالة إذن الإشعارات')}: ${perm}`;
  };

  const handleInspectSignal = (sig: AISignal) => {
    setInspectedSignal(sig);
    setSymbol(sig.symbol);
    setTimeframe(sig.recommendedTimeframe);
    setAnalysisMode('ai');
    setActivePage('chart');
  };

  const handleSyncBacktestRun = useCallback((runKey: string, setups: BacktestTrade[]) => {
    setBtSetupsByKey((prev) => {
      const existing = prev[runKey];
      if (
        existing &&
        existing.length === setups.length &&
        existing.every(
          (e, idx) =>
            e.id === setups[idx].id &&
            e.status === setups[idx].status &&
            e.tp1Hit === setups[idx].tp1Hit &&
            e.pnlR === setups[idx].pnlR
        )
      ) {
        return prev;
      }
      return { ...prev, [runKey]: setups };
    });
  }, []);

  const allBacktestSetups = useMemo(
    () => Object.values(btSetupsByKey).flat().sort((a, b) => b.entryTime - a.entryTime),
    [btSetupsByKey]
  );

  const handleJumpToBacktestSetup = useCallback((setup: BacktestTrade) => {
    btJumpSeqRef.current += 1;
    setBtJumpRequest({
      symbol: setup.symbol,
      timeframe: setup.timeframe,
      barIndex: setup.barIndex,
      entryTime: setup.entryTime,
      setupId: setup.id,
      seq: btJumpSeqRef.current,
    });
    setActivePage('backtest');
  }, []);

  const handleJumpFromTradeModal = useCallback(
    (payload: InspectedTradePayload) => {
      setInspectedTradeModal(null);
      if (payload.kind === 'signal') {
        handleInspectSignal(payload.signal);
        return;
      }
      if (payload.kind === 'user') {
        setSymbol(payload.trade.symbol);
        setActivePage('chart');
        return;
      }
      if (payload.kind === 'backtest') {
        handleJumpToBacktestSetup(payload.setup);
        return;
      }
      if (payload.alert.symbol) {
        setSymbol(payload.alert.symbol);
        setActivePage('chart');
      }
    },
    [handleJumpToBacktestSetup]
  );

  const unreadAlerts = alerts.filter((a) => !a.read).length;
  const activeSignalsCount = signals.filter((s) => s.status === 'Active' || s.status === 'Breakeven').length;
  const { t, dir } = i18nValue;

  return (
    <I18nContext.Provider value={i18nValue}>
    <div dir={dir} className="min-h-dvh bg-white text-black flex flex-col pb-14 md:pb-0">
      {/* Top Status Strip & Navigation */}
      <header className="sticky top-0 z-30 h-13 bg-white/95 backdrop-blur-xs border-b border-neutral-200 px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0" dir="ltr">
          <button
            type="button"
            onClick={() => setActivePage('chart')}
            className="text-left focus:outline-none"
          >
            <Logo />
          </button>

          {/* Live 24/7 Engine & Feed Health indicator dot (real live telemetry) */}
          <button
            type="button"
            onClick={() => setActivePage('settings')}
            title={t('24/7 Engine & Feed Health', 'حالة المحرك والتغذية المباشرة 24/7')}
            className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-600 hover:text-black"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                health?.freezeDetected ? 'bg-amber-500' : 'bg-emerald-600'
              }`}
            />
            <span className="whitespace-nowrap">{t('24/7 Live', 'مباشر 24/7')}</span>
          </button>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-4 text-xs font-semibold text-neutral-600 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((item) => {
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id)}
                className={`py-1.5 whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                  active
                    ? 'text-black border-black'
                    : 'border-transparent hover:text-black'
                }`}
              >
                {lang === 'ar' ? item.labelAr : item.label}
                {item.id === 'radar' && activeSignalsCount > 0 ? ` (${activeSignalsCount})` : ''}
                {item.id === 'backtest-trades' && allBacktestSetups.length > 0 ? ` (${allBacktestSetups.length})` : ''}
              </button>
            );
          })}
        </nav>

        {/* Right Controls: Language Switcher (عربي / EN), 10s Brief, Alert Mute/Inbox, Profile */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            aria-label="Switch Language"
            title={t('Switch to Arabic (عربي)', 'التبديل إلى الإنجليزية (EN)')}
            className="min-h-[36px] px-2.5 border border-neutral-300 bg-neutral-50 rounded-lg text-[11px] font-bold text-black hover:bg-neutral-100 flex items-center gap-1 whitespace-nowrap"
          >
            <Languages className="w-3.5 h-3.5" />
            <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
          </button>

          <PWAInstallButton variant="header" />

          <button
            type="button"
            onClick={() => setBriefOpen(true)}
            className="min-h-[36px] px-2.5 border border-neutral-200 rounded-lg text-[11px] font-semibold text-black hover:bg-neutral-50 flex items-center gap-1 whitespace-nowrap"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-700" />
            <span className="hidden sm:inline">{t('10s Brief', 'ملخص 10ث')}</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setAlertsOpen((v) => !v);
                if (!alertsOpen && unreadAlerts > 0) {
                  setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
                  void fetch('/api/alerts/read', { method: 'POST' });
                }
              }}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center border border-neutral-200 rounded-lg hover:bg-neutral-50 relative"
              title={t('Alerts & Mute Toggle', 'التنبيهات وكتم الصوت')}
            >
              {alertsMuted ? <BellOff className="w-4 h-4 text-neutral-400" /> : <Bell className="w-4 h-4 text-black" />}
              {unreadAlerts > 0 && !alertsMuted && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unreadAlerts}
                </span>
              )}
            </button>

            {alertsOpen && (
              <div className={`absolute ${lang === 'ar' ? 'left-0' : 'right-0'} top-full mt-1.5 w-80 max-w-[calc(100vw-1.5rem)] bg-white border border-neutral-200 rounded-2xl shadow-2xl p-3 z-50`}>
                <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                  <span className="text-xs font-bold text-black">{t('Live Alerts', 'التنبيهات المباشرة')} ({alerts.length})</span>
                  <button
                    type="button"
                    onClick={() => setAlertsMuted((v) => !v)}
                    className="text-[11px] font-semibold text-neutral-600 hover:text-black"
                  >
                    {alertsMuted ? t('Unmute Sound', 'تشغيل الصوت') : t('Mute / Snooze', 'كتم الصوت')}
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-neutral-100">
                  {alerts.length === 0 ? (
                    <p className="text-xs text-neutral-500 py-4 text-center">{t('No alerts fired yet.', 'لا توجد تنبيهات بعد.')}</p>
                  ) : (
                    alerts.slice(0, 20).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setAlertsOpen(false);
                          openAlertTradeCard({
                            alert: a,
                            signalId: a.signalId,
                            tradeId: a.tradeId,
                            symbol: a.symbol,
                          });
                        }}
                        className="w-full text-start py-2 px-1.5 rounded-lg hover:bg-neutral-50 active:bg-neutral-100 transition-colors text-xs block"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-black truncate">{a.title}</span>
                          <span className="text-[10px] font-semibold text-neutral-500 shrink-0">
                            {t('Open Card', 'فتح الكارت')}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-600 mt-0.5 line-clamp-2">{a.message}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className="min-h-[36px] px-2.5 bg-black text-white rounded-lg text-[11px] font-semibold hover:bg-neutral-800 flex items-center gap-1.5 whitespace-nowrap"
          >
            <User className="w-3.5 h-3.5" />
            <span className="max-w-[90px] truncate">
              {user && !user.isGuest ? user.displayName : t('Sign In', 'فتح حساب')}
            </span>
          </button>
        </div>
      </header>

      {/* Main Content with Keep-Alive State Persistence across all 7 pages */}
      <main className="flex-1 min-w-0 flex flex-col">
        <div className={activePage === 'chart' ? 'flex-1 flex flex-col' : 'hidden'}>
          <ChartPage
            symbol={symbol}
            onSelectSymbol={setSymbol}
            timeframe={timeframe}
            onSelectTimeframe={setTimeframe}
            analysisMode={analysisMode}
            onChangeAnalysisMode={setAnalysisMode}
            activeSchools={activeSchools}
            onToggleSchool={toggleSchool}
            onSetSchools={setActiveSchools}
            chartStyle={chartStyle}
            onChangeChartStyle={setChartStyle}
            splitLayout={splitLayout}
            onChangeSplitLayout={setSplitLayout}
            comparisonSymbol={comparisonSymbol}
            onChangeComparisonSymbol={setComparisonSymbol}
            candlesByKey={candlesByKey}
            quotes={quotes}
            signals={signals}
            customIndicators={customIndicators}
            onToggleIndicatorVisibility={(id) => void handleToggleIndicatorVisibility(id)}
            drawings={drawings}
            onAddDrawing={(d) => void handleAddDrawing(d)}
            onUpdateDrawing={(d, persist) => void handleUpdateDrawing(d, persist)}
            onDeleteDrawing={(id) => void handleDeleteDrawing(id)}
            onToggleLockDrawing={(id) => void handleToggleLockDrawing(id)}
            onToggleHideDrawing={(id) => void handleToggleHideDrawing(id)}
            onUndoDrawing={handleUndo}
            onRedoDrawing={handleRedo}
            canUndo={drawings.length > 0}
            canRedo={redoStack.length > 0}
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            magnetMode={magnetMode}
            onCycleMagnet={() =>
              setMagnetMode((m) => (m === 'off' ? 'weak' : m === 'weak' ? 'strong' : 'off'))
            }
            watchlist={watchlist}
            onUpdateWatchlist={(items) => void handleUpdateWatchlist(items)}
            templates={templates}
            onSaveTemplate={(n) => void handleSaveTemplate(n)}
            onApplyTemplate={handleApplyTemplate}
            timezone={timezone}
            onChangeTimezone={setTimezone}
            user={user}
            onJumpToDate={(ts) => void handleJumpToHistoricalDate(ts)}
            onLoadMoreHistory={(sym, tf, beforeTime) => void handleLoadMoreHistory(sym, tf, beforeTime)}
            isLoadingHistory={Boolean(historyLoadingByKey[`${symbol}:${timeframe}`])}
            jumpTarget={jumpTarget}
            onOpenCommandPalette={() => setCmdOpen(true)}
            onExecuteOrder={handleExecuteOrder}
            inspectedSignal={inspectedSignal}
            onClearInspectedSignal={() => setInspectedSignal(null)}
          />
        </div>

        <div className={activePage === 'radar' ? 'block' : 'hidden'}>
          <RadarPage
            signals={signals}
            rejected={rejected}
            quotes={quotes}
            timezone={timezone}
            onInspectSignal={handleInspectSignal}
            onTriggerScan={async () => {
              const res = await fetch('/api/signals/scan', { method: 'POST' });
              if (res.ok) {
                const d = await res.json();
                setSignals(d.signals || []);
                setRejected(d.rejected || []);
                if (d.rootCauses) setRootCauseAnalytics(d.rootCauses);
              }
            }}
          />
        </div>

        <div className={activePage === 'backtest' ? 'block' : 'hidden'}>
          <BacktestPage
            candlesByKey={candlesByKey}
            activeSchools={activeSchools}
            customIndicators={customIndicators}
            timezone={timezone}
            onFetchCandles={(s, tf) => fetchCandles(s, tf)}
            totalSavedBacktestTrades={allBacktestSetups.length}
            onSyncRunSetups={handleSyncBacktestRun}
            onOpenBacktestTrades={() => setActivePage('backtest-trades')}
            jumpRequest={btJumpRequest}
          />
        </div>

        <div className={activePage === 'backtest-trades' ? 'block' : 'hidden'}>
          <BacktestTradesPage
            setups={allBacktestSetups}
            timezone={timezone}
            onJumpToSetup={handleJumpToBacktestSetup}
            onOpenTradeCard={(setup) => setInspectedTradeModal({ kind: 'backtest', setup })}
            onBackToReplay={() => setActivePage('backtest')}
            onClearHistory={() => setBtSetupsByKey({})}
          />
        </div>

        <div className={activePage === 'studio' ? 'block' : 'hidden'}>
          <AIStudioPage
            indicators={customIndicators}
            onCreateOrUpdateIndicator={handleCreateOrUpdateIndicator}
            onDeleteIndicator={handleDeleteIndicator}
            onToggleVisibility={handleToggleIndicatorVisibility}
            onSendToBacktest={() => setActivePage('backtest')}
            authHeaders={authHeaders}
            onIndicatorGenerated={(ind) =>
              setCustomIndicators((prev) => [ind, ...prev.filter((x) => x.id !== ind.id)])
            }
          />
        </div>

        <div className={activePage === 'ai-log' ? 'block' : 'hidden'}>
          <AILogPage
            signals={signals}
            rejected={rejected}
            quotes={quotes}
            riskUsdPerR={
              user
                ? Number(
                    (
                      (user.riskSettings.accountBalance * user.riskSettings.riskPerTradePct) /
                      100
                    ).toFixed(2)
                  )
                : 100
            }
            schoolWeights={schoolWeights}
            rootCauseAnalytics={rootCauseAnalytics}
            timezone={timezone}
            onInspectSignal={handleInspectSignal}
            onOpenTradeCard={(sig) => setInspectedTradeModal({ kind: 'signal', signal: sig })}
          />
        </div>

        <div className={activePage === 'my-trades' ? 'block' : 'hidden'}>
          <MyTradesPage
            trades={trades}
            quotes={quotes}
            timezone={timezone}
            onCloseTrade={handleCloseTrade}
            onSaveReflection={handleSaveReflection}
            onInspectSymbol={(s) => {
              setSymbol(s);
              setActivePage('chart');
            }}
            onOpenTradeCard={(trade) => setInspectedTradeModal({ kind: 'user', trade })}
          />
        </div>

        <div className={activePage === 'settings' ? 'block' : 'hidden'}>
          <SettingsPage
            user={user}
            health={health}
            onOpenAuthModal={() => setAuthModalOpen(true)}
            onSaveProfile={handleSaveProfile}
            onSaveDefaultPreset={handleSaveDefaultPreset}
            onEnablePushNotifications={handleEnablePush}
          />
        </div>
      </main>

      {/* Mobile Bottom Tab Bar (Thumb-Zone Ergonomics, <=15% sticky height) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-14 bg-white/95 backdrop-blur-xs border-t border-neutral-200 grid grid-cols-8 items-center px-0.5">
        {NAV_ITEMS.map((item) => {
          const active = activePage === item.id;
          const mobileTxt =
            lang === 'ar'
              ? item.mobileLabelAr ?? item.labelAr
              : item.mobileLabel ?? item.label;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActivePage(item.id)}
              className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-black font-bold' : 'text-neutral-500'
              }`}
            >
              {item.icon}
              <span className="text-[8.5px] tracking-tight truncate max-w-full px-0.5">
                {mobileTxt}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Modals */}
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        user={user}
        onAuthSuccess={(u, token) => {
          setUser(u);
          setAuthToken(token);
          if (u.timezone) setTimezone(u.timezone);
          if (u.language === 'ar' || u.language === 'en') {
            setLangState(u.language);
            try { localStorage.setItem('apex_lang', u.language); } catch {}
          }
          void loadWorkspaceData({ Authorization: `Bearer ${token}` });
        }}
        onLogout={async () => {
          await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders }).catch(() => {});
          const guestRes = await fetch('/api/auth/guest', { method: 'POST' });
          if (guestRes.ok) {
            const d = await guestRes.json();
            setUser(d.user);
            setAuthToken(d.token);
            await loadWorkspaceData({ Authorization: `Bearer ${d.token}` });
          }
          setAuthModalOpen(false);
        }}
      />

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onSelectSymbol={(s) => {
          setSymbol(s);
          setActivePage('chart');
        }}
        onSelectTimeframe={(tf) => {
          setTimeframe(tf);
          setActivePage('chart');
        }}
        onToggleSchool={toggleSchool}
        onSelectTool={(t) => {
          setActiveTool(t);
          setActivePage('chart');
        }}
        onSelectPage={setActivePage}
      />

      {/* Quick 10-Second Daily Brief Modal */}
      {briefOpen && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-md p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
              <h3 className="text-sm font-bold text-black">{t('10-Second Daily Market Brief', 'الملخص اليومي السريع في 10 ثوانٍ')}</h3>
              <button
                type="button"
                onClick={() => setBriefOpen(false)}
                className="p-1.5 rounded-lg hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-neutral-800 space-y-2 font-mono-tabular">
              <div dir="ltr" className={lang === 'ar' ? 'text-right' : 'text-left'}>
                XAUUSD: <strong>{quotes['XAUUSD']?.mid.toFixed(2) ?? '—'}</strong> · BTCUSDT:{' '}
                <strong>{quotes['BTCUSDT']?.mid.toFixed(2) ?? '—'}</strong> · DXY:{' '}
                <strong>{quotes['DXY']?.mid.toFixed(3) ?? '—'}</strong>
              </div>
              <div className="font-sans">
                {t('Confirmed Live Signals', 'الإشارات المؤكدة المباشرة')}: <strong>{activeSignalsCount}</strong> · {t('Forming Watchlist', 'قيد التكوّن')}:{' '}
                <strong>{signals.filter((s) => s.status === 'Watchlist').length}</strong>
              </div>
              {signals[0] && (
                <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl font-sans leading-relaxed whitespace-pre-line">
                  {lang === 'ar'
                    ? signals[0].rationaleAr
                    : signals[0].rationaleEn ||
                      `${signals[0].symbol} ${signals[0].direction} (${signals[0].recommendedTimeframe.toUpperCase()}): ${signals[0].regimeMatch} · Entry ${signals[0].entryPrice} · SL ${signals[0].currentSl} · TP1 ${signals[0].tp1}`}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setBriefOpen(false);
                setActivePage('radar');
              }}
              className="w-full min-h-[40px] bg-black text-white rounded-xl text-xs font-semibold"
            >
              {t('Open Full Radar', 'فتح الرادار الكامل')}
            </button>
          </div>
        </div>
      )}

      {/* Interactive Live Alert Toast Banner (Tap to open Trade Card) */}
      {activeToastAlert && (
        <div
          className={`fixed top-15 z-40 w-[calc(100%-1.5rem)] max-w-sm ${
            lang === 'ar' ? 'left-3 sm:left-5' : 'right-3 sm:right-5'
          }`}
        >
          <div
            onClick={() => {
              const target = activeToastAlert;
              setActiveToastAlert(null);
              openAlertTradeCard({
                alert: target,
                signalId: target.signalId,
                tradeId: target.tradeId,
                symbol: target.symbol,
              });
            }}
            className="bg-black text-white rounded-2xl shadow-2xl border border-neutral-800 p-3 flex items-start gap-2.5 cursor-pointer hover:bg-neutral-900 active:scale-[0.99] transition-all"
          >
            <Bell className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold truncate">{activeToastAlert.title}</div>
              <div className="text-[11px] text-neutral-300 line-clamp-2 mt-0.5">
                {activeToastAlert.message}
              </div>
              <div className="text-[10px] font-semibold text-emerald-400 mt-1">
                {t('Tap to open Trade Card & Chart →', 'اضغط لفتح كارت الصفقة والشارت ←')}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveToastAlert(null);
              }}
              aria-label={t('Dismiss alert', 'إخفاء التنبيه')}
              className="p-1 text-neutral-400 hover:text-white shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Trade Card & Details Modal */}
      <TradeDetailsModal
        payload={inspectedTradeModal}
        quotes={quotes}
        timezone={timezone}
        riskUsdPerR={
          user
            ? Number(
                (
                  (user.riskSettings.accountBalance * user.riskSettings.riskPerTradePct) /
                  100
                ).toFixed(2)
              )
            : 100
        }
        onClose={() => setInspectedTradeModal(null)}
        onJumpToChart={handleJumpFromTradeModal}
      />

      <OfflineIndicator />
    </div>
    </I18nContext.Provider>
  );
}
