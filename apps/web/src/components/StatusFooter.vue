<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useTelemetryStore } from '@/stores/useTelemetryStore';
import { Download } from 'lucide-vue-next';

const store = useTelemetryStore();

// Ticking clock state
const currentTime = ref(new Date());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    currentTime.value = new Date();
  }, 1000);

  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  window.removeEventListener('keydown', handleKeydown);
});

// Real-time UTC clock (HH:mm:ss UTC)
const utcClock = computed(() => {
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(currentTime.value) + ' UTC'
  );
});

// Real-time WITA clock (UTC+8 / Asia/Makassar)
const witaClock = computed(() => {
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Makassar',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(currentTime.value) + ' WITA'
  );
});

// Spacebar keyboard shortcut listener to toggle stream pause
function handleKeydown(e: KeyboardEvent) {
  if (e.code === 'Space') {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    store.togglePauseStream();
  }
}

// Export active asset's sliding window telemetry to CSV
function exportCsv() {
  const asset = store.selectedAsset;
  const history = store.selectedHistory;

  if (!asset || history.length === 0) {
    alert('No telemetry data available to export for this asset yet.');
    return;
  }

  const headers = [
    'timestamp',
    'asset_id',
    'kw',
    'predicted_kw',
    'waste_gap_kw',
    'waste_pct',
    'rpm',
    'vib_rms',
    'temp_c',
    'pressure',
    'anomaly_score',
    'status',
  ];

  const rows = history.map((pt) => [
    pt.timestamp,
    pt.asset_id,
    pt.kw !== undefined ? pt.kw.toFixed(2) : '',
    pt.predicted_kw !== undefined ? pt.predicted_kw.toFixed(2) : '',
    pt.waste_gap_kw !== undefined ? pt.waste_gap_kw.toFixed(2) : '',
    pt.waste_pct !== undefined ? pt.waste_pct.toFixed(2) : '',
    pt.rpm !== undefined ? pt.rpm.toFixed(1) : '',
    pt.vib_rms !== undefined ? pt.vib_rms.toFixed(2) : '',
    pt.temp_c !== undefined ? pt.temp_c.toFixed(1) : '',
    pt.pressure !== undefined ? pt.pressure.toFixed(2) : '',
    pt.anomaly_score !== undefined ? pt.anomaly_score.toFixed(3) : '',
    pt.status || '',
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const safeTime = new Date().toISOString().replace(/[:.]/g, '-');
  link.setAttribute('download', `telemetry_${asset.id}_${safeTime}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
</script>

<template>
  <footer
    class="h-7 px-5 bg-[#060911] border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 select-none shrink-0 whitespace-nowrap"
  >
    <!-- Zona 1: Status Infrastruktur & Pipeline -->
    <div class="flex items-center gap-3">
      <!-- Database Status -->
      <div class="flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block pulse-emerald"></span>
        <span class="text-slate-300 font-semibold">DB: NEON POSTGRES [BRIN-IDX]</span>
      </div>

      <span class="text-slate-700">|</span>

      <!-- ML Engine Status -->
      <span class="text-slate-400">ML ENGINE: ISOLATION FOREST + LIGHTGBM</span>

      <span class="text-slate-700">|</span>

      <!-- Industrial Standard -->
      <span class="text-slate-400">STANDARD: ISO 10816-3 CLASS II</span>
    </div>

    <!-- Zona 2: Pintasan Operasional Cepat & Fitur Ekspor CSV -->
    <div class="hidden md:flex items-center gap-3">
      <!-- Shortcut Spacebar Pause/Resume Stream -->
      <button
        @click="store.togglePauseStream()"
        type="button"
        class="hover:text-cyan-300 transition-colors flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-slate-800/60"
        :class="store.isStreamPaused ? 'text-amber-400 font-bold' : 'text-slate-400'"
        title="Press Spacebar to pause or resume real-time stream"
      >
        <kbd class="px-1 py-0.2 bg-slate-800 border border-slate-700 rounded text-[9px] text-slate-300 font-mono">SPACE</kbd>
        <span>{{ store.isStreamPaused ? 'RESUME STREAM' : 'PAUSE STREAM' }}</span>
      </button>

      <span class="text-slate-700">|</span>

      <!-- Export Telemetry CSV Button -->
      <button
        @click="exportCsv"
        type="button"
        class="hover:text-cyan-300 transition-colors flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-slate-800/60 text-slate-400"
        title="Export active machine sliding window history to CSV"
      >
        <Download class="w-3 h-3 text-cyan-400" />
        <span>EXPORT TELEMETRY CSV</span>
      </button>
    </div>

    <!-- Zona 3: Jam Operasional Real-Time & Identitas Build -->
    <div class="flex items-center gap-3">
      <!-- Real-time Clocks (UTC & WITA) -->
      <div class="flex items-center gap-2">
        <span class="text-slate-300 font-medium">{{ utcClock }}</span>
        <span class="text-slate-600">•</span>
        <span class="text-cyan-400 font-bold">{{ witaClock }}</span>
      </div>

      <span class="text-slate-700">|</span>

      <!-- Build Version Identity -->
      <span class="text-slate-500 font-semibold tracking-wider">
        VIGILUX CORE v1.0.0-PROD
      </span>
    </div>
  </footer>
</template>
