<script setup lang="ts">
import { computed } from 'vue';
import type { AssetStatus } from '@/types';

const props = withDefaults(
  defineProps<{
    status: AssetStatus | string;
    showPulse?: boolean;
    size?: 'sm' | 'md' | 'lg';
  }>(),
  {
    showPulse: true,
    size: 'md',
  }
);

const normalizedStatus = computed(() => props.status.toLowerCase());

const statusConfig = computed(() => {
  switch (normalizedStatus.value) {
    case 'healthy':
      return {
        label: 'HEALTHY',
        badgeBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        dotBg: 'bg-emerald-400',
        pulseClass: 'pulse-emerald',
      };
    case 'warning':
      return {
        label: 'WARNING',
        badgeBg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        dotBg: 'bg-amber-400',
        pulseClass: 'pulse-amber',
      };
    case 'critical':
      return {
        label: 'CRITICAL',
        badgeBg: 'bg-crimson-500/10 text-crimson-400 border-crimson-500/30',
        dotBg: 'bg-crimson-400',
        pulseClass: 'pulse-crimson',
      };
    default:
      return {
        label: 'OFFLINE',
        badgeBg: 'bg-slate-700/30 text-slate-400 border-slate-600/30',
        dotBg: 'bg-slate-500',
        pulseClass: '',
      };
  }
});

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'text-xs px-2 py-0.5 gap-1.5';
    case 'lg':
      return 'text-sm px-3 py-1.5 gap-2.5';
    default:
      return 'text-xs px-2.5 py-1 gap-2';
  }
});
</script>

<template>
  <span
    class="inline-flex items-center font-mono font-semibold tracking-wider rounded-full border transition-all duration-300"
    :class="[statusConfig.badgeBg, sizeClasses]"
  >
    <span
      class="w-2 h-2 rounded-full shrink-0"
      :class="[statusConfig.dotBg, showPulse ? statusConfig.pulseClass : '']"
    ></span>
    <span>{{ statusConfig.label }}</span>
  </span>
</template>
