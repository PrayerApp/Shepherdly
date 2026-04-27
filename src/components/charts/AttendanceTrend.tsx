'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface TrendPoint {
  week_start: string
  unique_attenders: number
  total_checkins: number
}

/*
 * Renders only the chart body. Wrap with <ChartCard> for title, empty
 * state, legend. Colors come from the Tailwind/CSS-var palette so the
 * line treatment stays in sync with the rest of the dashboard.
 */
export default function AttendanceTrend({ data }: { data: TrendPoint[] }) {
  const formatted = data.map(d => ({
    ...d,
    label: new Date(d.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={formatted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--foreground-muted)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--foreground-muted)' }} />
        <Tooltip
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
          }}
          labelStyle={{ fontWeight: 600 }}
        />
        <Line
          type="monotone"
          dataKey="unique_attenders"
          stroke="var(--color-green-700)"
          strokeWidth={2}
          dot={false}
          name="Unique Attenders"
        />
        <Line
          type="monotone"
          dataKey="total_checkins"
          stroke="var(--color-gold-500)"
          strokeWidth={2}
          dot={false}
          name="Total Check-ins"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
