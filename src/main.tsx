import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeMultiMusicService } from './services/multiMusicService';

// Start fetching data immediately in the background
initializeMultiMusicService().catch(() => {});

createRoot(document.getElementById('root')!).render(<App />);
