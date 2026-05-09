import { useEffect, useState } from 'react';
import type { Company } from '../../server/types';

interface Props {
  value: string;
  onChange: (slug: string) => void;
}

export default function CompanySelector({ value, onChange }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/companies')
      .then((r) => r.json())
      .then((data: Company[]) => {
        setCompanies(data);
        // Auto-select first if no value set
        if (!value && data.length > 0) {
          onChange(data[0].slug);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="company-selector">
      <label htmlFor="company-select">Company:</label>
      <select
        id="company-select"
        className="company-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
      >
        {loading && <option value="">Loading…</option>}
        {companies.map((c) => (
          <option key={c.id} value={c.slug}>
            {c.name} — {c.sector}
          </option>
        ))}
      </select>
    </div>
  );
}
