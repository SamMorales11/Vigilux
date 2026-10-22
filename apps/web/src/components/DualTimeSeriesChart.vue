<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTelemetryStore } from '@/stores/useTelemetryStore';
import { graphic } from 'echarts';
import {
  TrendingUp,
  Radio,
  Eye,
  PauseCircle,
  PlayCircle,
} from 'lucide-vue-next';

const store = useTelemetryStore();

const isHoverPaused = ref(false);

function handleMouseEnter() {
  isHoverPaused.value = true;
  store.setStreamPaused(true);
}

function handleMouseLeave() {
  isHoverPaused.value = false;
  store.setStreamPaused(false);
}

const currentAsset = computed(() => store.selectedAsset);
const history = computed(() => store.selectedHistory);

// Prepare series arrays from sliding-window history
const chartOption = computed(() => {
  const points = history.value;
  const threshold = store.alarmThreshold;

  // Extract time labels (HH:mm:ss)
  const categories = points.map((p) => {
    try {
      const d = new Date(p.timestamp);
      return d.toLocaleTimeString('en-US', { hour12: false });
    } catch {
      return p.timestamp.slice(11, 19);
    }
  });

  const actualKw = points.map((p) => Number((p.kw ?? 0).toFixed(2)));
  const predictedKw = points.map((p) => Number((p.predicted_kw ?? p.kw ?? 0).toFixed(2)));
  const wasteGapKw = points.map((p) => Number(Math.max(0, p.waste_gap_kw ?? (p.kw - (p.predicted_kw ?? p.kw))).toFixed(2)));

  const vibRms = points.map((p) => Number((p.vib_rms ?? 0).toFixed(2)));
  const tempC = points.map((p) => Number((p.temp_c ?? 0).toFixed(1)));
  const anomalyScore = points.map((p) => Number((p.anomaly_score ?? 0).toFixed(3)));

  return {
    backgroundColor: 'transparent',
    animation: false, // Turn off heavy animation for rock-solid 60 FPS live stream
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        label: {
          backgroundColor: '#0F1626',
          borderColor: '#1E293B',
          color: '#38BDF8',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
        },
      },
      backgroundColor: 'rgba(9, 13, 22, 0.95)',
      borderColor: '#1E293B',
      borderWidth: 1,
      textStyle: {
        color: '#F1F5F9',
        fontFamily: 'Inter',
        fontSize: 11,
      },
      formatter: (params: any) => {
        if (!params || !params.length) return '';
        const time = params[0].axisValueLabel || '';
        let html = `<div class="font-mono text-xs font-bold text-cyan-400 mb-1.5 pb-1 border-b border-slate-700/80">${time}</div>`;
        html += '<div class="space-y-1 font-mono text-[11px]">';
        params.forEach((item: any) => {
          const val = typeof item.value === 'number' ? item.value : '---';
          html += `
            <div class="flex items-center justify-between gap-4">
              <span class="flex items-center gap-1.5 text-slate-300">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color};"></span>
                <span>${item.seriesName}</span>
              </span>
              <span class="font-bold text-white font-mono-tabular">${val}</span>
            </div>
          `;
        });
        html += '</div>';
        return html;
      },
    },
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      lineStyle: {
        color: 'rgba(6, 182, 212, 0.4)',
        type: 'dashed',
      },
    },
    legend: {
      top: 2,
      right: 8,
      itemGap: 12,
      textStyle: {
        color: '#94A3B8',
        fontSize: 10,
        fontFamily: 'Inter',
      },
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 4,
    },
    grid: [
      // Top Grid: Power & Waste Gap (Clearance below legend)
      {
        left: '52px',
        right: 48,
        top: 36,
        height: '35%',
        containLabel: false,
      },
      // Bottom Grid: Vibration, Temp & Anomaly Score
      {
        left: '52px',
        right: 48,
        top: '57%',
        height: '35%',
        containLabel: false,
      },
    ],
    xAxis: [
      // Top Grid X-Axis
      {
        type: 'category',
        gridIndex: 0,
        data: categories,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#1E293B' } },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      // Bottom Grid X-Axis (Synchronized time axis)
      {
        type: 'category',
        gridIndex: 1,
        data: categories,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#1E293B' } },
        axisTick: { lineStyle: { color: '#334155' } },
        axisLabel: {
          color: '#64748B',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          interval: Math.max(1, Math.floor(categories.length / 8)),
        },
        splitLine: {
          show: true,
          lineStyle: { color: 'rgba(30, 41, 59, 0.4)', type: 'dashed' },
        },
      },
    ],
    yAxis: [
      // Top Grid Y-Axis (Power kW)
      {
        type: 'value',
        gridIndex: 0,
        name: 'kW',
        nameTextStyle: { color: '#64748B', fontSize: 10, align: 'right', padding: [0, 8, 4, 0] },
        scale: true,
        splitLine: {
          lineStyle: { color: 'rgba(30, 41, 59, 0.6)', type: 'dashed' },
        },
        axisLabel: {
          color: '#94A3B8',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          margin: 8,
        },
      },
      // Bottom Grid Y-Axis Left (Vib RMS & Temp)
      {
        type: 'value',
        gridIndex: 1,
        name: 'Vib / Temp',
        nameTextStyle: { color: '#64748B', fontSize: 10, align: 'left', padding: [0, 0, 4, -40] },
        scale: true,
        splitLine: {
          lineStyle: { color: 'rgba(30, 41, 59, 0.6)', type: 'dashed' },
        },
        axisLabel: {
          color: '#94A3B8',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          margin: 8,
        },
      },
      // Bottom Grid Y-Axis Right (Anomaly Score 0.00 to 1.00)
      {
        type: 'value',
        gridIndex: 1,
        position: 'right',
        min: 0,
        max: 1,
        name: 'Score',
        nameTextStyle: { color: '#F43F5E', fontSize: 10, align: 'left', padding: [0, 0, 4, 8] },
        splitLine: { show: false },
        axisLabel: {
          color: '#F43F5E',
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          margin: 8,
          formatter: (v: number) => v.toFixed(2),
        },
      },
    ],
    series: [
      // 1. Actual Power (kW) - Cyan Curve
      {
        name: 'Actual Power (kW)',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: actualKw,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2.2, color: '#06B6D4' },
        itemStyle: { color: '#06B6D4' },
      },
      // 2. LightGBM Predicted Baseline (kW) - Dashed Line
      {
        name: 'LightGBM Baseline (kW)',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: predictedKw,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.8, type: 'dashed', color: '#94A3B8' },
        itemStyle: { color: '#94A3B8' },
      },
      // 3. Energy Waste Gap (kW) - Red Shaded Area
      {
        name: 'Energy Waste Gap',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: wasteGapKw,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: '#F43F5E' },
        itemStyle: { color: '#F43F5E' },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(244, 63, 94, 0.45)' },
            { offset: 1, color: 'rgba(244, 63, 94, 0.05)' },
          ]),
        },
      },
      // 4. Vibration RMS (mm/s) - Crimson
      {
        name: 'Vib RMS (mm/s)',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: vibRms,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: '#F43F5E' },
        itemStyle: { color: '#F43F5E' },
      },
      // 5. Bearing Temp (°C) - Amber
      {
        name: 'Temp (°C)',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: tempC,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.8, color: '#F59E0B' },
        itemStyle: { color: '#F59E0B' },
      },
      // 6. Anomaly Score with Real-Time Dynamic Alarm Threshold MarkLine
      {
        name: 'Anomaly Score',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 2,
        data: anomalyScore,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: '#E11D48' },
        itemStyle: { color: '#E11D48' },
        areaStyle: {
          color: 'rgba(225, 29, 72, 0.08)',
        },
        markLine: {
          symbol: 'none',
          silent: true,
          data: [
            {
              yAxis: threshold,
              lineStyle: {
                type: 'dashed',
                color: '#F43F5E',
                width: 2,
              },
              label: {
                position: 'insideEndTop',
                formatter: `Alarm Threshold: ${threshold.toFixed(2)}`,
                color: '#F43F5E',
                fontFamily: 'JetBrains Mono',
                fontWeight: 'bold',
                fontSize: 10,
                backgroundColor: 'rgba(9, 13, 22, 0.85)',
                padding: [2, 6],
                borderRadius: 4,
                borderColor: '#F43F5E',
                borderWidth: 1,
              },
            },
          ],
        },
      },
    ],
  };
});
</script>

