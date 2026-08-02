'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

export function VhuBarChart({ data, dataKey = 'count', nameKey = 'label', color = '#2563eb' }: {
  data: Array<Record<string, string | number>>;
  dataKey?: string;
  nameKey?: string;
  color?: string;
}) {
  if (data.length === 0) return <div className="py-8 text-center text-sm text-gray-400">Không có dữ liệu</div>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={nameKey} tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const PIE_COLORS = ['#2563eb', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#4b5563'];

export function VhuPieChart({ data, dataKey = 'count', nameKey = 'label' }: {
  data: Array<Record<string, string | number>>;
  dataKey?: string;
  nameKey?: string;
}) {
  if (data.length === 0) return <div className="py-8 text-center text-sm text-gray-400">Không có dữ liệu</div>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey={dataKey} nameKey={nameKey} outerRadius={90} label>
          {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
        </Pie>
        <Legend />
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
