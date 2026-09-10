'use strict';

const { join } = require('node:path');

const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const CORE_PIPELINE_STAGES = Object.freeze(['text', 'pages', 'mockups']);

function slugAccountId(value) {
  return String(value || 'default')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'default';
}

function accountUserDataDir(rootDir, account = {}) {
  if (account.userDataDir) return String(account.userDataDir);
  return join(String(rootDir || ''), 'accounts', slugAccountId(account.profileKey || account.id || account.email));
}

function normalizeAccount(entry, rootDir) {
  if (!entry) return null;
  const raw = typeof entry === 'string' ? { profileKey: entry, profileName: entry } : entry;
  if (typeof raw !== 'object') return null;
  const profileKey = String(raw.profileKey || raw.id || 'Default');
  const id = slugAccountId(raw.id || profileKey);
  const providers = Array.isArray(raw.providers) && raw.providers.length
    ? [...new Set(raw.providers.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))]
    : ['gemini', 'chatgpt', 'meta'];
  return {
    id,
    profileKey,
    profileName: String(raw.profileName || profileKey),
    browser: String(raw.browser || 'Google Chrome Canary'),
    email: String(raw.email || ''),
    providers,
    userDataDir: accountUserDataDir(rootDir, { ...raw, profileKey, id }),
    enabled: raw.enabled !== false,
    rateLimitedUntil: Number(raw.rateLimitedUntil) || 0
  };
}

function isQuotaError(error) {
  const code = String(error?.code || '');
  if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') return true;
  return /quota exceeded|usage (?:cap|limit)|rate limit|limit resets/i.test(String(error?.message || ''));
}

class AccountPool {
  constructor({ rootDir, accounts = [], currentIndex = 0, enabled = false } = {}) {
    this.rootDir = rootDir;
    this.accounts = (Array.isArray(accounts) ? accounts : [])
      .map((item) => normalizeAccount(item, rootDir))
      .filter(Boolean);
    this.currentIndex = Math.max(0, Math.min(Number(currentIndex) || 0, Math.max(0, this.accounts.length - 1)));
    this.enabled = Boolean(enabled);
  }

  current() {
    return this.accounts[this.currentIndex] || null;
  }

  canFailover() {
    return this.enabled && this.accounts.filter((account) => account.enabled).length > 1;
  }

  markRateLimited(ms = QUOTA_COOLDOWN_MS) {
    const account = this.current();
    if (!account) return null;
    account.rateLimitedUntil = Date.now() + Math.max(60_000, Number(ms) || QUOTA_COOLDOWN_MS);
    return account;
  }

  nextAvailable() {
    if (!this.accounts.length) return null;
    const now = Date.now();
    for (let step = 1; step < this.accounts.length; step += 1) {
      const index = (this.currentIndex + step) % this.accounts.length;
      const account = this.accounts[index];
      if (!account.enabled) continue;
      if (Number(account.rateLimitedUntil) > now) continue;
      return { account, index };
    }
    return null;
  }

  activate(index) {
    if (!this.accounts.length) return this.current();
    this.currentIndex = Math.max(0, Math.min(Number(index) || 0, this.accounts.length - 1));
    return this.current();
  }

  toJSON() {
    return {
      accounts: this.accounts,
      currentIndex: this.currentIndex,
      enabled: this.enabled
    };
  }

  static fromRotation(profiles, options = {}) {
    const rootDir = options.rootDir;
    const currentIndex = Math.max(0, Number(options.currentIndex) || 0);
    const previous = Array.isArray(options.previousAccounts) ? options.previousAccounts : [];
    const prevByKey = new Map(previous.map((account) => [String(account.profileKey || account.id), account]));
    const accounts = (Array.isArray(profiles) ? profiles : []).map((item, index) => {
      const raw = typeof item === 'string' ? { profileKey: item, profileName: item } : { ...item };
      const key = String(raw.profileKey || raw.id || 'Default');
      const existing = prevByKey.get(key);
      if (!raw.userDataDir && existing?.userDataDir) raw.userDataDir = existing.userDataDir;
      if (!raw.userDataDir && index === currentIndex && rootDir) raw.userDataDir = rootDir;
      if (existing?.rateLimitedUntil && !raw.rateLimitedUntil) raw.rateLimitedUntil = existing.rateLimitedUntil;
      if (existing?.providers && !raw.providers) raw.providers = existing.providers;
      return raw;
    });
    return new AccountPool({
      rootDir,
      accounts,
      currentIndex,
      enabled: options.enabled
    });
  }
}

module.exports = {
  AccountPool,
  CORE_PIPELINE_STAGES,
  QUOTA_COOLDOWN_MS,
  accountUserDataDir,
  isQuotaError,
  normalizeAccount,
  slugAccountId
};
