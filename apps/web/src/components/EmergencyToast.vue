<script setup lang="ts">
import { ref, watch } from 'vue';
import { useTelemetryStore } from '@/stores/useTelemetryStore';
import type { Incident } from '@/types/telemetry';
import {
  AlertOctagon,
  X,
  Zap,
  DollarSign,
} from 'lucide-vue-next';

const store = useTelemetryStore();

interface ToastItem {
  id: string;
  incident: Incident;
}

const activeToasts = ref<ToastItem[]>([]);

// Watch recent incidents in store and trigger toast notification on new alert
watch(
  () => store.recentIncidents,
  (newIncidents) => {
    if (newIncidents.length > 0) {
      const latest = newIncidents[0];
      const toastId = latest.id || `${latest.asset_id}-${Date.now()}`;

      // Avoid immediate duplicate toast for same incident
      if (!activeToasts.value.some((t) => t.id === toastId)) {
        activeToasts.value.unshift({
          id: toastId,
          incident: latest,
        });

        // Cap to max 3 toasts simultaneously
        if (activeToasts.value.length > 3) {
          activeToasts.value.pop();
        }

        // Auto dismiss after 8 seconds
        setTimeout(() => {
          dismissToast(toastId);
        }, 8000);
      }
    }
  },
  { deep: true }
);

function dismissToast(id: string) {
  activeToasts.value = activeToasts.value.filter((t) => t.id !== id);
}

function fmt(val: number | undefined | null, decimals = 1): string {
  if (val === undefined || val === null || isNaN(val)) return '0.0';
  return val.toFixed(decimals);
}
</script>

<template>
  <div class="fixed top-20 right-6 z-50 flex flex-col gap-3 pointer-events-none select-none max-w-md w-full">
    <TransitionGroup name="toast">
      <div
        v-for="toast in activeToasts"
        :key="toast.id"
        class="pointer-events-auto bg-gradient-to-r from-crimson-950/95 via-deep-slate/95 to-deep-slate/95 border-2 border-crimson-500 rounded-xl p-4 shadow-[0_0_30px_rgba(244,63,94,0.45)] backdrop-blur-xl animate-[pulse_2s_infinite]"
      >
        <div class="flex items-start justify-between gap-3">
          <!-- Icon & Header -->
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-crimson-500/20 border border-crimson-500/50 flex items-center justify-center text-crimson-400 shrink-0">
              <AlertOctagon class="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono font-extrabold uppercase tracking-wider text-crimson-400">
                  CRITICAL ANOMALY ALERT
                </span>
                <span class="px-1.5 py-0.2 rounded bg-crimson-500/20 text-white font-mono text-[10px] font-bold border border-crimson-500/40">
                  {{ toast.incident.asset_id }}
                </span>
              </div>
              <span class="text-[10px] font-mono text-slate-400">
                Score: <strong class="text-crimson-300 font-mono-tabular">{{ fmt(toast.incident.anomaly_score, 2) }}</strong>
              </span>
            </div>
          </div>

          <!-- Close Button -->
          <button
            @click="dismissToast(toast.id)"
            type="button"
            class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Diagnostic Message Body -->
        <p class="text-xs text-slate-200 font-sans mt-2 leading-relaxed">
          {{ toast.incident.diagnostic_message }}
        </p>

        <!-- Impact Footer -->
        <div class="mt-2.5 pt-2 border-t border-crimson-500/30 flex items-center justify-between text-[11px] font-mono">
          <span class="text-amber-400 flex items-center gap-1 font-mono-tabular">
            <Zap class="w-3.5 h-3.5 text-amber-400" />
            Waste: +{{ fmt(toast.incident.waste_kw, 2) }} kW
          </span>
          <span class="text-crimson-300 flex items-center gap-1 font-mono-tabular font-bold">
            <DollarSign class="w-3.5 h-3.5 text-crimson-400" />
            Cost: ${{ fmt(toast.incident.estimated_cost_per_hr, 2) }}/hr
          </span>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(40px) scale(0.95);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(40px) scale(0.95);
}
</style>
