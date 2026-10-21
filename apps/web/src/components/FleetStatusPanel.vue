<script setup lang="ts">
import { useTelemetryStore } from '@/stores/useTelemetryStore';
import type { EnrichedAsset } from '@/types/telemetry';
import AssetStatusBadge from '@/components/AssetStatusBadge.vue';
import {
  Layers,
  Zap,
  Radio,
  TrendingUp,
  AlertOctagon,
  ChevronRight,
  ShieldCheck,
} from 'lucide-vue-next';

const store = useTelemetryStore();

function formatNum(val: number | undefined | null, decimals = 1, fallback = '---'): string {
  if (val === undefined || val === null || isNaN(val)) return fallback;
  return val.toFixed(decimals);
}

function getWastePct(asset: EnrichedAsset): number {
  if (!asset.currentKwValue || asset.currentKwValue <= 0) return 0;
  if (!asset.wasteGapKwValue || asset.wasteGapKwValue <= 0) return 0;
  return Number(((asset.wasteGapKwValue / asset.currentKwValue) * 100).toFixed(1));
}
</script>

<template>
  <aside class="flex flex-col h-full bg-surface/50 border border-surface-border rounded-2xl p-4 overflow-hidden select-none">
    <!-- Panel Header -->
    <div class="flex items-center justify-between pb-3.5 mb-3 border-b border-surface-border">
      <div class="flex items-center gap-2">
        <div class="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
          <Layers class="w-4 h-4" />
        </div>
        <div>
          <h2 class="text-sm font-bold font-mono tracking-wider text-white uppercase">Fleet Health Monitor</h2>
          <p class="text-[11px] text-slate-400 font-sans">Ranked by Real-Time Anomaly Severity</p>
        </div>
      </div>

      <span class="text-xs font-mono font-bold text-slate-400 bg-surface-muted px-2.5 py-1 rounded-md border border-slate-700/60 font-mono-tabular">
        {{ store.sortedAssets.length }} ASSETS
      </span>
    </div>

    <!-- Scrollable Auto-Sorted Asset Cards with Smooth Transition -->
    <div class="flex-1 overflow-y-auto pr-1 space-y-2.5 custom-scrollbar">
      <TransitionGroup name="fleet-list" tag="div" class="space-y-2.5 relative">
        <div
          v-for="asset in store.sortedAssets"
          :key="asset.id"
          @click="store.selectAsset(asset.id)"
          class="group relative rounded-xl p-3.5 border cursor-pointer transition-all duration-300 backdrop-blur-sm"
          :class="[
            // Status Critical: Glowing Pulsing Red Border
            asset.dynamicStatus === 'critical'
              ? 'bg-crimson-950/20 border-crimson-500 shadow-[0_0_20px_rgba(244,63,94,0.4)] animate-pulse'
              : asset.dynamicStatus === 'warning'
                ? 'bg-amber-950/10 border-amber-500/40 hover:border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.12)]'
                : 'bg-surface-muted/40 border-surface-border hover:border-slate-600',
            // Active selection highlight
            store.selectedAssetId === asset.id
              ? 'ring-2 ring-cyan-400/80 border-cyan-400/80 shadow-[0_0_18px_rgba(6,182,212,0.25)]'
              : '',
          ]"
        >
          <!-- Top Row: ID, Name, Status Badge, Anomaly Score -->
          <div class="flex items-center justify-between mb-2.5">
            <div class="flex items-center gap-2">
              <span class="text-sm font-extrabold font-mono text-white tracking-wide group-hover:text-cyan-300 transition-colors">
                {{ asset.id }}
              </span>
              <span class="text-xs text-slate-400 font-sans">({{ asset.type }})</span>
            </div>

            <!-- Anomaly Score Badge -->
            <div class="flex items-center gap-2">
              <AssetStatusBadge :status="asset.dynamicStatus" size="sm" :show-pulse="true" />
              <div
                class="px-2 py-0.5 rounded text-xs font-mono font-bold font-mono-tabular border"
                :class="{
                  'bg-emerald-500/10 text-emerald-400 border-emerald-500/30': asset.dynamicStatus === 'healthy',
                  'bg-amber-500/10 text-amber-400 border-amber-500/30': asset.dynamicStatus === 'warning',
                  'bg-crimson-500/20 text-crimson-400 border-crimson-500/50': asset.dynamicStatus === 'critical',
                }"
              >
                {{ asset.currentScore.toFixed(2) }}
              </div>
            </div>
          </div>

          <!-- Middle Metrics Row: Power kW, Waste Gap %, Vibration RMS -->
          <div class="grid grid-cols-3 gap-2 py-2 border-t border-b border-slate-800/80 font-mono text-xs whitespace-nowrap">
            <!-- Power kW -->
            <div class="flex flex-col">
              <span class="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Zap class="w-2.5 h-2.5 text-cyan-400" /> Active kW
              </span>
              <span class="font-bold text-slate-200 font-mono-tabular">
                {{ formatNum(asset.currentKwValue, 1) }}
              </span>
            </div>

            <!-- Waste Gap % -->
            <div class="flex flex-col">
              <span class="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <TrendingUp class="w-2.5 h-2.5 text-amber-400" /> Waste Gap
              </span>
              <span
                class="font-bold font-mono-tabular"
                :class="asset.wasteGapKwValue > 0.5 ? 'text-amber-400' : 'text-slate-400'"
              >
                <template v-if="asset.wasteGapKwValue > 0.1">
                  +{{ getWastePct(asset) }}%
                </template>
                <template v-else>
                  0.0%
                </template>
              </span>
            </div>

            <!-- Vibration RMS -->
            <div class="flex flex-col">
              <span class="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Radio class="w-2.5 h-2.5 text-rose-400" /> Vib RMS
              </span>
              <span
                class="font-bold font-mono-tabular"
                :class="asset.currentVibRmsValue > asset.iso_vibration_limit ? 'text-crimson-400' : 'text-slate-200'"
              >
                {{ formatNum(asset.currentVibRmsValue, 2) }} <span class="text-[9px] text-slate-500">mm/s</span>
              </span>
            </div>
          </div>

          <!-- Bottom Row: Diagnostic Warning / ISO Status -->
          <div class="mt-2 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span v-if="asset.dynamicStatus === 'critical'" class="text-crimson-400 font-semibold flex items-center gap-1">
              <AlertOctagon class="w-3 h-3 text-crimson-400" /> ISO Vibration Exceeded!
            </span>
            <span v-else-if="asset.dynamicStatus === 'warning'" class="text-amber-400 font-semibold flex items-center gap-1">
              Elevated Friction Detected
            </span>
            <span v-else class="text-emerald-400/90 flex items-center gap-1">
              <ShieldCheck class="w-3 h-3 text-emerald-400" /> Nominal State
            </span>

            <span class="text-slate-500 group-hover:text-cyan-400 transition-colors flex items-center gap-0.5">
              <span>Inspect</span>
              <ChevronRight class="w-3 h-3" />
            </span>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </aside>
</template>

<style scoped>
/* Smooth gliding re-order transitions for fleet auto-sort */
.fleet-list-move,
.fleet-list-enter-active,
.fleet-list-leave-active {
  transition: all 0.45s cubic-bezier(0.25, 1, 0.5, 1);
}

.fleet-list-enter-from,
.fleet-list-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}

.fleet-list-leave-active {
  position: absolute;
}
</style>
