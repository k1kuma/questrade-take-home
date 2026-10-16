import { Link, Route, Routes } from 'react-router';
import { PortfolioPage } from './pages/PortfolioPage';
import { PortfoliosPage } from './pages/PortfoliosPage';

export function App() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Portfolio Value
          </Link>
          <span className="topbar-note">Live values in CAD</span>
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<PortfoliosPage />} />
          <Route path="/portfolios/:id" element={<PortfolioPage />} />
          <Route
            path="*"
            element={
              <div className="card">
                <h1>Page not found</h1>
                <p>
                  <Link to="/">See all portfolios</Link>
                </p>
              </div>
            }
          />
        </Routes>
      </main>
    </>
  );
}
