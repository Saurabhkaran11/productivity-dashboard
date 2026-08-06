import axios from 'axios'

// In local dev the API runs separately on :8000. When the frontend is served
// from the same origin (production build served by the backend), use relative URLs.
const isLocal =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)

const baseURL =
  import.meta.env.VITE_API_URL || (isLocal ? 'http://127.0.0.1:8000' : '')

const api = axios.create({
  baseURL,
  timeout: 60000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pd_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auth
export const register = (data) => api.post('/auth/register', data)
export const login = (data) => api.post('/auth/login', data)
export const getMe = (token) =>
  api.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
export const getGoogleUrl = () => api.get('/auth/google/url')
export const getSyncStatus = () => api.get('/sync/status')
export const getGoogleProducts = () => api.get('/google/products')
export const connectGoogleProduct = (productId) => api.post(`/google/products/${productId}/connect`)
export const removeGoogleProduct = (productId) => api.delete(`/google/products/${productId}`)
export const disconnectGoogle = () => api.post('/google/disconnect')

// Dashboard
export const getSummary = () => api.get('/analytics/summary')

// Spending
export const getSpending = (period = 'daily') => api.get('/spending', { params: { period } })
export const addSpending = (data) => api.post('/spending', data)
export const updateSpending = (id, data) => api.put(`/spending/${id}`, data)
export const deleteSpending = (id) => api.delete(`/spending/${id}`)

// Todos
export const getTodos = () => api.get('/todos')
export const addTodo = (data) => api.post('/todos', data)
export const updateTodo = (id, data) => api.put(`/todos/${id}`, data)
export const deleteTodo = (id) => api.delete(`/todos/${id}`)

// Work log
export const getWorkLog = () => api.get('/worklog')
export const addWorkLog = (data) => api.post('/worklog', data)
export const updateWorkLog = (id, data) => api.put(`/worklog/${id}`, data)
export const deleteWorkLog = (id) => api.delete(`/worklog/${id}`)

// Schedule
export const getSchedule = (date) => api.get('/schedule', { params: { date } })
export const addSchedule = (data) => api.post('/schedule', data)
export const updateSchedule = (id, data) => api.put(`/schedule/${id}`, data)
export const deleteSchedule = (id) => api.delete(`/schedule/${id}`)

// Exports
export const exportExcel = (dataType = 'all', period = 'all') =>
  api.get('/export/excel', { params: { data_type: dataType, period }, responseType: 'blob' })
export const exportPdf = (dataType = 'all', period = 'all') =>
  api.get('/export/pdf', { params: { data_type: dataType, period }, responseType: 'blob' })

// Google sync
export const syncSheets = (dataType = 'all', period = 'monthly') =>
  api.post('/sync/sheets', null, { params: { data_type: dataType, period } })
export const syncDrive = (period = 'monthly') =>
  api.post('/sync/drive', null, { params: { period } })

// Google data
export const listGmail = (q = '', max = 20) =>
  api.get('/google/gmail/list', { params: { q, max } })
export const readGmail = (id) => api.get(`/google/gmail/read/${id}`)
export const listDrive = (q = '', max = 100) =>
  api.get('/google/drive/list', { params: { q, max } })
export const listSheets = (max = 100) => api.get('/google/sheets/list', { params: { max } })
export const listCalendar = (max = 20) => api.get('/google/calendar/list', { params: { max } })
export const createGoogleCalendarEvent = (data) => api.post('/google/calendar/events', data)
export const listGoogleTasks = (max = 100) => api.get('/google/tasks', { params: { max } })
export const addGoogleTask = (data) => api.post('/google/tasks', data)
export const updateGoogleTask = (taskListId, taskId, completed) =>
  api.patch(`/google/tasks/${taskListId}/${taskId}`, { completed })

// Email
export const sendReportEmail = (period = 'daily') =>
  api.post('/notify/report', null, { params: { period } })
export const sendTestEmail = () => api.post('/notify/test')
export const saveEmailSettings = (data) =>
  api.put('/settings/email', data)
export const getEmailSettings = () => api.get('/settings/email')

export default api
