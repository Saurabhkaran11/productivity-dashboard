import { useCallback, useEffect, useRef, useState } from 'react'

// Whether the browser supports speech recognition (webkitSpeechRecognition)
export function supportsVoiceInput() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

// Whether the browser supports speech synthesis
export function supportsSpeech() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export default function useVoice({ onCommand, onSpeak }) {
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)
  const onCommandRef = useRef(onCommand)
  onCommandRef.current = onCommand

  // --- Text to speech ---
  const speak = useCallback((text) => {
    if (!supportsSpeech()) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95
    u.pitch = 1.05
    const voices = window.speechSynthesis.getVoices()
    const friendly = voices.find((v) => /en[-_]GB|en[-_]US/i.test(v.lang) && /Google|Natural|Samantha|Daniel/i.test(v.name))
    if (friendly) u.voice = friendly
    window.speechSynthesis.speak(u)
  }, [])

  // --- Speech to text (voice commands) ---
  const startListening = useCallback(() => {
    if (!supportsVoiceInput()) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim().toLowerCase()
      setListening(false)
      onCommandRef.current?.(transcript)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }, [])

  const stopListening = useCallback(() => {
    recRef.current?.stop()
    setListening(false)
  }, [])

  const toggleListening = useCallback(() => {
    if (listening) stopListening()
    else startListening()
  }, [listening, startListening, stopListening])

  useEffect(() => () => recRef.current?.abort?.(), [])

  return { speak, listening, toggleListening, startListening, stopListening, supported: supportsVoiceInput() }
}
