export type PageId =
  | 'chart'
  | 'radar'
  | 'backtest'
  | 'backtest-trades'
  | 'studio'
  | 'ai-log'
  | 'my-trades'
  | 'settings';

export type AnalysisMode = 'ai' | 'manual';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export type ChartStyle = 'candles' | 'ohlc' | 'line' | 'area';

export type MagnetMode = 'off' | 'weak' | 'strong';

export type AppLanguage = 'ar' | 'en';

export type SchoolId =
  | 'classical'
  | 'price_action'
  | 'supply_demand'
  | 'crt'
  | 'smc'
  | 'ict'
  | 'elliott'
  | 'harmonic'
  | 'gann'
  | 'astrology'
  | 'indicators'
  | 'wyckoff'
  | 'wolfe'
  | 'vsa'
  | 'fundamental'
  | 'psychology';

export interface SchoolDefinition {
  id: SchoolId;
  order: number;
  nameEn: string;
  nameAr: string;
  shortEn: string;
  color: string;
  category: 'structure' | 'timing' | 'orderflow' | 'quantitative' | 'macro';
  description: string;
  defaultWeight: number;
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolInfo {
  symbol: string;
  oandaInstrument?: string;
  binanceSymbol?: string;
  name: string;
  nameAr: string;
  category: 'Metals' | 'Crypto' | 'Energy' | 'Forex' | 'Macro';
  decimals: number;
  pipSize: number;
  contractSize: number;
  typicalSpreadPips: number;
  feedSource: 'OANDA' | 'Binance' | 'Macro';
}

export interface LiveQuote {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spreadPips: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  adrValue: number;
  adrUsedPct: number;
  adrRemaining: number;
  updatedAt: number;
  source: string;
  stale: boolean;
}

export type DrawingToolCategory =
  | 'cursors'
  | 'lines'
  | 'geometric'
  | 'fib_gann'
  | 'elliott_harmonic'
  | 'position_measure';

export type DrawingToolId =
  | 'crosshair'
  | 'dot'
  | 'arrow_cursor'
  | 'eraser'
  | 'trendline'
  | 'ray'
  | 'info_line'
  | 'extended_line'
  | 'trend_angle'
  | 'horizontal_line'
  | 'horizontal_ray'
  | 'vertical_line'
  | 'cross_line'
  | 'parallel_channel'
  | 'regression_trend'
  | 'flat_channel'
  | 'pitchfork'
  | 'schiff_pitchfork'
  | 'mod_schiff_pitchfork'
  | 'inside_pitchfork'
  | 'rectangle'
  | 'rotated_rectangle'
  | 'triangle'
  | 'ellipse'
  | 'arc'
  | 'curve'
  | 'double_curve'
  | 'polyline'
  | 'path'
  | 'brush'
  | 'highlighter'
  | 'callout'
  | 'balloon'
  | 'price_label'
  | 'flag_marker'
  | 'fib_retracement'
  | 'fib_extension'
  | 'fib_channel'
  | 'fib_time_zones'
  | 'fib_speed_arcs'
  | 'fib_trend_time'
  | 'fib_circles'
  | 'fib_spiral'
  | 'fib_speed_fan'
  | 'fib_wedge'
  | 'pitchfan'
  | 'gann_box'
  | 'gann_square'
  | 'gann_square_fixed'
  | 'gann_fan'
  | 'elliott_impulse'
  | 'elliott_correction'
  | 'elliott_triangle'
  | 'elliott_double_combo'
  | 'elliott_triple_combo'
  | 'harmonic_xabcd'
  | 'harmonic_cypher'
  | 'head_shoulders'
  | 'harmonic_abcd'
  | 'long_position'
  | 'short_position'
  | 'forecast'
  | 'bars_pattern'
  | 'ghost_feed'
  | 'price_range'
  | 'date_range'
  | 'date_price_range'
  | 'ruler';

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface DrawingObject {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  tool: DrawingToolId;
  points: DrawingPoint[];
  color: string;
  fillColor?: string;
  lineWidth: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  text?: string;
  locked: boolean;
  hidden: boolean;
  createdAt: number;
}

export interface OverlayZone {
  id: string;
  school: SchoolId;
  label: string;
  startTime: number;
  endTime: number;
  topPrice: number;
  bottomPrice: number;
  color: string;
  fillAlpha: number;
  dashed?: boolean;
}

export interface OverlayLine {
  id: string;
  school: SchoolId;
  label: string;
  points: DrawingPoint[];
  color: string;
  lineWidth: number;
  dashed?: boolean;
  extendRight?: boolean;
}

export interface OverlayMarker {
  id: string;
  school: SchoolId;
  time: number;
  price: number;
  label: string;
  position: 'above' | 'below';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'label';
}

export interface OverlaySeriesPoint {
  time: number;
  value: number;
}

export interface OverlaySeries {
  id: string;
  school: SchoolId | 'custom';
  name: string;
  color: string;
  lineWidth: number;
  dashed?: boolean;
  pane: 'main' | 'oscillator';
  data: OverlaySeriesPoint[];
}

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  isPoc: boolean;
  inValueArea: boolean;
}

