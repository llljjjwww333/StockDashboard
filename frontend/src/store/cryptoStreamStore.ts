import { create } from 'zustand';
import type { CandleEvent, DepthEvent } from '../lib/cryptoStream';

type StreamState = { depth: Record<string, DepthEvent>; candles: Record<string, CandleEvent[]> };
export const useCryptoStreamStore = create<StreamState>(() => ({ depth: {}, candles: {} }));

export function receiveDepth(event: DepthEvent) {
  useCryptoStreamStore.setState(state => {
    const previous = state.depth[event.ticker];
    if (previous && previous.sequence >= event.sequence) return state;
    return { depth: { [event.ticker]: event } };
  });
}

export function receiveCandle(event: CandleEvent) {
  const key = `${event.ticker}:${event.interval}`;
  useCryptoStreamStore.setState(state => {
    const rows = state.candles[key] ?? [], previous = rows.at(-1);
    if (previous && (event.event_time < previous.event_time || Date.parse(event.point.timestamp) < Date.parse(previous.point.timestamp))) return state;
    const next = previous?.point.timestamp === event.point.timestamp ? [...rows.slice(0, -1), event] : [...rows, event].slice(-4);
    return { candles: { [key]: next } };
  });
}
