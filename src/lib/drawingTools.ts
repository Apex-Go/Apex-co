import { DrawingToolCategory, DrawingToolId } from '../types/trading';

export interface DrawingToolSpec {
  id: DrawingToolId;
  category: DrawingToolCategory;
  name: string;
  nameAr: string;
  anchors: number; // 1 = single click, 2 = 2 points, 3 = 3 points, 4 = 4 points, 5 = 5 points, 0 = cursor/freehand
  shortcut?: string;
}

export const DRAWING_CATEGORIES: { id: DrawingToolCategory; label: string; labelAr: string }[] = [
  { id: 'cursors', label: 'Cursors & Eraser', labelAr: 'المؤشر والممحاة' },
  { id: 'lines', label: 'Trend & Channels', labelAr: 'خطوط الاتجاه والقنوات' },
  { id: 'geometric', label: 'Shapes & Annotations', labelAr: 'الأشكال والتعليقات' },
  { id: 'fib_gann', label: 'Fibonacci & Gann', labelAr: 'فيبوناتشي وجان' },
  { id: 'elliott_harmonic', label: 'Elliott & Harmonics', labelAr: 'إليوت والهارمونيك' },
  { id: 'position_measure', label: 'Positions & Measure', labelAr: 'الصفقات والقياس' },
];

