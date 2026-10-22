import { en, TranslationCatalog } from './catalogs/en.js';
import { es } from './catalogs/es.js';

export type SupportedLocale = 'en' | 'es';

const CATALOGS: Record<SupportedLocale, TranslationCatalog> = {
  en,
  es,
};

export class I18nManager {
  private currentLocale: SupportedLocale = 'en';

  setLocale(locale: SupportedLocale): void {
    if (CATALOGS[locale]) {
      this.currentLocale = locale;
    }
  }

  getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  t(): TranslationCatalog {
    return CATALOGS[this.currentLocale] || en;
  }

  formatTimestamp(isoDate: string, options?: Intl.DateTimeFormatOptions): string {
    const date = new Date(isoDate);
    const defaultOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    };
    return new Intl.DateTimeFormat(this.currentLocale, defaultOptions).format(date);
  }

  formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return new Intl.DateTimeFormat(this.currentLocale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }
  isRTL(locale?: string): boolean {
    const loc = locale || this.currentLocale;
    return ['ar', 'he', 'fa', 'ur'].includes(loc.toLowerCase().split('-')[0]);
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.currentLocale, options).format(value);
  }

  formatCurrency(value: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat(this.currentLocale, {
      style: 'currency',
      currency,
    }).format(value);
  }

  formatRelativeTime(isoDate: string): string {
    const target = new Date(isoDate).getTime();
    const now = Date.now();
    const diffSeconds = Math.round((target - now) / 1000);

    const rtf = new Intl.RelativeTimeFormat(this.currentLocale, { numeric: 'auto' });

    if (Math.abs(diffSeconds) < 60) {
      return rtf.format(diffSeconds, 'second');
    }
    const diffMinutes = Math.round(diffSeconds / 60);
    if (Math.abs(diffMinutes) < 60) {
      return rtf.format(diffMinutes, 'minute');
    }
    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) {
      return rtf.format(diffHours, 'hour');
    }
    const diffDays = Math.round(diffHours / 24);
    return rtf.format(diffDays, 'day');
  }
}

export const i18n = new I18nManager();
