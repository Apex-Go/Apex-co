import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Maximize2, Minimize2, Loader2, Lock, Unlock, Trash2, X } from 'lucide-react';
import {
  Candle,
  ChartOverlaysBundle,
  ChartStyle,
  DrawingObject,
  DrawingPoint,
  DrawingToolId,
  MagnetMode,
  Timeframe,
} from '../types/trading';
import { SYMBOL_MAP, TIMEFRAMES } from '../lib/schools';
import { getTimeframeSeconds } from '../lib/indicators';
import { TOOL_MAP } from '../lib/drawingTools';
import { formatCountdown, formatTimeInTimezone } from '../lib/timezones';
import { useI18n } from '../lib/i18n';

const DRAWING_COLOR_SWATCHES: Array<{ hex: string; label: string; labelAr: string }> = [
  { hex: '#000000', label: 'Black', labelAr: 'أسود' },
  { hex: '#059669', label: 'Emerald', labelAr: 'أخضر' },
  { hex: '#DC2626', label: 'Crimson', labelAr: 'أحمر' },
  { hex: '#2563EB', label: 'Blue', labelAr: 'أزرق' },
  { hex: '#D97706', label: 'Amber', labelAr: 'ذهبي' },
  { hex: '#7C3AED', label: 'Purple', labelAr: 'بنفسجي' },
];

export interface LogicalRangeChange {
  startIdx: number;
  endIdx: number;
  totalBars: number;
  oldestTime: number | null;
}

interface ChartCanvasProps {
  symbol: string;
  timeframe: Timeframe;
  onSelectTimeframe?: (tf: Timeframe) => void;
  candles: Candle[];
  comparisonCandles?: Candle[];
  comparisonSymbol?: string | null;
  overlays: ChartOverlaysBundle;
  customSeries?: ChartOverlaysBundle['series'];
  chartStyle: ChartStyle;
  activeTool: DrawingToolId;
  magnetMode: MagnetMode;
  drawings: DrawingObject[];
  showAllDrawings: boolean;
  onAddDrawing: (drawing: DrawingObject) => void;
  onUpdateDrawing?: (drawing: DrawingObject, persist?: boolean) => void;
  onDeleteDrawing: (id: string) => void;
  timezone: string;
  sessionFocus?: boolean;
  zenMode?: boolean;
  syncedCrosshairTime?: number | null;
  onCrosshairTimeChange?: (time: number | null) => void;
  onVisibleLogicalRangeChanged?: (range: LogicalRangeChange) => void;
  isLoadingHistory?: boolean;
  jumpTarget?: { time: number; seq: number } | null;
  heightClass?: string;
  isBacktest?: boolean;
  onResetToolToCursor?: () => void;
}

