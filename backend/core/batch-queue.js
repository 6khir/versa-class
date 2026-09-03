class BatchQueue {
  constructor(flushInterval = 100) {
    this.queue = [];
    this.flushInterval = flushInterval;
    this.timer = null;
    this.onFlush = null;
  }
  
  add(request) {
    this.queue.push(request);
    this.scheduleFlush();
  }
  
  scheduleFlush() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.flushInterval);
  }
  
  async flush() {
    if (this.queue.length === 0) {
      this.timer = null;
      return;
    }
    
    const batch = { operations: this.queue };
    
    if (this.onFlush) {
      await this.onFlush(batch);
    }
    
    this.queue = [];
    this.timer = null;
  }
  
  setFlushHandler(handler) {
    this.onFlush = handler;
  }
}

module.exports = new BatchQueue();
