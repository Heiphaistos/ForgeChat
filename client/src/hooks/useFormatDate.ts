import { useQuery } from '@tanstack/react-query'
import { format, isToday, isYesterday } from 'date-fns'
import api from '../api/client'
import { dateLocale, t as tr } from '../i18n'

export function useFormatDate() {
  const { data: userSettings } = useQuery<Record<string, unknown>>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const timeFormat = (userSettings?.time_format as string | undefined) ?? '24h'
  const dateFormat = (userSettings?.date_format as string | undefined) ?? 'DD/MM/YYYY'

  const timeFmt = timeFormat === '12h' ? 'hh:mm a' : 'HH:mm'
  const dateFmt = dateFormat === 'MM/DD/YYYY' ? 'MM/dd/yyyy'
    : dateFormat === 'YYYY-MM-DD' ? 'yyyy-MM-dd'
    : 'dd/MM/yyyy'

  const formatShort = (dateStr: string) => {
    const d = new Date(dateStr)
    return format(d, timeFmt, { locale: dateLocale() })
  }

  const formatTs = (dateStr: string) => {
    const d = new Date(dateStr)
    if (isToday(d)) return tr('date.todayAt', { time: format(d, timeFmt, { locale: dateLocale() }) })
    if (isYesterday(d)) return tr('date.yesterdayAt', { time: format(d, timeFmt, { locale: dateLocale() }) })
    return format(d, `${dateFmt} ${timeFmt}`, { locale: dateLocale() })
  }

  const formatDate = (dateStr: string) => format(new Date(dateStr), dateFmt, { locale: dateLocale() })

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const shortDate = dateFormat === 'MM/DD/YYYY' ? 'MM/dd' : dateFormat === 'YYYY-MM-DD' ? 'yyyy-MM-dd' : 'dd/MM'
    return format(d, `${shortDate} ${timeFmt}`, { locale: dateLocale() })
  }

  return { formatTs, formatShort, formatDate, formatShortDate, timeFmt, dateFmt }
}