export const ChartCanvas: React.FC<ChartCanvasProps> = ({
  symbol,
  timeframe,
  onSelectTimeframe,
  candles,
  comparisonCandles,
  comparisonSymbol,
  overlays,
  customSeries = [],
  chartStyle,
  activeTool,
  magnetMode,
  drawings,
  showAllDrawings,
  onAddDrawing,
  onUpdateDrawing,
  onDeleteDrawing,
  timezone,
  sessionFocus = false,
  zenMode = false,
  syncedCrosshairTime,
  onCrosshairTimeChange,
  onVisibleLogicalRangeChanged,
  isLoadingHistory = false,
  jumpTarget = null,
  heightClass = 'h-[460px] sm:h-[560px] lg:h-[620px]',
  isBacktest = false,
  onResetToolToCursor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const candlesLengthRef = useRef(candles.length);
  candlesLengthRef.current = candles.length;
  const { lang, dir, t } = useI18n();

  const [size, setSize] = useState({ width: 800, height: 480 });
  const [expanded, setExpanded] = useState(false);

  // Viewport state: barWidth in px, rightOffset in bars (can be negative to see future space), priceZoom & priceOffset
  const [view, setView] = useState({
    barWidth: 8,
    rightIndex: 0, // offset from last candle; 0 means last candle near right edge
    futureMarginBars: 10,
    priceScaleMult: 1,
    priceShift: 0,
  });

  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [cursor, setCursor] = useState<{ x: number; y: number; time: number; price: number } | null>(null);
  const [draftPoints, setDraftPoints] = useState<DrawingPoint[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFreehand, setIsFreehand] = useState(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    rightIndex: number;
    priceShift: number;
    priceScaleMult: number;
  } | null>(null);
  const dragActivatedRef = useRef(false);
  const drawDragStartRef = useRef<{ x: number; y: number; startPoint: DrawingPoint } | null>(null);
  const freehandPointsRef = useRef<DrawingPoint[]>([]);
  const draggingHandleRef = useRef<{ drawing: DrawingObject; pointIdx: number; latest: DrawingObject } | null>(null);
  const tapCandidateRef = useRef<{ x: number; y: number; hitDrawingId: string | null } | null>(null);
  const pinchDistRef = useRef<number | null>(null);
  const pinchAnchorDistRef = useRef<number | null>(null);
  const pinchActivatedRef = useRef(false);

  const isDrawingMode = activeTool !== 'crosshair' && activeTool !== 'dot' && activeTool !== 'arrow_cursor';
  const selectedDrawing = useMemo(
    () => (showAllDrawings && selectedDrawingId ? drawings.find((d) => d.id === selectedDrawingId && !d.hidden) || null : null),
    [drawings, selectedDrawingId, showAllDrawings]
  );

  // Reset transient draft/selection on symbol switch or when switching back to cursor
  useEffect(() => {
    setSelectedDrawingId(null);
    setDraftPoints([]);
  }, [symbol]);

  useEffect(() => {
    if (!isDrawingMode) {
      setDraftPoints([]);
      drawDragStartRef.current = null;
      setIsFreehand(false);
    } else {
      setSelectedDrawingId(null);
    }
  }, [isDrawingMode, activeTool]);

  const info = SYMBOL_MAP[symbol] || SYMBOL_MAP.XAUUSD;
  const tfSec = getTimeframeSeconds(timeframe);

  // 1-second timer for live candle countdown on far-right axis
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // ResizeObserver for crisp DPR rendering inside independent chart container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, zenMode]);

  const resetView = useCallback(() => {
    setView({
      barWidth: size.width < 500 ? 7 : 9,
      rightIndex: 0,
      futureMarginBars: 10,
      priceScaleMult: 1,
      priceShift: 0,
    });
  }, [size.width]);

  const hasOscillator = useMemo(() => {
    const allSeries = [...overlays.series, ...customSeries];
    return allSeries.some((s) => s.pane === 'oscillator' && s.data.length > 0);
  }, [overlays.series, customSeries]);

  const axisRightW = 76;
  const axisBottomH = 26;
  const availChartH = Math.max(180, size.height - axisBottomH);
  const oscH = hasOscillator ? Math.max(66, Math.min(136, Math.round(availChartH * 0.2))) : 0;
  const plotW = Math.max(100, size.width - axisRightW);
  const plotH = Math.max(100, availChartH - oscH);

  // Compute visible slice (Viewport Culling)
  const visibleWindow = useMemo(() => {
    const count = candles.length;
    if (count === 0) {
      return { startIdx: 0, endIdx: 0, visibleBars: 1, minPrice: 0, maxPrice: 1 };
    }
    const visibleBars = Math.max(12, Math.floor(plotW / view.barWidth));
    const endFloat = count - 1 - view.rightIndex + view.futureMarginBars;
    const endIdx = Math.min(count - 1, Math.max(0, Math.ceil(endFloat)));
    const startIdx = Math.max(0, Math.floor(endFloat - visibleBars));

    let minP = Infinity;
    let maxP = -Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      const c = candles[i];
      if (!c) continue;
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    }
    if (overlays.tradeLevels && (isBacktest || endIdx >= count - 15)) {
      const tl = overlays.tradeLevels;
      minP = Math.min(minP, tl.sl, tl.tp3);
      maxP = Math.max(maxP, tl.sl, tl.tp3);
    }
    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || maxP <= minP) {
      minP = (candles[count - 1]?.close ?? 100) * 0.99;
      maxP = (candles[count - 1]?.close ?? 100) * 1.01;
    }
    const mid = (minP + maxP) / 2 + view.priceShift;
    const halfSpan = ((maxP - minP) / 2) * 1.18 * view.priceScaleMult;
    return {
      startIdx,
      endIdx,
      visibleBars,
      minPrice: mid - halfSpan,
      maxPrice: mid + halfSpan,
    };
  }, [candles, plotW, view, overlays.tradeLevels]);

  const indexToX = useCallback(
    (idx: number): number => {
      const rightAnchorX = plotW - view.futureMarginBars * view.barWidth;
      const idxDiff = idx - (candles.length - 1);
      return rightAnchorX + (idxDiff + view.rightIndex) * view.barWidth;
    },
    [candles.length, plotW, view.futureMarginBars, view.barWidth, view.rightIndex]
  );

  const timeToX = useCallback(
    (time: number): number => {
      const count = candles.length;
      if (count === 0) return 0;
      const firstBar = candles[0];
      const lastBar = candles[count - 1];
      if (time <= firstBar.time) {
        return indexToX(0) + ((time - firstBar.time) / tfSec) * view.barWidth;
      }
      if (time >= lastBar.time) {
        return indexToX(count - 1) + ((time - lastBar.time) / tfSec) * view.barWidth;
      }
      // Binary search for exact candle index across historical weekend/session gaps
      let lo = 0;
      let hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const tMid = candles[mid].time;
        if (tMid === time) return indexToX(mid);
        if (tMid < time) lo = mid + 1;
        else hi = mid - 1;
      }
      const leftIdx = Math.max(0, hi);
      const rightIdx = Math.min(count - 1, lo);
      const t0 = candles[leftIdx].time;
      const t1 = candles[rightIdx].time;
      const frac = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
      return indexToX(leftIdx + frac);
    },
    [candles, indexToX, tfSec, view.barWidth]
  );

  const xToTime = useCallback(
    (x: number): number => {
      if (candles.length === 0) return nowSec;
      const lastBar = candles[candles.length - 1];
      const rightAnchorX = plotW - view.futureMarginBars * view.barWidth;
      const barsFromLast = (x - rightAnchorX) / view.barWidth - view.rightIndex;
      const approxIdx = Math.round(candles.length - 1 + barsFromLast);
      if (approxIdx >= 0 && approxIdx < candles.length) {
        return candles[approxIdx].time;
      }
      if (approxIdx < 0) {
        return Math.round(candles[0].time + approxIdx * tfSec);
      }
      return Math.round(lastBar.time + Math.round(barsFromLast) * tfSec);
    },
    [candles, nowSec, plotW, view.futureMarginBars, view.barWidth, view.rightIndex, tfSec]
  );

  const rangeCallbackRef = useRef(onVisibleLogicalRangeChanged);
  rangeCallbackRef.current = onVisibleLogicalRangeChanged;

  // Notify parent of visible logical range changes so scroll-left pagination loads older history
  useEffect(() => {
    const cb = rangeCallbackRef.current;
    if (!cb || candles.length === 0) return;
    cb({
      startIdx: visibleWindow.startIdx,
      endIdx: visibleWindow.endIdx,
      totalBars: candles.length,
      oldestTime: candles[0]?.time ?? null,
    });
  }, [visibleWindow.startIdx, visibleWindow.endIdx, candles]);

  // Center viewport when user jumps to a specific historical date
  const lastJumpSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!jumpTarget || jumpTarget.seq === lastJumpSeqRef.current || candles.length === 0) return;
    const targetSec = jumpTarget.time;
    const first = candles[0].time;
    const last = candles[candles.length - 1].time;
    if (targetSec < first - tfSec * 15 || targetSec > last + tfSec * 15) return;

    lastJumpSeqRef.current = jumpTarget.seq;
    let lo = 0;
    let hi = candles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].time < targetSec) lo = mid + 1;
      else hi = mid;
    }
    const targetIdx = lo;
    const halfVis = Math.floor(Math.max(12, plotW / view.barWidth) * 0.45);
    const desiredRightIndex = Math.max(
      -10,
      Math.min(Math.max(0, candles.length - 10), candles.length - 1 - targetIdx - halfVis)
    );
    setView((v) => ({
      ...v,
      rightIndex: desiredRightIndex,
      priceShift: 0,
      priceScaleMult: 1,
    }));
  }, [jumpTarget, candles, tfSec, plotW, view.barWidth]);

  const priceToY = useCallback(
    (price: number): number => {
      const span = Math.max(0.00001, visibleWindow.maxPrice - visibleWindow.minPrice);
      return plotH - ((price - visibleWindow.minPrice) / span) * plotH;
    },
    [plotH, visibleWindow.maxPrice, visibleWindow.minPrice]
  );

  const yToPrice = useCallback(
    (y: number): number => {
      const span = Math.max(0.00001, visibleWindow.maxPrice - visibleWindow.minPrice);
      return visibleWindow.minPrice + ((plotH - y) / plotH) * span;
    },
    [plotH, visibleWindow.maxPrice, visibleWindow.minPrice]
  );

  const applyMagnet = useCallback(
    (rawTime: number, rawPrice: number): DrawingPoint => {
      if (magnetMode === 'off' || candles.length === 0) {
        return { time: rawTime, price: Number(rawPrice.toFixed(info.decimals)) };
      }
      let nearest: Candle | null = null;
      let minDist = Infinity;
      for (let i = visibleWindow.startIdx; i <= visibleWindow.endIdx; i++) {
        const c = candles[i];
        if (!c) continue;
        const d = Math.abs(c.time - rawTime);
        if (d < minDist) {
          minDist = d;
          nearest = c;
        }
      }
      if (!nearest) return { time: rawTime, price: Number(rawPrice.toFixed(info.decimals)) };

      const ohlc = [nearest.open, nearest.high, nearest.low, nearest.close];
      let snapP = rawPrice;
      let bestPriceDist = Infinity;
      for (const candidate of ohlc) {
        const pd = Math.abs(candidate - rawPrice);
        if (pd < bestPriceDist) {
          bestPriceDist = pd;
          snapP = candidate;
        }
      }
      const threshold = (visibleWindow.maxPrice - visibleWindow.minPrice) * (magnetMode === 'strong' ? 0.16 : 0.05);
      if (bestPriceDist <= threshold || magnetMode === 'strong') {
        return { time: nearest.time, price: Number(snapP.toFixed(info.decimals)) };
      }
      return { time: nearest.time, price: Number(rawPrice.toFixed(info.decimals)) };
    },
    [magnetMode, candles, info.decimals, visibleWindow]
  );

  // ------------------------------------------------------------------
  // BASE CANVAS RENDER (Candles, Grid, Axes, Countdown, AI Overlays)
  // ------------------------------------------------------------------
  useEffect(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Pure white canvas
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size.width, size.height);

    // Subtle grid lines
    ctx.strokeStyle = '#F3F4F6';
    ctx.lineWidth = 1;
    const priceSteps = 6;
    for (let i = 0; i <= priceSteps; i++) {
      const y = Math.round((plotH / priceSteps) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();
    }
    const timeStepBars = Math.max(4, Math.floor(visibleWindow.visibleBars / 6));
    for (let i = visibleWindow.startIdx; i <= visibleWindow.endIdx; i += timeStepBars) {
      const x = Math.round(indexToX(i)) + 0.5;
      if (x >= 0 && x <= plotW) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, plotH + oscH);
        ctx.stroke();
      }
    }

    // Session Focus Highlights (Killzones)
    if (sessionFocus) {
      for (let i = visibleWindow.startIdx; i <= visibleWindow.endIdx; i++) {
        const c = candles[i];
        if (!c) continue;
        const hr = new Date(c.time * 1000).getUTCHours();
        if (hr >= 7 && hr < 10) {
          ctx.fillStyle = 'rgba(5, 150, 105, 0.045)';
          ctx.fillRect(indexToX(i) - view.barWidth / 2, 0, view.barWidth, plotH);
        } else if (hr >= 12 && hr < 15) {
          ctx.fillStyle = 'rgba(220, 38, 38, 0.04)';
          ctx.fillRect(indexToX(i) - view.barWidth / 2, 0, view.barWidth, plotH);
        }
      }
    }

    // AI Overlay Zones (clipped to plotW x plotH)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, plotH);
    ctx.clip();

    // Label collision tracker (Decluttered Chart Labels)
    const placedLabelBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const reserveLabelBox = (
      x: number,
      yTop: number,
      w: number,
      h: number,
      pad = 4
    ): boolean => {
      if (x < 0 || x + w > plotW || yTop < 0 || yTop + h > plotH) return false;
      for (const b of placedLabelBoxes) {
        if (x - pad < b.x2 && x + w + pad > b.x1 && yTop - pad < b.y2 && yTop + h + pad > b.y1) {
          return false;
        }
      }
      placedLabelBoxes.push({ x1: x, y1: yTop, x2: x + w, y2: yTop + h });
      return true;
    };

    const deferredZoneLabels: Array<{ label: string; x: number; y: number; color: string }> = [];

    if (showAllDrawings) {
      for (const z of overlays.zones) {
        const x1 = timeToX(z.startTime);
        const x2 = timeToX(z.endTime);
        const y1 = priceToY(z.topPrice);
        const y2 = priceToY(z.bottomPrice);
        if (x2 < 0 || x1 > plotW) continue;
        ctx.fillStyle = hexToRgba(z.color, z.fillAlpha);
        ctx.fillRect(x1, y1, Math.max(4, x2 - x1), Math.max(2, y2 - y1));
        ctx.strokeStyle = hexToRgba(z.color, 0.65);
        ctx.lineWidth = 1;
        ctx.setLineDash(z.dashed ? [4, 4] : []);
        ctx.strokeRect(x1, y1, Math.max(4, x2 - x1), Math.max(2, y2 - y1));
        ctx.setLineDash([]);
        deferredZoneLabels.push({
          label: z.label,
          x: Math.max(6, x1 + 4),
          y: y1 + 11,
          color: z.color,
        });
      }

      // Volume Profile Histogram on right inside plot
      if (overlays.volumeProfile.length > 0) {
        const maxVol = Math.max(...overlays.volumeProfile.map((v) => v.volume), 1);
        const barMaxW = Math.min(70, plotW * 0.14);
        const rowH = Math.max(2, plotH / overlays.volumeProfile.length - 1);
        for (const vp of overlays.volumeProfile) {
          const y = priceToY(vp.price);
          const w = (vp.volume / maxVol) * barMaxW;
          ctx.fillStyle = vp.isPoc
            ? 'rgba(220, 38, 38, 0.42)'
            : vp.inValueArea
              ? 'rgba(17, 24, 39, 0.18)'
              : 'rgba(156, 163, 175, 0.14)';
          ctx.fillRect(plotW - w, y - rowH / 2, w, rowH);
        }
      }
    }

    // Comparison Overlay (e.g. DXY / XAGUSD normalized for SMT divergence)
    if (comparisonCandles && comparisonCandles.length > 5 && candles.length > 5) {
      const compMap = new Map(comparisonCandles.map((c) => [c.time, c.close]));
      const visComp: { x: number; val: number }[] = [];
      let cMin = Infinity;
      let cMax = -Infinity;
      for (let i = visibleWindow.startIdx; i <= visibleWindow.endIdx; i++) {
        const c = candles[i];
        if (!c) continue;
        const cv = compMap.get(c.time);
        if (cv !== undefined) {
          if (cv < cMin) cMin = cv;
          if (cv > cMax) cMax = cv;
          visComp.push({ x: indexToX(i), val: cv });
        }
      }
      if (visComp.length > 3 && cMax > cMin) {
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        visComp.forEach((pt, idx) => {
          const norm = (pt.val - cMin) / (cMax - cMin);
          const y = plotH - (0.15 + norm * 0.7) * plotH;
          if (idx === 0) ctx.moveTo(pt.x, y);
          else ctx.lineTo(pt.x, y);
        });
        ctx.stroke();
        if (comparisonSymbol) {
          ctx.fillStyle = 'rgba(37, 99, 235, 0.85)';
          ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
          const smtTxt = `SMT Overlay: ${comparisonSymbol}`;
          const smtW = ctx.measureText(smtTxt).width + 8;
          if (reserveLabelBox(10, 8, smtW, 13)) {
            ctx.fillText(smtTxt, 10, 18);
          }
        }
      }
    }

    // Candlesticks / OHLC / Line / Area (Viewport Culled!)
    const candleBodyW = Math.max(1.5, view.barWidth * 0.68);
    if (chartStyle === 'line' || chartStyle === 'area') {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      let firstX = 0;
      let lastX = 0;
      for (let i = visibleWindow.startIdx; i <= visibleWindow.endIdx; i++) {
        const c = candles[i];
        if (!c) continue;
        const x = indexToX(i);
        const y = priceToY(c.close);
        if (i === visibleWindow.startIdx) {
          ctx.moveTo(x, y);
          firstX = x;
        } else {
          ctx.lineTo(x, y);
        }
        lastX = x;
      }
      ctx.stroke();
      if (chartStyle === 'area' && lastX > firstX) {
        ctx.lineTo(lastX, plotH);
        ctx.lineTo(firstX, plotH);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.fill();
      }
    } else {
      for (let i = visibleWindow.startIdx; i <= visibleWindow.endIdx; i++) {
        const c = candles[i];
        if (!c) continue;
        const x = indexToX(i);
        const yOpen = priceToY(c.open);
        const yClose = priceToY(c.close);
        const yHigh = priceToY(c.high);
        const yLow = priceToY(c.low);
        const isBull = c.close >= c.open;
        const color = isBull ? '#059669' : '#DC2626';

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;

        if (chartStyle === 'ohlc') {
          ctx.beginPath();
          ctx.moveTo(x, yHigh);
          ctx.lineTo(x, yLow);
          ctx.moveTo(x - candleBodyW / 2, yOpen);
          ctx.lineTo(x, yOpen);
          ctx.moveTo(x, yClose);
          ctx.lineTo(x + candleBodyW / 2, yClose);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(x, yHigh);
          ctx.lineTo(x, yLow);
          ctx.stroke();
          const top = Math.min(yOpen, yClose);
          const h = Math.max(1.5, Math.abs(yClose - yOpen));
          ctx.fillRect(x - candleBodyW / 2, top, candleBodyW, h);
        }
      }
    }

    // Main-pane Overlay Series (MA 5/10/50 + Custom Indicators)
    const allSeries = [...overlays.series, ...customSeries];
    for (const ser of allSeries) {
      if (ser.pane !== 'main' || ser.data.length < 2) continue;
      ctx.strokeStyle = ser.color;
      ctx.lineWidth = ser.lineWidth;
      ctx.setLineDash(ser.dashed ? [4, 4] : []);
      ctx.beginPath();
      let started = false;
      for (const pt of ser.data) {
        const x = timeToX(pt.time);
        if (x < -20 || x > plotW + 20) continue;
        const y = priceToY(pt.value);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (showAllDrawings) {
      const deferredLineLabels: Array<{ label: string; x: number; y: number; color: string }> = [];

      // AI School Lines (BOS, CHoCH, CRT, PDH/PDL, Gann, Elliott, Harmonics, Wolfe)
      for (const l of overlays.lines) {
        if (l.points.length < 2) continue;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.lineWidth;
        ctx.setLineDash(l.dashed ? [5, 4] : []);
        ctx.beginPath();
        l.points.forEach((pt, idx) => {
          const x = timeToX(pt.time);
          const y = priceToY(pt.price);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        if (l.extendRight && l.points.length >= 2) {
          const p1 = l.points[l.points.length - 2];
          const p2 = l.points[l.points.length - 1];
          const x1 = timeToX(p1.time);
          const y1 = priceToY(p1.price);
          const x2 = timeToX(p2.time);
          const y2 = priceToY(p2.price);
          if (Math.abs(x2 - x1) > 1) {
            const slope = (y2 - y1) / (x2 - x1);
            ctx.lineTo(plotW, y2 + slope * (plotW - x2));
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const lastPt = l.points[l.points.length - 1];
        deferredLineLabels.push({
          label: l.label,
          x: Math.min(plotW - 115, Math.max(6, timeToX(lastPt.time) + 4)),
          y: priceToY(lastPt.price) - 4,
          color: l.color,
        });
      }

      // 1) HIGHEST PRIORITY: Trade Level Lines & Badges (Entry, SL, BE, TP1, TP2, TP3)
      // Rendered first with horizontal/vertical collision stagger so ENTRY, SL, TP1 remain crisp
      if (overlays.tradeLevels) {
        const tl = overlays.tradeLevels;
        const drawLevel = (price: number, label: string, color: string, dashed = false) => {
          const y = priceToY(price);
          if (y < 0 || y > plotH) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.4;
          ctx.setLineDash(dashed ? [4, 4] : []);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotW, y);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.font = '600 10px "JetBrains Mono", monospace';
          const badgeW = Math.min(165, Math.ceil(ctx.measureText(label).width) + 12);
          const badgeH = 14;

          let placedX = 6;
          let placedY = Math.max(2, Math.min(plotH - badgeH - 2, y - 15));
          let placed = reserveLabelBox(placedX, placedY, badgeW, badgeH, 2);
          if (!placed) {
            // Try placing directly below the line
            placedY = Math.max(2, Math.min(plotH - badgeH - 2, y + 2));
            placed = reserveLabelBox(placedX, placedY, badgeW, badgeH, 2);
          }
          if (!placed) {
            // Try staggering horizontally so close ENTRY / SL / TP1 levels never overlap
            placedX = Math.min(plotW - badgeW - 6, 6 + badgeW + 8);
            placedY = Math.max(2, Math.min(plotH - badgeH - 2, y - 15));
            placed = reserveLabelBox(placedX, placedY, badgeW, badgeH, 2);
          }
          if (placed) {
            ctx.fillStyle = color;
            ctx.fillRect(placedX, placedY, badgeW, badgeH);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(label, placedX + 5, placedY + 10.5);
          }
        };
        drawLevel(tl.entry, `ENTRY ${tl.entry.toFixed(info.decimals)}`, '#000000', false);
        drawLevel(tl.sl, `${tl.be ? 'SL -> BE' : 'SL'} ${tl.sl.toFixed(info.decimals)}`, tl.be ? '#D97706' : '#DC2626', false);
        drawLevel(tl.tp1, `${tl.tp1Hit ? '✓ TP1 Hit' : 'TP1'} ${tl.tp1.toFixed(info.decimals)}`, tl.tp1Hit ? '#047857' : '#059669', !tl.tp1Hit);
        drawLevel(tl.tp2, `${tl.tp2Hit ? '✓ TP2 Hit' : 'TP2'} ${tl.tp2.toFixed(info.decimals)}`, tl.tp2Hit ? '#047857' : '#059669', !tl.tp2Hit);
        drawLevel(tl.tp3, `${tl.tp3Hit ? '✓ TP3 Hit' : 'TP3'} ${tl.tp3.toFixed(info.decimals)}`, tl.tp3Hit ? '#065F46' : '#047857', false);
      }

      // 2) SECOND PRIORITY: School Line Labels (deduplicated & collision-checked)
      ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
      for (const ll of deferredLineLabels) {
        const w = Math.ceil(ctx.measureText(ll.label).width) + 6;
        const h = 12;
        let lx = Math.max(6, Math.min(plotW - w - 6, ll.x));
        const yTop = Math.max(2, Math.min(plotH - h - 2, ll.y - 10));
        if (reserveLabelBox(lx, yTop, w, h, 4)) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fillRect(lx - 2, yTop, w + 2, h);
          ctx.fillStyle = ll.color;
          ctx.fillText(ll.label, lx, yTop + 9.5);
        }
      }

      // 3) THIRD PRIORITY: Zone Labels (FVG, Supply/Demand, OTE) — skip if colliding
      for (const zl of deferredZoneLabels) {
        const w = Math.ceil(ctx.measureText(zl.label).width) + 6;
        const h = 12;
        const yTop = Math.max(2, Math.min(plotH - h - 2, zl.y - 10));
        if (reserveLabelBox(zl.x, yTop, w, h, 5)) {
          ctx.fillStyle = zl.color;
          ctx.fillText(zl.label, zl.x, yTop + 9.5);
        }
      }

      // 4) FOURTH PRIORITY: AI Candle Markers (Pin, Engulf, CRT Sweep, Spring, Absorption)
      // Deduplicate and try slight vertical offset before dropping overlapping markers
      ctx.textAlign = 'center';
      for (const m of overlays.markers) {
        const x = timeToX(m.time);
        if (x < 12 || x > plotW - 12) continue;
        const baseY = priceToY(m.price) + (m.position === 'above' ? -12 : 14);
        const w = Math.ceil(ctx.measureText(m.label).width) + 8;
        const h = 12;
        const offsets = m.position === 'above' ? [0, -13] : [0, 13];
        for (const dy of offsets) {
          const yText = baseY + dy;
          const yTop = yText - 10;
          const xLeft = x - w / 2;
          if (reserveLabelBox(xLeft, yTop, w, h, 6)) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
            ctx.fillRect(xLeft + 1, yTop, w - 2, h);
            ctx.fillStyle = m.color;
            ctx.fillText(m.label, x, yText);
            break;
          }
        }
      }
      ctx.textAlign = 'left';
    }

    ctx.restore(); // end main plot clip

    // Oscillator Pane (RSI / Custom Oscillators) pinned directly above bottom time axis
    if (hasOscillator && oscH > 30) {
      const oscTop = plotH;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, oscTop, size.width, oscH);

      ctx.strokeStyle = '#D1D5DB';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, oscTop + 0.5);
      ctx.lineTo(size.width, oscTop + 0.5);
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, oscTop, plotW, oscH);
      ctx.clip();

      const oscSeries = allSeries.filter((s) => s.pane === 'oscillator' && s.data.length > 1);
      let rsiLatest: number | null = null;
      const hasRsi = oscSeries.some((s) => s.name.toLowerCase().includes('rsi'));

      if (hasRsi) {
        [70, 50, 30].forEach((lvl) => {
          const ly = oscTop + oscH - 6 - (lvl / 100) * (oscH - 12);
          ctx.strokeStyle = lvl === 50 ? '#F3F4F6' : '#E5E7EB';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(0, ly);
          ctx.lineTo(plotW, ly);
          ctx.stroke();
          ctx.setLineDash([]);
        });
      }

      for (const ser of oscSeries) {
        const isRsi = ser.name.toLowerCase().includes('rsi');
        let minV = isRsi ? 0 : Infinity;
        let maxV = isRsi ? 100 : -Infinity;
        if (!isRsi) {
          for (const pt of ser.data) {
            if (pt.value < minV) minV = pt.value;
            if (pt.value > maxV) maxV = pt.value;
          }
          if (!Number.isFinite(minV) || maxV <= minV) {
            minV = -1;
            maxV = 1;
          }
        } else {
          rsiLatest = ser.data[ser.data.length - 1]?.value ?? null;
        }
        ctx.strokeStyle = ser.color;
        ctx.lineWidth = ser.lineWidth;
        ctx.beginPath();
        let started = false;
        for (const pt of ser.data) {
          const x = timeToX(pt.time);
          if (x < -10 || x > plotW + 10) continue;
          const y = oscTop + oscH - 6 - ((pt.value - minV) / (maxV - minV)) * (oscH - 12);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.fillStyle = '#000000';
        ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(ser.name, 8, oscTop + 13);
      }

      ctx.restore();

      // Draw sub-pane right axis labels (70 / 30 / live RSI)
      if (hasRsi) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(plotW, oscTop + 1, axisRightW, oscH - 1);
        ctx.fillStyle = '#6B7280';
        ctx.font = '500 10px "JetBrains Mono", monospace';
        const y70 = oscTop + oscH - 6 - 0.7 * (oscH - 12);
        const y30 = oscTop + oscH - 6 - 0.3 * (oscH - 12);
        ctx.fillText('70', plotW + 6, y70 + 3);
        ctx.fillText('30', plotW + 6, y30 + 3);
        if (rsiLatest !== null) {
          ctx.fillStyle = '#000000';
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillText(rsiLatest.toFixed(1), plotW + 32, oscTop + oscH / 2 + 3);
        }
      }
    }

    // Far-right Price Axis (Pure white background, crisp #000000 text)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(plotW, 0, axisRightW, plotH);
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotW + 0.5, 0);
    ctx.lineTo(plotW + 0.5, plotH + oscH);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = '500 11px "JetBrains Mono", monospace';
    for (let i = 0; i <= priceSteps; i++) {
      const y = (plotH / priceSteps) * i;
      const p = yToPrice(y);
      ctx.fillText(p.toFixed(info.decimals), plotW + 6, Math.max(12, Math.min(plotH - 4, y + 4)));
    }

    // Current Price Line + Badge + Live Candle Countdown Timer directly beneath in crisp #000000
    const lastCandle = candles[candles.length - 1];
    if (lastCandle) {
      const curY = priceToY(lastCandle.close);
      if (curY >= 0 && curY <= plotH) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, curY);
        ctx.lineTo(plotW, curY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price badge (black border, white/high-contrast or black badge)
        ctx.fillStyle = '#000000';
        ctx.fillRect(plotW + 2, curY - 10, axisRightW - 4, 19);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillText(lastCandle.close.toFixed(info.decimals), plotW + 6, curY + 3);

        // Live Candle Countdown Timer directly beneath current price badge in crisp #000000 text
        const remSec = isBacktest ? 0 : Math.max(0, lastCandle.time + tfSec - nowSec);
        const cdStr = isBacktest ? 'REPLAY' : formatCountdown(remSec);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(plotW + 2, curY + 10, axisRightW - 4, 16);
        ctx.strokeStyle = '#E5E7EB';
        ctx.strokeRect(plotW + 2, curY + 10, axisRightW - 4, 16);
        ctx.fillStyle = '#000000';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.fillText(cdStr, plotW + 8, curY + 21);
      }
    }

    // Bottom Time Axis (Crisp #000000 text)
    const timeY = plotH + oscH;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, timeY, size.width, axisBottomH);
    ctx.strokeStyle = '#E5E7EB';
    ctx.beginPath();
    ctx.moveTo(0, timeY + 0.5);
    ctx.lineTo(size.width, timeY + 0.5);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = '500 10px "JetBrains Mono", monospace';
    for (let i = visibleWindow.startIdx; i <= visibleWindow.endIdx; i += timeStepBars) {
      const c = candles[i];
      if (!c) continue;
      const x = indexToX(i);
      if (x > 24 && x < plotW - 35) {
        const label = formatTimeInTimezone(c.time * 1000, timezone, false, timeframe === '1d' || timeframe === '4h');
        ctx.fillText(label, x - 20, timeY + 17);
      }
    }
  }, [
    size,
    candles,
    comparisonCandles,
    comparisonSymbol,
    overlays,
    customSeries,
    chartStyle,
    view,
    visibleWindow,
    plotW,
    plotH,
    oscH,
    hasOscillator,
    info.decimals,
    nowSec,
    tfSec,
    timezone,
    sessionFocus,
    showAllDrawings,
    isBacktest,
    indexToX,
    timeToX,
    priceToY,
    yToPrice,
  ]);

  // ------------------------------------------------------------------
  // OVERLAY CANVAS RENDER (Manual Drawings + Draft + Crosshair + Ruler)
  // ------------------------------------------------------------------
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.width, size.height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, plotH);
    ctx.clip();

    if (showAllDrawings) {
      for (const d of drawings) {
        if (d.hidden) continue;
        drawUserObject(ctx, d, timeToX, priceToY, plotW, plotH, info.decimals, tfSec, d.id === selectedDrawingId);
      }
    }

    if (draftPoints.length > 0) {
      const previewPts = cursor ? [...draftPoints, { time: cursor.time, price: cursor.price }] : draftPoints;
      const preview: DrawingObject = {
        id: 'draft',
        symbol,
        timeframe,
        tool: activeTool,
        points: previewPts,
        color: activeTool === 'long_position' ? '#059669' : activeTool === 'short_position' ? '#DC2626' : '#000000',
        lineWidth: 1.5,
        lineStyle: 'solid',
        locked: false,
        hidden: false,
        createdAt: 0,
      };
      drawUserObject(ctx, preview, timeToX, priceToY, plotW, plotH, info.decimals, tfSec, true);
    }

    // Synced Crosshair from Multi-Chart Split View
    if (syncedCrosshairTime && !cursor) {
      const sx = timeToX(syncedCrosshairTime);
      if (sx >= 0 && sx <= plotW) {
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Active Crosshair
    if (cursor && cursor.x <= plotW && cursor.y <= plotH) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cursor.x, 0);
      ctx.lineTo(cursor.x, plotH);
      ctx.moveTo(0, cursor.y);
      ctx.lineTo(plotW, cursor.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (activeTool === 'dot') {
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Crosshair Price & Time tags on axes
    if (cursor && cursor.x <= plotW && cursor.y <= plotH) {
      ctx.fillStyle = '#374151';
      ctx.fillRect(plotW + 2, cursor.y - 9, axisRightW - 4, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillText(cursor.price.toFixed(info.decimals), plotW + 6, cursor.y + 3);

      const tStr = formatTimeInTimezone(cursor.time * 1000, timezone, false, true);
      const tw = 86;
      const tx = Math.max(2, Math.min(plotW - tw, cursor.x - tw / 2));
      ctx.fillStyle = '#374151';
      ctx.fillRect(tx, plotH + oscH + 3, tw, 20);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(tStr, tx + 6, plotH + oscH + 17);
    }
  }, [
    size,
    plotW,
    plotH,
    oscH,
    drawings,
    showAllDrawings,
    selectedDrawingId,
    draftPoints,
    cursor,
    syncedCrosshairTime,
    activeTool,
    symbol,
    timeframe,
    info.decimals,
    tfSec,
    timezone,
    timeToX,
    priceToY,
  ]);

  // ------------------------------------------------------------------
  // INTERACTIVE POINTER & WHEEL HANDLERS
  // ------------------------------------------------------------------
  const getCoords = (clientX: number, clientY: number) => {
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const commitNewDrawing = useCallback(
    (points: DrawingPoint[]) => {
      const id = `drw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const created: DrawingObject = {
        id,
        symbol,
        timeframe,
        tool: activeTool,
        points,
        color:
          activeTool === 'long_position'
            ? '#059669'
            : activeTool === 'short_position'
              ? '#DC2626'
              : activeTool === 'highlighter'
                ? '#D97706'
                : '#000000',
        lineWidth: activeTool === 'highlighter' ? 10 : 1.75,
        lineStyle: 'solid',
        locked: false,
        hidden: false,
        createdAt: Date.now(),
      };
      onAddDrawing(created);
      setSelectedDrawingId(id);
      setDraftPoints([]);
      drawDragStartRef.current = null;
      if (onResetToolToCursor) onResetToolToCursor();
    },
    [symbol, timeframe, activeTool, onAddDrawing, onResetToolToCursor]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getCoords(e.clientX, e.clientY);
    const hitR = e.pointerType === 'touch' ? 24 : 13;

    if (x > plotW || y > plotH) {
      // Axis drag zoom
      setIsDragging(true);
      dragActivatedRef.current = false;
      dragStartRef.current = {
        x,
        y,
        rightIndex: view.rightIndex,
        priceShift: view.priceShift,
        priceScaleMult: view.priceScaleMult,
      };
      return;
    }

    const snapped = applyMagnet(xToTime(x), yToPrice(y));
    setCursor({ x, y, time: snapped.time, price: snapped.price });

    // Eraser tool: accurate full-shape hit-testing
    if (activeTool === 'eraser') {
      const hit = [...drawings]
        .reverse()
        .find((d) => !d.hidden && !d.locked && hitTestDrawing(d, x, y, timeToX, priceToY, plotW, plotH, hitR));
      if (hit) {
        onDeleteDrawing(hit.id);
        if (selectedDrawingId === hit.id) setSelectedDrawingId(null);
      }
      return;
    }

    // Freehand Brush / Highlighter
    if (activeTool === 'brush' || activeTool === 'highlighter') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore capture limitation
      }
      setIsFreehand(true);
      freehandPointsRef.current = [snapped];
      setDraftPoints([snapped]);
      return;
    }

    // Multi/Single-Anchor Drawing Placement Mode (supports BOTH Tap-to-Place AND Touch-and-Drag)
    const spec = TOOL_MAP[activeTool];
    if (spec && spec.anchors > 0) {
      if (spec.anchors === 1) {
        commitNewDrawing([snapped]);
        return;
      }

      if (spec.anchors === 2 && draftPoints.length === 0) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        drawDragStartRef.current = { x, y, startPoint: snapped };
        setDraftPoints([snapped]);
        return;
      }

      const next = [...draftPoints, snapped];
      if (next.length >= spec.anchors) {
        commitNewDrawing(next);
      } else {
        setDraftPoints(next);
      }
      return;
    }

    // Cursor Mode: 1) Check selected drawing's anchor handles first so adjusting handles never pans the chart
    if (showAllDrawings && selectedDrawing && !selectedDrawing.locked) {
      const handleIdx = hitTestAnchorHandle(selectedDrawing, x, y, timeToX, priceToY, plotW, plotH, hitR);
      if (handleIdx !== null) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        draggingHandleRef.current = {
          drawing: selectedDrawing,
          pointIdx: handleIdx,
          latest: selectedDrawing,
        };
        return;
      }
    }

    // 2) Record potential drawing tap selection vs chart pan
    const hitDrawing = showAllDrawings
      ? [...drawings].reverse().find((d) => !d.hidden && hitTestDrawing(d, x, y, timeToX, priceToY, plotW, plotH, hitR))
      : undefined;
    tapCandidateRef.current = { x, y, hitDrawingId: hitDrawing?.id || null };

    // Pan chart (with 10px dead-zone threshold before activating)
    setIsDragging(true);
    dragActivatedRef.current = false;
    dragStartRef.current = {
      x,
      y,
      rightIndex: view.rightIndex,
      priceShift: view.priceShift,
      priceScaleMult: view.priceScaleMult,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Do not pan while pinching with two fingers
    if (pinchDistRef.current !== null) return;

    const { x, y } = getCoords(e.clientX, e.clientY);
    const snapped = applyMagnet(xToTime(x), yToPrice(y));
    setCursor({ x, y, time: snapped.time, price: snapped.price });
    if (onCrosshairTimeChange) onCrosshairTimeChange(snapped.time);

    // Dragging an anchor handle on the selected drawing (zero chart pan)
    if (draggingHandleRef.current) {
      const { drawing, pointIdx } = draggingHandleRef.current;
      const nextPoints = drawing.points.map((pt, idx) =>
        idx === pointIdx ? { time: snapped.time, price: snapped.price } : pt
      );
      const updated: DrawingObject = { ...drawing, points: nextPoints };
      draggingHandleRef.current.latest = updated;
      onUpdateDrawing?.(updated, false);
      return;
    }

    if (isFreehand) {
      const pt = { time: xToTime(x), price: yToPrice(y) };
      freehandPointsRef.current.push(pt);
      setDraftPoints([...freehandPointsRef.current]);
      return;
    }

    // While placing a drawing, keep preview responsive without panning chart
    if (isDrawingMode) return;

    const dragStart = dragStartRef.current;
    if (isDragging && dragStart) {
      const dx = x - dragStart.x;
      const dy = y - dragStart.y;
      const moveDist = Math.hypot(dx, dy);

      // 10px touch/pointer dead-zone threshold so taps never jump the chart
      if (!dragActivatedRef.current) {
        if (moveDist < 10) return;
        dragActivatedRef.current = true;
        tapCandidateRef.current = null;
        // Re-anchor origin after passing dead-zone for zero sudden jump
        dragStartRef.current = {
          ...dragStart,
          x,
          y,
        };
        return;
      }

      if (dragStart.x > plotW) {
        // Deliberate right-side price axis vertical zoom (damped & smooth)
        const nextScale = Math.max(0.35, Math.min(3.5, dragStart.priceScaleMult * (1 + dy * 0.0022)));
        setView((v) => ({
          ...v,
          priceScaleMult: nextScale,
        }));
      } else {
        // Horizontal pan with steady damping; lock vertical price shift unless deliberately dragging vertically
        const barDelta = (dx * 0.85) / view.barWidth;
        const maxLeftRightIndex = Math.max(0, candlesLengthRef.current - 10);
        const nextRightIndex = Math.max(-30, Math.min(maxLeftRightIndex, dragStart.rightIndex + barDelta));
        const deliberateVertical = Math.abs(dy) > Math.abs(dx) * 1.75 && Math.abs(dy) > 22;
        const priceSpan = visibleWindow.maxPrice - visibleWindow.minPrice;
        const nextPriceShift = deliberateVertical
          ? dragStart.priceShift + (dy / plotH) * priceSpan * 0.65
          : dragStart.priceShift;
        setView((v) => ({
          ...v,
          rightIndex: nextRightIndex,
          priceShift: nextPriceShift,
        }));
      }
    }
  };

  const handlePointerUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    }

    // Commit anchor handle drag adjustment to persistence
    if (draggingHandleRef.current) {
      const finalDrawing = draggingHandleRef.current.latest;
      draggingHandleRef.current = null;
      onUpdateDrawing?.(finalDrawing, true);
      return;
    }

    // Finish touch-and-drag 2-point drawing if user dragged >= 16px from start point
    if (drawDragStartRef.current && e) {
      const { x, y } = getCoords(e.clientX, e.clientY);
      const dragDist = Math.hypot(x - drawDragStartRef.current.x, y - drawDragStartRef.current.y);
      const startPt = drawDragStartRef.current.startPoint;
      drawDragStartRef.current = null;
      if (dragDist >= 16) {
        const endPt = applyMagnet(xToTime(x), yToPrice(y));
        commitNewDrawing([startPt, endPt]);
        return;
      }
      // Clean single tap (<16px): keep startPoint so user taps end point next
      return;
    }

    if (isFreehand) {
      const pts = freehandPointsRef.current;
      freehandPointsRef.current = [];
      if (pts.length > 1) {
        commitNewDrawing(pts);
      } else {
        setDraftPoints([]);
      }
      setIsFreehand(false);
      return;
    }

    // Tap selection in Cursor mode (when pointer moved < 10px)
    if (tapCandidateRef.current && !dragActivatedRef.current) {
      setSelectedDrawingId(tapCandidateRef.current.hitDrawingId);
    }
    tapCandidateRef.current = null;
    setIsDragging(false);
    dragActivatedRef.current = false;
    dragStartRef.current = null;
  };

  useEffect(() => {
    const el = overlayCanvasRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.035 : 0.965;
      setView((v) => ({
        ...v,
        barWidth: Math.max(3, Math.min(30, v.barWidth * factor)),
      }));
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Prevent 2-finger pinch from interfering during active drawing placement or handle dragging
    if (isDrawingMode || draggingHandleRef.current) return;
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchDistRef.current = dist;
      pinchAnchorDistRef.current = dist;
      pinchActivatedRef.current = false;
      tapCandidateRef.current = null;
      setIsDragging(false);
      dragActivatedRef.current = false;
      dragStartRef.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDrawingMode || draggingHandleRef.current) return;
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (pinchAnchorDistRef.current === null) {
        pinchAnchorDistRef.current = dist;
        pinchDistRef.current = dist;
        return;
      }
      if (!pinchActivatedRef.current) {
        // 10px pinch dead-zone threshold before initiating zoom
        if (Math.abs(dist - pinchAnchorDistRef.current) < 10) return;
        pinchActivatedRef.current = true;
        pinchDistRef.current = dist;
        return;
      }
      if (pinchDistRef.current !== null && pinchDistRef.current > 0) {
        const rawRatio = dist / pinchDistRef.current;
        // 68% sensitivity damping so pinch-zoom is heavy, steady, and controlled
        const dampedRatio = 1 + (rawRatio - 1) * 0.32;
        setView((v) => ({
          ...v,
          barWidth: Math.max(3, Math.min(30, v.barWidth * dampedRatio)),
        }));
      }
      pinchDistRef.current = dist;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchDistRef.current = null;
      pinchAnchorDistRef.current = null;
      pinchActivatedRef.current = false;
    }
  };

  // Clear, non-intrusive Drawing Placement Prompt text
  const placementPrompt = useMemo(() => {
    if (!isDrawingMode) return null;
    const spec = TOOL_MAP[activeTool];
    const toolLabel = lang === 'ar' ? spec?.nameAr || spec?.name || activeTool : spec?.name || activeTool;
    let stepText = '';
    if (activeTool === 'eraser') {
      stepText = t('Tap any drawing to erase', 'اضغط على أي رسم لحذفه');
    } else if (activeTool === 'brush' || activeTool === 'highlighter') {
      stepText = t('Drag on chart to draw', 'اسحب على الشارت للرسم');
    } else if (spec?.anchors === 1) {
      stepText = t('Tap chart to place', 'اضغط على الشارت للوضع');
    } else if (spec?.anchors === 2) {
      stepText =
        draftPoints.length === 0
          ? t('Tap or drag start point (1/2)', 'اضغط أو اسحب لتحديد البداية (1/2)')
          : t('Tap end point (2/2)', 'اضغط لتحديد النهاية (2/2)');
    } else if (spec && spec.anchors >= 3) {
      stepText = t(
        `Tap point (${draftPoints.length + 1}/${spec.anchors})`,
        `اضغط لتحديد النقطة (${draftPoints.length + 1}/${spec.anchors})`
      );
    }
    return { toolLabel, stepText };
  }, [isDrawingMode, activeTool, draftPoints.length, lang, t]);

  return (
    <div
      dir="ltr"
      className={`flex flex-col w-full bg-white select-none overflow-hidden ${
        expanded ? 'h-[84dvh]' : heightClass
      }`}
    >
      {/* Compact Crisp-Black Timeframe Top Bar (replaces redundant OHLC text block) */}
      <div className="h-8 px-2 sm:px-2.5 bg-white border-b border-neutral-100 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto no-scrollbar">
          {onSelectTimeframe ? (
            TIMEFRAMES.map((tf) => {
              const active = timeframe === tf.id;
              return (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => onSelectTimeframe(tf.id)}
                  className={`h-7 px-2 text-[11px] tracking-tight rounded-md whitespace-nowrap transition-colors ${
                    active
                      ? 'font-bold text-black bg-neutral-100 border border-neutral-300'
                      : 'font-semibold text-black/70 hover:text-black hover:bg-neutral-50'
                  }`}
                >
                  {tf.label}
                </button>
              );
            })
          ) : (
            <span className="text-[11px] font-bold text-black px-1">
              {symbol} · {timeframe.toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isLoadingHistory && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-600 px-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="hidden sm:inline">{t('History', 'تاريخ')}</span>
            </span>
          )}
          <button
            type="button"
            onClick={resetView}
            title={t('Reset Chart View', 'إعادة ضبط عرض الشارت')}
            className="h-6 px-2 bg-white border border-neutral-200 rounded-md text-[11px] font-medium text-black hover:bg-neutral-100 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="hidden sm:inline">{t('Reset View', 'إعادة الضبط')}</span>
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={t('Independent Chart Container Scale', 'تكبير / تصغير مساحة الشارت')}
            className="h-6 w-6 bg-white border border-neutral-200 rounded-md text-black hover:bg-neutral-100 flex items-center justify-center"
          >
            {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        onDoubleClick={() => {
          if (!isDrawingMode) resetView();
        }}
        className="relative flex-1 min-h-0 w-full bg-white overflow-hidden"
      >
        {/* Non-intrusive Drawing Placement Prompt */}
        {placementPrompt && (
          <div
            dir={dir}
            className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-black/90 text-white rounded-xl shadow-lg px-3 py-1.5 flex items-center gap-2 text-xs max-w-[calc(100%-24px)]"
          >
            <span className="font-bold whitespace-nowrap">{placementPrompt.toolLabel}:</span>
            <span className="text-neutral-200 whitespace-nowrap truncate">{placementPrompt.stepText}</span>
            <button
              type="button"
              onClick={() => {
                setDraftPoints([]);
                drawDragStartRef.current = null;
                setIsFreehand(false);
                if (onResetToolToCursor) onResetToolToCursor();
              }}
              className="px-2 py-0.5 bg-white/15 hover:bg-white/25 rounded-md text-[11px] font-semibold shrink-0"
            >
              {t('Cancel', 'إلغاء')}
            </button>
          </div>
        )}

        {/* Floating Mini Action Bar when a drawing is selected or newly created */}
        {!isDrawingMode && selectedDrawing && (
          <div
            dir={dir}
            className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur-xs border border-neutral-200 rounded-xl shadow-lg px-2 py-1 flex items-center gap-1.5 max-w-[calc(100%-16px)] overflow-x-auto no-scrollbar"
          >
            <span className="text-[11px] font-bold text-black px-1 whitespace-nowrap hidden sm:inline">
              {lang === 'ar'
                ? TOOL_MAP[selectedDrawing.tool]?.nameAr || selectedDrawing.tool
                : TOOL_MAP[selectedDrawing.tool]?.name || selectedDrawing.tool}
            </span>

            {/* Quick Color Swatches (تغيير اللون) */}
            <div className="flex items-center gap-1 px-1" aria-label={t('Change Color', 'تغيير اللون')}>
              {DRAWING_COLOR_SWATCHES.map((sw) => {
                const isCurrent = selectedDrawing.color.toLowerCase() === sw.hex.toLowerCase();
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    onClick={() => onUpdateDrawing?.({ ...selectedDrawing, color: sw.hex }, true)}
                    title={lang === 'ar' ? `تغيير اللون: ${sw.labelAr}` : `Color: ${sw.label}`}
                    className={`w-6 h-6 rounded-full border transition-transform shrink-0 flex items-center justify-center ${
                      isCurrent ? 'ring-2 ring-black ring-offset-1 scale-105 border-white' : 'border-neutral-300 hover:scale-105'
                    }`}
                    style={{ backgroundColor: sw.hex }}
                  />
                );
              })}
            </div>

            <div className="w-px h-5 bg-neutral-200 shrink-0" />

            {/* Lock / Unlock Toggle (قفل) */}
            <button
              type="button"
              onClick={() => onUpdateDrawing?.({ ...selectedDrawing, locked: !selectedDrawing.locked }, true)}
              title={selectedDrawing.locked ? t('Unlock Drawing', 'فتح القفل') : t('Lock Drawing', 'قفل الرسم')}
              className={`h-7 px-2 rounded-lg text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                selectedDrawing.locked
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {selectedDrawing.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span className="hidden xs:inline">{selectedDrawing.locked ? t('Locked', 'مقفل') : t('Lock', 'قفل')}</span>
            </button>

            {/* One-tap Delete / Erase (مسح) */}
            <button
              type="button"
              onClick={() => {
                const idToDelete = selectedDrawing.id;
                setSelectedDrawingId(null);
                onDeleteDrawing(idToDelete);
              }}
              title={t('Delete Drawing', 'مسح الرسم')}
              className="h-7 px-2 rounded-lg text-[11px] font-bold bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('Delete', 'مسح')}</span>
            </button>

            {/* Deselect (إلغاء التحديد) */}
            <button
              type="button"
              onClick={() => setSelectedDrawingId(null)}
              title={t('Deselect', 'إلغاء التحديد')}
              className="h-7 w-7 rounded-lg text-neutral-500 hover:text-black hover:bg-neutral-100 flex items-center justify-center shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <canvas ref={baseCanvasRef} className="absolute inset-0 w-full h-full" />
        <canvas
          ref={overlayCanvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => {
            if (!draggingHandleRef.current && !isFreehand && !drawDragStartRef.current) {
              handlePointerUp();
              if (!isDrawingMode) setCursor(null);
              if (onCrosshairTimeChange) onCrosshairTimeChange(null);
            }
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
        />
      </div>
    </div>
  );
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getHandleCoords(
  d: DrawingObject,
  timeToX: (t: number) => number,
  priceToY: (p: number) => number,
  plotW: number,
  plotH: number
): Array<{ x: number; y: number; pointIdx: number }> {
  if (d.points.length === 0) return [];
  if (d.tool === 'horizontal_line') {
    return [{ x: plotW * 0.5, y: priceToY(d.points[0].price), pointIdx: 0 }];
  }
  if (d.tool === 'vertical_line') {
    return [{ x: timeToX(d.points[0].time), y: plotH * 0.5, pointIdx: 0 }];
  }
  return d.points.map((p, idx) => ({ x: timeToX(p.time), y: priceToY(p.price), pointIdx: idx }));
}

function hitTestAnchorHandle(
  d: DrawingObject,
  x: number,
  y: number,
  timeToX: (t: number) => number,
  priceToY: (p: number) => number,
  plotW: number,
  plotH: number,
  hitR: number
): number | null {
  if (d.tool === 'horizontal_line' && d.points.length > 0) {
    if (Math.abs(y - priceToY(d.points[0].price)) <= hitR) return 0;
    return null;
  }
  if (d.tool === 'vertical_line' && d.points.length > 0) {
    if (Math.abs(x - timeToX(d.points[0].time)) <= hitR) return 0;
    return null;
  }
  const handles = getHandleCoords(d, timeToX, priceToY, plotW, plotH);
  let bestIdx: number | null = null;
  let bestDist = hitR;
  for (const h of handles) {
    const dist = Math.hypot(h.x - x, h.y - y);
    if (dist <= bestDist) {
      bestDist = dist;
      bestIdx = h.pointIdx;
    }
  }
  return bestIdx;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitTestDrawing(
  d: DrawingObject,
  x: number,
  y: number,
  timeToX: (t: number) => number,
  priceToY: (p: number) => number,
  plotW: number,
  plotH: number,
  hitR: number
): boolean {
  if (d.points.length === 0) return false;
  const pts = d.points.map((p) => ({ x: timeToX(p.time), y: priceToY(p.price) }));
  const p0 = pts[0];
  const p1 = pts[1] || p0;

  switch (d.tool) {
    case 'horizontal_line':
      return Math.abs(y - p0.y) <= hitR;
    case 'horizontal_ray':
      return x >= p0.x - hitR && Math.abs(y - p0.y) <= hitR;
    case 'vertical_line':
      return Math.abs(x - p0.x) <= hitR;
    case 'cross_line':
      return Math.abs(y - p0.y) <= hitR || Math.abs(x - p0.x) <= hitR;
    case 'ray':
    case 'extended_line': {
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      if (Math.abs(dx) < 1) return distToSegment(x, y, p0.x, p0.y, p1.x, p1.y) <= hitR;
      const slope = dy / dx;
      const sx = d.tool === 'extended_line' ? 0 : p0.x;
      const sy = d.tool === 'extended_line' ? p0.y - slope * p0.x : p0.y;
      const ex = dx >= 0 ? plotW : 0;
      const ey = p0.y + slope * (ex - p0.x);
      return distToSegment(x, y, sx, sy, ex, ey) <= hitR;
    }
    case 'rectangle':
    case 'date_price_range':
    case 'price_range':
    case 'date_range':
    case 'gann_box':
    case 'gann_square':
    case 'gann_square_fixed': {
      const rx = Math.min(p0.x, p1.x);
      const ry = Math.min(p0.y, p1.y);
      const rw = Math.abs(p1.x - p0.x);
      const rh = Math.abs(p1.y - p0.y);
      return x >= rx - hitR && x <= rx + rw + hitR && y >= ry - hitR && y <= ry + rh + hitR;
    }
    case 'ellipse': {
      const cx = (p0.x + p1.x) / 2;
      const cy = (p0.y + p1.y) / 2;
      const rx = Math.max(8, Math.abs(p1.x - p0.x) / 2 + hitR);
      const ry = Math.max(8, Math.abs(p1.y - p0.y) / 2 + hitR);
      return ((x - cx) * (x - cx)) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry) <= 1;
    }
    case 'fib_retracement':
    case 'fib_extension': {
      const leftX = Math.min(p0.x, p1.x);
      const rightX = Math.max(p0.x, p1.x, leftX + 140);
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618].slice(
        0,
        d.tool === 'fib_retracement' ? 7 : 9
      );
      if (distToSegment(x, y, p0.x, p0.y, p1.x, p1.y) <= hitR) return true;
      for (const lvl of levels) {
        const ly = priceToY(d.points[0].price + (d.points[1].price - d.points[0].price) * lvl);
        if (distToSegment(x, y, leftX, ly, rightX, ly) <= hitR) return true;
      }
      return false;
    }
    case 'long_position':
    case 'short_position': {
      const isLong = d.tool === 'long_position';
      const w = Math.max(80, Math.abs(p1.x - p0.x));
      const slDist = Math.abs(p1.y - p0.y) * 0.5;
      const slY = isLong ? p0.y + slDist : p0.y - slDist;
      const minY = Math.min(p0.y, p1.y, slY);
      const maxY = Math.max(p0.y, p1.y, slY);
      return x >= p0.x - hitR && x <= p0.x + w + hitR && y >= minY - hitR && y <= maxY + hitR;
    }
    case 'price_label':
    case 'callout':
    case 'balloon':
    case 'flag_marker':
      return x >= p0.x - hitR && x <= p0.x + 96 + hitR && y >= p0.y - 22 - hitR && y <= p0.y + hitR;
    default: {
      if (pts.length === 1) return Math.hypot(x - p0.x, y - p0.y) <= hitR;
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= hitR) return true;
      }
      return false;
    }
  }
}

function drawUserObject(
  ctx: CanvasRenderingContext2D,
  d: DrawingObject,
  timeToX: (t: number) => number,
  priceToY: (p: number) => number,
  plotW: number,
  plotH: number,
  decimals: number,
  tfSec: number,
  isSelected = false
): void {
  if (d.points.length === 0) return;
  ctx.save();
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = isSelected ? Math.max(2, d.lineWidth + 0.75) : d.lineWidth;
  if (d.tool === 'highlighter') {
    ctx.globalAlpha = 0.42;
  }
  if (d.lineStyle === 'dashed') ctx.setLineDash([6, 4]);
  else if (d.lineStyle === 'dotted') ctx.setLineDash([2, 3]);

  const pts = d.points.map((p) => ({ x: timeToX(p.time), y: priceToY(p.price), time: p.time, price: p.price }));
  const p0 = pts[0];
  const p1 = pts[1] || p0;

  switch (d.tool) {
    case 'horizontal_line': {
      ctx.beginPath();
      ctx.moveTo(0, p0.y);
      ctx.lineTo(plotW, p0.y);
      ctx.stroke();
      break;
    }
    case 'horizontal_ray': {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(plotW, p0.y);
      ctx.stroke();
      break;
    }
    case 'vertical_line': {
      ctx.beginPath();
      ctx.moveTo(p0.x, 0);
      ctx.lineTo(p0.x, plotH);
      ctx.stroke();
      break;
    }
    case 'cross_line': {
      ctx.beginPath();
      ctx.moveTo(0, p0.y);
      ctx.lineTo(plotW, p0.y);
      ctx.moveTo(p0.x, 0);
      ctx.lineTo(p0.x, plotH);
      ctx.stroke();
      break;
    }
    case 'ray':
    case 'extended_line': {
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      ctx.beginPath();
      if (Math.abs(dx) < 1) {
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
      } else {
        const slope = dy / dx;
        const startX = d.tool === 'extended_line' ? 0 : p0.x;
        const startY = d.tool === 'extended_line' ? p0.y - slope * p0.x : p0.y;
        const endX = dx >= 0 ? plotW : 0;
        const endY = p0.y + slope * (endX - p0.x);
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
      }
      ctx.stroke();
      break;
    }
    case 'rectangle':
    case 'date_price_range':
    case 'price_range':
    case 'date_range': {
      const rx = Math.min(p0.x, p1.x);
      const ry = Math.min(p0.y, p1.y);
      const rw = Math.abs(p1.x - p0.x);
      const rh = Math.abs(p1.y - p0.y);
      ctx.fillStyle = d.color.startsWith('#') ? hexToRgba(d.color, 0.08) : 'rgba(0, 0, 0, 0.06)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      if (d.tool !== 'rectangle') {
        const diff = p1.price - p0.price;
        const pct = ((diff / Math.max(0.00001, p0.price)) * 100).toFixed(2);
        const bars = Math.round(Math.abs(p1.time - p0.time) / tfSec);
        ctx.fillStyle = d.color;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(`${diff >= 0 ? '+' : ''}${diff.toFixed(decimals)} (${pct}%) · ${bars} bars`, rx + 6, ry + 14);
      }
      break;
    }
    case 'ellipse': {
      const cx = (p0.x + p1.x) / 2;
      const cy = (p0.y + p1.y) / 2;
      ctx.fillStyle = d.color.startsWith('#') ? hexToRgba(d.color, 0.06) : 'rgba(0, 0, 0, 0.04)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(p1.x - p0.x) / 2, Math.abs(p1.y - p0.y) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'fib_retracement':
    case 'fib_extension': {
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
      const leftX = Math.min(p0.x, p1.x);
      const rightX = Math.max(p0.x, p1.x, leftX + 140);
      levels.slice(0, d.tool === 'fib_retracement' ? 7 : 9).forEach((lvl) => {
        const price = p0.price + (p1.price - p0.price) * lvl;
        const y = priceToY(price);
        ctx.strokeStyle = lvl === 0.618 || lvl === 0.5 ? '#059669' : d.color;
        ctx.beginPath();
        ctx.moveTo(leftX, y);
        ctx.lineTo(rightX, y);
        ctx.stroke();
        ctx.fillStyle = d.color;
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.fillText(`${lvl} (${price.toFixed(decimals)})`, leftX + 4, y - 3);
      });
      break;
    }
    case 'gann_box':
    case 'gann_square':
    case 'gann_square_fixed': {
      const rx = Math.min(p0.x, p1.x);
      const ry = Math.min(p0.y, p1.y);
      const rw = Math.abs(p1.x - p0.x);
      const rh = Math.abs(p1.y - p0.y);
      ctx.strokeRect(rx, ry, rw, rh);
      [0.25, 0.5, 0.75].forEach((f) => {
        ctx.beginPath();
        ctx.moveTo(rx + rw * f, ry);
        ctx.lineTo(rx + rw * f, ry + rh);
        ctx.moveTo(rx, ry + rh * f);
        ctx.lineTo(rx + rw, ry + rh * f);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + rw, ry + rh);
      ctx.moveTo(rx, ry + rh);
      ctx.lineTo(rx + rw, ry);
      ctx.stroke();
      break;
    }
    case 'gann_fan':
    case 'fib_speed_fan': {
      [0.25, 0.5, 1, 2, 4].forEach((m) => {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p0.y + (p1.y - p0.y) * m);
        ctx.stroke();
      });
      break;
    }
    case 'long_position':
    case 'short_position': {
      const isLong = d.tool === 'long_position';
      const w = Math.max(80, Math.abs(p1.x - p0.x));
      const tpY = p1.y;
      const slDist = Math.abs(p1.y - p0.y) * 0.5;
      const slY = isLong ? p0.y + slDist : p0.y - slDist;
      ctx.fillStyle = 'rgba(5, 150, 105, 0.14)';
      ctx.fillRect(p0.x, Math.min(p0.y, tpY), w, Math.abs(tpY - p0.y));
      ctx.fillStyle = 'rgba(220, 38, 38, 0.14)';
      ctx.fillRect(p0.x, Math.min(p0.y, slY), w, Math.abs(slY - p0.y));
      ctx.strokeStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p0.x + w, p0.y);
      ctx.stroke();
      ctx.fillStyle = d.color;
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(`${isLong ? 'LONG' : 'SHORT'} · R:R 2.0`, p0.x + 6, p0.y - 4);
      break;
    }
    case 'ruler':
    case 'info_line':
    case 'trend_angle': {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      const diff = p1.price - p0.price;
      const pct = ((diff / Math.max(0.00001, p0.price)) * 100).toFixed(2);
      const bars = Math.round(Math.abs(p1.time - p0.time) / tfSec);
      const mins = Math.round((bars * tfSec) / 60);
      const angle = ((Math.atan2(p0.y - p1.y, p1.x - p0.x) * 180) / Math.PI).toFixed(1);
      ctx.fillStyle = d.color;
      ctx.fillRect(p1.x + 6, p1.y - 18, 175, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(`${diff >= 0 ? '+' : ''}${diff.toFixed(decimals)} (${pct}%) · ${bars}b/${mins}m · ${angle}°`, p1.x + 10, p1.y - 5);
      break;
    }
    case 'price_label':
    case 'callout':
    case 'balloon':
    case 'flag_marker': {
      ctx.fillStyle = d.color;
      ctx.fillRect(p0.x, p0.y - 18, 92, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText(d.text || p0.price.toFixed(decimals), p0.x + 6, p0.y - 5);
      break;
    }
    default: {
      // Multi-point lines, channels, pitchforks, Elliott waves, Harmonics, Brush, Path
      ctx.beginPath();
      pts.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      if (d.tool === 'triangle' && pts.length >= 3) ctx.closePath();
      ctx.stroke();

      if (d.tool.startsWith('elliott_') || d.tool.startsWith('harmonic_') || d.tool === 'head_shoulders') {
        const labels =
          d.tool === 'elliott_impulse'
            ? ['0', '1', '2', '3', '4', '5']
            : d.tool === 'elliott_correction'
              ? ['0', 'A', 'B', 'C']
              : ['X', 'A', 'B', 'C', 'D'];
        pts.forEach((pt, idx) => {
          ctx.fillStyle = d.color;
          ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
          ctx.fillText(labels[idx] || String(idx), pt.x - 4, pt.y - 8);
        });
      }
      break;
    }
  }

  // Draw crisp draggable control-point handles when selected (or subtle dots otherwise)
  ctx.globalAlpha = 1;
  if (d.tool !== 'brush' && d.tool !== 'highlighter') {
    const handles = getHandleCoords(d, timeToX, priceToY, plotW, plotH);
    ctx.setLineDash([]);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = isSelected ? (d.color.startsWith('#') ? d.color : '#000000') : '#000000';
    ctx.lineWidth = isSelected ? 2.2 : 1.5;
    const radius = isSelected ? 6.5 : 3;
    if (d.id !== 'draft' || isSelected) {
      handles.forEach((h) => {
        ctx.beginPath();
        ctx.arc(h.x, h.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  }

  ctx.restore();
}
