// Keep one real snapshot for the next paint; never replay a queue after a stall.
export class LatestFrame<T> {
  private pending: T | null = null;
  private frame: number | null = null;
  private publish: (value: T) => void;
  private request: (callback: FrameRequestCallback) => number;
  private cancel: (frame: number) => void;
  private newer: (next: T, current: T) => boolean;

  constructor(publish: (value: T) => void,
    request = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    cancel = (frame: number) => cancelAnimationFrame(frame),
    newer: (next: T, current: T) => boolean = () => true) {
    this.publish = publish;
    this.request = request;
    this.cancel = cancel;
    this.newer = newer;
  }

  offer(value: T) {
    if (this.pending !== null && !this.newer(value, this.pending)) return;
    this.pending = value;
    if (this.frame === null) this.frame = this.request(this.flush);
  }

  private flush = () => {
    this.frame = null;
    const value = this.pending;
    this.pending = null;
    if (value !== null) this.publish(value);
  };

  clear() {
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
    this.pending = null;
  }
}
