import {
  CalendarDays, CheckSquare, Cloud, HardDrive, Mail, Table2,
} from 'lucide-react'

export const GOOGLE_PRODUCT_ICONS = {
  gmail: Mail,
  calendar: CalendarDays,
  drive: HardDrive,
  sheets: Table2,
  tasks: CheckSquare,
}

export const GOOGLE_PRODUCT_ACCENTS = {
  gmail: '#ea4335',
  calendar: '#4285f4',
  drive: '#34a853',
  sheets: '#0f9d58',
  tasks: '#4285f4',
}

export function getGoogleProductIcon(product) {
  return GOOGLE_PRODUCT_ICONS[product?.icon || product?.id] || Cloud
}