export interface TradeLevelLines {
  signalId: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  optimalZoneHigh: number;
  optimalZoneLow: number;
  sl: number;
  be?: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  invalidation: number;
}

export interface ChartOverlaysBundle {
  zones: OverlayZone[];
  lines: OverlayLine[];
  markers: OverlayMarker[];
  series: OverlaySeries[];
  volumeProfile: VolumeProfileLevel[];
  tradeLevels: TradeLevelLines | null;
  sanityCheckedCount: number;
  rejectedOverlayCount: number;
}

export type SignalStatus = 'Watchlist' | 'Active' | 'Breakeven' | 'Won' | 'Lost';
export type SignalTier = 'A+' | 'A' | 'B';

export interface MtfSnapshotItem {
  timeframe: Timeframe;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  structure: 'BOS' | 'CHoCH' | 'RANGE';
  momentum: number; // -100..100
}

export interface PatternTwinMatch {
  historicalTime: number;
  similarityPct: number;
  outcome: 'Won' | 'Lost';
  moveR: number;
  summary: string;
}

export type LossRootCauseCategory =
  | 'Counter-Trend / Against Momentum'
  | 'Late Entry / Chasing'
  | 'Wide SL / Volatility Spike'
  | 'Premature / Weak Confluence';

export type MissedWinRootCauseCategory =
  | 'Near-Threshold Score'
  | 'Over-Strict Filter'
  | 'Early Rejection Before Pullback/Confirm';

