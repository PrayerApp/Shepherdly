'use client'

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

interface CoverageData {
  has_shepherd: number
  unconnected_active: number
  connection_percentage: number
}

export default function CareCoverage({ data }: { data: CoverageData }) {
  const connected = data.has_shepherd || 0
  const unconnected = data.unconnected_active || 0
  const total = connected + unconnected

  if (total === 0) {
    return (
      <div className="text-center py-12 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
        No people data yet.
      </div>
    )
  }

  const chartData = [
    { name: 'Connected', value: connected },
    { name: 'Unconnected', value: unconnected },
  ]
  const colors = ['#2d6047', '#dc4a4a']

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={colors[i]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <div className="text-2xl font-serif" style={{ color: 'var(--foreground)' }}>
            {Math.round(data.connection_percentage || 0)}%
          </div>
          <div className="text-xs sans" style={{ color: 'var(--foreground-muted)' }}>connected</div>
        </div>
      </div>
    </div>
  )
}
