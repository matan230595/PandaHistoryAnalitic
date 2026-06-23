import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'system-ui, sans-serif', color: '#e5e7eb' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🐼</div>
          <h2 style={{ color: '#fb7185', marginBottom: 8 }}>משהו השתבש</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 20 }}>
            {this.state.error?.message || 'שגיאה לא צפויה'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 24px', borderRadius: 12, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(56,189,248,.18)', color: '#e5e7eb', cursor: 'pointer', fontWeight: 700 }}
          >
            טען מחדש
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
