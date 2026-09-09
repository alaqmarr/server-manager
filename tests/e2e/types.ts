export interface PM2Summary {
  total: number;
  online: number;
  stopped: number;
  totalMemoryBytes: number;
  avgCpuPercent: number;
}

export interface PM2Process {
  id: number | string;
  name: string;
  pid: number;
  status: 'online' | 'stopped' | 'errored';
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
}

export interface PM2ListResponse {
  success: boolean;
  mode: 'real' | 'mock';
  timestamp: number;
  summary: PM2Summary;
  processes: PM2Process[];
}

export interface PM2ActionRequest {
  action: 'start' | 'stop' | 'restart';
  id: number | string;
}

export interface PM2ActionResponse {
  success: boolean;
  mode: 'real' | 'mock';
  message: string;
}

export interface PortEntry {
  port: number;
  protocol: 'TCP' | 'UDP';
  address: string;
  process: string;
  pid: number;
  state: string;
}

export interface PortsResponse {
  success: boolean;
  mode: 'real' | 'mock';
  ports: PortEntry[];
}

export interface NginxFileEntry {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export interface NginxFilesResponse {
  success: boolean;
  files: NginxFileEntry[];
}

export interface NginxContentResponse {
  success: boolean;
  relativePath: string;
  content: string;
}

export interface NginxSaveRequest {
  relativePath: string;
  content: string;
}

export interface NginxSaveResponse {
  success: boolean;
  message: string;
}

export interface TerminalExecuteRequest {
  command: string;
  cwd?: string;
}

export interface TerminalExecuteResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
}

export interface SetupRequest {
  username: string;
  password: string;
}

export interface SetupResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  assertionCount: number;
}

export interface SuiteSummary {
  suiteName: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: TestResult[];
}

// Enterprise Feature Types (M6 - M10)

export type UserRole = 'admin' | 'developer';

export interface DeployWebhookPayload {
  ref?: string;
  repository?: {
    name?: string;
    full_name?: string;
    [key: string]: any;
  };
  commits?: Array<{
    id?: string;
    message?: string;
    timestamp?: string;
    [key: string]: any;
  }>;
  head_commit?: {
    id?: string;
    message?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface DeployWebhookResponse {
  success: boolean;
  message: string;
  deploymentId: string;
  status?: string;
}

export interface DiscordAlertPayload {
  title?: string;
  description?: string;
  level?: 'info' | 'warning' | 'error';
  content?: string;
  embeds?: any[];
}

export interface DiscordTestResponse {
  success: boolean;
  statusCode: number;
  message: string;
}

export interface SseLogEvent {
  timestamp: string;
  process: string;
  type: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface PmVitalRecord {
  id?: number;
  processId: string;
  processName: string;
  cpu: number;
  memory: number;
  timestamp: string;
}

export interface VitalsHistoryResponse {
  success: boolean;
  data: PmVitalRecord[];
  process?: string;
  hours?: number;
}

export interface Fail2BanJail {
  name: string;
  currentlyFailed: number;
  totalFailed: number;
  currentlyBanned: number;
  totalBanned: number;
  bannedIPs: string[];
}

export interface Fail2BanBannedIP {
  ip: string;
  jail: string;
  bannedAt?: string;
}

export interface Fail2BanStatusResponse {
  success: boolean;
  mode: 'real' | 'mock';
  jails: Fail2BanJail[];
  bannedList: Fail2BanBannedIP[];
}

export interface Fail2BanUnbanRequest {
  jail: string;
  ip: string;
}

export interface Fail2BanUnbanResponse {
  success: boolean;
  mode: 'real' | 'mock';
  message: string;
}

export interface UptimeMonitorRecord {
  id: number;
  name: string;
  url: string;
  intervalSeconds: number;
  createdAt?: string;
  uptimePercentage?: number;
  avgResponseTimeMs?: number;
  lastStatus?: 'UP' | 'DOWN';
}

export interface UptimeCheckRecord {
  id: number;
  monitorId: number;
  statusCode: number;
  responseTimeMs: number;
  status: 'UP' | 'DOWN';
  error?: string | null;
  timestamp: string;
}

export interface UptimeListResponse {
  success: boolean;
  monitors: UptimeMonitorRecord[];
}

export interface UptimeCreateRequest {
  name: string;
  url: string;
  intervalSeconds?: number;
}

export interface UptimeCreateResponse {
  success: boolean;
  monitor: UptimeMonitorRecord;
}

export interface UptimeCheckResponse {
  success: boolean;
  check: UptimeCheckRecord;
}