<template>
  <div
    class="relative flex flex-col h-full bg-surface/50 border border-surface-border rounded-2xl p-4 overflow-hidden select-none"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <!-- Chart Header -->
    <div class="flex items-center justify-between pb-2 mb-2 border-b border-surface-border">
      <div class="flex items-center gap-2">
        <div class="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
          <TrendingUp class="w-4 h-4" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-bold font-mono tracking-wider text-white uppercase">
              Dual Time-Series Telemetry
            </h2>
            <span v-if="currentAsset" class="text-xs font-mono text-cyan-300 font-semibold px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30">
              [{{ currentAsset.id }}]
            </span>
          </div>
          <p class="text-[11px] text-slate-400 font-sans">
            Synchronized Power / Energy Gap (Top) & Vibration / Thermal / ML Anomaly (Bottom)
          </p>
        </div>
      </div>

      <!-- Live Hover Status Indicator -->
      <div class="flex items-center gap-2">
        <span
          class="text-[11px] font-mono px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-all"
          :class="
            isHoverPaused || store.isStreamPaused
              ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.15)]'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
          "
        >
          <component
            :is="isHoverPaused || store.isStreamPaused ? PauseCircle : PlayCircle"
            class="w-3.5 h-3.5"
            :class="isHoverPaused || store.isStreamPaused ? 'text-amber-400' : 'text-emerald-400'"
          />
          <span>{{ isHoverPaused ? 'HOVER PAUSED' : store.isStreamPaused ? 'PAUSED' : 'LIVE 1 Hz' }}</span>
        </span>
      </div>
    </div>

    <!-- ECharts Synchronized Dual-Grid Canvas -->
    <div class="flex-1 w-full min-h-[360px] relative">
      <v-chart
        class="w-full h-full"
        :option="chartOption"
        autoresize
      />

      <!-- Empty State If No Data Points Yet -->
      <div
        v-if="history.length === 0"
        class="absolute inset-0 flex flex-col items-center justify-center bg-deep-slate/80 text-slate-400 font-mono text-xs"
      >
        <Radio class="w-8 h-8 text-cyan-400 animate-pulse mb-2" />
        <span>Awaiting 1 Hz telemetry stream...</span>
      </div>
    </div>

    <!-- Bottom Chart Annotation Footer -->
    <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
      <span class="flex items-center gap-1.5">
        <Eye class="w-3.5 h-3.5 text-slate-400" />
        <span>Hover anywhere on canvas to freeze tooltip inspection</span>
      </span>
      <span class="text-slate-400">
        Sliding Window: <strong class="text-white font-mono-tabular">{{ history.length }}</strong> / 90 sec
      </span>
    </div>
  </div>
</template>
