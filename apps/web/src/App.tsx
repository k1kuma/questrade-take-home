import { Link, Route, Routes } from 'react-router';
import { PortfolioPage } from './pages/PortfolioPage';
import { PortfoliosPage } from './pages/PortfoliosPage';

export function App() {
  return (
    <main>
      <Routes>
        <Route path="/" element={<PortfoliosPage />} />
        <Route path="/portfolios/:id" element={<PortfolioPage />} />
        <Route
          path="*"
          element={
            <p>
              Page not found. <Link to="/">See all portfolios</Link>
            </p>
          }
        />
      </Routes>
    </main>
  );
}
