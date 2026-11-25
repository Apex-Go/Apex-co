export interface MarketSessionInfo {
  id: 'sydney' | 'tokyo' | 'london' | 'new_york' | 'overlap';
  name: string;
  nameAr: string;
  isOpen: boolean;
  statusText: string;
  countdownLabel: string;
  utcOpenHour: number;
  utcCloseHour: number;
}

export const CURATED_TIMEZONES = [
  { id: 'Africa/Cairo', label: 'Cairo (EET/EEST)', city: 'Cairo' },
  { id: 'Asia/Riyadh', label: 'Riyadh (AST)', city: 'Riyadh' },
  { id: 'Asia/Dubai', label: 'Dubai (GST)', city: 'Dubai' },
  { id: 'Europe/London', label: 'London (GMT/BST)', city: 'London' },
  { id: 'America/New_York', label: 'New York (EST/EDT)', city: 'New York' },
  { id: 'Asia/Tokyo', label: 'Tokyo (JST)', city: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)', city: 'Sydney' },
  { id: 'UTC', label: 'UTC (Coordinated Universal)', city: 'UTC' },
];

export function getAllIanaTimezones(): string[] {
  try {
    const intlAny = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof intlAny.supportedValuesOf === 'function') {
      return intlAny.supportedValuesOf('timeZone');
    }
  } catch {
    // Fallback below
  }
  return CURATED_TIMEZONES.map((t) => t.id);
}

export function detectDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatTimeInTimezone(
  unixMs: number,
  timeZone: string,
  includeSeconds = true,
  includeDate = false
): string {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      ...(includeDate ? { month: 'short', day: '2-digit' } : {}),
    };
    return new Intl.DateTimeFormat('en-GB', opts).format(new Date(unixMs));
  } catch {
    return new Date(unixMs).toISOString().slice(11, 19);
  }
}

export function getTimezoneOffsetLabel(timeZone: string, nowMs = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date(nowMs));
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function getGlobalMarketSessions(nowMs = Date.now()): MarketSessionInfo[] {
  const d = new Date(nowMs);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const utcSecondsOfDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  const isWeekend = day === 6 || (day === 0 && d.getUTCHours() < 22) || (day === 5 && d.getUTCHours() >= 22);

  const calcWindow = (openH: number, closeH: number) => {
    const openSec = openH * 3600;
    const closeSec = closeH * 3600;
    let isOpen = false;
    let remaining = 0;

    if (openH < closeH) {
      isOpen = !isWeekend && utcSecondsOfDay >= openSec && utcSecondsOfDay < closeSec;
      if (isOpen) {
        remaining = closeSec - utcSecondsOfDay;
      } else {
        remaining = utcSecondsOfDay < openSec ? openSec - utcSecondsOfDay : 86400 - utcSecondsOfDay + openSec;
      }
    } else {
      // Overnight session (e.g. Sydney 22:00 - 07:00 UTC)
      isOpen = !isWeekend && (utcSecondsOfDay >= openSec || utcSecondsOfDay < closeSec);
      if (isOpen) {
        remaining = utcSecondsOfDay >= openSec ? 86400 - utcSecondsOfDay + closeSec : closeSec - utcSecondsOfDay;
      } else {
        remaining = openSec - utcSecondsOfDay;
      }
    }
    return { isOpen, remaining };
  };

  const sydney = calcWindow(22, 7);
  const tokyo = calcWindow(0, 9);
  const london = calcWindow(7, 16);
  const newYork = calcWindow(12, 21);
  const overlap = calcWindow(12, 16);

  return [
    {
      id: 'sydney',
      name: 'Sydney',
      nameAr: 'سيدني',
      isOpen: sydney.isOpen,
      statusText: sydney.isOpen ? 'Open' : 'Closed',
      countdownLabel: `${sydney.isOpen ? 'Closes' : 'Opens'} ${formatCountdown(sydney.remaining)}`,
      utcOpenHour: 22,
      utcCloseHour: 7,
    },
    {
      id: 'tokyo',
      name: 'Tokyo',
      nameAr: 'طوكيو',
      isOpen: tokyo.isOpen,
      statusText: tokyo.isOpen ? 'Open' : 'Closed',
      countdownLabel: `${tokyo.isOpen ? 'Closes' : 'Opens'} ${formatCountdown(tokyo.remaining)}`,
      utcOpenHour: 0,
      utcCloseHour: 9,
    },
    {
      id: 'london',
      name: 'London',
      nameAr: 'لندن',
      isOpen: london.isOpen,
      statusText: london.isOpen ? 'Open' : 'Closed',
      countdownLabel: `${london.isOpen ? 'Closes' : 'Opens'} ${formatCountdown(london.remaining)}`,
      utcOpenHour: 7,
      utcCloseHour: 16,
    },
    {
      id: 'new_york',
      name: 'New York',
      nameAr: 'نيويورك',
      isOpen: newYork.isOpen,
      statusText: newYork.isOpen ? 'Open' : 'Closed',
      countdownLabel: `${newYork.isOpen ? 'Closes' : 'Opens'} ${formatCountdown(newYork.remaining)}`,
      utcOpenHour: 12,
      utcCloseHour: 21,
    },
    {
      id: 'overlap',
      name: 'LDN–NY Overlap',
      nameAr: 'تداخل لندن-نيويورك',
      isOpen: overlap.isOpen,
      statusText: overlap.isOpen ? 'Peak Liquidity' : 'Standby',
      countdownLabel: `${overlap.isOpen ? 'Ends' : 'Starts'} ${formatCountdown(overlap.remaining)}`,
      utcOpenHour: 12,
      utcCloseHour: 16,
    },
  ];
}