export const DRAWING_TOOLS: DrawingToolSpec[] = [
  // Cursors & Eraser
  { id: 'crosshair', category: 'cursors', name: 'Crosshair', nameAr: 'تقاطع', anchors: 0, shortcut: 'Alt+C' },
  { id: 'dot', category: 'cursors', name: 'Dot Cursor', nameAr: 'نقطة', anchors: 0 },
  { id: 'arrow_cursor', category: 'cursors', name: 'Arrow Cursor', nameAr: 'سهم', anchors: 0 },
  { id: 'eraser', category: 'cursors', name: 'Eraser', nameAr: 'ممحاة', anchors: 0 },

  // Trend & Line Tools
  { id: 'trendline', category: 'lines', name: 'Trend Line', nameAr: 'خط اتجاه', anchors: 2, shortcut: 'Alt+T' },
  { id: 'ray', category: 'lines', name: 'Ray', nameAr: 'شعاع', anchors: 2 },
  { id: 'info_line', category: 'lines', name: 'Info Line', nameAr: 'خط معلومات', anchors: 2 },
  { id: 'extended_line', category: 'lines', name: 'Extended Line', nameAr: 'خط ممتد', anchors: 2 },
  { id: 'trend_angle', category: 'lines', name: 'Trend Angle', nameAr: 'زاوية اتجاه', anchors: 2 },
  { id: 'horizontal_line', category: 'lines', name: 'Horizontal Line', nameAr: 'خط أفقي', anchors: 1, shortcut: 'Alt+H' },
  { id: 'horizontal_ray', category: 'lines', name: 'Horizontal Ray', nameAr: 'شعاع أفقي', anchors: 1, shortcut: 'Alt+J' },
  { id: 'vertical_line', category: 'lines', name: 'Vertical Line', nameAr: 'خط عمودي', anchors: 1, shortcut: 'Alt+V' },
  { id: 'cross_line', category: 'lines', name: 'Cross Line', nameAr: 'خط متقاطع', anchors: 1 },
  { id: 'parallel_channel', category: 'lines', name: 'Parallel Channel', nameAr: 'قناة متوازية', anchors: 3 },
  { id: 'regression_trend', category: 'lines', name: 'Regression Trend', nameAr: 'اتجاه الانحدار', anchors: 2 },
  { id: 'flat_channel', category: 'lines', name: 'Flat Top/Bottom Channel', nameAr: 'قناة مسطحة', anchors: 3 },
  { id: 'pitchfork', category: 'lines', name: 'Andrews Pitchfork', nameAr: 'شوكة أندروز', anchors: 3 },
  { id: 'schiff_pitchfork', category: 'lines', name: 'Schiff Pitchfork', nameAr: 'شوكة شيف', anchors: 3 },
  { id: 'mod_schiff_pitchfork', category: 'lines', name: 'Modified Schiff Pitchfork', nameAr: 'شوكة شيف المعدلة', anchors: 3 },
  { id: 'inside_pitchfork', category: 'lines', name: 'Inside Pitchfork', nameAr: 'شوكة داخلية', anchors: 3 },

  // Geometric & Annotation Tools
  { id: 'rectangle', category: 'geometric', name: 'Rectangle', nameAr: 'مستطيل', anchors: 2, shortcut: 'Alt+R' },
  { id: 'rotated_rectangle', category: 'geometric', name: 'Rotated Rectangle', nameAr: 'مستطيل مائل', anchors: 3 },
  { id: 'triangle', category: 'geometric', name: 'Triangle', nameAr: 'مثلث', anchors: 3 },
  { id: 'ellipse', category: 'geometric', name: 'Circle / Ellipse', nameAr: 'دائرة / بيضاوي', anchors: 2 },
  { id: 'arc', category: 'geometric', name: 'Arc', nameAr: 'قوس', anchors: 3 },
  { id: 'curve', category: 'geometric', name: 'Curve', nameAr: 'منحنى', anchors: 3 },
  { id: 'double_curve', category: 'geometric', name: 'Double Curve', nameAr: 'منحنى مزدوج', anchors: 4 },
  { id: 'polyline', category: 'geometric', name: 'Polyline', nameAr: 'متعدد الخطوط', anchors: 4 },
  { id: 'path', category: 'geometric', name: 'Path', nameAr: 'مسار', anchors: 4 },
  { id: 'brush', category: 'geometric', name: 'Brush', nameAr: 'فرشاة', anchors: 0 },
  { id: 'highlighter', category: 'geometric', name: 'Highlighter', nameAr: 'قلم تمييز', anchors: 0 },
  { id: 'callout', category: 'geometric', name: 'Callout', nameAr: 'ملاحظة نصية', anchors: 2 },
  { id: 'balloon', category: 'geometric', name: 'Comment Balloon', nameAr: 'بالون تعليق', anchors: 1 },
  { id: 'price_label', category: 'geometric', name: 'Price Label', nameAr: 'ملصق السعر', anchors: 1 },
  { id: 'flag_marker', category: 'geometric', name: 'Flag / Signpost / Arrow', nameAr: 'علم / إشارة', anchors: 1 },

  // Fibonacci & Gann Tools
  { id: 'fib_retracement', category: 'fib_gann', name: 'Fib Retracement', nameAr: 'تصحيح فيبوناتشي', anchors: 2, shortcut: 'Alt+F' },
  { id: 'fib_extension', category: 'fib_gann', name: 'Trend-Based Fib Extension', nameAr: 'امتداد فيبوناتشي', anchors: 3 },
  { id: 'fib_channel', category: 'fib_gann', name: 'Fib Channel', nameAr: 'قناة فيبوناتشي', anchors: 3 },
  { id: 'fib_time_zones', category: 'fib_gann', name: 'Fib Time Zones', nameAr: 'المناطق الزمنية فيبوناتشي', anchors: 2 },
  { id: 'fib_speed_arcs', category: 'fib_gann', name: 'Fib Speed Resistance Arcs', nameAr: 'أقواس مقاومة فيبوناتشي', anchors: 2 },
  { id: 'fib_trend_time', category: 'fib_gann', name: 'Trend-Based Fib Time', nameAr: 'زمن فيبوناتشي الاتجاهي', anchors: 3 },
  { id: 'fib_circles', category: 'fib_gann', name: 'Fib Circles', nameAr: 'دوائر فيبوناتشي', anchors: 2 },
  { id: 'fib_spiral', category: 'fib_gann', name: 'Fib Spiral', nameAr: 'حلزون فيبوناتشي', anchors: 2 },
  { id: 'fib_speed_fan', category: 'fib_gann', name: 'Fib Speed Resistance Fan', nameAr: 'مروحة فيبوناتشي', anchors: 2 },
  { id: 'fib_wedge', category: 'fib_gann', name: 'Fib Wedge', nameAr: 'وتد فيبوناتشي', anchors: 3 },
  { id: 'pitchfan', category: 'fib_gann', name: 'Pitchfan', nameAr: 'مروحة بيتشفان', anchors: 3 },
  { id: 'gann_box', category: 'fib_gann', name: 'Gann Box', nameAr: 'صندوق جان', anchors: 2 },
  { id: 'gann_square', category: 'fib_gann', name: 'Gann Square', nameAr: 'مربع جان', anchors: 2 },
  { id: 'gann_square_fixed', category: 'fib_gann', name: 'Gann Square Fixed', nameAr: 'مربع جان ثابت', anchors: 2 },
  { id: 'gann_fan', category: 'fib_gann', name: 'Gann Fan', nameAr: 'مروحة جان', anchors: 2 },

  // Elliott & Harmonic Tools
  { id: 'elliott_impulse', category: 'elliott_harmonic', name: 'Elliott Impulse (1-2-3-4-5)', nameAr: 'موجة إليوت دافعة 1-5', anchors: 6 },
  { id: 'elliott_correction', category: 'elliott_harmonic', name: 'Elliott Correction (A-B-C)', nameAr: 'موجة إليوت تصحيحية A-B-C', anchors: 4 },
  { id: 'elliott_triangle', category: 'elliott_harmonic', name: 'Elliott Triangle (A-B-C-D-E)', nameAr: 'مثلث إليوت', anchors: 6 },
  { id: 'elliott_double_combo', category: 'elliott_harmonic', name: 'Elliott Double Combo (W-X-Y)', nameAr: 'تصحيح مزدوج W-X-Y', anchors: 4 },
  { id: 'elliott_triple_combo', category: 'elliott_harmonic', name: 'Elliott Triple Combo (W-X-Y-X-Z)', nameAr: 'تصحيح ثلاثي W-X-Y-X-Z', anchors: 6 },
  { id: 'harmonic_xabcd', category: 'elliott_harmonic', name: 'XABCD Harmonic Pattern', nameAr: 'نموذج هارمونيك XABCD', anchors: 5 },
  { id: 'harmonic_cypher', category: 'elliott_harmonic', name: 'Cypher Pattern', nameAr: 'نموذج سايفر', anchors: 5 },
  { id: 'head_shoulders', category: 'elliott_harmonic', name: 'Head & Shoulders', nameAr: 'الرأس والكتفين', anchors: 7 },
  { id: 'harmonic_abcd', category: 'elliott_harmonic', name: 'ABCD Pattern', nameAr: 'نموذج ABCD', anchors: 4 },

  // Position, Forecast & Measurement
  { id: 'long_position', category: 'position_measure', name: 'Long Position', nameAr: 'صفقة شراء (Long)', anchors: 2 },
  { id: 'short_position', category: 'position_measure', name: 'Short Position', nameAr: 'صفقة بيع (Short)', anchors: 2 },
  { id: 'forecast', category: 'position_measure', name: 'Forecast / Price Projection', nameAr: 'توقع السعر', anchors: 2 },
  { id: 'bars_pattern', category: 'position_measure', name: 'Bars Pattern', nameAr: 'نسخ نمط الشموع', anchors: 2 },
  { id: 'ghost_feed', category: 'position_measure', name: 'Ghost Feed', nameAr: 'موجة شبحية متوقعة', anchors: 2 },
  { id: 'price_range', category: 'position_measure', name: 'Price Range', nameAr: 'نطاق السعر', anchors: 2 },
  { id: 'date_range', category: 'position_measure', name: 'Date Range', nameAr: 'نطاق الزمن', anchors: 2 },
  { id: 'date_price_range', category: 'position_measure', name: 'Date & Price Range', nameAr: 'نطاق السعر والزمن', anchors: 2 },
  { id: 'ruler', category: 'position_measure', name: 'Price / Date Ruler', nameAr: 'مسطرة القياس', anchors: 2, shortcut: 'Shift+Click' },
];

export const TOOL_MAP: Record<DrawingToolId, DrawingToolSpec> = Object.fromEntries(
  DRAWING_TOOLS.map((t) => [t.id, t])
) as Record<DrawingToolId, DrawingToolSpec>;
