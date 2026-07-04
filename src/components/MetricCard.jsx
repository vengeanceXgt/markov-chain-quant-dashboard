// src/components/MetricCard.jsx
import React from 'react';

export default function MetricCard({ label, value, subtext, icon: Icon, color = 'cyan', trend }) {
  // trend: 'up' | 'down' | 'neutral'
  
  const getTrendClass = () => {
    if (trend === 'up') return 'text-green';
    if (trend === 'down') return 'text-red';
    return 'text-muted';
  };
  
  return (
    <div className={`kpi-card ${color}`}>
      <div className="kpi-content">
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{value}</span>
        {subtext && (
          <span className={`kpi-subtext ${getTrendClass()}`}>
            {subtext}
          </span>
        )}
      </div>
      {Icon && (
        <div className="kpi-icon-wrapper">
          <Icon size={18} strokeWidth={2.5} />
        </div>
      )}
    </div>
  );
}
