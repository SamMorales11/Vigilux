<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    value: string | number;
    unit?: string;
    subValue?: string;
    status?: 'healthy' | 'warning' | 'critical' | 'cyan' | 'neutral';
    iconName?: string;
  }>(),
  {
    unit: '',
    subValue: '',
    status: 'neutral',
  }
);

const statusColorClasses = computed(() => {
  switch (props.status) {
    case 'healthy':
      return {
        text: 'text-emerald-400',
        border: 'border-emerald-500/20 hover:border-emerald-500/40',
        glow: 'shadow-[0_0_15px_rgba(16,185,129,0.08)]',
      };
    case 'warning':
      return {
        text: 'text-amber-400',
        border: 'border-amber-500/20 hover:border-amber-500/40',
        glow: 'shadow-[0_0_15px_rgba(245,158,11,0.08)]',
      };
    case 'critical':
      return {
        text: 'text-crimson-400',
        border: 'border-crimson-500/20 hover:border-crimson-500/40',
        glow: 'shadow-[0_0_15px_rgba(244,63,94,0.08)]',
      };
    case 'cyan':
      return {
        text: 'text-cyan-400',
        border: 'border-cyan-500/20 hover:border-cyan-500/40',
        glow: 'shadow-[0_0_15px_rgba(6,182,212,0.08)]',
      };
    default:
      return {
        text: 'text-slate-100',
        border: 'border-surface-border hover:border-slate-700',
        glow: '',
      };
  }
});
</script>

<template>
  <div
    class="glass-panel rounded-xl p-4 transition-all duration-300 relative overflow-hidden group"
    :class="[statusColorClasses.border, statusColorClasses.glow]"
  >
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs uppercase tracking-wider text-slate-400 font-medium">
        {{ title }}
      </span>
      <div v-if="$slots.icon" class="text-slate-400 group-hover:text-cyan-400 transition-colors">
        <slot name="icon"></slot>
      </div>
    </div>

    <!-- Live value container with Zero Layout Shift -->
    <div class="flex items-baseline gap-1.5 my-1">
      <span
        class="text-2xl font-bold font-mono-tabular tracking-tight transition-colors duration-300"
        :class="statusColorClasses.text"
      >
        {{ value }}
      </span>
      <span v-if="unit" class="text-xs font-mono text-slate-400 font-medium">
        {{ unit }}
      </span>
    </div>

    <div v-if="subValue || $slots.footer" class="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between">
      <slot name="footer">
        <span>{{ subValue }}</span>
      </slot>
    </div>
  </div>
</template>
