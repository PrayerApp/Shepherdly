'use client'

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

interface CoverageData {
  has_shepherd: number
  unconnected_active: number
  connection_percentage?: number
  connection_pct?: number
}

/*
 * Donut chart with a percentage label in the center. Renders only the
 * chart body — wrap with <ChartCard> for title and `legend` for the
 * dot legend so it sits inside the card with the chart, not as a
 * detached HTML row underneath.
 */
export default function CareCoverage({ data }: { data: CoverageData }) {
  const connected = data.has_shepherd || 0
  const unconnected = data.unconnected_active || 0
  const pct = data.connection_percentage ?? data.connection_pct ?? 0

  const chartData = [
    { name: 'Connected', value: connected, fill: 'var(--color-green-700)' },
    { name: 'Unconnected', value: unconnected, fill: 'var(--color-red-500)' },
  ]

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="font-serif text-2xl text-neutral-900">
            {Math.round(pct)}%
          </div>
          <div className="text-xs text-neutral-500">connected</div>
        </div>
      </div>
    </div>
  )
}
