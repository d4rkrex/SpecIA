/**
 * specia stats command
 * 
 * Display token usage and cost analytics
 * REF: .specia/changes/cli-mcp2cli-redesign/spec.md REQ-9
 */

import { Command } from "commander";
import { AnalyticsService } from "../../services/analytics.js";
import { info, error as outputError } from "../output.js";
import path from "path";

export function registerStatsCommand(program: Command): void {
  program
    .command("stats")
    .description("Show token usage and cost analytics")
    .option("--project", "Show only current project operations")
    .option("--export <format>", "Export data (json)")
    .option("--all", "Include all projects in export")
    .action(async (opts) => {
      try {
        const analytics = new AnalyticsService();
        
        const projectPath = opts.project ? process.cwd() : undefined;
        
        if (opts.export) {
          // Export mode
          if (opts.export !== 'json') {
            throw new Error(`Unsupported export format: ${opts.export}. Use 'json'`);
          }
          
          const records = analytics.exportOperations();
          console.log(JSON.stringify(records, null, 2));
        } else {
          // Summary mode
          const summary = analytics.getSummary(projectPath);
          
          if (summary.total_operations === 0) {
            info("No operations tracked yet.");
            return;
          }
          
          // Format output
          const lines = [
            `📊 Token Analytics ${projectPath ? `(${path.basename(projectPath)})` : '(all projects)'}`,
            '',
            `Total operations: ${summary.total_operations}`,
            `Total input tokens: ${summary.total_input_tokens.toLocaleString()}`,
            `Total output tokens: ${summary.total_output_tokens.toLocaleString()}`,
            `Estimated cost: $${summary.total_cost_usd.toFixed(2)}`,
            ''
          ];
          
          if (Object.keys(summary.by_operation).length > 0) {
            lines.push('Breakdown by operation:');
            lines.push('');
            
            // Sort by cost descending
            const sorted = Object.entries(summary.by_operation).sort(
              ([, a], [, b]) => b.cost_usd - a.cost_usd
            );
            
            for (const [op, stats] of sorted) {
              lines.push(
                `  ${op.padEnd(15)} ${stats.count.toString().padStart(3)} ops  ` +
                `${stats.input_tokens.toLocaleString().padStart(8)} in  ` +
                `${stats.output_tokens.toLocaleString().padStart(8)} out  ` +
                `$${stats.cost_usd.toFixed(2)}`
              );
            }
          }
          
          console.log(lines.join('\n'));
        }
        
        analytics.close();
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
