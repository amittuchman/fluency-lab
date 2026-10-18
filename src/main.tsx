import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-sans-hebrew/400.css'
import '@fontsource/noto-sans-hebrew/600.css'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import { App } from './ui/App'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
