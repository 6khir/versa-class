const NodeCache = require('node-cache');

class CacheManager {
  constructor(stdTTL = 3600) {
    this.cache = new NodeCache({ stdTTL });
  }
  
  async get(key, fetchFn) {
    const cached = this.cache.get(key);
    if (cached) return cached;
    
    const fresh = await fetchFn();
    this.cache.set(key, fresh);
    return fresh;
  }
  
  set(key, value, ttl = 3600) {
    this.cache.set(key, value, ttl);
  }
  
  clear(key) {
    this.cache.del(key);
  }
  
  clearAll() {
    this.cache.flushAll();
  }
  
  getStats() {
    return this.cache.getStats();
  }
}

module.exports = new CacheManager();
