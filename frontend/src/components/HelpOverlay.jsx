import React from 'react'
import { X, Volume2, Mic, MousePointerClick, Type, Contrast, HelpCircle, Cloud } from 'lucide-react'

export default function HelpOverlay({ onClose, speak }) {
  const speakable = (text) => () => speak?.(text)

  return (
    <div className="help-overlay" role="dialog" aria-modal="true" aria-label="Help">
      <div className="help-card">
        <div className="help-header">
          <h2>How to use MyLife</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close help">
            <X size={20} />
          </button>
        </div>

        <ul className="help-list">
          <li>
            <span className="help-icon"><MousePointerClick size={18} /></span>
            <div>
              <strong>Pick a page</strong>
              <p>The big buttons on the left take you to Spending, To-Do List, Work, Schedule, Export and Settings.</p>
            </div>
            <button className="btn btn-small" onClick={speakable('Pick a page. The big buttons on the left take you to Spending, To Do List, Work, Schedule, Export and Settings.')}>
              <Volume2 size={14} /> Listen
            </button>
          </li>
          <li>
            <span className="help-icon"><Volume2 size={18} /></span>
            <div>
              <strong>Read aloud</strong>
              <p>Use the speaker button in the toolbar to hear the current page read to you.</p>
            </div>
            <button className="btn btn-small" onClick={speakable('Use the speaker button in the toolbar to hear the current page read to you.')}>
              <Volume2 size={14} /> Listen
            </button>
          </li>
          <li>
            <span className="help-icon"><Mic size={18} /></span>
            <div>
              <strong>Voice navigation</strong>
              <p>Tap the microphone and say a page name, like &quot;Spending&quot; or &quot;To Do List&quot;, to jump there.</p>
            </div>
            <button className="btn btn-small" onClick={speakable('Tap the microphone and say a page name, like Spending or To Do List, to jump there.')}>
              <Volume2 size={14} /> Listen
            </button>
          </li>
          <li>
            <span className="help-icon"><Type size={18} /></span>
            <div>
              <strong>Make text bigger</strong>
              <p>Use the A+ and A− buttons to change the size of all text.</p>
            </div>
            <button className="btn btn-small" onClick={speakable('Use the A plus and A minus buttons to change the size of all text.')}>
              <Volume2 size={14} /> Listen
            </button>
          </li>
          <li>
            <span className="help-icon"><Contrast size={18} /></span>
            <div>
              <strong>High contrast</strong>
              <p>Turn on high contrast for easier reading, and the dyslexia font if you prefer it.</p>
            </div>
            <button className="btn btn-small" onClick={speakable('Turn on high contrast for easier reading, and the dyslexia font if you prefer it.')}>
              <Volume2 size={14} /> Listen
            </button>
          </li>
          <li>
            <span className="help-icon"><HelpCircle size={18} /></span>
            <div>
              <strong>Save your data</strong>
              <p>Everything is saved automatically on this device and linked to your account.</p>
            </div>
            <button className="btn btn-small" onClick={speakable('Everything is saved automatically on this device and linked to your account.')}>
              <Volume2 size={14} /> Listen
            </button>
          </li>
          <li>
            <span className="help-icon"><Cloud size={18} /></span>
            <div>
              <strong>My Google page</strong>
              <p>Open &quot;My Google&quot; in the menu to see your Gmail inbox, Drive files, Sheets and Calendar in one place.</p>
            </div>
            <button className="btn btn-small" onClick={speakable('Open My Google in the menu to see your Gmail inbox, Drive files, Sheets and Calendar in one place.')}>
              <Volume2 size={14} /> Listen
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}
