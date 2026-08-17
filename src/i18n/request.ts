import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import {
  LOCALE_COOKIE,
  resolveLocale,
} from './config';

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = resolveLocale(
    cookieLocale,
    process.env.NEXT_PUBLIC_APP_LOCALE,
  );

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
