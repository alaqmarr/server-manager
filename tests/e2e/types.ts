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
