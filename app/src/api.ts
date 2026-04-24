// Thin typed wrapper over Tauri's invoke() for all our backend commands.
import { invoke } from '@tauri-apps/api/core';
import type {
  DealRow,
  HistoryFilter,
  LogFile,
  OverviewStats,
  ScheduleConfig,
  SecretEntry,
  SourceStat,
  Status,
  UpdateInfo,
} from './types';

export const api = {
  // Config
  readConfig: () => invoke<string>('read_config'),
  writeConfig: (content: string) => invoke<void>('write_config', { content }),
  getConfigDir: () => invoke<string>('get_config_dir'),

  // Sidecar
  runNow: (dry = false) => invoke<void>('run_now', { dry }),
  getStatus: () => invoke<Status>('get_status'),

  // Secrets
  readSecrets: (reveal = false) => invoke<SecretEntry[]>('read_secrets', { reveal }),
  writeSecrets: (entries: SecretEntry[]) => invoke<void>('write_secrets', { entries }),

  // Schedule
  getSchedule: () => invoke<ScheduleConfig>('get_schedule'),
  setSchedule: (config: ScheduleConfig) => invoke<void>('set_schedule', { config }),
  getNextRuns: (count: number) => invoke<number[]>('get_next_runs', { count }),

  // DB queries
  getRecentDeals: (limit = 10) => invoke<DealRow[]>('get_recent_deals', { limit }),
  getQueue: () => invoke<DealRow[]>('get_queue'),
  setListingState: (id: string, state: string) =>
    invoke<void>('set_listing_state', { id, state }),
  getHistory: (filter: HistoryFilter) => invoke<DealRow[]>('get_history', { filter }),
  getSourceStats: () => invoke<SourceStat[]>('get_source_stats'),
  getOverview: () => invoke<OverviewStats>('get_overview'),

  // Logs
  listLogs: () => invoke<LogFile[]>('list_logs'),
  tailLog: (name?: string, maxLines = 500) => invoke<string>('tail_log', { name, maxLines }),

  // Util
  openUrl: (url: string) => invoke<void>('open_url', { url }),

  // Data management
  exportBackup: () => invoke<string>('export_backup'),
  wipeDatabase: () => invoke<number>('wipe_database'),

  // Version + updates
  getVersion: () => invoke<string>('get_version'),
  checkForUpdates: () => invoke<UpdateInfo>('check_for_updates'),

  // Autostart on boot
  getAutostartEnabled: () => invoke<boolean>('get_autostart_enabled'),
  setAutostartEnabled: (enabled: boolean) =>
    invoke<void>('set_autostart_enabled', { enabled }),

  // Target generation (LLM-assisted)
  generateTargetYaml: (description: string) =>
    invoke<{ yaml: string; model: string; duration_ms: number }>(
      'generate_target_yaml',
      { description },
    ),
};
