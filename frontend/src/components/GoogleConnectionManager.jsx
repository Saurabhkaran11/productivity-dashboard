import React, { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2, Cloud, Loader2, Unplug,
} from 'lucide-react'
import {
  connectGoogleProduct, disconnectGoogle, getGoogleProducts, removeGoogleProduct,
} from '../utils/api'
import { getGoogleProductIcon, GOOGLE_PRODUCT_ACCENTS } from '../constants/googleProducts'

export default function GoogleConnectionManager({ onProductsChange }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingConnection, setPendingConnection] = useState(null)
  const connectedCount = data?.products?.filter((product) => product.enabled).length || 0
  const productCount = data?.products?.length || 0

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
    setPendingConnection(null)
    try {
      const response = await connectGoogleProduct(productId)
      const product = data?.products?.find((item) => item.id === productId)
      // A regular same-tab link is more dependable than a programmatic popup
      // or redirect in browsers that suppress navigation after an async call.
      setPendingConnection({
        productId,
        label: product?.label || 'Google tool',
        url: response.data.url,
      })
      setNotice(`Ready to connect ${product?.label || 'your Google tool'}. Use Continue with Google on this card to approve access.`)
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
          <h2>Your Google tool catalog</h2>
          <p>Choose only the tools you want in your dashboard. You can remove any of them later.</p>
        </div>
        <div className="google-product-heading-actions">
          {data && <span className="google-tool-count">{connectedCount} of {productCount} added</span>}
          {data?.google_account_linked && (
            <button className="btn btn-outline" onClick={disconnect} disabled={busy === 'disconnect'}>
              {busy === 'disconnect' ? <Loader2 size={16} className="spin" /> : <Unplug size={16} />}
              Disconnect Google
            </button>
          )}
        </div>
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
          const Icon = getGoogleProductIcon(product)
          const isBusy = busy === product.id
          const awaitingApproval = pendingConnection?.productId === product.id
          const accent = GOOGLE_PRODUCT_ACCENTS[product.icon || product.id]
          return (
            <article className={`google-product-card ${product.enabled ? 'is-connected' : ''}`} key={product.id}>
              <span className="google-product-icon" style={{ '--product-accent': accent }}><Icon size={20} /></span>
              <div className="google-product-copy">
                <div className="google-product-title-row">
                  <h3>{product.label}</h3>
                  <span className={`google-product-state ${product.enabled ? 'is-added' : ''}`}>
                    {product.enabled ? 'Added' : 'Optional'}
                  </span>
                </div>
                <p>{product.description}</p>
                <div className="google-product-meta">
                  <span>{product.category}</span>
                  <span>Requires {product.api_name}</span>
                </div>
              </div>
              {product.enabled ? (
                <button className="btn btn-outline" onClick={() => remove(product.id)} disabled={isBusy}>
                  {isBusy ? <Loader2 size={15} className="spin" /> : <Unplug size={15} />}
                  Remove
                </button>
              ) : awaitingApproval ? (
                <div className="google-product-connect-actions">
                  <a className="btn btn-primary" href={pendingConnection.url}>Continue with Google</a>
                  <button className="btn btn-outline" onClick={() => setPendingConnection(null)}>Cancel</button>
                </div>
              ) : (
                <button className="btn btn-primary" onClick={() => connect(product.id)} disabled={!data.configured || isBusy}>
                  {isBusy ? <Loader2 size={15} className="spin" /> : <Cloud size={15} />}
                  Add tool
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
