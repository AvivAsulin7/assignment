import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Overview } from './pages/Overview';
import { Upload } from './pages/Upload';
import { FridgeDetail } from './pages/FridgeDetail';
import './styles.css';

function App() {
  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">Fridge Monitor</Link>
        <nav>
          <Link to="/upload">Upload</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/fridges/:id" element={<FridgeDetail />} />
        </Routes>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
