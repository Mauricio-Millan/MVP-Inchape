import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Mapa3DView } from './views/Mapa3DView.tsx'

// La app no usa react-router (una sola vista con estado, ver App.tsx) --
// para la ventana 3D standalone (se abre con window.open, no navega
// dentro de la SPA) alcanza con mirar el hash antes de montar: nunca
// toca el servidor, así que funciona igual en dev y en cualquier
// despliegue estático sin configurar rutas del lado del servidor.
const raiz = location.hash === '#mapa3d' ? <Mapa3DView /> : <App />

createRoot(document.getElementById('root')!).render(<StrictMode>{raiz}</StrictMode>)
