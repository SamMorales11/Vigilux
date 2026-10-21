<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useTelemetryStore } from '@/stores/useTelemetryStore';
import TopBar from '@/components/TopBar.vue';
import FleetStatusPanel from '@/components/FleetStatusPanel.vue';
import DualTimeSeriesChart from '@/components/DualTimeSeriesChart.vue';
import DiagnosticControlPanel from '@/components/DiagnosticControlPanel.vue';
import EmergencyToast from '@/components/EmergencyToast.vue';
import AssetStatusBadge from '@/components/AssetStatusBadge.vue';
import {
  Zap,
  Radio,
  Flame,
  Activity,
} from 'lucide-vue-next';

const store = useTelemetryStore();

onMounted(async () => {
  await store.fetchAssets();
  await store.fetchDemoStatus();
  store.initWebSocket();
});

const currentAsset = computed(() => store.selectedAsset);
const currentTele = computed(() => store.selectedTelemetry);

function fmt(val: number | undefined | null, decimals = 1, fallback = '---'): string {
  if (val === undefined || val === null || isNaN(val)) return fallback;
  return val.toFixed(decimals);
}
</script>

<template>
  <div class="h-screen w-screen overflow-hidden bg-[#090D16] text-slate-100 flex flex-col font-sans select-none selection:bg-cyan-500/20 selection:text-cyan-300">
    <!-- TopBar (Fixed Slim Header: 56px / h-14) -->
    <TopBar class="shrink-0 h-14" />

    <!-- Emergency Incident Toast Overlay -->
    <EmergencyToast />

    <!-- Bento Grid One-Screen Command Center (Zero Main Page Scrolling) -->
    <main class="flex-1 min-h-0 p-3 md:p-3.5 grid grid-cols-12 gap-3 overflow-hidden">
      <!-- Left Bento Cell: Fleet Status Panel (Ranked by Anomaly Score) -->
      <section class="col-span-12 lg:col-span-3 h-full overflow-hidden">
        <FleetStatusPanel />
      </section>

      <!-- Center Bento Cell: Active Asset Inspector & Dual Time-Series Chart -->
      <section class="col-span-12 lg:col-span-6 h-full flex flex-col gap-2.5 min-h-0 overflow-hidden">
        <!-- Active Machine Quick Status Ribbon (Spacious & No Truncation) -->
        <div
          v-if="currentAsset"
          class="shrink-0 glass-panel rounded-xl px-4 py-2 border border-surface-border flex items-center justify-between gap-4 whitespace-nowrap overflow-hidden"
        >
          <!-- Left: Asset ID, Full Untruncated Name & Status Badge -->
          <div class="flex items-center gap-3 shrink-0">
            <div class="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <Activity class="w-4 h-4" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-extrabold font-mono text-white tracking-wide">{{ currentAsset.id }}</span>
                <span class="text-xs text-slate-300 font-sans font-medium">— {{ currentAsset.name }}</span>
                <AssetStatusBadge :status="currentAsset.dynamicStatus" size="sm" />
              </div>
              <p class="text-[10px] text-slate-500 font-mono">
                {{ currentAsset.type }} • Rated: {{ currentAsset.rated_kw }} kW • ISO Limit: {{ currentAsset.iso_vibration_limit }} mm/s
              </p>
            </div>
          </div>

          <!-- Right: Proportionally Spaced Metrics (POWER, VIBRATION, TEMP, SCORE) -->
          <div class="flex items-center divide-x divide-slate-800 bg-slate-900/60 border border-slate-800/80 rounded-lg px-3 py-1 font-mono text-xs shrink-0">
            <!-- 1. POWER -->
            <div class="px-3 flex flex-col items-center">
              <span class="text-[9px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Zap class="w-2.5 h-2.5 text-cyan-400" /> POWER
              </span>
              <span class="text-xs font-bold text-cyan-300 font-mono-tabular">
                {{ fmt(currentTele?.kw, 1) }} <span class="text-[9px] font-normal text-slate-400">kW</span>
              </span>
            </div>

            <!-- 2. VIBRATION -->
            <div class="px-3 flex flex-col items-center">
              <span class="text-[9px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Radio class="w-2.5 h-2.5 text-rose-400" /> VIBRATION
              </span>
              <span
                class="text-xs font-bold font-mono-tabular"
                :class="(currentTele?.vib_rms ?? 0) > currentAsset.iso_vibration_limit ? 'text-crimson-400' : 'text-slate-200'"
              >
                {{ fmt(currentTele?.vib_rms, 2) }} <span class="text-[9px] font-normal text-slate-400">mm/s</span>
              </span>
            </div>

            <!-- 3. TEMP -->
            <div class="px-3 flex flex-col items-center">
              <span class="text-[9px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Flame class="w-2.5 h-2.5 text-amber-400" /> TEMP
              </span>
              <span
                class="text-xs font-bold font-mono-tabular"
                :class="(currentTele?.temp_c ?? 0) > 75 ? 'text-amber-400' : 'text-slate-200'"
              >
                {{ fmt(currentTele?.temp_c, 1) }} <span class="text-[9px] font-normal text-slate-400">°C</span>
              </span>
            </div>

            <!-- 4. SCORE -->
            <div class="pl-3 flex flex-col items-center">
              <span class="text-[9px] text-slate-400 uppercase tracking-wider">SCORE</span>
              <span
                class="text-xs font-extrabold font-mono-tabular"
                :class="{
                  'text-emerald-400': currentAsset.dynamicStatus === 'healthy',
                  'text-amber-400': currentAsset.dynamicStatus === 'warning',
                  'text-crimson-400': currentAsset.dynamicStatus === 'critical',
                }"
              >
                {{ fmt(currentTele?.anomaly_score, 2, '0.00') }}
              </span>
            </div>
          </div>
        </div>

        <!-- Dual Time-Series Chart Component (Fills Remaining Height) -->
        <div class="flex-1 min-h-0 overflow-hidden">
          <DualTimeSeriesChart />
        </div>
      </section>

      <!-- Right Bento Cell: Diagnostic Control & Live Incident Feed -->
      <section class="col-span-12 lg:col-span-3 h-full overflow-hidden">
        <DiagnosticControlPanel />
      </section>
    </main>
  </div>
</template>
