class PerformanceMonitor {
  constructor(logger = console) {
    this.logger = logger;
  }
  
  measureApiCall(endpoint, fn) {
    const start = performance.now();
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        (val) => {
          const duration = performance.now() - start;
          this.logger.info(
            { endpoint, durationMs: duration.toFixed(2) },
            'API call completed'
          );
          if (duration > 1000) {
            this.logger.warn(
              { endpoint, durationMs: duration.toFixed(2) },
              'Slow API call'
            );
          }
          return val;
        },
        (err) => {
          const duration = performance.now() - start;
          this.logger.error(
            { endpoint, durationMs: duration.toFixed(2), error: err ? err.message : String(err) },
            'API call failed'
          );
          throw err;
        }
      );
    }
    const duration = performance.now() - start;
    
    this.logger.info(
      { endpoint, durationMs: duration.toFixed(2) },
      'API call completed'
    );
    
    if (duration > 1000) {
      this.logger.warn(
        { endpoint, durationMs: duration.toFixed(2) },
        'Slow API call'
      );
    }
    
    return result;
  }
  
  trackError(error, context = {}) {
    this.logger.error(
      {
        error: error ? error.message : 'Unknown error',
        stack: error ? error.stack : undefined,
        ...context,
      },
      'Error occurred'
    );
  }
  
  trackEvent(eventName, data = {}) {
    this.logger.info(data, eventName);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PerformanceMonitor;
}