export interface AISignal {
  id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  tier: SignalTier;
  status: SignalStatus;
  recommendedTimeframe: Timeframe;
  dominantTimeframe: Timeframe;
  optimalEntryZone: [number, number];
  entryPrice: number;
  stopLoss: number;
  currentSl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  hardInvalidation: number;
  schoolsUsed: SchoolId[];
  weightedScore: number; // 0..100
  regimeMatch: string;
  liquidityFingerprint: string;
  devilsAdvocate: string;
  preTp1ObstacleCheck: string;
  mtfSnapshot: MtfSnapshotItem[];
  checklist: { label: string; passed: boolean }[];
  rationaleAr: string;
  rationaleEn?: string;
  autopsySummary?: string;
  lossCause?: LossRootCauseCategory;
  lossCauseDetail?: string;
  entryRsi?: number;
  slAtrRatio?: number;
  isScalp: boolean;
  tp1Hit: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  pnlPips: number;
  pnlR: number;
  patternTwin?: PatternTwinMatch;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export interface RejectedSetup {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: 'BUY' | 'SELL';
  guardName: string;
  reason: string;
  wouldHaveWon: boolean;
  counterfactualPnlR: number;
  priceAtCheck: number;
  weightedScore?: number;
  entryRsi?: number;
  hypotheticalSl?: number;
  hypotheticalTp1?: number;
  counterfactualStatus?: 'Pending' | 'MissedWin' | 'SavedLoss';
  missedWinCause?: MissedWinRootCauseCategory;
  missedWinDetail?: string;
  resolvedAt?: number;
  createdAt: number;
}

export interface RootCauseAnalytics {
  lossBreakdown: Array<{
    category: LossRootCauseCategory;
    labelAr: string;
    count: number;
    totalR: number;
    cooldownActive: boolean;
    adjustmentEn: string;
    adjustmentAr: string;
  }>;
  missedWinBreakdown: Array<{
    category: MissedWinRootCauseCategory;
    labelAr: string;
    count: number;
    missedR: number;
    adjustmentEn: string;
    adjustmentAr: string;
  }>;
  learnedAdjustments: Array<{
    id: string;
    kind: 'tighten' | 'calibrate' | 'locked';
    titleEn: string;
    titleAr: string;
    detailEn: string;
    detailAr: string;
  }>;
  policy: {
    minConfluenceScore: number;
    antiLateAtrMult: number;
    slCapScale: number;
    chopAtrFloor: number;
    activeCooldownCauses: LossRootCauseCategory[];
  };
}

export interface UserTrade {
  id: string;
  userId: string;
  signalId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  lotSize: number;
  entryPrice: number;
  stopLoss: number;
  currentSl?: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  exitPrice?: number;
  status: 'Open' | 'Breakeven' | 'Won' | 'Lost';
  pnlUsd: number;
  pnlPips: number;
  riskUsd: number;
  riskPct: number;
  rrRatio: number;
  executionVsPlanScore: number;
  exitEfficiency: number;
  driftPips: number;
  postLossStreakCount: number;
  lossCause?: LossRootCauseCategory;
  lossCauseDetail?: string;
  tags: string[];
  notes: string;
  createdAt: number;
  closedAt?: number;
}

export interface CustomIndicatorInput {
  key: string;
  label: string;
  type: 'number' | 'color' | 'select';
  defaultValue: number | string;
  value: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface CustomIndicatorBlueprint {
  kind: 'ma_crossover' | 'rsi_bands' | 'bollinger_squeeze' | 'ema_ribbon' | 'vwap_deviation' | 'atr_channel' | 'momentum_osc' | 'custom_expr';
  pane: 'main' | 'oscillator';
  expression?: string;
  signalRule?: string;
}

export interface CustomIndicator {
  id: string;
  userId: string;
  name: string;
  nameAr: string;
  description: string;
  visible: boolean;
  color: string;
  secondaryColor: string;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  lineWidth: number;
  linkedSchools: SchoolId[];
  inputs: CustomIndicatorInput[];
  blueprint: CustomIndicatorBlueprint;
  createdAt: number;
}

export interface WatchlistItem {
  symbol: string;
  folder: string;
  flagColor: 'none' | 'emerald' | 'amber' | 'crimson' | 'blue';
}

export interface ChartTemplate {
  id: string;
  name: string;
  symbol: string;
  timeframe: Timeframe;
  chartStyle: ChartStyle;
  analysisMode: AnalysisMode;
  activeSchools: SchoolId[];
  comparisonSymbol: string | null;
  splitLayout: 1 | 2 | 4;
  createdAt: number;
}

export interface RiskSettings {
  accountBalance: number;
  riskPerTradePct: number;
  maxConcurrentTrades: number;
  dailyProfitLockPct: number;
  trailingEquityGuardPct: number;
  dailyMaxLossPct: number;
  consecutiveLossCooldownCount: number;
  cooldownMinutes: number;
  maxSpreadMultiplier: number;
  exposureGuardEnabled: boolean;
  newsVolatilityShieldEnabled: boolean;
  splitEntryEnabled: boolean;
  oneClickTradingEnabled: boolean;
}

export interface AlertSettings {
  pushEnabled: boolean;
  soundEnabled: boolean;
  mutedUntil: number;
  notifyScalp: boolean;
  notifyEntryApproach: boolean;
  notifyCandleClose: boolean;
  notifyTp1Be: boolean;
  notifyFinalTpSl: boolean;
  notifyPostEntryGuard: boolean;
}

export interface UserAccount {
  id: string;
  displayName: string;
  email: string;
  isGuest: boolean;
  timezone: string;
  autoDst: boolean;
  language?: AppLanguage;
  defaultWatchlist: string[];
  riskSettings: RiskSettings;
  alertSettings: AlertSettings;
}

export interface AlertEvent {
  id: string;
  symbol: string;
  signalId?: string;
  tradeId?: string;
  type:
    | 'NEW_SIGNAL'
    | 'SCALP_SIGNAL'
    | 'APPROACHING_ENTRY'
    | 'CANDLE_CONFIRMED'
    | 'POST_ENTRY_GUARD'
    | 'SCALP_TIME_GUARD'
    | 'TP1_BE'
    | 'FINAL_TP'
    | 'SL_HIT'
    | 'RISK_GUARD';
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
}

export interface FeedHealth {
  engine247Active: boolean;
  lastTickAt: number;
  oandaConfigured: boolean;
  oandaEnv: 'practice' | 'live';
  geminiConfigured: boolean;
  oandaStatus: 'live' | 'fallback_bridge' | 'reconnecting';
  binanceStatus: 'live' | 'reconnecting';
  macroStatus: 'live' | 'cached';
  freezeDetected: boolean;
  activeSignalCount: number;
  watchlistSignalCount: number;
  uptimeSeconds: number;
}

export type BacktestSetupStatus = 'Active' | 'Breakeven' | 'Won' | 'Lost';

export interface BacktestTrade {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: 'BUY' | 'SELL';
  barIndex: number;
  entryTime: number;
  exitTime?: number;
  entryPrice: number;
  entryZone: [number, number];
  stopLoss: number;
  currentSl: number;
  takeProfit: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  exitPrice?: number;
  status: BacktestSetupStatus;
  pnlR: number;
  pnlUsd: number;
  lastLivePrice?: number;
  floatingPnlR?: number;
  floatingPnlUsd?: number;
  floatingPips?: number;
  score: number;
  schoolsUsed: SchoolId[];
  indicatorMatches: string[];
  rationaleEn: string;
  rationaleAr: string;
}

export interface BacktestRunMetrics {
  totalSetups: number;
  closedCount: number;
  wonCount: number;
  lostCount: number;
  breakevenCount: number;
  activeCount: number;
  winRatePct: number;
  netR: number;
  netPnlUsd: number;
  profitFactor: number;
  maxDrawdownR: number;
  maxDrawdownPct: number;
}

export interface BacktestJumpRequest {
  symbol: string;
  timeframe: Timeframe;
  barIndex: number;
  entryTime: number;
  setupId: string;
  seq: number;
}
