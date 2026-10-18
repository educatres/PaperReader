import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

// Do not reload an active research session automatically when a new release arrives.
registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(<App />);
