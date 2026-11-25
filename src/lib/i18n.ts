import React, { createContext, useContext } from 'react';
import { AppLanguage } from '../types/trading';

export interface I18nContextValue {
  lang: AppLanguage;
  dir: 'rtl' | 'ltr';
  setLang: (lang: AppLanguage) => void;
  t: (en: string, ar: string) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  dir: 'ltr',
  setLang: () => {},
  t: (en) => en,
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function pickLang(lang: AppLanguage, en: string, ar: string): string {
  return lang === 'ar' ? ar : en;
}
