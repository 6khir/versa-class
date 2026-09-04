const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_STARTUP_DELAY_MS = 12 * 1000;

class UpdateManager {
  constructor({
    autoUpdater,
    currentVersion,
    enabled,
    onStateChange = () => {},
    onDownloaded = () => {},
    logger = console,
    startupDelayMs = DEFAULT_STARTUP_DELAY_MS,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS
  }) {
    this.autoUpdater = autoUpdater;
    this.enabled = Boolean(enabled);
    this.onStateChange = onStateChange;
    this.onDownloaded = onDownloaded;
    this.logger = logger;
    this.startupDelayMs = startupDelayMs;
    this.checkIntervalMs = checkIntervalMs;
    this.startupTimer = null;
    this.intervalTimer = null;
    this.started = false;
    this.listeners = [];
    this.state = {
      status: this.enabled ? 'idle' : 'disabled',
      currentVersion,
      availableVersion: null,
      percent: null,
      message: null,
      checkedAt: null
    };
  }

  getState() {
    return { ...this.state };
  }

  setState(changes) {
    this.state = { ...this.state, ...changes };
    this.onStateChange(this.getState());
  }

  listen(eventName, listener) {
    this.autoUpdater.on(eventName, listener);
    this.listeners.push([eventName, listener]);
  }

  start() {
    if (!this.enabled || this.started) return;
    this.started = true;
    this.autoUpdater.autoDownload = true;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.allowPrerelease = false;
    this.autoUpdater.logger = this.logger;

    try {
      this.autoUpdater.setFeedURL?.({
        provider: 'generic',
        url: 'https://podnetwork.store/downloads/tpt-book-automation'
      });
    } catch (err) {
      this.logger.error?.('Failed setting auto-updater feed URL:', err);
    }

    this.listen('checking-for-update', () => {
      this.setState({ status: 'checking', percent: null, message: 'Checking for updates…' });
    });
    this.listen('update-available', (info) => {
      this.setState({
        status: 'available',
        availableVersion: info?.version ?? null,
        percent: 0,
        message: `Downloading version ${info?.version ?? ''}…`.trim()
      });
    });
    this.listen('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));
      if (this.state.status === 'downloading' && this.state.percent === percent) return;
      this.setState({
        status: 'downloading',
        percent,
        message: `Downloading update… ${percent}%`
      });
    });
    this.listen('update-downloaded', (info) => {
      this.setState({
        status: 'ready',
        availableVersion: info?.version ?? this.state.availableVersion,
        percent: 100,
        message: 'Update ready — restart to install'
      });
      this.onDownloaded(info);
    });
    this.listen('update-not-available', () => {
      this.setState({
        status: 'up-to-date',
        availableVersion: null,
        percent: null,
        message: null,
        checkedAt: new Date().toISOString()
      });
    });
    this.listen('error', (error) => {
      this.logger.error?.('Automatic update check failed:', error);
      this.setState({
        status: 'error',
        percent: null,
        message: 'Update service is temporarily unavailable',
        checkedAt: new Date().toISOString()
      });
    });

    this.startupTimer = setTimeout(() => this.check().catch(() => {}), this.startupDelayMs);
    this.startupTimer.unref?.();
    this.intervalTimer = setInterval(() => this.check().catch(() => {}), this.checkIntervalMs);
    this.intervalTimer.unref?.();
  }

  async check(force = false) {
    if (!this.enabled) return this.getState();
    if (!force && ['checking', 'available', 'downloading', 'ready', 'installing'].includes(this.state.status)) {
      return this.getState();
    }
    this.setState({ status: 'checking', percent: null, message: 'Checking for updates…' });
    try {
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      this.logger.error?.('Automatic update check failed:', error);
      this.setState({
        status: 'error',
        percent: null,
        message: 'Update service is temporarily unavailable',
        checkedAt: new Date().toISOString()
      });
    }
    return this.getState();
  }

  install() {
    if (!this.enabled || this.state.status !== 'ready') return false;
    this.setState({ status: 'installing', message: 'Restarting to install update…' });
    this.autoUpdater.quitAndInstall(false, true);
    return true;
  }

  stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startupTimer = null;
    this.intervalTimer = null;
    for (const [eventName, listener] of this.listeners) {
      this.autoUpdater.removeListener(eventName, listener);
    }
    this.listeners = [];
    this.started = false;
  }
}

module.exports = {
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_STARTUP_DELAY_MS,
  UpdateManager
};
