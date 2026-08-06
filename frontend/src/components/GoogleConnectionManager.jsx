import React, { useCallback, useEffect, useState } from 'react'
import {
  CalendarDays, CheckCircle2, CheckSquare, Cloud, HardDrive, Loader2,
  Mail, Table2, Unplug,
} from 'lucide-react'
import {
  connectGoogleProduct, disconnectGoogle, getGoogleProducts, removeGoogleProduct,
} from '../utils/api'

const ICONS = {
  gmail: Mail,
  calendar: CalendarDays,
  drive: HardDrive,
  sheets: Table2,
  tasks: CheckSquare,
}

export default function GoogleConnectionManager({ onProductsChange }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await getGoogleProducts()
      setData(response.data)
      onProductsChange?.(response.data.products.filter((item) => item.enabled).map((item) => item.id))
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load your Google connections.')
    }
  }, [onProductsChange])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const refreshAfterGoogle = () => window.setTimeout(load, 700)
    window.addEventListener('focus', refreshAfterGoogle)
    return () => window.removeEventListener('focus', refreshAfterGoogle)
  }, [load])

  async function connect(productId) {
    setBusy(productId)
    setError('')
    setNotice('')
    try {
      const response = await connectGoogleProduct(productId)
      // Keep OAuth in the current tab. Popups can be blocked or detached from
      // their opener, making a successful authorization look unsuccessful.
      window.location.assign(response.data.url)
      return
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not start the Google connection.')
    }
    setBusy('')
  }

  async function remove(productId) {
    if (!window.confirm('Remove this Google product from MyLife? You can add it again at any time.')) return
    setBusy(productId)
    setError('')
    try {
      await removeGoogleProduct(productId)
      setNotice('Product removed from MyLife.')
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not remove this Google product.')
    }
    setBusy('')
  }

  async function disconnect() {
    if (!window.confirm('Disconnect your Google account and remove every connected product?')) return
    setBusy('disconnect')
    setError('')
    try {
      await disconnectGoogle()
      setNotice('Google account disconnected.')
      await load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not disconnect Google.')
    }
    setBusy('')
  }

  return (
    <section className="google-product-manager" aria-label="Google product connections">
      <div className="google-product-manager-heading">
        <div>
          <p className="section-eyebrow">Connected workspace</p>
          <h2>Choose your Google tools</h2>
          <p>Only the products you add can access your Google data.</p>
        </div>
        {data?.google_account_linked && (
          <button className="btn btn-outline" onClick={disconnect} disabled={busy === 'disconnect'}>
            {busy === 'disconnect' ? <Loader2 size={16} className="spin" /> : <Unplug size={16} />}
            Disconnect Google
          </button>
        )}
      </div>

      {!data?.configured && (
        <div className="notice">
          <strong>Google is not configured on this server yet.</strong>
          <p>Add the Google client ID, client secret, and callback URL as Render environment variables, then redeploy.</p>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success"><CheckCircle2 size={17} /> {notice}</div>}

      <div className="google-product-grid">
        {(data?.products || []).map((product) => {
          const Icon = ICONS[product.id] || Cloud
          const isBusy = busy === product.id
          return (
            <article className={`google-product-card ${product.enabled ? 'is-connected' : ''}`} key={product.id}>
              <span className="google-product-icon"><Icon size={20} /></span>
              <div className="google-product-copy">
                <h3>{product.label}</h3>
                <p>{product.description}</p>
              </div>
              {product.enabled ? (
                <button className="btn btn-outline" onClick={() => remove(product.id)} disabled={isBusy}>
                  {isBusy ? <Loader2 size={15} className="spin" /> : <Unplug size={15} />}
                  Remove
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => connect(product.id)} disabled={!data.configured || isBusy}>
                  {isBusy ? <Loader2 size={15} className="spin" /> : <Cloud size={15} />}
                  Add
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
