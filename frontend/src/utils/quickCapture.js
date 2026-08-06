export const EXPENSE_CATEGORIES = [
  'Food', 'Transport', 'Shopping', 'Entertainment', 'Bills', 'Health', 'Education', 'Other',
]

export function todayIso() {
  return new Date().toISOString().split('T')[0]
}

function dateOffset(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().split('T')[0]
}

function takeDate(text) {
  let remaining = text
  let date = todayIso()
  if (/\btomorrow\b/i.test(remaining)) {
    date = dateOffset(1)
    remaining = remaining.replace(/\btomorrow\b/gi, '')
  } else if (/\btoday\b/i.test(remaining)) {
    remaining = remaining.replace(/\btoday\b/gi, '')
  } else {
    const match = remaining.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    if (match) {
      date = match[1]
      remaining = remaining.replace(match[0], '')
    }
  }
  return { date, text: remaining.replace(/\s+/g, ' ').trim() }
}

function cleanCommand(text, pattern) {
  return text.replace(pattern, '').replace(/\s+/g, ' ').trim()
}

export function parseQuickSpending(input) {
  const amountMatch = input.match(/(?:\$|(?:spent|spend|expense|paid)\s*\$?)(\d+(?:\.\d{1,2})?)/i)
    || input.match(/^\s*(\d+(?:\.\d{1,2})?)\b/)

  if (!amountMatch) throw new Error('Start with an amount, for example “$24 lunch”.')

  const amount = Number(amountMatch[1])
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.')

  let description = input.replace(amountMatch[0], '')
  description = cleanCommand(description, /^(?:on|for)?\s*/i)
  const category = EXPENSE_CATEGORIES.find((item) => new RegExp(`\\b${item}\\b`, 'i').test(description)) || 'Other'
  if (category !== 'Other') description = description.replace(new RegExp(`\\b${category}\\b`, 'gi'), '')
  const dated = takeDate(description)

  return {
    amount,
    category,
    description: dated.text || null,
    date: dated.date,
  }
}

export function parseQuickTodo(input) {
  let text = cleanCommand(input, /^\s*(?:todo|task)\s*:?\s*/i)
  const priorityMatch = text.match(/#(high|medium|low)\b|\b(high|medium|low)\s+priority\b/i)
  const priority = (priorityMatch?.[1] || priorityMatch?.[2] || 'medium').toLowerCase()
  if (priorityMatch) text = text.replace(priorityMatch[0], '')
  const dated = takeDate(text)
  const title = dated.text.replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('Tell me what you need to do, for example “Finish report tomorrow #high”.')

  return { title, priority, due_date: dated.date === todayIso() && !/\btoday\b/i.test(input) ? null : dated.date }
}

export function parseQuickWork(input) {
  let text = cleanCommand(input, /^\s*(?:work|log)\s*:?\s*/i)
  const hoursMatch = text.match(/\b(\d+(?:\.\d+)?)\s*h(?:ours?)?\b/i)
  if (!hoursMatch) throw new Error('Include a duration, for example “1.5h design review”.')
  const hours = Number(hoursMatch[1])
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('Use a duration between 0 and 24 hours.')
  text = text.replace(hoursMatch[0], '')
  const dated = takeDate(text)
  const task = dated.text
  if (!task) throw new Error('Tell me what you worked on after the duration.')
  return { task, hours, project: null, notes: null, date: dated.date }
}

function nextHour() {
  const date = new Date()
  date.setMinutes(0, 0, 0)
  date.setHours(date.getHours() + 1)
  return `${String(date.getHours()).padStart(2, '0')}:00`
}

function addHour(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return `${String((hours + 1) % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function parseQuickSchedule(input) {
  let text = cleanCommand(input, /^\s*(?:schedule|event|meeting|meet)\s*:?\s*/i)
  const timeMatch = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  let startTime = nextHour()

  if (timeMatch) {
    let hour = Number(timeMatch[1])
    const minutes = Number(timeMatch[2] || 0)
    const suffix = timeMatch[3].toLowerCase()
    if (suffix === 'pm' && hour !== 12) hour += 12
    if (suffix === 'am' && hour === 12) hour = 0
    startTime = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    text = text.replace(timeMatch[0], '')
  }

  const dated = takeDate(text)
  const title = dated.text.replace(/^\bat\b/i, '').trim()
  if (!title) throw new Error('Name the event, for example “Team sync at 2pm”.')

  return {
    title,
    date: dated.date,
    start_time: startTime,
    end_time: addHour(startTime),
    recurring: false,
    notes: null,
  }
}

export function classifyQuickCapture(input) {
  const text = input.trim()
  if (/^\s*(?:work\b|log\b)|\b\d+(?:\.\d+)?\s*h(?:ours?)?\b/i.test(text)) return 'work'
  if (/^\s*(?:schedule\b|event\b|meeting\b|meet\b)/i.test(text)) return 'schedule'
  if (/^\s*(?:\$|\d+(?:\.\d{1,2})?\b|spent\b|spend\b|expense\b|paid\b)/i.test(text)) return 'spending'
  return 'todo'
}
