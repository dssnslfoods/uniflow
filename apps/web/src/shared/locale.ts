import i18n from './i18n'

// Dates and numbers follow the app language (th/en), never the browser's own locale.
export const appLocale = () => (i18n.language === 'en' ? 'en-GB' : 'th-TH')
