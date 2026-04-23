interface KpiCardProps {
  title: string;
  value: string | number;
  delta?: string;
  subtitle?: string;
  icon?: React.ReactNode;
}

export default function KpiCard({ title, value, delta, subtitle, icon }: KpiCardProps) {
  return (
    <div className="kpi group">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {title}
        </div>
        {icon && <div className="opacity-70 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--accent)' }}>{icon}</div>}
      </div>
      <div className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      {(delta || subtitle) && (
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {delta || subtitle}
        </div>
      )}
    </div>
  );
}
