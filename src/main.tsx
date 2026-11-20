import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initAndroidSafeArea} from './utils/androidSafeArea';

initAndroidSafeArea();

createRoot(document.getElementById('root')!).render(<App />);
