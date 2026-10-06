import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export function Chart({ option, height = 300, onClick }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const chart = echarts.init(ref.current, null, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.on('click', (params) => {
      if (clickRef.current) clickRef.current(params);
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ height, width: '100%' }} />;
}

const AXIS = {
  axisLine: { lineStyle: { color: '#2b3442' } },
  axisLabel: { color: '#8b98a9', fontSize: 11 },
  splitLine: { lineStyle: { color: '#1a212c' } },
};
const TIP = {
  backgroundColor: '#161b24',
  borderColor: '#2b3442',
  textStyle: { color: '#e6edf3', fontSize: 12 },
};

export function timelineOption(timeline) {
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TIP,
      trigger: 'axis',
      valueFormatter: (v) => (v == null ? '—' : Number(v).toLocaleString()),
    },
    legend: { textStyle: { color: '#8b98a9' }, top: 0 },
    grid: { left: 56, right: 20, top: 34, bottom: 46 },
    xAxis: { type: 'time', ...AXIS },
    yAxis: { type: 'value', ...AXIS },
    dataZoom: [
      { type: 'inside' },
      { type: 'slider', height: 18, bottom: 6, borderColor: '#2b3442', backgroundColor: '#12161d', textStyle: { color: '#8b98a9' } },
    ],
    series: [
      {
        name: 'lines added',
        type: 'line',
        stack: 'x',
        showSymbol: false,
        areaStyle: { opacity: 0.7 },
        lineStyle: { width: 1, color: '#3fb950' },
        itemStyle: { color: '#3fb950' },
        data: timeline.map((b) => [b.t * 1000, b.plus]),
      },
      {
        name: 'lines removed',
        type: 'line',
        stack: 'x',
        showSymbol: false,
        areaStyle: { opacity: 0.7 },
        lineStyle: { width: 1, color: '#f85149' },
        itemStyle: { color: '#f85149' },
        data: timeline.map((b) => [b.t * 1000, b.minus]),
      },
      {
        name: 'commits',
        type: 'line',
        yAxisIndex: 0,
        showSymbol: false,
        lineStyle: { width: 1.5, color: '#58a6ff', type: 'dashed' },
        itemStyle: { color: '#58a6ff' },
        data: timeline.map((b) => [b.t * 1000, b.commits]),
      },
    ],
  };
}

function nestDirs(dirs) {
  const root = { name: 'repo', path: '', children: [] };
  const byPath = { '': root };
  const sorted = [...dirs].sort((a, b) => a.path.localeCompare(b.path));
  for (const d of sorted) {
    if (!d.path) continue;
    const segs = d.path.split('/');
    let cur = root;
    let cp = '';
    for (const s of segs) {
      cp = cp ? cp + '/' + s : s;
      if (!byPath[cp]) {
        const node = { name: s, path: cp, children: [] };
        byPath[cp] = node;
        cur.children.push(node);
      }
      cur = byPath[cp];
    }
    cur.value = d.churn;
    cur.mods = d.mods;
    cur.leaf = true;
  }
  const prune = (n) => {
    if (!n.children.length) delete n.children;
    else n.children.forEach(prune);
  };
  prune(root);
  return root;
}

export function treemapOption(dirs) {
  const top = dirs.filter((d) => d.path).slice(0, 400);
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TIP,
      formatter: (p) => {
        const d = p.data;
        const v = d.value || 0;
        const mods = d.mods || 0;
        return `<b>${d.path || '(root)'}</b><br/>churn: ${v.toLocaleString()} lines<br/>modifications: ${mods.toLocaleString()}`;
      },
    },
    series: [
      {
        type: 'treemap',
        roam: true,
        nodeClick: 'zoomToNode',
        breadcrumb: { show: true, top: 0, textStyle: { color: '#8b98a9' } },
        label: { show: true, formatter: '{b}', fontSize: 12, color: '#e6edf3' },
        upperLabel: { show: true, height: 24, color: '#e6edf3', backgroundColor: '#1a212c' },
        itemStyle: { borderColor: '#0b0f14', borderWidth: 2, gapWidth: 2 },
        levels: [
          { itemStyle: { borderWidth: 0, gapWidth: 3 } },
          { itemStyle: { borderWidth: 2, gapWidth: 2 } },
          { colorSaturation: [0.35, 0.6] },
        ],
        color: ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#39c5cf', '#ff9bce'],
        data: [nestDirs(top)],
      },
    ],
  };
}

export function topFilesOption(files) {
  const top = files.slice(0, 15).reverse();
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TIP,
      formatter: (p) =>
        `<b>${p.name}</b><br/>churn: ${Number(p.value).toLocaleString()} lines<br/>modifications: ${top[p.dataIndex]?.mods?.toLocaleString() ?? '—'}`,
    },
    grid: { left: 8, right: 40, top: 10, bottom: 24, containLabel: true },
    xAxis: { type: 'value', ...AXIS },
    yAxis: {
      type: 'category',
      data: top.map((f) => (f.path.length > 42 ? '…' + f.path.slice(-41) : f.path)),
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, fontFamily: 'ui-monospace, monospace' },
    },
    series: [
      {
        type: 'bar',
        data: top.map((f) => f.churn),
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#1f6feb' },
              { offset: 1, color: '#f85149' },
            ],
          },
        },
      },
    ],
  };
}

export function authorsOption(authors) {
  const top = authors.slice(0, 12).reverse();
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...TIP,
      formatter: (p) => {
        const a = top[p.dataIndex];
        return `<b>${a.name}</b> &lt;${a.email}&gt;<br/>churn: ${a.churn.toLocaleString()} lines<br/>ownership: ${(a.ownership * 100).toFixed(1)}%<br/>commits: ${a.commits.toLocaleString()}`;
      },
    },
    grid: { left: 8, right: 40, top: 10, bottom: 24, containLabel: true },
    xAxis: { type: 'value', ...AXIS },
    yAxis: { type: 'category', data: top.map((a) => (a.name.length > 24 ? a.name.slice(0, 23) + '…' : a.name)), ...AXIS },
    series: [
      {
        type: 'bar',
        data: top.map((a) => a.churn),
        itemStyle: { borderRadius: [0, 4, 4, 0], color: '#a371f7' },
      },
    ],
  };
}
