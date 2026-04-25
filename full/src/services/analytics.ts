/**
 * Token Analytics Service
 * 
 * Tracks LLM token usage and costs to SQLite database.
 * 
 * SECURITY: Uses parameterized queries exclusively (Mitigation T-02, AC-001)
 * REF: .specia/changes/cli-mcp2cli-redesign/spec.md REQ-9
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { validateChangeName, checkDatabaseSize } from "../utils/validation.js";

export interface OperationRecord {
  id?: number;
  timestamp: string;
  operation: string;
  change_name: string | null;
  project_path: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  provider: string;
  model: string;
  execution_time_ms: number;
}

export interface AnalyticsSummary {
  total_operations: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  by_operation: Record<string, {
    count: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }>;
}

export class AnalyticsService {
  private db: Database.Database | null = null;
  private dbPath: string;
  private disabled: boolean = false;

  constructor(customPath?: string, disableAnalytics: boolean = false) {
    this.disabled = disableAnalytics;
    
    if (disableAnalytics) {
      this.dbPath = ''; // No path needed when disabled
      return;
    }

    // Default: ~/.local/share/specia/analytics.db
    const dataDir = customPath 
      ? path.dirname(customPath)
      : path.join(os.homedir(), '.local', 'share', 'specia');
    
    this.dbPath = customPath || path.join(dataDir, 'analytics.db');
    
    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.initDatabase();
  }

  private initDatabase(): void {
    if (this.disabled) return;

    this.db = new Database(this.dbPath);
    
    // Create schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        change_name TEXT,
        project_path TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        execution_time_ms INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_timestamp ON operations(timestamp);
      CREATE INDEX IF NOT EXISTS idx_operation ON operations(operation);
      CREATE INDEX IF NOT EXISTS idx_project_path ON operations(project_path);
      CREATE INDEX IF NOT EXISTS idx_change_name ON operations(change_name);
    `);
  }

  /**
   * Track a single operation
   * 
   * SECURITY: Uses parameterized queries exclusively (Mitigation T-02, AC-001)
   * Validates change_name before insertion
   */
  trackOperation(record: Omit<OperationRecord, 'id'>): void {
    if (this.disabled || !this.db) return;

    // CRITICAL: Validate change_name to prevent SQL injection (T-02, AC-001)
    if (record.change_name) {
      const validation = validateChangeName(record.change_name);
      if (!validation.valid) {
        throw new Error(`Invalid change_name: ${validation.error}`);
      }
    }

    // Check database size limit (DOS-01 mitigation)
    const sizeCheck = checkDatabaseSize(this.dbPath);
    if (!sizeCheck.withinLimit) {
      this.rotateDatabase();
    }

    // SECURITY: Parameterized query (NEVER string concatenation)
    const stmt = this.db.prepare(`
      INSERT INTO operations (
        timestamp, operation, change_name, project_path,
        input_tokens, output_tokens, cost_usd,
        provider, model, execution_time_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.timestamp,
      record.operation,
      record.change_name,
      record.project_path,
      record.input_tokens,
      record.output_tokens,
      record.cost_usd,
      record.provider,
      record.model,
      record.execution_time_ms
    );
  }

  /**
   * Get analytics summary (all operations or project-scoped)
   */
  getSummary(projectPath?: string): AnalyticsSummary {
    if (this.disabled || !this.db) {
      return this.emptySummary();
    }

    let whereClause = '';
    const params: any[] = [];
    
    if (projectPath) {
      whereClause = 'WHERE project_path = ?';
      params.push(projectPath);
    }

    // Aggregate totals
    const totalsStmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total_operations,
        COALESCE(SUM(input_tokens), 0) as total_input_tokens,
        COALESCE(SUM(output_tokens), 0) as total_output_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd
      FROM operations
      ${whereClause}
    `);

    const totals = totalsStmt.get(...params) as any;

    // Breakdown by operation
    const byOpStmt = this.db.prepare(`
      SELECT 
        operation,
        COUNT(*) as count,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM operations
      ${whereClause}
      GROUP BY operation
    `);

    const byOpRows = byOpStmt.all(...params) as any[];
    
    const by_operation: Record<string, any> = {};
    for (const row of byOpRows) {
      by_operation[row.operation] = {
        count: row.count,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cost_usd: row.cost_usd
      };
    }

    return {
      total_operations: totals.total_operations,
      total_input_tokens: totals.total_input_tokens,
      total_output_tokens: totals.total_output_tokens,
      total_cost_usd: totals.total_cost_usd,
      by_operation
    };
  }

  /**
   * Export all operations as JSON
   * 
   * SECURITY: Excludes spec_content by default (ID-02 mitigation)
   * @param _includeSpecs - Reserved for future use to include spec content with warning
   */
  exportOperations(_includeSpecs: boolean = false): OperationRecord[] {
    if (this.disabled || !this.db) {
      return [];
    }

    // Basic export without sensitive data
    const stmt = this.db.prepare(`
      SELECT 
        id, timestamp, operation, change_name, project_path,
        input_tokens, output_tokens, cost_usd,
        provider, model, execution_time_ms
      FROM operations
      ORDER BY timestamp DESC
    `);

    return stmt.all() as OperationRecord[];
  }

  /**
   * Rotate database when size limit exceeded (DOS-01 mitigation)
   */
  private rotateDatabase(): void {
    if (!this.db) return;

    this.db.close();

    const backupPath = `${this.dbPath}.1`;
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    fs.renameSync(this.dbPath, backupPath);

    // Reinitialize fresh database
    this.initDatabase();
  }

  private emptySummary(): AnalyticsSummary {
    return {
      total_operations: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
      by_operation: {}
    };
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * Token pricing by provider and model
 */
export const TOKEN_PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  anthropic: {
    'claude-sonnet-4': { input: 3, output: 15 },           // per 1M tokens
    'claude-sonnet-3.5': { input: 3, output: 15 },
    'claude-opus-4': { input: 15, output: 75 },
    'claude-haiku-3.5': { input: 0.8, output: 4 },
  },
  openai: {
    'gpt-4': { input: 30, output: 60 },
    'gpt-4-turbo': { input: 10, output: 30 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  }
};

/**
 * Calculate cost from token usage
 */
export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = TOKEN_PRICING[provider]?.[model];
  if (!pricing) {
    return 0; // Unknown model, return 0 cost
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  
  return inputCost + outputCost;
}
