import { createContext } from 'react';

// The language the layout resolved for this request (cookie, else
// Accept-Language), set by VariableContextComponent. useT renders it on the
// server, where i18next has no browser to detect from.
export const LanguageContext = createContext('');
