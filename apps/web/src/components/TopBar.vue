<script setup lang="ts">
import { computed } from 'vue';
import { useTelemetryStore } from '@/stores/useTelemetryStore';
import {
  Pause,
  Play,
} from 'lucide-vue-next';

const store = useTelemetryStore();

const isSimulating = computed(() => store.isSimulatingFailure);

function toggleSimulation() {
  store.triggerSimulateFailure(!isSimulating.value);
}

function fmtCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}
</script>

<template>
  <header class="h-14 px-5 border-b border-surface-border bg-deep-slate/95 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between select-none whitespace-nowrap">
    <!-- Zona Kiri: Brand Ringkas dengan Logo Icon -->
    <div class="flex items-center gap-3 shrink-0">
      <img
        src="/logo-icon.jpg"
        alt="Vigilux Logo"
        class="h-9 w-9 rounded-lg object-cover border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.2)] shrink-0"
      />
      <span class="font-extrabold text-sm tracking-wider text-white font-mono uppercase">
        VIGILUX // CBM COMMAND
      </span>
    </div>

    <!-- Zona Tengah: Satu Container Kapsul Terpadu -->
    <div class="hidden md:flex items-center divide-x divide-slate-800 bg-slate-900/90 border border-slate-800 rounded-lg px-4 py-1.5 font-mono text-xs">
      <!-- 1. LIVE 1Hz • Latency ms -->
      <div class="flex items-center gap-2 pr-4">
        <span
          class="w-2 h-2 rounded-full shrink-0"
          :class="store.isConnected ? 'bg-emerald-400 pulse-emerald' : 'bg-crimson-400 pulse-crimson'"
        ></span>
        <span class="text-slate-300 font-medium">
          {{ store.isConnected ? 'LIVE 1Hz' : 'OFFLINE' }}
        </span>
        <span class="text-slate-600">•</span>
        <span class="text-cyan-400 font-bold font-mono-tabular">
          {{ store.pingMs !== null ? `${store.pingMs}ms` : '1ms' }}
        </span>
      </div>

      <!-- 2. OPEX WASTE: $104.51/d -->
      <div class="px-4 flex items-center gap-1.5">
        <span class="text-slate-400 text-[11px] font-semibold">OPEX WASTE:</span>
        <span class="text-amber-300 font-bold font-mono-tabular text-xs">
          {{ fmtCurrency(store.totalDailyWasteCost) }}/d
        </span>
      </div>

      <!-- 3. Ringkasan Status Armada: 4 OK | 0 WARN | 1 CRIT -->
      <div class="pl-4 flex items-center gap-2 text-[11px] font-bold">
        <span class="text-emerald-400 font-mono-tabular">
          {{ store.healthyCount }} OK
        </span>
        <span class="text-slate-600">|</span>
        <span class="text-amber-400 font-mono-tabular">
          {{ store.warningCount }} WARN
        </span>
        <span class="text-slate-600">|</span>
        <span class="text-crimson-400 font-mono-tabular">
          {{ store.criticalCount }} CRIT
        </span>
      </div>
    </div>

    <!-- Zona Kanan: Kontrol Compact Satu Baris -->
    <div class="flex items-center gap-2.5 shrink-0">
      <!-- Tombol Compact PAUSE / RESUME -->
      <button
        @click="store.togglePauseStream()"
        type="button"
        class="px-3 py-1 rounded-md text-xs font-semibold font-mono tracking-wide flex items-center gap-1.5 border transition-all duration-200"
        :class="
          store.isStreamPaused
            ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
            : 'bg-surface-muted text-slate-300 border-surface-border hover:border-slate-600 hover:text-white'
        "
        :title="store.isStreamPaused ? 'Resume live chart stream' : 'Pause stream for chart inspection'"
      >
        <component :is="store.isStreamPaused ? Play : Pause" class="w-3.5 h-3.5" />
        <span>{{ store.isStreamPaused ? 'RESUME' : 'PAUSE' }}</span>
      </button>

      <!-- Tombol Ringkas ⚡ SIMULATE FAULT / 🔥 FAULT: MOTOR-03 [STOP] -->
      <button
        @click="toggleSimulation"
        type="button"
        class="px-3 py-1 rounded-md text-xs font-bold font-mono tracking-wide flex items-center gap-1.5 border transition-all duration-200"
        :class="
          isSimulating
            ? 'bg-crimson-600/90 text-white border-crimson-400 shadow-[0_0_15px_rgba(244,63,94,0.5)] animate-pulse'
            : 'bg-surface-muted text-rose-300 border-rose-500/40 hover:border-rose-400 hover:bg-rose-500/10'
        "
      >
        <span>{{ isSimulating ? '🔥 FAULT: MOTOR-03 [STOP]' : '⚡ SIMULATE FAULT' }}</span>
      </button>
    </div>
  </header>
</template>
